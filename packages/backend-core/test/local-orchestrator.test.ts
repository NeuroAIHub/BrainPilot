import { describe, expect, it, vi } from "vitest";
import {
  LocalProcessOrchestrator,
  type SpawnedProcess,
} from "../src/local-orchestrator.js";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A controllable fake child process for testing exit/restart logic. */
function makeFakeProc(pid: number = 4242): SpawnedProcess & {
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
    await orch.ensureRuntime();
    expect(spawnFn).toHaveBeenCalledTimes(1);

    // First crash -> restart.
    procs[0]!.emitExit(1, null);
    await Promise.resolve();
    await Promise.resolve();
    expect(spawnFn).toHaveBeenCalledTimes(2);

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

    // Crash repeatedly. Budget=2 restarts; the 3rd crash exhausts it.
    for (let i = 0; i < 5 && !onFatal.mock.calls.length; i++) {
      procs[procs.length - 1]!.emitExit(1, null);
      await Promise.resolve();
      await Promise.resolve();
    }
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
    await orch.stopRuntime();
    expect(procs[0]!.killed).toContain("SIGTERM");
    procs[0]!.emitExit(1, null);
    await Promise.resolve();
    expect(spawnFn).toHaveBeenCalledTimes(1);
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
