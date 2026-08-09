import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import { createApp } from "../src/app.js";
import type { Orchestrator, RuntimeHandle } from "../src/orchestrator.js";

function fakeOrchestrator(baseUrl = "http://runtime.test"): Orchestrator {
  return {
    async ensureRuntime(): Promise<RuntimeHandle> {
      return { baseUrl };
    },
    async health() {
      return true;
    },
    async stopRuntime() {},
  };
}

describe("Hono app — REST forwarding", () => {
  it("stops and recreates the current user's runtime", async () => {
    const calls: string[] = [];
    const orchestrator: Orchestrator = {
      ensureRuntime: vi.fn(async (opts) => {
        calls.push(`start:${opts?.userId}`);
        return { baseUrl: "http://runtime-restarted.test" };
      }),
      health: async () => true,
      stopRuntime: vi.fn(async (userId) => { calls.push(`stop:${userId}`); }),
    };
    const app = createApp({ orchestrator, serveWeb: false });

    const response = await app.request("/api/runtime/restart", {
      method: "POST",
      headers: { "x-bp-user": "researcher-1" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(calls).toEqual(["stop:researcher-1", "start:researcher-1"]);
  });

  it("forwards runtime-observed MCP status", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("http://runtime.test/mcp/status");
      return new Response(JSON.stringify({ state: "ready", servers: [{ name: "playwright", pluginId: "org.brainpilot.playwright-mcp", state: "ready" }] }), {
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({ orchestrator: fakeOrchestrator(), fetchFn: fetchFn as never, serveWeb: false });

    const response = await app.request("/api/mcp-status");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "ready" });
  });

  it("GET /api/sessions forwards to the runtime and returns its body", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("http://runtime.test/sessions");
      return new Response('{"sessions":[]}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessions: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("POST /api/sessions/:id/messages forwards body + path param", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://runtime.test/sessions/abc/messages");
      expect(init.method).toBe("POST");
      expect(init.body).toBe('{"content":"hi"}');
      return new Response('{"accepted":true}', { status: 202 });
    });
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/sessions/abc/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"content":"hi"}',
    });
    expect(res.status).toBe(202);
  });

  it("forwards a scoped tool interrupt and preserves the runtime status", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://runtime.test/sessions/s%201/tools/tool%2F1/interrupt");
      expect(init.method).toBe("POST");
      return new Response('{"interrupted":false,"toolCallId":"tool/1","reason":"timeout"}', {
        status: 504,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({ orchestrator: fakeOrchestrator(), fetchFn: fetchFn as never, serveWeb: false });
    const response = await app.request("/api/sessions/s%201/tools/tool%2F1/interrupt", { method: "POST" });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ reason: "timeout" });
  });

  // #47: base64 JSON upload still forwards through the buffered path.
  it("POST /api/sandbox/:id/files (base64 JSON) forwards to writeFile", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://runtime.test/sessions/s1/files");
      expect(init.method).toBe("POST");
      expect(init.body).toBe('{"path":"a.txt","contentBase64":"aGk="}');
      return new Response('{"path":"a.txt","size":2}', { status: 201 });
    });
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/sandbox/s1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"path":"a.txt","contentBase64":"aGk="}',
    });
    expect(res.status).toBe(201);
  });

  it("forwards byte Range headers and preserves partial-content metadata", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://runtime.test/sessions/s1/files/raw?path=%2Fworkspace%2Fscan.nii");
      expect((init.headers as Record<string, string>).range).toBe("bytes=0-347");
      return new Response(new Uint8Array([1, 2]), { status: 206, headers: { "content-range": "bytes 0-1/4096", "content-type": "application/octet-stream" } });
    });
    const app = createApp({ orchestrator: fakeOrchestrator(), fetchFn: fetchFn as never, serveWeb: false });
    const response = await app.request("/api/sandbox/s1/files/raw?path=%2Fworkspace%2Fscan.nii", { headers: { range: "bytes=0-347" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-1/4096");
  });

  // #256: a raw octet-stream upload must be streamed to the runtime BYTE-FOR-BYTE
  // (query carried, octet content-type preserved). Routing it through the
  // buffered `text()` forward would UTF-8-decode and corrupt binary payloads.
  it("POST /api/sandbox/:id/files (octet-stream) streams raw bytes + ?path=", async () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 128]);
    let receivedCt: string | undefined;
    let receivedBytes: Uint8Array | undefined;
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://runtime.test/sessions/s1/files?path=data%2Fbig.bin");
      expect(init.method).toBe("POST");
      receivedCt = (init.headers as Record<string, string>)["content-type"];
      // body is streamed; drain it back to bytes to prove no corruption
      receivedBytes = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      return new Response('{"path":"data/big.bin","size":6}', { status: 201 });
    });
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/sandbox/s1/files?path=data%2Fbig.bin", {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: bytes,
    });
    expect(res.status).toBe(201);
    expect(receivedCt).toBe("application/octet-stream");
    expect(receivedBytes).toEqual(bytes);
  });

  // Regression (BPCASE-0004): /metrics is a RUNTIME_ROUTES entry implemented by
  // the runtime (server.ts) but was missing from the backend's /api table, so
  // /api/metrics fell through to the SPA static fallback and returned index.html
  // (200 text/html) instead of proxying the runtime's metrics JSON.
  it("GET /api/metrics forwards to the runtime (not the SPA fallback)", async () => {
    const metricsBody = '{"activeSessions":3,"runningAgents":0,"lastActivityAt":null,"memRss":120520704}';
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("http://runtime.test/metrics");
      return new Response(metricsBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    // serveWeb defaults on + a real index.html: if /metrics weren't routed it
    // would hit the fallback and return HTML, which this asserts against.
    const root = await mkdtemp(path.join(tmpdir(), "bp-web-metrics-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>BP</title>");
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      webRoot: root,
    });
    const res = await app.request("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      activeSessions: 3,
      runningAgents: 0,
      lastActivityAt: null,
      memRss: 120520704,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("GET /api/sessions/:id/trace forwards to the runtime (not the SPA fallback)", async () => {
    // Same class as the /metrics regression: the SPA calls
    // GET /api/sessions/:id/trace, but the route was missing from the /api
    // table, so it fell through to the static fallback and returned index.html
    // (200 text/html) — the frontend then choked with "Unexpected token '<'".
    const graphBody = '{"meta":{"sessionId":"abc","createdAt":"2026-01-01T00:00:00.000Z"},"nodes":[]}';
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("http://runtime.test/sessions/abc/trace");
      return new Response(graphBody, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const root = await mkdtemp(path.join(tmpdir(), "bp-web-trace-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>BP</title>");
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      webRoot: root,
    });
    const res = await app.request("/api/sessions/abc/trace");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      meta: { sessionId: "abc", createdAt: "2026-01-01T00:00:00.000Z" },
      nodes: [],
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("GET /api/sessions/:id/history forwards to the runtime (preserving ?limit)", async () => {
    // Same class as the /trace regression: chat rehydrate after a runtime
    // restart depends on this proxy. When it was missing, the SPA's
    // api.sessions.getHistory call hit the static SPA fallback, returned 200
    // text/html, and the SessionContext silently treated it as zero events —
    // so restored sessions opened with an empty chat.
    const body =
      '{"events":[{"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}],"total":1,"truncated":false}';
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("http://runtime.test/sessions/abc/history?limit=3");
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const root = await mkdtemp(path.join(tmpdir(), "bp-web-history-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>BP</title>");
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      webRoot: root,
    });
    const res = await app.request("/api/sessions/abc/history?limit=3");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      events: [{ type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" }],
      total: 1,
      truncated: false,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // #29: session rename. The SPA PUTs /api/sessions/:id {title}; this must
  // proxy to the runtime's updateSession route (PUT /sessions/:id) with the
  // body intact — not the old forwardRename hack that PUT the GET path.
  it("PUT /api/sessions/:id forwards rename to the runtime updateSession route", async () => {
    const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("http://runtime.test/sessions/abc");
      expect(init.method).toBe("PUT");
      expect(init.body).toBe('{"title":"Renamed"}');
      return new Response('{"id":"abc","title":"Renamed"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/sessions/abc", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: '{"title":"Renamed"}',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "abc", title: "Renamed" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // #30: any unmatched /api/* returns a JSON 404, for every method, and never
  // touches the runtime (no fetchFn call) nor the SPA static fallback.
  it.each(["GET", "POST", "PUT", "DELETE"])(
    "%s /api/<unknown> returns a JSON 404 (not SPA HTML / plain-text)",
    async (method) => {
      const fetchFn = vi.fn();
      const app = createApp({
        orchestrator: fakeOrchestrator(),
        fetchFn: fetchFn as never,
        serveWeb: false,
      });
      const res = await app.request("/api/__definitely_unknown__", { method });
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(await res.json()).toEqual({ error: "not found" });
      expect(fetchFn).not.toHaveBeenCalled();
    },
  );

  it("GET /api/health returns ok without touching the runtime", async () => {
    const fetchFn = vi.fn();
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({ status: "ok" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // A throw from ensureRuntime (runtime failed to start / provider misconfig)
  // must surface as a JSON 500 carrying the diagnostic message + an actionable
  // hint — never Hono's default text/plain "Internal Server Error", which the
  // frontend's handleJson can't parse (the 500-layer twin of the #30 404 fix).
  it("a runtime start failure returns a JSON 500 with the diagnostic + hint (not text/plain)", async () => {
    const brokenOrchestrator: Orchestrator = {
      async ensureRuntime(): Promise<RuntimeHandle> {
        throw new Error("runtime did not become healthy at http://runtime.test within 30000ms");
      },
      async health() {
        return false;
      },
      async stopRuntime() {},
    };
    const app = createApp({
      orchestrator: brokenOrchestrator,
      serveWeb: false,
    });
    const res = await app.request("/api/sessions");
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { error: string; code: string; hint: string };
    expect(body.error).toContain("did not become healthy");
    expect(body.code).toBe("runtime_unavailable");
    expect(body.hint).toContain("Settings → Providers");
  });

  // #46: /version must report this package's own package.json version so the
  // endpoint stays in lockstep with every release.
  it("GET /api/version reports the real package version (not a hardcoded literal)", async () => {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { name: string; version: string };
    const fetchFn = vi.fn();
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/version");
    expect(await res.json()).toEqual({ name: pkg.name, version: pkg.version });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // #156: /api/info exposes the real on-disk data root for the Files panel,
  // gated to local mode. It must never touch the runtime.
  it("GET /api/info returns absolute dataDir + workspacesRoot in local mode", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bp-info-"));
    const fetchFn = vi.fn();
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
      dataDir: dir,
      env: {}, // BP_LOCAL_MODE unset → defaults to local mode
    });
    const res = await app.request("/api/info");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { localMode: boolean; dataDir: string; workspacesRoot: string };
    expect(body.localMode).toBe(true);
    expect(body.dataDir).toBe(path.resolve(dir));
    expect(body.workspacesRoot).toBe(path.join(path.resolve(dir), "workspaces"));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("GET /api/info hides host paths when BP_LOCAL_MODE=0 (hosted)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bp-info-hosted-"));
    const fetchFn = vi.fn();
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
      dataDir: dir,
      env: { BP_LOCAL_MODE: "0" },
    });
    const res = await app.request("/api/info");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { localMode: boolean; dataDir?: string; workspacesRoot?: string };
    expect(body).toEqual({ localMode: false });
    expect(body.dataDir).toBeUndefined();
    expect(body.workspacesRoot).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("Hono app — SSE byte passthrough (修正4)", () => {
  it("forwards the shutdown abort signal to the runtime SSE request", async () => {
    const shutdown = new AbortController();
    let upstreamSignal: AbortSignal | null = null;
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      upstreamSignal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({ start() {} }), {
        headers: { "content-type": "text/event-stream" },
      });
    });
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
      shutdownSignal: shutdown.signal,
    });
    const res = await app.request("/api/sse/sess-shutdown");
    expect(res.status).toBe(200);
    expect(upstreamSignal?.aborted).toBe(false);
    shutdown.abort();
    expect(upstreamSignal?.aborted).toBe(true);
    await res.body?.cancel();
  });

  it("pipes runtime SSE chunks through unmodified", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode("data: {\"type\":\"RUN_STARTED\"}\n\n"));
        controller.enqueue(enc.encode("data: {\"type\":\"RUN_FINISHED\"}\n\n"));
        controller.close();
      },
    });
    const fetchFn = vi.fn(async (url: string) => {
      expect(url).toBe("http://runtime.test/sse/sess-1");
      return new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
    });
    const res = await app.request("/api/sessions/sess-1/sse");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain("RUN_STARTED");
    expect(text).toContain("RUN_FINISHED");
  });

  // Regression: the protocol SSOT client (client-cli / @brainpilot/web) builds
  // the SSE URL from RUNTIME_ROUTES.sessionEvents = "/sse/:id". The backend must
  // mount that canonical path under /api, not only the SPA's /sessions/:id/sse.
  it.each(["/api/sse/sess-2", "/api/sessions/sess-2/events"])(
    "serves the canonical/alias SSE path %s",
    async (reqPath) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('data: {"type":"RUN_FINISHED"}\n\n'),
          );
          controller.close();
        },
      });
      const fetchFn = vi.fn(async () => {
        return new Response(stream, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      });
      const app = createApp({
        orchestrator: fakeOrchestrator(),
        fetchFn: fetchFn as never,
        serveWeb: false,
      });
      const res = await app.request(reqPath);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(await res.text()).toContain("RUN_FINISHED");
    },
  );
});

