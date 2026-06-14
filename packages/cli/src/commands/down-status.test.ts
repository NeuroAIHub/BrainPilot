import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { down } from "./down.js";
import { status } from "./status.js";
import { writePid, readPid } from "../process-control.js";
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
});
