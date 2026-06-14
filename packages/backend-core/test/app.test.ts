import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
});

describe("Hono app — SSE byte passthrough (修正4)", () => {
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
});
