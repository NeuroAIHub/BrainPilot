import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { down } from "./down.js";
import { status } from "./status.js";
import { writePid, readPid, writeServerState, readServerState } from "../process-control.js";
import { dataPaths } from "../paths.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "bp-ds-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A fake process table: set of live pids; records signals delivered. */
function fakeProcs(live: Set<number>) {
  const signals: Array<{ pid: number; sig: string }> = [];
  return {
    signals,
    isAlive: (pid: number) => live.has(pid),
    signal: (pid: number, sig: NodeJS.Signals) => {
      signals.push({ pid, sig });
      if (sig === "SIGTERM" || sig === "SIGKILL") live.delete(pid);
    },
    sleep: async () => {},
  };
}

describe("down", () => {
  it("reports no running backend when no pid file", async () => {
    const root = join(dir, "bp");
    const res = await down({ dir: root }, { log: () => {} });
    expect(res.pid).toBeNull();
    expect(res.stopped).toBe(false);
  });

  it("SIGTERMs a live backend and removes the pid file", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    await writePid(p.backendPid, 1234);
    const procs = fakeProcs(new Set([1234]));

    const res = await down(
      { dir: root },
      { ...procs, log: () => {} },
    );

    expect(res.stopped).toBe(true);
    expect(res.pid).toBe(1234);
    expect(res.forced).toBe(false);
    expect(procs.signals).toContainEqual({ pid: 1234, sig: "SIGTERM" });
    expect(await readPid(p.backendPid)).toBeNull();
  });

  it("treats a stale pid (dead process) as already stopped", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    await writePid(p.backendPid, 9999);
    const procs = fakeProcs(new Set()); // 9999 not alive

    const res = await down({ dir: root }, { ...procs, log: () => {} });
    expect(res.stopped).toBe(true);
    expect(procs.signals).toHaveLength(0);
    expect(await readPid(p.backendPid)).toBeNull();
  });

  it("removes the persisted server state on down (#41)", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    await writePid(p.backendPid, 1234);
    await writeServerState(p.serverState, {
      pid: 1234,
      port: 9801,
      runtimePort: 9802,
      host: "127.0.0.1",
    });
    const procs = fakeProcs(new Set([1234]));

    await down({ dir: root }, { ...procs, log: () => {} });
    expect(await readServerState(p.serverState)).toBeNull();
  });

  it("backstops an orphaned runtime via runtime.pid (#58)", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    // Backend already gone, but the orchestrator lost track of the runtime, so
    // runtime.pid still points at a live runtime on port+1.
    await writePid(p.backendPid, 1000);
    await writePid(p.runtimePid, 2000);
    const procs = fakeProcs(new Set([1000, 2000]));

    await down({ dir: root }, { ...procs, log: () => {} });

    // Both the backend and the orphaned runtime must be signalled.
    expect(procs.signals).toContainEqual({ pid: 1000, sig: "SIGTERM" });
    expect(procs.signals).toContainEqual({ pid: 2000, sig: "SIGTERM" });
    // And the runtime pid file is cleaned up by stop().
    expect(await readPid(p.runtimePid)).toBeNull();
  });

  it("is a no-op for the runtime when no runtime.pid file exists (#58)", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    await writePid(p.backendPid, 1234);
    const procs = fakeProcs(new Set([1234]));

    const res = await down({ dir: root }, { ...procs, log: () => {} });
    expect(res.stopped).toBe(true);
    // Only the backend was signalled; no runtime pid to chase.
    expect(procs.signals).toEqual([{ pid: 1234, sig: "SIGTERM" }]);
  });
});

describe("status", () => {
  it("reports stopped when no pid", async () => {
    const root = join(dir, "bp");
    const report = await status({ dir: root, port: 9001 }, { log: () => {} });
    expect(report.running).toBe(false);
    expect(report.healthy).toBe(false);
    expect(report.backendPort).toBe(9001);
    expect(report.runtimePort).toBe(9002);
  });

  it("reports running + health + metrics for a live backend", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    await writePid(p.backendPid, 555);

    const fetchFn = (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/api/health")) return new Response("ok", { status: 200 });
      if (u.endsWith("/api/metrics"))
        return new Response(
          JSON.stringify({ activeSessions: 2, runningAgents: 3 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const report = await status(
      { dir: root, port: 9001 },
      { isAlive: () => true, fetchFn, log: () => {} },
    );

    expect(report.running).toBe(true);
    expect(report.pid).toBe(555);
    expect(report.healthy).toBe(true);
    expect(report.metrics).toEqual({ activeSessions: 2, runningAgents: 3 });
  });

  it("reports the persisted custom port from server.json without --port (#41)", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    await writePid(p.backendPid, 555);
    await writeServerState(p.serverState, {
      pid: 555,
      port: 9801,
      runtimePort: 9802,
      host: "127.0.0.1",
    });

    const probed: string[] = [];
    const fetchFn = (async (url: string | URL) => {
      probed.push(String(url));
      if (String(url).endsWith("/api/health")) return new Response("ok", { status: 200 });
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const report = await status({ dir: root }, { isAlive: () => true, fetchFn, log: () => {} });

    expect(report.backendPort).toBe(9801);
    expect(report.runtimePort).toBe(9802);
    expect(report.healthy).toBe(true);
    expect(probed.some((u) => u.includes(":9801/api/health"))).toBe(true);
  });

  it("lets an explicit --port override server.json (#41)", async () => {
    const root = join(dir, "bp");
    const p = dataPaths(root);
    await writePid(p.backendPid, 555);
    await writeServerState(p.serverState, {
      pid: 555,
      port: 9801,
      runtimePort: 9802,
      host: "127.0.0.1",
    });

    const report = await status(
      { dir: root, port: 9701 },
      { isAlive: () => true, fetchFn: (async () => new Response("ok", { status: 200 })) as unknown as typeof fetch, log: () => {} },
    );

    expect(report.backendPort).toBe(9701);
    expect(report.runtimePort).toBe(9702);
  });
});
