/**
 * Hono app — the host-side lightweight backend (§10, §11A).
 *
 * Responsibilities:
 *  - REST routes the SPA needs → forwarded to the runtime via RuntimeClient
 *    (byte passthrough, 修正4: no parsing, no state).
 *  - SSE route → byte-pipes the runtime's event stream to the client.
 *  - Local config routes (settings/providers) → read/write on-disk config
 *    (NOT proxied; backend owns this, §11A.2).
 *  - Static serving of the web build (@brainpilot/web dist) with SPA fallback.
 *  - Health endpoint.
 *
 * The app is mounted under `/api` for the proxied/local routes (the SPA calls
 * `API_BASE = "/api"`), with static assets served at the root.
 */
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { RUNTIME_ROUTES } from "@brainpilot/protocol";
import { RuntimeClient } from "./runtime-client.js";
import type { Orchestrator } from "./orchestrator.js";
import {
  readLocalSettings,
  writeLocalSettings,
  resolveProvider,
} from "./config.js";

export interface CreateAppOptions {
  orchestrator: Orchestrator;
  /** Data dir for local config routes. Default `./brainpilot`. */
  dataDir?: string;
  /** Web build dir to serve. Default `$BP_WEB_ROOT` or `packages/web/dist`. */
  webRoot?: string;
  /** Injectable fetch for the runtime client (tests). */
  fetchFn?: typeof fetch;
  /** Disable static serving (tests that only exercise the API). */
  serveWeb?: boolean;
  env?: Record<string, string | undefined>;
}

