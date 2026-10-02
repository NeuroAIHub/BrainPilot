import { describe, expect, it, vi } from "vitest";
import {
  LocalProcessOrchestrator,
  type SpawnedProcess,
} from "../src/local-orchestrator.js";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A controllable fake child process for testing exit/restart logic. */
function makeFakeProc(pid: number = 4242, opts: { ignoreTerm?: boolean; autoExit?: boolean } = {}): SpawnedProcess & {
  emitExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  emitError: (err: Error) => void;
  killed: NodeJS.Signals[];
} {
  const exitListeners: Array<(c: number | null, s: NodeJS.Signals | null) => void> = [];
  const errorListeners: Array<(e: Error) => void> = [];
  const killed: NodeJS.Signals[] = [];
  return {
    pid,
    killed,
    on(event: string, listener: (...args: never[]) => void) {
      if (event === "exit") exitListeners.push(listener as never);
      if (event === "error") errorListeners.push(listener as never);
      return this;
    },
    kill(signal?: NodeJS.Signals) {
      killed.push(signal ?? "SIGTERM");
      if (opts.autoExit !== false && (signal !== "SIGTERM" || !opts.ignoreTerm)) {
        queueMicrotask(() => this.emitExit(null, signal ?? "SIGTERM"));
      }
      return true;
    },
    emitExit(code, signal) {
      for (const l of exitListeners) l(code, signal);
    },
    emitError(err) {
      for (const l of errorListeners) l(err);
    },
  };
}

describe("LocalProcessOrchestrator argv/env", () => {
  it("builds spawn argv with execPath + resolved runtime server path", () => {
    const orch = new LocalProcessOrchestrator({
      execPath: "/usr/bin/node",
      runtimeServerPath: "/abs/runtime/server.js",
      dataDir: "/tmp/bp",
      port: 8081,
    });
    const { command, args } = orch.buildArgv();
    expect(command).toBe("/usr/bin/node");
    expect(args).toEqual(["/abs/runtime/server.js"]);
  });

  it("injects BP_DATA_DIR and PORT into the runtime env", () => {
    const orch = new LocalProcessOrchestrator({
      dataDir: "/data/bp",
      port: 9091,
    });
    const env = orch.buildEnv({ FOO: "bar" });
    expect(env.BP_DATA_DIR).toBe("/data/bp");
    expect(env.PORT).toBe("9091");
    expect(env.AGENT_RUNTIME_PORT).toBe("9091");
    expect(env.FOO).toBe("bar");
  });

  it("calls spawn with execPath + server path + env on ensureRuntime", async () => {
    const proc = makeFakeProc();
    const spawnFn = vi.fn(() => proc);
    const orch = new LocalProcessOrchestrator({
      execPath: "/usr/bin/node",
      runtimeServerPath: "/abs/server.js",
      dataDir: "/d",
      port: 8081,
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
    });
    const handle = await orch.ensureRuntime();
    expect(handle.baseUrl).toBe("http://127.0.0.1:8081");
    expect(handle.instanceId).toEqual(expect.any(String));
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnFn.mock.calls[0]!;
    expect(cmd).toBe("/usr/bin/node");
    expect(args).toEqual(["/abs/server.js"]);
    expect((opts.env as Record<string, string>).BP_DATA_DIR).toBe("/d");
    expect((opts.env as Record<string, string>).PORT).toBe("8081");
  });
});

