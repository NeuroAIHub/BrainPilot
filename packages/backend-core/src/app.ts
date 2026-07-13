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
import { resolve, join } from "node:path";
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
  readKbApiConfig,
  writeKbApiConfig,
  readToolToggles,
  writeToolToggles,
  TOGGLEABLE_TOOL_NAMES,
  type ToolToggles,
} from "./config.js";
import {
  cancelKbBuild,
  findKbRoot,
  getKbBuildStatus,
  probeKbEnvironment,
  startKbBuild,
  startKbEnvSetup,
  startKbFullSetup,
  startKbModelSetup,
  subscribeKbBuild,
} from "./kb-builder.js";
import { computeKbInventory } from "./kb-inventory.js";

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

  // Catch-all error handler: any uncaught throw returns JSON, never Hono's
  // default text/plain "Internal Server Error" (which the frontend's handleJson
  // chokes on — the same non-JSON hazard #30 fixed at the 404 layer, here at the
  // 500 layer). The message carries the orchestrator's own diagnostic (runtime
  // failed to start / provider misconfigured / missing docker dep), and `hint`
  // names the user-actionable next step so the guidance actually reaches the UI
  // instead of being flattened into an opaque 500.
  app.onError((err, c) => {
    const message = err instanceof Error ? err.message : String(err);
    return c.json(
      {
        error: message,
        code: "runtime_unavailable",
        hint: "The agent runtime failed to start or is unreachable. Check the provider config in Settings → Providers, ensure no port conflict, and see the backend/runtime logs.",
      },
      500,
    );
  });

  // ---- Health (backend-local; does not require runtime) ----------------
  api.get("/health", (c) => c.json({ status: "ok" }));

  api.get("/version", (c) => c.json({ name: pkg.name, version: pkg.version }));

  // ---- Runtime info (backend-local; #156) ------------------------------
  // Exposes the real on-disk data root so the Files panel can show users
  // where a session's workspace actually lives (e.g. to open it in a file
  // manager). Host paths are sensitive in multi-user hosting, so this is
  // gated to local mode: hosted deployments set BP_LOCAL_MODE=0 (mirroring
  // the web build's VITE_LOCAL_MODE) and then only `{ localMode: false }`
  // is returned — never a host path. A per-session workspace dir is
  // `<workspacesRoot>/<sessionId>` (the SPA joins the active id itself).
  const localMode = (env?.BP_LOCAL_MODE ?? process.env.BP_LOCAL_MODE) !== "0";
  api.get("/info", (c) => {
    if (!localMode) return c.json({ localMode: false });
    const absDataDir = resolve(dataDir);
    return c.json({
      localMode: true,
      dataDir: absDataDir,
      workspacesRoot: join(absDataDir, "workspaces"),
    });
  });

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
  // #47/#256: file upload. A base64 JSON body goes through the buffered
  // `forward` helper; a raw `application/octet-stream` body is streamed to the
  // runtime untouched (forward() reads the body via `text()`, which would
  // UTF-8-decode and corrupt binary bytes — so we must NOT route it there).
  api.post("/sandbox/:id/files", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/octet-stream")) {
      const rc = await getClient();
      const query = new URL(c.req.url).search.replace(/^\?/, "");
      const upstream = await rc.forward("writeFile", {
        params: { id: c.req.param("id") ?? "" },
        body: c.req.raw.body, // byte ReadableStream — streamed, not buffered
        headers: { "content-type": "application/octet-stream" },
        query: query.length > 0 ? query : undefined,
      });
      return relay(c, upstream);
    }
    return forward("writeFile", { idParam: "id", withBody: true })(c);
  });

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
    // #205: reject a duplicate name (trimmed, case-insensitive) so the list
    // can't grow two indistinguishable same-named profiles where `Use` is
    // ambiguous. Enforced here at the route layer only — internal callers
    // (scaffold / writeLocalSettings) intentionally bypass this.
    const name = parsed.data.name.trim().toLowerCase();
    const { profiles } = await readProviders(dataDir);
    if (profiles.some((p) => p.name.trim().toLowerCase() === name)) {
      return c.json({ error: `a provider named "${parsed.data.name.trim()}" already exists` }, 409);
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
    // #204: POST creates — a name that already exists is a conflict, not a
    // silent overwrite (which lost the prior config, e.g. a token-bearing URL).
    // Editing an existing server goes through PUT /mcp-servers/:name instead.
    const existing = await readMcpServers(dataDir);
    if (existing.some((s) => s.name === name)) {
      return c.json({ error: `an MCP server named "${name}" already exists` }, 409);
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

  // ---- Built-in tool toggles (disk-backed: bp_template/tool_toggles.json) ----
  //
  // Per-tool on/off overrides for the three user-controllable Pi-native
  // SystemTools: skill_search, get_domain_knowledge_local, search_papers_local.
  // Missing / non-boolean → runtime treats as enabled (default-on). PUT is a
  // MERGE (partial patch); unknown keys and non-boolean values are ignored.
  //
  // Liveness: the runtime reads this file on every `ensureAgent`, so a PUT
  // here takes effect on the next new session (or the next expert spawn in
  // an existing session) immediately. Already-running agents keep the tool
  // list they were given at agent-creation time — Pi caches it inside the
  // provider session — so applying the change to a currently-active agent
  // still requires a backend restart. The frontend panel spells this out.
  api.get("/tool-toggles", async (c) => {
    return c.json(await readToolToggles(dataDir));
  });
  api.put("/tool-toggles", async (c) => {
    const body = (await safeJson(c)) as Record<string, unknown>;
    // Manual coercion instead of a Zod schema — the shape is trivially small
    // (three booleans, all optional) and rejecting the whole PUT on a stray
    // non-boolean would be user-hostile ("your JSON is fine, we just dropped
    // the fields we didn't recognise" is friendlier). Non-boolean values fall
    // through to the writer, which drops them.
    const patch: ToolToggles = {};
    for (const name of TOGGLEABLE_TOOL_NAMES) {
      const v = body[name];
      if (typeof v === "boolean") patch[name] = v;
    }
    const merged = await writeToolToggles(dataDir, patch);
    return c.json(merged);
  });

  // ---- Knowledge Base build orchestration ------------------------------
  //
  // Spawn ``KnowledgeBase/scripts/build_kb.py --json`` and surface its
  // NDJSON progress over SSE so the "Build Knowledge Base" button in the
  // settings panel can show a live log.  One run at a time; cancellable.
  //
  // POST /api/kb/build  { kbRoot?, ocrApiKey, ocrConcurrency?, ocrLimit?,
  //                       metaApiKey?, metaBaseUrl?, metaModel?, skip?, only? }
  // GET  /api/kb/status
  // GET  /api/kb/events    Server-Sent Events
  // POST /api/kb/cancel
  api.post("/kb/build", async (c) => {
    const body = await safeJson(c);
    // When the frontend sends no metaApiKey (i.e. "reuse the agent's active
    // LLM key" is checked), fill in the credentials from the selected provider
    // profile so the Python extract_meta.py script receives them.
    let metaApiKey = typeof body.metaApiKey === "string" ? body.metaApiKey : undefined;
    let metaBaseUrl = typeof body.metaBaseUrl === "string" ? body.metaBaseUrl : undefined;
    let metaModel = typeof body.metaModel === "string" ? body.metaModel : undefined;
    if (!metaApiKey) {
      const { profiles, selectedProfileId } = await readProviders(dataDir);
      const profile =
        profiles.find((p) => p.id === selectedProfileId) ?? profiles[0];
      if (profile) {
        metaApiKey = profile.apiKey || undefined;
        if (!metaBaseUrl) metaBaseUrl = profile.baseUrl || undefined;
        if (!metaModel) metaModel = profile.models[0] || undefined;
      }
    }
    // Same shape for the OCR credentials: whichever fields the frontend
    // didn't send, fall back to the persisted API_config.json so the user's
    // saved provider config survives page reloads without ever leaving the
    // backend. Each field falls back independently — a user can override
    // just the base URL for one build without re-typing the key.
    const kbRootForCfg = typeof body.kbRoot === "string" ? body.kbRoot : findKbRoot();
    const savedOcr = await readKbApiConfig(kbRootForCfg);
    const pickStr = (b: unknown, s: string | undefined) => {
      if (typeof b === "string" && b.trim()) return b;
      return s || undefined;
    };
    const ocrPreset = pickStr(body.ocrPreset, savedOcr.ocrPreset);
    const ocrBaseUrl = pickStr(body.ocrBaseUrl, savedOcr.ocrBaseUrl);
    const ocrModel = pickStr(body.ocrModel, savedOcr.ocrModel);
    const ocrPrompt = pickStr(body.ocrPrompt, savedOcr.ocrPrompt);
    const ocrApiKey = pickStr(body.ocrApiKey, savedOcr.ocrApiKey);
    const result = startKbBuild({
      kbRoot: typeof body.kbRoot === "string" ? body.kbRoot : undefined,
      ocrPreset,
      ocrBaseUrl,
      ocrModel,
      ocrPrompt,
      ocrApiKey,
      ocrConcurrency:
        typeof body.ocrConcurrency === "number" ? body.ocrConcurrency : undefined,
      ocrLimit: typeof body.ocrLimit === "number" ? body.ocrLimit : undefined,
      metaApiKey,
      metaBaseUrl,
      metaModel,
      hfMirror: typeof body.hfMirror === "string" ? body.hfMirror : undefined,
      skip: Array.isArray(body.skip)
        ? (body.skip.filter((s) =>
            typeof s === "string" && ["ocr", "extract", "chunk", "vectorize"].includes(s),
          ) as Array<"ocr" | "extract" | "chunk" | "vectorize">)
        : undefined,
      only: Array.isArray(body.only)
        ? (body.only.filter((s) =>
            typeof s === "string" && ["ocr", "extract", "chunk", "vectorize"].includes(s),
          ) as Array<"ocr" | "extract" | "chunk" | "vectorize">)
        : undefined,
    });
    if (!result.ok) return c.json({ error: result.message }, 409);
    return c.json({ ok: true, startedAt: result.startedAt });
  });

  api.get("/kb/status", (c) => c.json(getKbBuildStatus()));

  // Force-refresh the env-completeness probe. /kb/status returns a cached
  // reading (60s TTL) so opening the panel is cheap; this endpoint is what
  // the "Re-check" button hits when the user has just installed something
  // externally and wants an immediate answer.
  api.post("/kb/probe", async (c) => {
    const body = await safeJson(c);
    const kbRoot = typeof body.kbRoot === "string" ? body.kbRoot : undefined;
    return c.json({ environment: probeKbEnvironment(kbRoot) });
  });

  // Read-only inventory of the four-stage KB pipeline. Streams the ledger
  // files, tail-scans oversized chunks.json, and reports a consistency
  // rollup ("healthy" or a list of gap-count issues). Cheap enough to call
  // on every KB tab open. GET so the panel can just fetch() with no body.
  api.get("/kb/inventory", async (c) => {
    const inv = await computeKbInventory();
    return c.json({ inventory: inv });
  });

  // Bootstrap the KnowledgeBase Python venv. Shares the same run slot /
  // SSE stream as /kb/build (both surfaces are in the same panel and
  // pipeline-mutate the same on-disk state, so only one Python job runs
  // at a time).
  api.post("/kb/setup-env", async (c) => {
    const body = await safeJson(c);
    const result = startKbEnvSetup({
      python: typeof body.python === "string" ? body.python : undefined,
      reinstall: typeof body.reinstall === "boolean" ? body.reinstall : undefined,
      pipIndexUrl: typeof body.pipIndexUrl === "string" && body.pipIndexUrl.trim()
        ? body.pipIndexUrl.trim() : undefined,
      kbRoot: typeof body.kbRoot === "string" ? body.kbRoot : undefined,
    });
    if (!result.ok) return c.json({ error: result.message }, 409);
    return c.json({ ok: true, startedAt: result.startedAt });
  });

  // Download bge-m3 + bge-reranker-v2-m3 weights (~2.5 GB). Runs in its
  // own slot so it can execute concurrently with venv setup (the "full
  // setup" one-shot endpoint below chains the two together).
  api.post("/kb/setup-models", async (c) => {
    const body = await safeJson(c);
    const result = startKbModelSetup({
      hfMirror: typeof body.hfMirror === "string" ? body.hfMirror : undefined,
      hfToken: typeof body.hfToken === "string" && body.hfToken.trim()
        ? body.hfToken.trim() : undefined,
      kbRoot: typeof body.kbRoot === "string" ? body.kbRoot : undefined,
    });
    if (!result.ok) return c.json({ error: result.message }, 409);
    return c.json({ ok: true, startedAt: result.startedAt });
  });

  // Combined one-click: creates the venv and then (upon success) downloads
  // the bge models. The frontend uses this by default so the user only
  // has to click once to get an end-to-end-ready KB pipeline.
  api.post("/kb/setup-full", async (c) => {
    const body = await safeJson(c);
    const result = startKbFullSetup({
      python: typeof body.python === "string" ? body.python : undefined,
      reinstall: typeof body.reinstall === "boolean" ? body.reinstall : undefined,
      hfMirror: typeof body.hfMirror === "string" ? body.hfMirror : undefined,
      hfToken: typeof body.hfToken === "string" && body.hfToken.trim()
        ? body.hfToken.trim() : undefined,
      pipIndexUrl: typeof body.pipIndexUrl === "string" && body.pipIndexUrl.trim()
        ? body.pipIndexUrl.trim() : undefined,
      kbRoot: typeof body.kbRoot === "string" ? body.kbRoot : undefined,
    });
    if (!result.ok) return c.json({ error: result.message }, 409);
    return c.json({ ok: true, startedAt: result.startedAt });
  });

  // Persisted KB API config. GET returns non-secret fields verbatim plus a
  // masked preview of the API key — the plaintext key never leaves the
  // backend. The extra fields (preset / base URL / model / prompt) are not
  // secret, so returning them lets the UI show the current provider and
  // pre-fill the form for edits.
  api.get("/kb/api-config", async (c) => {
    const cfg = await readKbApiConfig(findKbRoot());
    return c.json({
      hasOcrApiKey: Boolean(cfg.ocrApiKey),
      ocrApiKeyPreview: cfg.ocrApiKey ? `...${cfg.ocrApiKey.slice(-4)}` : "",
      ocrPreset: cfg.ocrPreset ?? "",
      ocrBaseUrl: cfg.ocrBaseUrl ?? "",
      ocrModel: cfg.ocrModel ?? "",
      ocrPrompt: cfg.ocrPrompt ?? "",
    });
  });

  api.put("/kb/api-config", async (c) => {
    const body = await safeJson(c);
    // Each field is patched independently — omitting a key leaves the
    // stored value alone, sending "" removes it. This lets the UI PATCH
    // just the field the user changed without having to fetch-and-resend
    // the whole record.
    const patch: {
      ocrPreset?: string;
      ocrBaseUrl?: string;
      ocrModel?: string;
      ocrPrompt?: string;
      ocrApiKey?: string;
    } = {};
    const trimIfString = (v: unknown, key: keyof typeof patch) => {
      if (typeof v === "string") patch[key] = v.trim();
    };
    trimIfString(body.ocrPreset, "ocrPreset");
    trimIfString(body.ocrBaseUrl, "ocrBaseUrl");
    trimIfString(body.ocrModel, "ocrModel");
    trimIfString(body.ocrPrompt, "ocrPrompt");
    trimIfString(body.ocrApiKey, "ocrApiKey");
    await writeKbApiConfig(findKbRoot(), patch);
    return c.json({ ok: true });
  });

  api.post("/kb/cancel", (c) => {
    const r = cancelKbBuild();
    return c.json(r, r.ok ? 200 : 404);
  });

  api.get("/kb/events", (c) => {
    // SSE: stream every NDJSON event from the active build, plus a snapshot
    // of buffered events so a late subscriber doesn't see a blank panel.
    //
    // The stream stays open even when no build is running — every listener
    // is registered on the shared bus, so a subsequent build's events flow
    // through this same connection without the client needing to reconnect
    // when it hits "Build Knowledge Base". This eliminates the race where
    // the panel opens the SSE (server sees idle → sends `idle` + closes),
    // then a moment later startBuild spawns the child and events fire into
    // a bus that no live client is subscribed to — the classic "have to
    // refresh to see progress" bug.
    //
    // We still emit an `idle` marker on subscribe so any client that WAS
    // treating that as end-of-stream keeps working; the frontend has been
    // updated to keep the connection open on `idle` and act on it purely
    // as an informational tick. `stream-end` fires only when a build slot
    // transitions to done — but crucially, we then loop back to waiting
    // for the next slot instead of tearing the connection down.
    // Shared teardown state — populated inside start(), consumed by
    // cancel(). Kept in closure (rather than on `this`) because the
    // ReadableStream underlying-source's `this` binding across start /
    // cancel is set by property lookup, and stashing state on the
    // controller pollutes its TS typings.
    let closed = false;
    let cleanup: () => void = () => { closed = true; };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        const send = (ev: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
          } catch {
            /* controller was torn down between checks */
          }
        };
        const handle = subscribeKbBuild(send);
        // Replay buffered history immediately so a late subscriber gets
        // the context it missed (e.g. a build that started before the
        // panel opened, or events already produced since the last event
        // buffer flush).
        for (const ev of handle.history) send(ev);
        // Non-terminal "idle" tick lets the frontend distinguish "server
        // ack'd, waiting for events" from "no HTTP response yet". The
        // client keeps the connection open on this — the stream is
        // long-lived across build starts and stops now, matching how
        // MCP-style tool panels stream too.
        if (!getKbBuildStatus().active) {
          send({ stage: "build", event: "idle", msg: "no active build" });
        }
        // Heartbeat every 15 s so proxies / load balancers don't kill
        // the connection during a long idle stretch. Comment-only SSE
        // frames (":ping") aren't dispatched as events by the browser —
        // they just reset the intermediary's idle timer.
        const hb = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(enc.encode(": ping\n\n"));
          } catch {
            /* connection torn down */
          }
        }, 15_000);
        // Terminal `stream-end` on build completion is deliberately NOT
        // emitted here anymore. The frontend already reacts to the real
        // `build:done` / `build:error` events (they flow through the
        // subscribe listener alongside everything else) — sending an
        // extra stream-end used to also close the connection client-side,
        // which caused the "have to refresh the page to see the next
        // build" bug. The bus listener persists across builds; the
        // connection stays warm.
        cleanup = () => {
          closed = true;
          clearInterval(hb);
          handle.unsubscribe();
        };
        // Two paths can tear the stream down: the Fetch request's abort
        // signal (client hangup / tab close), and the ReadableStream's
        // cancel() hook. Wire both — whichever fires first calls cleanup
        // (idempotent via the `closed` guard).
        c.req.raw.signal?.addEventListener("abort", () => cleanup());
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
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