describe("Hono app — static serving", () => {
  it("serves index.html for an unknown SPA path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-web-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>BP</title>");
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: (async () => new Response("")) as never,
      webRoot: root,
    });
    const res = await app.request("/some/spa/route");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("BP");
  });

  // Regression: detached spawn (`brainpilot up`) starts the backend via
  // server.ts `startServer()` with no webRoot option and passes the dist path
  // through BP_WEB_ROOT. Without the env fallback the SPA 404s in a tarball install.
  it("falls back to BP_WEB_ROOT when no webRoot option is given", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-web-env-"));
    await writeFile(path.join(root, "index.html"), "<!doctype html><title>ENV</title>");
    const prev = process.env.BP_WEB_ROOT;
    process.env.BP_WEB_ROOT = root;
    try {
      const app = createApp({
        orchestrator: fakeOrchestrator(),
        fetchFn: (async () => new Response("")) as never,
      });
      const res = await app.request("/some/spa/route");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("ENV");
    } finally {
      if (prev === undefined) delete process.env.BP_WEB_ROOT;
      else process.env.BP_WEB_ROOT = prev;
    }
  });
});

describe("Hono app — local config routes", () => {
  it("GET /api/settings reads local config (masked key), not the runtime", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bp-cfg-"));
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(
      path.join(dir, "bp_template", "settings.json"),
      JSON.stringify({ model: "claude-x", apiKey: "sk-abcd1234efgh", baseUrl: "https://api.x" }),
    );
    const fetchFn = vi.fn();
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: fetchFn as never,
      serveWeb: false,
      dataDir: dir,
      env: {},
    });
    const res = await app.request("/api/settings");
    const body = (await res.json()) as { model: string; apiKey: string; baseUrl: string };
    expect(body.model).toBe("claude-x");
    expect(body.baseUrl).toBe("https://api.x");
    expect(body.apiKey).toContain("…"); // masked
    expect(body.apiKey).not.toContain("abcd1234"); // raw key body never leaks
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("provider profiles: create → list → set active → delete (no 404)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bp-prov-"));
    const app = createApp({
      orchestrator: fakeOrchestrator(),
      fetchFn: vi.fn() as never,
      serveWeb: false,
      dataDir: dir,
      env: {},
    });

    // create (the bug: this used to 404)
    const created = await app.request("/api/provider/profiles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Gw", base_url: "https://gw", api_key: "sk-secret", models: ["m1"] }),
    });
    expect(created.status).toBe(201);
    const profile = (await created.json()) as { id: string; api_key_masked: string; is_active: boolean };
    expect(profile.id).toBeTruthy();
    expect(profile.is_active).toBe(true); // first profile auto-selected
    expect(profile.api_key_masked).not.toContain("secret"); // masked on the wire

    // list
    const list = (await (await app.request("/api/provider/profiles")).json()) as unknown[];
    expect(list).toHaveLength(1);

    // active
    const active = await app.request("/api/provider/profiles/active");
    expect(active.status).toBe(200);

    // delete
    const del = await app.request(`/api/provider/profiles/${profile.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await del.json()) as { deleted: boolean }).toEqual({ deleted: true });
  });

  // #50: malformed provider profiles must 400, not silently create an unusable
  // active profile.
  describe("#50 provider profile validation", () => {
    async function provApp() {
      const dir = await mkdtemp(path.join(tmpdir(), "bp-prov50-"));
      const app = createApp({
        orchestrator: fakeOrchestrator(),
        fetchFn: vi.fn() as never,
        serveWeb: false,
        dataDir: dir,
        env: {},
      });
      return { app, dir };
    }
    const postProfile = (app: ReturnType<typeof createApp>, body: unknown) =>
      app.request("/api/provider/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    it("rejects an empty name with 400", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, { name: "", base_url: "https://x", api_key: "sk-x", models: ["m"] });
      expect(res.status).toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
    });

    it("rejects whitespace-only name with 400", async () => {
      const { app } = await provApp();
      expect((await postProfile(app, { name: "   ", models: ["m"] })).status).toBe(400);
    });

    it("rejects a non-array models with 400 (not a silent empty list)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, { name: "Bad Models Type", base_url: "https://x", api_key: "sk-x", models: "m" });
      expect(res.status).toBe(400);
    });

    it("rejects an empty models array with 400 (#61)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, { name: "empty-first", base_url: "", api_key: "sk-empty", models: [] });
      expect(res.status).toBe(400);
      // The empty-models profile must not have been persisted or activated.
      expect((await app.request("/api/provider/profiles/active")).status).toBe(204);
      const list = (await (await app.request("/api/provider/profiles")).json()) as unknown[];
      expect(list).toHaveLength(0);
    });

    it("rejects a create with no models field at all with 400 (#61)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, { name: "no-models", base_url: "https://x", api_key: "sk-x" });
      expect(res.status).toBe(400);
    });

    it("does not persist or activate an invalid profile", async () => {
      const { app } = await provApp();
      await postProfile(app, { name: "", base_url: "https://x", api_key: "sk-x", models: ["m"] });
      // no profile was created → active returns 204
      const active = await app.request("/api/provider/profiles/active");
      expect(active.status).toBe(204);
      const list = (await (await app.request("/api/provider/profiles")).json()) as unknown[];
      expect(list).toHaveLength(0);
    });

    it("still accepts a valid profile (201) and selects it active", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, { name: "Good", base_url: "https://x", api_key: "sk-x", models: ["m1", "m2"] });
      expect(res.status).toBe(201);
      const p = (await res.json()) as { is_active: boolean; models: string[] };
      expect(p.is_active).toBe(true);
      expect(p.models).toEqual(["m1", "m2"]);
    });

    it("persists and echoes the selected api protocol (#63)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, {
        name: "Azure",
        base_url: "https://r.openai.azure.com/openai",
        api: "azure-openai-responses",
        api_key: "sk-az",
        models: ["gpt-5.5"],
      });
      expect(res.status).toBe(201);
      expect(((await res.json()) as { api: string }).api).toBe("azure-openai-responses");
    });

    it("defaults api to anthropic-messages when omitted (#63 back-compat)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, { name: "Legacy", base_url: "https://x", api_key: "sk-x", models: ["m"] });
      expect(res.status).toBe(201);
      expect(((await res.json()) as { api: string }).api).toBe("anthropic-messages");
    });

    // #68 (R-10): adapter + is_shared on the wire.
    it("persists and echoes the adapter, defaulting to auto; is_shared is always false (#68)", async () => {
      const { app } = await provApp();
      const withAdapter = await postProfile(app, {
        name: "OpenAI-ish",
        base_url: "https://x",
        adapter: "openai",
        api_key: "sk-x",
        models: ["m"],
      });
      expect(withAdapter.status).toBe(201);
      const a = (await withAdapter.json()) as { adapter: string; is_shared: boolean };
      expect(a.adapter).toBe("openai");
      expect(a.is_shared).toBe(false);

      // omitted adapter → "auto"
      const noAdapter = await postProfile(app, { name: "Plain", base_url: "https://y", api_key: "sk-y", models: ["m"] });
      const b = (await noAdapter.json()) as { adapter: string; is_shared: boolean };
      expect(b.adapter).toBe("auto");
      expect(b.is_shared).toBe(false);
    });

    // #75: adapter without an explicit api must NOT be overridden by a default
    // anthropic-messages — the echoed api derives from the adapter, and the
    // stored profile carries no contradictory api.
    it("derives api from adapter when api is omitted, no contradictory default (#75)", async () => {
      const { app, dir } = await provApp();
      const res = await postProfile(app, {
        name: "adapter-openai-no-api",
        adapter: "openai",
        base_url: "https://example.invalid/v1",
        api_key: "sk-x",
        models: ["m"],
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { api: string; adapter: string };
      // echo reflects the derived wire value, not anthropic-messages
      expect(body.adapter).toBe("openai");
      expect(body.api).toBe("openai-completions");

      // the stored profile must not contain the contradictory default
      const stored = JSON.parse(
        await readFile(path.join(dir, "bp_template", "providers.json"), "utf8"),
      ) as { profiles: Array<{ adapter?: string; api?: string }> };
      expect(stored.profiles[0].adapter).toBe("openai");
      expect(stored.profiles[0].api).toBe("openai-completions");
    });

    it("adapter=anthropic derives anthropic-messages; auto falls back to default (#75)", async () => {
      const { app } = await provApp();
      const ant = await postProfile(app, { name: "A", adapter: "anthropic", base_url: "https://x", api_key: "k", models: ["m"] });
      expect(((await ant.json()) as { api: string }).api).toBe("anthropic-messages");
      const auto = await postProfile(app, { name: "B", adapter: "auto", base_url: "https://x", api_key: "k", models: ["m"] });
      expect(((await auto.json()) as { api: string }).api).toBe("anthropic-messages");
    });

    it("explicit api still wins over adapter (#75)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, {
        name: "explicit",
        adapter: "anthropic",
        api: "openai-responses",
        base_url: "https://x",
        api_key: "k",
        models: ["m"],
      });
      expect(((await res.json()) as { api: string }).api).toBe("openai-responses");
    });

    it("rejects an unknown adapter value with 400 (#68)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, {
        name: "Bad Adapter",
        base_url: "https://x",
        adapter: "totally-made-up",
        api_key: "sk-x",
        models: ["m"],
      });
      expect(res.status).toBe(400);
    });

    it("rejects an unknown api value with 400 (#63)", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, {
        name: "Bad Api",
        base_url: "https://x",
        api: "totally-made-up",
        api_key: "sk-x",
        models: ["m"],
      });
      expect(res.status).toBe(400);
    });

    it("#203 rejects a non-URL base_url with 400", async () => {
      const { app } = await provApp();
      const res = await postProfile(app, { name: "Bad URL", base_url: "not a url", api_key: "sk-x", models: ["m"] });
      expect(res.status).toBe(400);
    });

    it("#203 accepts an empty base_url and localhost base_url", async () => {
      const { app } = await provApp();
      expect((await postProfile(app, { name: "Empty Base", base_url: "", api_key: "sk-x", models: ["m"] })).status).toBe(
        201,
      );
      expect(
        (await postProfile(app, { name: "Local Base", base_url: "http://127.0.0.1:1234", api_key: "sk-x", models: ["m"] }))
          .status,
      ).toBe(201);
    });

    it("#205 rejects a duplicate provider name with 409 (case-insensitive)", async () => {
      const { app } = await provApp();
      expect((await postProfile(app, { name: "sqz", base_url: "https://a", api_key: "k", models: ["m"] })).status).toBe(
        201,
      );
      const dup = await postProfile(app, { name: "  SQZ  ", base_url: "https://b", api_key: "k", models: ["m"] });
      expect(dup.status).toBe(409);
      // only the first profile persisted
      const list = (await (await app.request("/api/provider/profiles")).json()) as unknown[];
      expect(list).toHaveLength(1);
    });
  });

  // #55: the Test button must do a real connectivity probe, not echo unknown.
  describe("#55 provider test endpoint", () => {
    async function makeProfile(fetchFn: unknown, models = ["m"]) {
      const dir = await mkdtemp(path.join(tmpdir(), "bp-prov55-"));
      const app = createApp({
        orchestrator: fakeOrchestrator(),
        fetchFn: fetchFn as never,
        serveWeb: false,
        dataDir: dir,
        env: {},
        providerProbeTimeoutMs: 50,
      });
      const created = await app.request("/api/provider/profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Gw", base_url: "https://gw.example.com/api", api_key: "sk-x", models }),
      });
      const { id } = (await created.json()) as { id: string };
      return { app, id };
    }

    it("reports unavailable for an unreachable gateway", async () => {
      const fetchFn = vi.fn(async () => {
        throw new TypeError("fetch failed");
      });
      const { app, id } = await makeProfile(fetchFn);
      const res = await app.request(`/api/provider/profiles/${id}/test`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { health_status: string };
      expect(body.health_status).toBe("unavailable");
    });

    it("reports healthy for a 2xx gateway", async () => {
      const fetchFn = vi.fn(async () => new Response("{}", { status: 200 }));
      const { app, id } = await makeProfile(fetchFn);
      const res = await app.request(`/api/provider/profiles/${id}/test`, { method: "POST" });
      const body = (await res.json()) as {
        health_status: string;
        model_health: Array<{ model: string; status: string; latency_ms?: number; checked_at?: number }>;
      };
      expect(body.health_status).toBe("healthy");
      expect(body.model_health).toHaveLength(1);
      expect(body.model_health[0]).toMatchObject({ model: "m", status: "healthy" });
      expect(body.model_health[0]!.latency_ms).toBeGreaterThanOrEqual(0);
      expect(body.model_health[0]!.checked_at).toBeGreaterThan(0);
    });

    it("marks only the model used by the probe and leaves untested models unknown", async () => {
      const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
      );
      const { app, id } = await makeProfile(fetchFn, ["tested-model", "other-model"]);

      const res = await app.request(`/api/provider/profiles/${id}/test`, { method: "POST" });
      const body = (await res.json()) as {
        model_health: Array<{ model: string; status: string }>;
      };

      expect(body.model_health).toEqual([
        expect.objectContaining({ model: "tested-model", status: "healthy" }),
        { model: "other-model", status: "unknown" },
      ]);
      const request = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as { model: string };
      expect(request.model).toBe("tested-model");
    });

    it("404s for an unknown profile id", async () => {
      const fetchFn = vi.fn();
      const { app } = await makeProfile(fetchFn);
      const res = await app.request("/api/provider/profiles/nope/test", { method: "POST" });
      expect(res.status).toBe(404);
    });

    // #69: the probe result must be persisted, so a later GET (card refresh /
    // reopen) keeps the tested status instead of reverting to "unknown".
    it("persists the probe result across list + health reads", async () => {
      const fetchFn = vi.fn(async () => new Response("forbidden", { status: 403 }));
      const { app, id } = await makeProfile(fetchFn);

      // before any test: unknown
      const before = (await (await app.request("/api/provider/profiles")).json()) as Array<{
        id: string;
        health_status: string;
      }>;
      expect(before.find((p) => p.id === id)?.health_status).toBe("unknown");

      // test → 403 maps to "unavailable"
      const test = await app.request(`/api/provider/profiles/${id}/test`, { method: "POST" });
      const tested = (await test.json()) as { health_status: string; health_checked_at: number; health_message: string };
      expect(tested.health_status).toBe("unavailable");
      expect(tested.health_checked_at).toBeGreaterThan(0);
      expect(tested.health_message).toContain("403");

      // list still reflects the tested status (no longer unknown)
      const list = (await (await app.request("/api/provider/profiles")).json()) as Array<{
        id: string;
        health_status: string;
        health_checked_at?: number;
        model_health: Array<{ model: string; status: string; error?: string }>;
      }>;
      const fromList = list.find((p) => p.id === id);
      expect(fromList?.health_status).toBe("unavailable");
      expect(fromList?.health_checked_at).toBeGreaterThan(0);
      expect(fromList?.model_health[0]).toMatchObject({
        model: "m",
        status: "unavailable",
      });
      expect(fromList?.model_health[0]?.error).toContain("403");

      // and the dedicated health endpoint too
      const health = (await (await app.request("/api/provider/profiles/health")).json()) as Array<{
        id: string;
        health_status: string;
      }>;
      expect(health.find((p) => p.id === id)?.health_status).toBe("unavailable");
    });
  });
});

// #301: per-user (dynamic) routing. The backend passes the resolved user id
// (X-BP-User header, trust-front) to the orchestrator and caches one runtime
// client per baseUrl, so two users hit two different sandboxes.
describe("per-user sandbox routing (#301)", () => {
  function routingOrchestrator(): {
    orch: Orchestrator;
    seen: string[];
  } {
    const seen: string[] = [];
    const orch: Orchestrator = {
      async ensureRuntime(opts): Promise<RuntimeHandle> {
        const userId = opts?.userId ?? "none";
        seen.push(userId);
        return { baseUrl: `http://runtime-${userId}.test` };
      },
      async health() {
        return true;
      },
      async stopRuntime() {},
    };
    return { orch, seen };
  }

  it("routes distinct X-BP-User values to distinct runtimes", async () => {
    const { orch, seen } = routingOrchestrator();
    const hit: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      hit.push(url);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const app = createApp({ orchestrator: orch, fetchFn: fetchFn as never, serveWeb: false });

    await app.request("/api/sessions", { headers: { "x-bp-user": "alice" } });
    await app.request("/api/sessions", { headers: { "x-bp-user": "bob" } });

    expect(seen).toEqual(["alice", "bob"]);
    expect(hit).toEqual([
      "http://runtime-alice.test/sessions",
      "http://runtime-bob.test/sessions",
    ]);
  });

  it("falls back to `local` when no header is present", async () => {
    const { orch, seen } = routingOrchestrator();
    const fetchFn = vi.fn(async () =>
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const app = createApp({ orchestrator: orch, fetchFn: fetchFn as never, serveWeb: false });
    await app.request("/api/sessions");
    expect(seen).toEqual(["local"]);
  });

  it("/auth/me reflects the X-BP-User identity", async () => {
    const { orch } = routingOrchestrator();
    const app = createApp({ orchestrator: orch, serveWeb: false });
    const res = await app.request("/api/auth/me", { headers: { "x-bp-user": "alice" } });
    expect(await res.json()).toMatchObject({ id: "alice", username: "alice" });
  });
});
