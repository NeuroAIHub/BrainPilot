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
import { createRequire } from "node:module";
import { join } from "node:path";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import {
  RUNTIME_ROUTES,
  McpServerConfigSchema,
  ProviderProfileCreateSchema,
  ProviderProfileUpdateSchema,
  deriveProviderApi,
} from "@brainpilot/protocol";
import { RuntimeClient } from "./runtime-client.js";
import { probeProvider } from "./provider-probe.js";
import type { Orchestrator } from "./orchestrator.js";
import {
  readLocalSettings,
  writeLocalSettings,
  resolveProvider,
  readProviders,
  createProfile,
  updateProfile,
  deleteProfile,
  setSelectedProfile,
  setProfileHealth,
  readMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  type StoredProviderProfile,
} from "./config.js";

export interface CreateAppOptions {
  orchestrator: Orchestrator;
  /** Data dir for local config routes. Default `./brainpilot`. */
  dataDir?: string;
  /** Web build dir to serve. Default `$BP_WEB_ROOT` or `packages/web/dist`. */
  webRoot?: string;
  /** Injectable fetch for the runtime client (tests). */
  fetchFn?: typeof fetch;
  /** #55: timeout (ms) for the provider connectivity probe. Default 5000. */
  providerProbeTimeoutMs?: number;
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

// #46: report the real package version instead of a hardcoded literal. Read at
// module load from this package's own package.json (one level above dist/) so
// the value always tracks the published @brainpilot/backend-core version
// (kept in lockstep with the root version via `npm run version:sync`).
const pkg = createRequire(import.meta.url)("../package.json") as {
  name: string;
  version: string;
};

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

  api.get("/version", (c) => c.json({ name: pkg.name, version: pkg.version }));

  // ---- Identity (backend-local) ----------------------------------------
  // Trust-front (#21): hosted deployments resolve identity at the upstream
  // gateway, which intercepts /api/auth/me before it reaches us. For
  // self-hosted `bp --up` there is no gateway, so we answer locally with a
  // single default identity. Without this the SPA's auth bootstrap 404s into a
  // hosted-login redirect loop (#38). Shape matches the web `User` contract.
  api.get("/auth/me", (c) =>
    c.json({ id: "local", username: "local", createdAt: new Date(0).toISOString() }),
  );

  // ---- Metrics (proxied to runtime; idle-reclaim source, §15.4 修正2) --
  api.get("/metrics", forward("metrics"));

  // ---- Sessions (proxied to runtime) -----------------------------------
  api.get("/sessions", forward("listSessions"));
  api.post("/sessions", forward("createSession", { withBody: true }));
  api.get("/sessions/:id", forward("getSession", { idParam: "id" }));
  api.put("/sessions/:id", forward("updateSession", { idParam: "id", withBody: true }));
  api.delete("/sessions/:id", forward("deleteSession", { idParam: "id" }));
  api.get("/sessions/:id/state", forward("getSessionState", { idParam: "id" }));
  api.get("/sessions/:id/trace", forward("getTrace", { idParam: "id" }));
  // Persisted event tail for chat rehydrate after a restart. SSE replays only
  // the in-memory ring; this endpoint reads events.jsonl on disk. Carries the
  // ?limit query verbatim.
  api.get("/sessions/:id/history", forward("getSessionHistory", { idParam: "id", withQuery: true }));
  api.post("/sessions/:id/messages", forward("sendMessage", { idParam: "id", withBody: true }));
  api.post("/sessions/:id/interrupt", forward("interrupt", { idParam: "id", withBody: true }));
  api.get("/sessions/:id/agents", forward("listAgents", { idParam: "id" }));
  api.post("/sessions/:id/evict", forward("evictSession", { idParam: "id", withBody: true }));