/** Headers that must not be copied verbatim onto an SSE passthrough. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

export function createApp(options: CreateAppOptions): Hono {
  const dataDir = options.dataDir ?? process.env.BP_DATA_DIR ?? "./brainpilot";
  const webRoot = options.webRoot ?? process.env.BP_WEB_ROOT ?? "packages/web/dist";
  const orchestrator = options.orchestrator;
  const env = options.env;

  // Lazily-created runtime client, bound to the ensured runtime's baseUrl.
  let client: RuntimeClient | null = null;
  async function getClient(): Promise<RuntimeClient> {
    const handle = await orchestrator.ensureRuntime();
    if (!client || (client as { _baseUrl?: string })._baseUrl !== handle.baseUrl) {
      client = new RuntimeClient({ baseUrl: handle.baseUrl, fetchFn: options.fetchFn });
      (client as { _baseUrl?: string })._baseUrl = handle.baseUrl;
    }
    return client;
  }

  const app = new Hono();
  const api = new Hono();

  // ---- Health (backend-local; does not require runtime) ----------------
  api.get("/health", (c) => c.json({ status: "ok" }));

  api.get("/version", (c) => c.json({ name: "@brainpilot/backend-core", version: "0.1.0" }));

  // ---- Sessions (proxied to runtime) -----------------------------------
  api.get("/sessions", forward("listSessions"));
  api.post("/sessions", forward("createSession", { withBody: true }));
  api.get("/sessions/:id", forward("getSession", { idParam: "id" }));
  api.put("/sessions/:id", forwardRename());
  api.delete("/sessions/:id", forward("deleteSession", { idParam: "id" }));
  api.get("/sessions/:id/state", forward("getSessionState", { idParam: "id" }));
  api.post("/sessions/:id/messages", forward("sendMessage", { idParam: "id", withBody: true }));
  api.post("/sessions/:id/interrupt", forward("interrupt", { idParam: "id", withBody: true }));
  api.get("/sessions/:id/agents", forward("listAgents", { idParam: "id" }));
  api.post("/sessions/:id/evict", forward("evictSession", { idParam: "id", withBody: true }));

  // ---- SSE byte passthrough (修正4) ------------------------------------
  // Canonical protocol path `/sse/:id` (RUNTIME_ROUTES.sessionEvents) plus the
  // SPA's `/sessions/:id/sse` and the `/sessions/:id/events` alias.
  api.get("/sse/:id", sseHandler);
  api.get("/sessions/:id/sse", sseHandler);
  api.get("/sessions/:id/events", sseHandler);

  // ---- Local config routes (NOT proxied; §11A.2) -----------------------
  api.get("/settings", async (c) => {
    const settings = await readLocalSettings({ dataDir, env });
    return c.json(settings);
  });
  api.put("/settings", async (c) => {
    const body = await safeJson(c);
    await writeLocalSettings(dataDir, {
      model: typeof body.model === "string" ? body.model : undefined,
      apiKey: typeof body.api_key === "string" ? body.api_key : (typeof body.apiKey === "string" ? body.apiKey : undefined),
      baseUrl: typeof body.base_url === "string" ? body.base_url : (typeof body.baseUrl === "string" ? body.baseUrl : undefined),
    });
    return c.json(await readLocalSettings({ dataDir, env }));
  });
  // Provider profiles: single-user open-source mode exposes the resolved
  // provider as one active profile (sourced from the §11A.2 priority chain).
  api.get("/provider/profiles", async (c) => {
    const resolved = await resolveProvider({ dataDir, env });
    return c.json(resolved.apiKey ? [providerProfile(resolved)] : []);
  });
  api.get("/provider/profiles/active", async (c) => {
    const resolved = await resolveProvider({ dataDir, env });
    return c.json(resolved.apiKey ? providerProfile(resolved) : null);
  });

  // Mount the API under /api (the SPA's API_BASE).
  app.route("/api", api);

  // ---- Static web serving with SPA fallback ----------------------------
  if (options.serveWeb !== false) {
    app.use("/*", serveStatic({ root: webRoot }));
    // SPA fallback: any unmatched GET that isn't /api returns index.html.
    app.get("/*", serveStatic({ path: `${webRoot}/index.html` }));
  }

  return app;

  // ---------------- helpers ----------------

  function forward(
    route: keyof typeof RUNTIME_ROUTES,
    opts: { idParam?: string; withBody?: boolean } = {},
  ) {
    return async (c: import("hono").Context) => {
      const rc = await getClient();
      const params: Record<string, string> = {};
      if (opts.idParam) params.id = c.req.param(opts.idParam) ?? "";
      const body = opts.withBody ? await c.req.text() : undefined;
      const headers: Record<string, string> = {};
      const ct = c.req.header("content-type");
      if (ct) headers["content-type"] = ct;
      const upstream = await rc.forward(route, {
        params,
        body: body && body.length > 0 ? body : undefined,
        headers,
      });
      return relay(c, upstream);
    };
  }

  // The SPA's PUT /sessions/:id (rename) has no dedicated runtime route in
  // §15.4; forward it to the runtime's getSession path with PUT semantics via
  // a raw forward so the runtime can handle/ignore it. We reuse sendMessage's
  // session path shape but keep method PUT by hitting getSession's path.
  function forwardRename() {
    return async (c: import("hono").Context) => {
      const rc = await getClient();
      const id = c.req.param("id") ?? "";
      const body = await c.req.text();
      // getSession route path is `/sessions/:id`; issue a PUT against it.
      const url = rc.urlFor("getSession", { id });
      const upstream = await (options.fetchFn ?? fetch)(url, {
        method: "PUT",
        headers: { "content-type": c.req.header("content-type") ?? "application/json" },
        body: body && body.length > 0 ? body : undefined,
      });
      return relay(c, upstream);
    };
  }

  async function sseHandler(c: import("hono").Context): Promise<Response> {
    const rc = await getClient();
    const id = c.req.param("id") ?? "";
    const upstream = await rc.openSse(id, {
      query: c.req.query("token") ? `token=${encodeURIComponent(c.req.query("token")!)}` : undefined,
    });
    // 修正4: do not parse the stream — relay the byte body untouched.
    const headers = new Headers();
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
    });
    if (!headers.has("content-type")) headers.set("content-type", "text/event-stream");
    headers.set("cache-control", "no-cache");
    headers.set("connection", "keep-alive");
    return new Response(upstream.body, { status: upstream.status, headers });
  }
}

/** Relay a runtime Response to the client, preserving status + safe headers. */
function relay(c: import("hono").Context, upstream: Response): Response {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  return new Response(upstream.body, { status: upstream.status, headers });
}

async function safeJson(c: import("hono").Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function providerProfile(resolved: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Record<string, unknown> {
  const now = Date.now();
  const masked = resolved.apiKey
    ? resolved.apiKey.length <= 8
      ? "****"
      : `${resolved.apiKey.slice(0, 4)}…${resolved.apiKey.slice(-4)}`
    : "";
  return {
    id: "local",
    name: "Local",
    base_url: resolved.baseUrl ?? "",
    models: resolved.model ? [resolved.model] : [],
    icon: "circle",
    icon_color: "#111111",
    notes: "",
    is_active: true,
    api_key_masked: masked,
    created_at: now,
    updated_at: now,
    health_status: "unknown",
    model_health: [],
  };
}
