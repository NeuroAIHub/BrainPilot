import { mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildServerOrchestrator, resolveServerKbManagementEnabled, resolveServerKbRoot, startServer } from "../src/server.js";
import { DockerOrchestrator } from "../src/docker-orchestrator.js";
import { LocalProcessOrchestrator } from "../src/local-orchestrator.js";
import type { Orchestrator } from "../src/orchestrator.js";

/**
 * Regression coverage for issue #169 — `startServer` dropped `dataDir` when
 * constructing the orchestrator, so the runtime child it spawns fell back to
 * `./brainpilot` (relative to cwd) instead of the requested data dir. The
 * orchestrator construction is now a pure, exported function so this seam is
 * testable without binding a socket.
 *
 * The `create-orchestrator.test.ts` suite already covers the factory in
 * isolation; what was missing was the *caller* wiring — that `options.dataDir`
 * actually reaches the local orchestrator's `BP_DATA_DIR`.
 */
describe("buildServerOrchestrator", () => {
  it("threads dataDir through to the local runtime env (#169)", () => {
    const orch = buildServerOrchestrator({
      dataDir: "/data/xyz",
      // foreground/CLI mode — exercises the stdioInherit branch too.
      stdioInherit: true,
    });
    expect(orch).toBeInstanceOf(LocalProcessOrchestrator);
    const env = (orch as LocalProcessOrchestrator).buildEnv();
    expect(env.BP_DATA_DIR).toBe("/data/xyz");
  });

  it("threads dataDir through in detached (non-stdioInherit) mode too", () => {
    const orch = buildServerOrchestrator({ dataDir: "/data/detached" });
    expect(orch).toBeInstanceOf(LocalProcessOrchestrator);
    const env = (orch as LocalProcessOrchestrator).buildEnv();
    expect(env.BP_DATA_DIR).toBe("/data/detached");
  });

  it("threads dataDir through to the single-user Docker bind mount", () => {
    const orch = buildServerOrchestrator({
      dataDir: "/data/docker",
      mode: "docker",
    });
    expect(orch).toBeInstanceOf(DockerOrchestrator);
    expect((orch as unknown as { dataDir?: string }).dataDir).toBe("/data/docker");
  });

  it("maps single-user Docker KB management into the mounted data root", () => {
    expect(resolveServerKbRoot({
      dataDir: "/data/docker",
      mode: "docker",
    })).toBe("/data/docker/KnowledgeBase");
    expect(resolveServerKbRoot({
      dataDir: "/data/docker",
      env: { BP_DYNAMIC: "1" },
      mode: "docker",
    })).toBeUndefined();
  });

  it("disables KB management server-side in dynamic multi-user mode", () => {
    expect(resolveServerKbManagementEnabled({ env: { BP_DYNAMIC: "1" } })).toBe(false);
    expect(resolveServerKbManagementEnabled({ env: { BP_DYNAMIC: "0" } })).toBe(true);
    expect(resolveServerKbManagementEnabled({
      env: { BP_DYNAMIC: "1" },
      kbManagementEnabled: true,
    })).toBe(true);
  });

  it("threads runtimePort through to the local runtime env (#171)", () => {
    // Foreground path: `up` prechecks port+1 and must pass it to the backend so
    // the runtime binds there instead of the AGENT_RUNTIME_PORT/8081 fallback.
    const orch = buildServerOrchestrator({
      dataDir: "/data/xyz",
      stdioInherit: true,
      runtimePort: 9501,
    });
    expect(orch).toBeInstanceOf(LocalProcessOrchestrator);
    const env = (orch as LocalProcessOrchestrator).buildEnv();
    expect(env.AGENT_RUNTIME_PORT).toBe("9501");
  });

  it("falls back to the default runtime port when runtimePort is omitted (#171)", () => {
    const prev = process.env.AGENT_RUNTIME_PORT;
    delete process.env.AGENT_RUNTIME_PORT;
    try {
      const orch = buildServerOrchestrator({ dataDir: "/data/xyz", stdioInherit: true });
      const env = (orch as LocalProcessOrchestrator).buildEnv();
      expect(env.AGENT_RUNTIME_PORT).toBe("8081");
    } finally {
      if (prev === undefined) delete process.env.AGENT_RUNTIME_PORT;
      else process.env.AGENT_RUNTIME_PORT = prev;
    }
  });

  it("returns an injected orchestrator verbatim (short-circuit)", () => {
    const injected = { id: "injected" } as unknown as Orchestrator;
    expect(buildServerOrchestrator({ orchestrator: injected })).toBe(injected);
  });

  it("falls back to BP_DATA_DIR env when no dataDir option is given", () => {
    const prev = process.env.BP_DATA_DIR;
    process.env.BP_DATA_DIR = "/data/from-env";
    try {
      const orch = buildServerOrchestrator({ stdioInherit: true });
      const env = (orch as LocalProcessOrchestrator).buildEnv();
      expect(env.BP_DATA_DIR).toBe("/data/from-env");
    } finally {
      if (prev === undefined) delete process.env.BP_DATA_DIR;
      else process.env.BP_DATA_DIR = prev;
    }
  });
});

describe("startServer graceful shutdown (#407)", () => {
  it("closes an active browser SSE connection promptly and is idempotent", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bp-shutdown-"));
    const stopRuntime = vi.fn(async () => {});
    const orchestrator: Orchestrator = {
      async ensureRuntime() { return { baseUrl: "http://runtime.test" }; },
      async health() { return true; },
      stopRuntime,
    };
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(": connected\n\n"));
          signal.addEventListener("abort", () => controller.close(), { once: true });
        },
      }), { headers: { "content-type": "text/event-stream" } });
    });

    let running: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      running = await startServer({
        port: 0,
        hostname: "127.0.0.1",
        orchestrator,
        fetchFn: fetchFn as never,
        serveWeb: false,
        dataDir,
      });
      if (!running.server.listening) await once(running.server, "listening");
      const address = running.server.address();
      if (!address || typeof address === "string") throw new Error("server did not bind a TCP port");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/sse/live`);
      expect(response.status).toBe(200);

      const firstStop = running.stop();
      const secondStop = running.stop();
      expect(secondStop).toBe(firstStop);
      await Promise.race([
        firstStop,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("shutdown timed out")), 2_000)),
      ]);
      expect(stopRuntime).toHaveBeenCalledTimes(1);
      await response.body?.cancel().catch(() => {});
    } finally {
      await running?.stop().catch(() => {});
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