  // ---- Workspace files (proxied to runtime) ----------------------------
  // The SPA addresses files under `/sandbox/:id/*`; in single-user mode the
  // sandbox id IS the session id, so we forward straight to the runtime's
  // `/sessions/:id/files*` routes. `?path=` is carried through verbatim.
  api.get("/sandbox/:id/files", forward("listFiles", { idParam: "id", withQuery: true }));
  api.get("/sandbox/:id/files/content", forward("readFile", { idParam: "id", withQuery: true }));
  api.get("/sandbox/:id/files/raw", forward("readRawFile", { idParam: "id", withQuery: true }));
  api.delete("/sandbox/:id/files", forward("deleteFile", { idParam: "id", withQuery: true }));
  // #47: file upload — POST the base64 body through to the runtime writeFile route.
  api.post("/sandbox/:id/files", forward("writeFile", { idParam: "id", withBody: true }));

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
  // Provider profiles (SSOT = providers.json). Full CRUD; the active/selected
  // profile is what new sessions default to. Keys are masked on the way out.
  api.get("/provider/profiles", async (c) => {
    const { profiles, selectedProfileId } = await readProviders(dataDir);
    return c.json(profiles.map((p) => toHttpProfile(p, selectedProfileId)));
  });
  api.get("/provider/profiles/active", async (c) => {
    const { profiles, selectedProfileId } = await readProviders(dataDir);
    const active = profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];
    return active ? c.json(toHttpProfile(active, selectedProfileId)) : c.body(null, 204);
  });
  api.post("/provider/profiles", async (c) => {
    // #50: validate the create body before persisting — empty name and
    // malformed `models` (e.g. the string "m") must 400, not silently create an
    // unusable profile that becomes the active selection.
    const parsed = ProviderProfileCreateSchema.safeParse(await safeJson(c));
    if (!parsed.success) {
      return c.json({ error: "invalid provider profile", details: parsed.error.issues }, 400);
    }
    const created = await createProfile(dataDir, fromHttpBody(parsed.data));
    const { selectedProfileId } = await readProviders(dataDir);
    return c.json(toHttpProfile(created, selectedProfileId), 201);
  });
  api.put("/provider/profiles/active", async (c) => {
    const body = await safeJson(c);
    const id = typeof body.id === "string" ? body.id : "";
    const ok = await setSelectedProfile(dataDir, id);
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json(await activeHttpProfile(dataDir));
  });
  api.post("/provider/profiles/active", async (c) => {
    const body = await safeJson(c);
    const id = typeof body.id === "string" ? body.id : "";
    const ok = await setSelectedProfile(dataDir, id);
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.json(await activeHttpProfile(dataDir));
  });
  api.get("/provider/profiles/health", async (c) => {
    const { profiles, selectedProfileId } = await readProviders(dataDir);
    return c.json(profiles.map((p) => toHttpProfile(p, selectedProfileId)));
  });
  api.put("/provider/profiles/:id", async (c) => {
    // #50: same validation on update (partial patch — fields optional, but a
    // present `name` must be non-empty and `models` a valid string array).
    const parsed = ProviderProfileUpdateSchema.safeParse(await safeJson(c));
    if (!parsed.success) {
      return c.json({ error: "invalid provider profile", details: parsed.error.issues }, 400);
    }
    const updated = await updateProfile(dataDir, c.req.param("id"), fromHttpBody(parsed.data));
    if (!updated) return c.json({ error: "not found" }, 404);
    const { selectedProfileId } = await readProviders(dataDir);
    return c.json(toHttpProfile(updated, selectedProfileId));
  });
  api.delete("/provider/profiles/:id", async (c) => {
    const ok = await deleteProfile(dataDir, c.req.param("id"));
    return c.json({ deleted: ok }, ok ? 200 : 404);
  });
  api.post("/provider/profiles/:id/test", async (c) => {
    // #55: actually probe the provider gateway instead of echoing "unknown".
    // A real connectivity/auth check so the UI can report healthy / unavailable
    // / error rather than telling the user an unreachable gateway was "tested".
    const { profiles, selectedProfileId } = await readProviders(dataDir);
    const p = profiles.find((x) => x.id === c.req.param("id"));
    if (!p) return c.json({ error: "not found" }, 404);
    const result = await probeProvider(
      { baseUrl: p.baseUrl, apiKey: p.apiKey },
      { fetchFn: options.fetchFn, timeoutMs: options.providerProbeTimeoutMs },
    );
    // #69: persist the probe outcome so a later GET /provider/profiles (card
    // refresh / reopen) keeps the same health instead of reverting to
    // "unknown". model_health stays empty this round (per-model probing is
    // future work). ProbeStatus "error" maps to the HealthStatus "unavailable".
    const healthStatus = result.status === "error" ? "unavailable" : result.status;
    const saved = await setProfileHealth(dataDir, p.id, {
      healthStatus,
      healthCheckedAt: Date.now(),
      healthMessage: result.message ?? "",
      healthLatencyMs: result.latencyMs ?? null,
    });
    return c.json(toHttpProfile(saved ?? p, selectedProfileId));
  });

  // ---- MCP Servers CRUD (disk-backed: bp_template/mcp_servers.json) ----
  api.get("/mcp-servers", async (c) => {
    return c.json(await readMcpServers(dataDir));
  });
  api.post("/mcp-servers", async (c) => {
    const body = await safeJson(c);
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const config = body.config && typeof body.config === "object" ? (body.config as Record<string, unknown>) : null;
    if (!name || !config) return c.json({ error: "name and config are required" }, 400);
    // #49: validate the transport config before persisting — invalid type /
    // missing url (http/sse) / missing command (stdio) must 400 and leave the
    // on-disk file untouched, not 201 + write an unusable entry.
    const parsed = McpServerConfigSchema.safeParse(config);
    if (!parsed.success) {
      return c.json({ error: "invalid mcp server config", details: parsed.error.issues }, 400);
    }
    return c.json(await createMcpServer(dataDir, name, parsed.data), 201);
  });
  api.put("/mcp-servers/:name", async (c) => {
    const config = await safeJson(c);
    // #49: same validation on update — a PUT must not be able to write an
    // invalid transport config either.
    const parsed = McpServerConfigSchema.safeParse(config);
    if (!parsed.success) {
      return c.json({ error: "invalid mcp server config", details: parsed.error.issues }, 400);
    }
    const entry = await updateMcpServer(dataDir, c.req.param("name"), parsed.data);
    if (!entry) return c.json({ error: "not found" }, 404);
    return c.json(entry);
  });
  api.delete("/mcp-servers/:name", async (c) => {
    const ok = await deleteMcpServer(dataDir, c.req.param("name"));
    if (!ok) return c.json({ error: "not found" }, 404);
    return c.body(null, 204);
  });

  // Mount the API under /api (the SPA's API_BASE).
  app.route("/api", api);

  // #30: any unmatched /api/* (any method) returns a JSON 404 — never the SPA
  // index.html. Sits between the API routes and the static fallback, and is
  // unconditional (independent of serveWeb) so an unimplemented route can't fall
  // through to text/html (which the frontend's handleJson chokes on).
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

  // ---- Static web serving with SPA fallback ----------------------------
  if (options.serveWeb !== false) {
    app.use("/*", serveStatic({ root: webRoot }));
    // SPA fallback: any unmatched GET that isn't /api returns index.html.
    app.get("/*", serveStatic({ path: join(webRoot, "index.html") }));
  }

  return app;

  // ---------------- helpers ----------------

  function forward(
    route: keyof typeof RUNTIME_ROUTES,
    opts: { idParam?: string; withBody?: boolean; withQuery?: boolean } = {},
  ) {
    return async (c: import("hono").Context) => {
      const rc = await getClient();
      const params: Record<string, string> = {};
      if (opts.idParam) params.id = c.req.param(opts.idParam) ?? "";
      const body = opts.withBody ? await c.req.text() : undefined;
      const headers: Record<string, string> = {};
      const ct = c.req.header("content-type");
      if (ct) headers["content-type"] = ct;
      const query = opts.withQuery ? new URL(c.req.url).search.replace(/^\?/, "") : undefined;
      const upstream = await rc.forward(route, {
        params,
        body: body && body.length > 0 ? body : undefined,
        headers,
        query: query && query.length > 0 ? query : undefined,
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

function maskKey(key: string): string {
  if (!key) return "";
  return key.length <= 8 ? "****" : `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** Stored profile → masked HTTP shape the SPA's normalizeProviderProfile reads. */
function toHttpProfile(
  p: StoredProviderProfile,
  selectedId?: string,
): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    base_url: p.baseUrl,
    // #75: echo the effective api — explicit, else derived from adapter, else
    // the default — so the response never shows a value that contradicts the
    // adapter (e.g. adapter:"openai" + api:"anthropic-messages").
    api: p.api ?? deriveProviderApi(p.adapter) ?? "anthropic-messages",
    // #68 (R-10): coarse adapter family + sharing flag. Single-user open-source
    // is never shared, so is_shared is always false here.
    adapter: p.adapter ?? "auto",
    is_shared: false,
    models: p.models,
    icon: p.icon ?? "circle",
    icon_color: p.iconColor ?? "#111111",
    notes: p.notes ?? "",
    is_active: p.id === selectedId,
    // #65: an env-bootstrapped profile stores no key — show its env source
    // instead of an empty mask so the UI doesn't look misconfigured.
    api_key_masked: p.apiKeyEnv ? `env:$${p.apiKeyEnv}` : maskKey(p.apiKey),
    api_key_env: p.apiKeyEnv,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    // #69: surface the persisted probe result instead of a hardcoded
    // "unknown", so the Settings card reflects the last test across reloads.
    health_status: p.healthStatus ?? "unknown",
    health_checked_at: p.healthCheckedAt,
    health_message: p.healthMessage ?? "",
    health_latency_ms: p.healthLatencyMs ?? null,
    model_health: [],
  };
}

/** SPA create/update body (snake_case) → stored-profile patch. */
function fromHttpBody(body: Record<string, unknown>): Partial<StoredProviderProfile> {
  const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    name: str(body.name),
    baseUrl: str(body.base_url) ?? str(body.baseUrl),
    api: str(body.api) as StoredProviderProfile["api"] | undefined,
    adapter: str(body.adapter) as StoredProviderProfile["adapter"] | undefined,
    apiKey: str(body.api_key) ?? str(body.apiKey),
    models: Array.isArray(body.models) ? (body.models as string[]) : undefined,
    icon: str(body.icon),
    iconColor: str(body.icon_color) ?? str(body.iconColor),
    notes: str(body.notes),
  };
}

async function activeHttpProfile(dataDir: string): Promise<Record<string, unknown> | null> {
  const { profiles, selectedProfileId } = await readProviders(dataDir);
  const active = profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];
  return active ? toHttpProfile(active, selectedProfileId) : null;
}
