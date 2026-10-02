/**
 * LocalProcessOrchestrator — 免 Docker 本地直跑 (§11A.3 / §11A.5).
 *
 * Spawns the runtime as a child process:
 *   spawn(process.execPath, [require.resolve('@brainpilot/runtime/server')],
 *         { env: { BP_DATA_DIR, PORT, ... } })
 *
 * IMPORTANT: we never `import` runtime symbols — the resolved server path is
 * just a string handed to a child process (per the package brief / 决策 E).
 *
 * Crash self-healing (§11A.5 决策 F): on abnormal exit, restart a bounded
 * number of times within a sliding window with exponential backoff; past the
 * threshold, give up and mark the runtime dead (caller surfaces a fatal event).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { openSync, closeSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { gracefulSignalsSupported } from "@brainpilot/runtime";
import type {
  EnsureRuntimeOptions,
  Orchestrator,
  RuntimeHandle,
} from "./orchestrator.js";

/** Minimal shape we need from a spawned process — eases stubbing in tests. */
export interface SpawnedProcess {
  readonly pid?: number;
  on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: "error", listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio?: unknown },
) => SpawnedProcess;

export interface LocalOrchestratorOptions {
  /** BP_DATA_DIR for the runtime (§11A.2). Default `./brainpilot`. */
  dataDir?: string;
  /** Runtime port. Default 8081 (backend 9001 + 1, stride-2 §16). */
  port?: number;
  host?: string;
  /** Override `process.execPath` (node binary). */
  execPath?: string;
  /** Override the resolved runtime server entry path. */
  runtimeServerPath?: string;
  /** Injectable spawn (for tests). Defaults to node:child_process.spawn. */
  spawnFn?: SpawnFn;
  /** Max restarts within the sliding window before giving up. Default 5. */
  maxRestarts?: number;
  /** Sliding-window length in ms for counting restarts. Default 60_000. */
  restartWindowMs?: number;
  /** Base backoff in ms (exponential). Default 200. */
  backoffBaseMs?: number;
  /** Injectable health probe (for tests). Defaults to fetch GET /health. */
  healthProbe?: (baseUrl: string) => Promise<boolean>;
  /** Health wait timeout in ms when ensuring readiness. Default 30_000. */
  healthTimeoutMs?: number;
  /** Grace period for runtime persistence before SIGKILL. Default 5_000. */
  stopTimeoutMs?: number;
  /** Called when the restart budget is exhausted (§11A.5 fatal). */
  onFatal?: (err: Error) => void;
  /** Sleep impl (for tests). */
  sleep?: (ms: number) => Promise<void>;
  /** If set, the runtime child's stdout/stderr are appended to this file
   *  (replaces stdio:"inherit"). If unset, inherit is kept (zero behavior change). */
  runtimeLogFile?: string;
  /** If set, the runtime child's pid is written here; removed on clean exit / stopRuntime. */
  runtimePidFile?: string;
  /** When true, inherit the runtime child's stdio (foreground CLI mode). */
  stdioInherit?: boolean;
}

/** Resolve `@brainpilot/runtime/server` to an absolute path WITHOUT importing it. */
export function resolveRuntimeServerPath(): string {
  const require = createRequire(import.meta.url);
  return require.resolve("@brainpilot/runtime/server");
}