describe("LocalProcessOrchestrator restart logic", () => {
  it("auto-restarts on abnormal exit within the budget", async () => {
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    const orch = new LocalProcessOrchestrator({
      execPath: "node",
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
      maxRestarts: 5,
    });
    const first = await orch.ensureRuntime();
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // First crash -> restart.
    procs[0]!.emitExit(1, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(spawnFn).toHaveBeenCalledTimes(2);
    const restarted = await orch.ensureRuntime();
    expect(restarted.instanceId).not.toBe(first.instanceId);

    // Second crash -> restart.
    procs[1]!.emitExit(null, "SIGSEGV");
    await Promise.resolve();
    await Promise.resolve();
    expect(spawnFn).toHaveBeenCalledTimes(3);
  });

  it("gives up and fires onFatal after exceeding the restart budget", async () => {
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    const onFatal = vi.fn();
    const orch = new LocalProcessOrchestrator({
      execPath: "node",
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
      maxRestarts: 2,
      onFatal,
    });
    await orch.ensureRuntime();

    // Crash repeatedly. Wait for each replacement to become healthy before
    // crashing it, so late events from the old child cannot skew the budget.
    for (let i = 0; i < 2; i++) {
      procs[i]!.emitExit(1, null);
      await orch.ensureRuntime();
    }
    procs[2]!.emitExit(1, null);
    await expect(orch.ensureRuntime()).rejects.toThrow(/giving up/);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0]![0]).toBeInstanceOf(Error);
  });

  it("does not restart on clean exit (code 0)", async () => {
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    const orch = new LocalProcessOrchestrator({
      execPath: "node",
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await orch.ensureRuntime();
    procs[0]!.emitExit(0, null);
    await Promise.resolve();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("does not restart after stopRuntime()", async () => {
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    const orch = new LocalProcessOrchestrator({
      execPath: "node",
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await orch.ensureRuntime();
    const stopped = orch.stopRuntime();
    expect(procs[0]!.killed).toContain("SIGTERM");
    procs[0]!.emitExit(1, null);
    await stopped;
    await Promise.resolve();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("force-kills a runtime that does not exit within the grace period", async () => {
    const proc = makeFakeProc(4242, { ignoreTerm: true });
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn: () => proc,
      healthProbe: async () => true,
      sleep: async () => {},
      stopTimeoutMs: 0,
    });
    await orch.ensureRuntime();
    await orch.stopRuntime();
    expect(proc.killed).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("LocalProcessOrchestrator single-flight + first-start failure (#58)", () => {
  it("is single-flight: concurrent ensureRuntime() spawns the runtime only once", async () => {
    const proc = makeFakeProc();
    const spawnFn = vi.fn(() => proc);
    // Health gated on a switch we flip after the concurrent calls are in flight,
    // so all callers must share the one in-flight startup promise.
    let healthy = false;
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => healthy,
      sleep: async () => {},
      healthTimeoutMs: 1000,
    });

    const calls = Array.from({ length: 12 }, () => orch.ensureRuntime());
    // Let the first call spawn + start polling, then become healthy.
    await Promise.resolve();
    healthy = true;
    const handles = await Promise.all(calls);

    expect(spawnFn).toHaveBeenCalledTimes(1);
    for (const h of handles) {
      expect(h.baseUrl).toBe(handles[0]!.baseUrl);
    }
  });

  it("does NOT enter the restart loop when a first-start child exits before ever being healthy", async () => {
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    // Never healthy: simulates a duplicate that lost the port race (EADDRINUSE)
    // and exits. waitForHealth should time out; the exit must not restart.
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => false,
      sleep: async () => {},
      healthTimeoutMs: 0,
    });

    await expect(orch.ensureRuntime()).rejects.toThrow(/did not become healthy/);
    // The child "crashes" after the failed startup — must not trigger a restart.
    procs[0]!.emitExit(1, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("can retry a fresh startup after a first-start failure", async () => {
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const p = makeFakeProc();
      procs.push(p);
      return p;
    });
    let healthy = false;
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => healthy,
      sleep: async () => {},
      healthTimeoutMs: 0,
    });

    await expect(orch.ensureRuntime()).rejects.toThrow(/did not become healthy/);
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // starting was cleared, so a later call retries with a fresh spawn.
    healthy = true;
    const handle = await orch.ensureRuntime();
    expect(handle.baseUrl).toBe("http://127.0.0.1:8081");
    expect(spawnFn).toHaveBeenCalledTimes(2);
  });
});

describe("LocalProcessOrchestrator owned-child lifecycle (#565)", () => {
  it("keeps an unhealthy living child and its identity until health returns", async () => {
    const child = makeFakeProc();
    const spawnFn = vi.fn(() => child);
    let healthy = true;
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js", spawnFn,
      healthProbe: async () => healthy,
    });
    const first = await orch.ensureRuntime();
    healthy = false;
    await expect(orch.ensureRuntime()).rejects.toThrow(/owned runtime is still running/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(child.killed).toEqual([]);
    healthy = true;
    expect(await orch.ensureRuntime()).toEqual(first);
    await orch.stopRuntime();
  });

  it("joins crash recovery during backoff and ignores stale child events", async () => {
    const children: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const child = makeFakeProc();
      children.push(child);
      return child;
    });
    let releaseBackoff!: () => void;
    const backoff = new Promise<void>((resolve) => { releaseBackoff = resolve; });
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js", spawnFn,
      healthProbe: async () => true,
      sleep: async () => backoff,
    });
    const first = await orch.ensureRuntime();
    children[0]!.emitExit(1, null);
    const callers = Array.from({ length: 5 }, () => orch.ensureRuntime());
    expect(spawnFn).toHaveBeenCalledTimes(1);
    releaseBackoff();
    const handles = await Promise.all(callers);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(handles.every((handle) => handle.instanceId === handles[0]!.instanceId)).toBe(true);
    expect(handles[0]!.instanceId).not.toBe(first.instanceId);
    children[0]!.emitError(new Error("late error"));
    children[0]!.emitExit(1, null);
    expect(await orch.ensureRuntime()).toEqual(handles[0]);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    await orch.stopRuntime();
  });

  it("cancels delayed recovery on stop and starts once afterward", async () => {
    const children: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const child = makeFakeProc();
      children.push(child);
      return child;
    });
    let releaseBackoff!: () => void;
    const backoff = new Promise<void>((resolve) => { releaseBackoff = resolve; });
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js", spawnFn,
      healthProbe: async () => true,
      sleep: async () => backoff,
    });
    await orch.ensureRuntime();
    children[0]!.emitExit(1, null);
    const stopped = orch.stopRuntime();
    releaseBackoff();
    await stopped;
    expect(spawnFn).toHaveBeenCalledTimes(1);
    await orch.ensureRuntime();
    expect(spawnFn).toHaveBeenCalledTimes(2);
    await orch.stopRuntime();
  });

  it("does not spawn when stop races the queued first startup", async () => {
    const spawnFn = vi.fn(() => makeFakeProc());
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js", spawnFn,
      healthProbe: async () => true,
    });
    const starting = orch.ensureRuntime();
    const stopped = orch.stopRuntime();
    await expect(starting).rejects.toThrow(/cancelled/);
    await stopped;
    expect(spawnFn).toHaveBeenCalledTimes(0);
    await orch.ensureRuntime();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    await orch.stopRuntime();
  });

  it("does not reset an exhausted restart budget on repeated ensure calls", async () => {
    const children: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const child = makeFakeProc();
      children.push(child);
      return child;
    });
    const onFatal = vi.fn();
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js", spawnFn,
      healthProbe: async () => true,
      sleep: async () => {}, maxRestarts: 1, onFatal,
    });
    await orch.ensureRuntime();
    children[0]!.emitExit(1, null);
    await orch.ensureRuntime();
    children[1]!.emitExit(1, null);
    await expect(orch.ensureRuntime()).rejects.toThrow(/giving up|budget exhausted/);
    await expect(orch.ensureRuntime()).rejects.toThrow(/budget exhausted/);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(onFatal).toHaveBeenCalledTimes(1);
  });

  it("counts a child error followed by exit as one crash", async () => {
    const children: ReturnType<typeof makeFakeProc>[] = [];
    const spawnFn = vi.fn(() => {
      const child = makeFakeProc();
      children.push(child);
      return child;
    });
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js", spawnFn,
      healthProbe: async () => true,
      sleep: async () => {}, maxRestarts: 1,
    });
    await orch.ensureRuntime();
    children[0]!.emitError(new Error("process error"));
    expect(spawnFn).toHaveBeenCalledTimes(1);
    children[0]!.emitExit(1, null);
    await orch.ensureRuntime();
    children[0]!.emitExit(1, null);
    expect(spawnFn).toHaveBeenCalledTimes(2);
    await orch.stopRuntime();
  });
});

describe("Orchestrator interface conformance", () => {
  it("LocalProcessOrchestrator implements ensureRuntime/health/stopRuntime", () => {
    const orch = new LocalProcessOrchestrator();
    expect(typeof orch.ensureRuntime).toBe("function");
    expect(typeof orch.health).toBe("function");
    expect(typeof orch.stopRuntime).toBe("function");
  });

  it("health() is false before any runtime is started", async () => {
    const orch = new LocalProcessOrchestrator({ healthProbe: async () => true });
    expect(await orch.health()).toBe(false);
  });
});

describe("LocalProcessOrchestrator log/pid artifacts", () => {
  it("passes fd-based stdio when runtimeLogFile is set", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp-lo-"));
    let captured: { env: NodeJS.ProcessEnv; stdio?: unknown } | undefined;
    const spawnFn = (_c: string, _a: readonly string[], o: { env: NodeJS.ProcessEnv; stdio?: unknown }) => {
      captured = o;
      return makeFakeProc();
    };
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
      runtimeLogFile: join(dir, "runtime.log"),
    });
    await orch.ensureRuntime();
    expect(Array.isArray(captured!.stdio)).toBe(true);
    const stdio = captured!.stdio as unknown[];
    expect(stdio[0]).toBe("ignore");
    expect(stdio[1]).toBe(stdio[2]); // stdout and stderr share the same fd
    expect(typeof stdio[1]).toBe("number");
  });

  it("does NOT pass stdio (keeps inherit) when no runtimeLogFile set", async () => {
    let captured: { env: NodeJS.ProcessEnv; stdio?: unknown } | undefined;
    const spawnFn = (_c: string, _a: readonly string[], o: { env: NodeJS.ProcessEnv; stdio?: unknown }) => {
      captured = o;
      return makeFakeProc();
    };
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
    });
    await orch.ensureRuntime();
    expect(captured!.stdio).toBeUndefined();
  });

  it("writes the runtime pid file on spawn and removes it on stopRuntime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp-lo-"));
    const pidFile = join(dir, "runtime.pid");
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn: () => makeFakeProc(7777),
      healthProbe: async () => true,
      sleep: async () => {},
      runtimePidFile: pidFile,
    });
    await orch.ensureRuntime();
    expect(readFileSync(pidFile, "utf8")).toBe("7777");
    await orch.stopRuntime();
    expect(existsSync(pidFile)).toBe(false);
  });

  it("refreshes the pid file with the new pid after a crash restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp-lo-"));
    const pidFile = join(dir, "runtime.pid");
    const pids = [1001, 1002];
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    let i = 0;
    const spawnFn = () => {
      const p = makeFakeProc(pids[i++]!);
      procs.push(p);
      return p;
    };
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn,
      healthProbe: async () => true,
      sleep: async () => {},
      runtimePidFile: pidFile,
    });
    await orch.ensureRuntime();
    expect(readFileSync(pidFile, "utf8")).toBe("1001");
    procs[0]!.emitExit(1, null); // crash -> restart
    await Promise.resolve();
    await Promise.resolve();
    expect(readFileSync(pidFile, "utf8")).toBe("1002");
  });

  it("removes the pid file on clean exit (code 0)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bp-lo-"));
    const pidFile = join(dir, "runtime.pid");
    const procs: ReturnType<typeof makeFakeProc>[] = [];
    const orch = new LocalProcessOrchestrator({
      runtimeServerPath: "/s.js",
      spawnFn: () => {
        const p = makeFakeProc();
        procs.push(p);
        return p;
      },
      healthProbe: async () => true,
      sleep: async () => {},
      runtimePidFile: pidFile,
    });
    await orch.ensureRuntime();
    expect(existsSync(pidFile)).toBe(true);
    procs[0]!.emitExit(0, null);
    await Promise.resolve();
    expect(existsSync(pidFile)).toBe(false);
  });
});