async function defaultHealthProbe(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

const sleepDefault = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class LocalProcessOrchestrator implements Orchestrator {
  private readonly opts: Required<
    Omit<
      LocalOrchestratorOptions,
      | "onFatal"
      | "runtimeServerPath"
      | "runtimeLogFile"
      | "runtimePidFile"
      | "stdioInherit"
    >
  > & {
    onFatal?: (err: Error) => void;
    runtimeServerPath?: string;
    runtimeLogFile?: string;
    runtimePidFile?: string;
    stdioInherit?: boolean;
  };

  private child: SpawnedProcess | null = null;
  private handle: RuntimeHandle | null = null;
  private runtimeInstanceId: string | null = null;
  private restartTimestamps: number[] = [];
  /** Set when stopRuntime() is invoked — suppresses auto-restart. */
  private stopping = false;
  private gaveUp = false;
  private lastEnv: NodeJS.ProcessEnv = {};
  /**
   * In-flight startup promise (issue #58). ensureRuntime() is single-flight:
   * concurrent first-run callers share this one promise instead of each
   * spawning their own runtime child (which raced for the port and crashed the
   * losers with EADDRINUSE). Null when no startup is in progress.
   */
  private starting: Promise<RuntimeHandle> | null = null;
  private stoppingPromise: Promise<void> | null = null;
  /** Invalidates health waits and delayed restarts when an explicit stop begins. */
  private generation = 0;
  /**
   * Set once the runtime has become healthy at least once (issue #58). The
   * crash-restart self-heal (§11A.5) is only meant for a runtime that was
   * healthy and later died — NOT for a first-start spawn that immediately
   * exits (e.g. a duplicate that lost the port race). While this is false, an
   * exiting child does not trigger a restart; ensureRuntime's waitForHealth
   * surfaces the failure instead.
   */
  private everHealthy = false;

  constructor(options: LocalOrchestratorOptions = {}) {
    this.opts = {
      dataDir: options.dataDir ?? process.env.BP_DATA_DIR ?? "./brainpilot",
      port: options.port ?? Number(process.env.AGENT_RUNTIME_PORT ?? 8081),
      host: options.host ?? "127.0.0.1",
      execPath: options.execPath ?? process.execPath,
      runtimeServerPath: options.runtimeServerPath,
      spawnFn:
        options.spawnFn ??
        ((command, args, o) =>
          spawn(command, args as string[], {
            env: o.env,
            stdio: (o.stdio as never) ?? "inherit",
          }) as unknown as SpawnedProcess),
      maxRestarts: options.maxRestarts ?? 5,
      restartWindowMs: options.restartWindowMs ?? 60_000,
      backoffBaseMs: options.backoffBaseMs ?? 200,
      healthProbe: options.healthProbe ?? defaultHealthProbe,
      healthTimeoutMs: options.healthTimeoutMs ?? 30_000,
      stopTimeoutMs: options.stopTimeoutMs ?? 5_000,
      onFatal: options.onFatal,
      sleep: options.sleep ?? sleepDefault,
      runtimeLogFile: options.runtimeLogFile,
      runtimePidFile: options.runtimePidFile,
      stdioInherit: options.stdioInherit,
    };
  }

  get baseUrl(): string {
    return `http://${this.opts.host}:${this.opts.port}`;
  }

  /** Build the exact argv used to spawn the runtime. Exposed for testing. */
  buildArgv(): { command: string; args: string[] } {
    const serverPath =
      this.opts.runtimeServerPath ?? resolveRuntimeServerPath();
    return { command: this.opts.execPath, args: [serverPath] };
  }

  /** Build the env injected into the runtime child. Exposed for testing. */
  buildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    return {
      ...process.env,
      BP_DATA_DIR: this.opts.dataDir,
      PORT: String(this.opts.port),
      AGENT_RUNTIME_PORT: String(this.opts.port),
      BP_MODE: process.env.BP_MODE ?? "single",
      ...(extra ?? {}),
    };
  }

  async ensureRuntime(opts?: EnsureRuntimeOptions): Promise<RuntimeHandle> {
    if (this.stoppingPromise) {
      await this.stoppingPromise;
      return this.ensureRuntime(opts);
    }
    // The same gate covers first startup and automatic crash recovery. Check it
    // before probing or changing options: callers during backoff join recovery.
    if (this.starting) return this.starting;
    if (this.child) {
      const child = this.child;
      const handle = this.handle;
      if (handle && await this.health() && this.child === child && this.handle === handle && !this.stopping)
        return handle;
      if (this.starting) return this.starting;
      throw new Error("owned runtime is still running but is not healthy; waiting for its exit");
    }
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter(
      (ts) => now - ts < this.opts.restartWindowMs,
    );
    if (this.gaveUp && this.restartTimestamps.length >= this.opts.maxRestarts) {
      throw new Error("runtime restart budget exhausted");
    }
    this.gaveUp = false;
    this.stopping = false;
    if (opts?.dataDir) this.opts.dataDir = opts.dataDir;
    if (opts?.port) this.opts.port = opts.port;
    this.lastEnv = this.buildEnv(opts?.env);
    const generation = this.generation;
    return this.startOperation(async () => {
      if (this.stopping || generation !== this.generation)
        throw new Error("runtime startup cancelled");
      const child = this.spawnChild(this.lastEnv);
      try {
        return await this.readyHandle(child, generation);
      } catch (err) {
        // A timed-out first child may still own the port. Do not replace it
        // until our own child has actually exited.
        if (this.child === child) await this.terminateChild(child);
        throw err;
      }
    });
  }

  async health(): Promise<boolean> {
    if (!this.child) return false;
    return this.probeHealth(1000);
  }

  async stopRuntime(): Promise<void> {
    if (this.stoppingPromise) return this.stoppingPromise;
    this.stopping = true;
    this.generation++;
    this.everHealthy = false;
    // Explicit stop starts a new lifecycle; failed request probes do not.
    this.gaveUp = false;
    this.restartTimestamps = [];
    const child = this.child;
    this.handle = null;
    this.runtimeInstanceId = null;
    const promise = (async () => {
      if (child) await this.terminateChild(child);
      // A cancelled startup/restart cannot publish a handle after this point.
      if (this.starting) await this.starting.catch(() => {});
    })();
    this.stoppingPromise = promise;
    try { await promise; } finally {
      if (this.stoppingPromise === promise) this.stoppingPromise = null;
    }
  }

  private startOperation(work: () => Promise<RuntimeHandle>): Promise<RuntimeHandle> {
    const promise = Promise.resolve().then(work);
    this.starting = promise;
    void promise.finally(() => {
      if (this.starting === promise) this.starting = null;
    }).catch(() => {});
    return promise;
  }

  private spawnChild(env: NodeJS.ProcessEnv): SpawnedProcess {
    if (this.child) throw new Error("refusing to spawn while an owned runtime child exists");
    const { command, args } = this.buildArgv();

    let logFd: number | undefined;
    let stdio: unknown;
    if (this.opts.stdioInherit) {
      stdio = "inherit";
    } else if (this.opts.runtimeLogFile) {
      try {
        mkdirSync(dirname(this.opts.runtimeLogFile), { recursive: true });
        logFd = openSync(this.opts.runtimeLogFile, "a");
        stdio = ["ignore", logFd, logFd];
      } catch (err) {
        // Never fail runtime startup over logging — fall back to inherit.
        // eslint-disable-next-line no-console
        console.warn(
          `[orchestrator] cannot open runtime log ${this.opts.runtimeLogFile}: ` +
            `${(err as Error).message}; falling back to inherit`,
        );
        logFd = undefined;
        stdio = undefined;
      }
    }

    const child = this.opts.spawnFn(
      command,
      args,
      stdio ? { env, stdio } : { env },
    );
    this.child = child;
    this.runtimeInstanceId = randomUUID();
    this.handle = null;
    this.writePidFile(child.pid);

    let childError: Error | null = null;
    child.on("error", (err) => {
      childError = err instanceof Error ? err : new Error(String(err));
      // A failed spawn has no pid and may never emit exit. An error on a live
      // process does not prove it exited, so wait for its exit event instead.
      if (child.pid === undefined) this.handleExit(child, childError, true);
    });
    child.on("exit", (code, signal) => {
      if (logFd !== undefined) {
        try {
          closeSync(logFd);
        } catch {
          /* already closed */
        }
      }
      const err = childError ?? new Error(
        `runtime exited (code=${String(code)} signal=${String(signal)})`,
      );
      this.handleExit(child, err, code !== 0 || signal !== null);
    });
    return child;
  }

  private writePidFile(pid: number | undefined): void {
    if (!this.opts.runtimePidFile || pid === undefined) return;
    try {
      mkdirSync(dirname(this.opts.runtimePidFile), { recursive: true });
      writeFileSync(this.opts.runtimePidFile, String(pid));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[orchestrator] cannot write runtime pid file ${this.opts.runtimePidFile}: ` +
          `${(err as Error).message}`,
      );
    }
  }

  private removePidFile(): void {
    if (!this.opts.runtimePidFile) return;
    try {
      rmSync(this.opts.runtimePidFile, { force: true });
    } catch {
      /* nothing to remove */
    }
  }

  private handleExit(child: SpawnedProcess, err: Error, abnormal: boolean): void {
    if (this.child !== child) return; // stale error/exit from a former child
    this.child = null;
    this.handle = null;
    this.runtimeInstanceId = null;
    this.removePidFile();
    if (this.stopping || this.gaveUp || this.starting || !this.everHealthy || !abnormal) return;
    // Automatic recovery shares the same gate as explicit ensureRuntime calls.
    void this.startOperation(() => this.recover(err)).catch(() => {});
  }

  private async recover(lastError: Error): Promise<RuntimeHandle> {
    const generation = this.generation;
    for (;;) {
      if (this.stopping || generation !== this.generation) throw new Error("runtime recovery cancelled");
      const now = Date.now();
      this.restartTimestamps = this.restartTimestamps.filter(
        (ts) => now - ts < this.opts.restartWindowMs,
      );
      if (this.restartTimestamps.length >= this.opts.maxRestarts) {
        this.gaveUp = true;
        const fatal = new Error(
          `runtime crashed ${this.restartTimestamps.length + 1} times within ` +
            `${this.opts.restartWindowMs}ms; giving up. Last error: ${lastError.message}`,
        );
        this.opts.onFatal?.(fatal);
        throw fatal;
      }
      const attempt = this.restartTimestamps.length;
      this.restartTimestamps.push(now);
      await this.opts.sleep(this.opts.backoffBaseMs * Math.pow(2, attempt));
      if (this.stopping || generation !== this.generation) throw new Error("runtime recovery cancelled");
      const child = this.spawnChild(this.lastEnv);
      try {
        return await this.readyHandle(child, generation);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (this.stopping || generation !== this.generation) throw lastError;
        if (this.child === child) await this.terminateChild(child);
      }
    }
  }

  private async readyHandle(child: SpawnedProcess, generation: number): Promise<RuntimeHandle> {
    await this.waitForHealth(child, generation);
    if (this.child !== child || this.stopping || generation !== this.generation || !this.runtimeInstanceId) {
      throw new Error("runtime exited before becoming ready");
    }
    this.everHealthy = true;
    this.handle = { baseUrl: this.baseUrl, instanceId: this.runtimeInstanceId };
    return this.handle;
  }

  private async probeHealth(timeoutMs: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.opts.healthProbe(this.baseUrl).catch(() => false),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), Math.max(0, timeoutMs));
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async waitForHealth(child: SpawnedProcess, generation: number): Promise<void> {
    const deadline = Date.now() + this.opts.healthTimeoutMs;
    // Poll until healthy or timeout. Spacing is small for local startup.
    for (;;) {
      if (this.child !== child || this.stopping || generation !== this.generation)
        throw new Error("runtime exited before becoming ready");
      if (await this.probeHealth(Math.min(1000, Math.max(0, deadline - Date.now())))) {
        if (this.child === child && !this.stopping && generation === this.generation) return;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `runtime did not become healthy at ${this.baseUrl} within ` +
            `${this.opts.healthTimeoutMs}ms`,
        );
      }
      await this.opts.sleep(200);
    }
  }

  private async terminateChild(child: SpawnedProcess): Promise<void> {
    if (this.child !== child) return;
    let exited = false;
    const exit = new Promise<void>((resolve) => child.on("exit", () => {
      exited = true;
      resolve();
    }));
    const signal = gracefulSignalsSupported ? "SIGTERM" : "SIGKILL";
    try { child.kill(signal); } catch { /* an exit may already be queued */ }
    await Promise.race([exit, this.opts.sleep(this.opts.stopTimeoutMs)]);
    if (!exited && gracefulSignalsSupported) {
      try { child.kill("SIGKILL"); } catch { /* an exit may already be queued */ }
    }
    if (!exited) await Promise.race([exit, this.opts.sleep(this.opts.stopTimeoutMs)]);
    if (!exited && this.child === child) {
      throw new Error("owned runtime did not confirm exit after SIGKILL");
    }
  }
}
