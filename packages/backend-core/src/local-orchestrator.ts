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
import { createRequire } from "node:module";
import { openSync, closeSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";
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
    const res = await fetch(`${baseUrl}/health`);
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
  private restartTimestamps: number[] = [];
  /** Set when stopRuntime() is invoked — suppresses auto-restart. */
  private stopping = false;
  private gaveUp = false;
  private lastEnv: NodeJS.ProcessEnv = {};

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
    if (opts?.dataDir) this.opts.dataDir = opts.dataDir;
    if (opts?.port) this.opts.port = opts.port;
    this.gaveUp = false;
    this.stopping = false;

    if (this.child && this.handle && (await this.health())) {
      return this.handle;
    }

    this.lastEnv = this.buildEnv(opts?.env);
    this.spawnChild(this.lastEnv);

    await this.waitForHealth();
    this.handle = { baseUrl: this.baseUrl };
    return this.handle;
  }

  async health(): Promise<boolean> {
    if (!this.child) return false;
    return this.opts.healthProbe(this.baseUrl);
  }

  async stopRuntime(): Promise<void> {
    this.stopping = true;
    const child = this.child;
    this.child = null;
    this.handle = null;
    this.removePidFile();
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
    }
  }

  private spawnChild(env: NodeJS.ProcessEnv): void {
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
    this.writePidFile(child.pid);

    child.on("error", (err) =>
      this.handleExit(err instanceof Error ? err : new Error(String(err))),
    );
    child.on("exit", (code, signal) => {
      if (logFd !== undefined) {
        try {
          closeSync(logFd);
        } catch {
          /* already closed */
        }
      }
      if (this.stopping) return;
      // Clean exit (code 0, not killed) is treated as intentional shutdown.
      if (code === 0 && signal === null) {
        this.child = null;
        this.handle = null;
        this.removePidFile();
        return;
      }
      const err = new Error(
        `runtime exited (code=${String(code)} signal=${String(signal)})`,
      );
      void this.handleExit(err);
    });
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

  private async handleExit(err: Error): Promise<void> {
    if (this.stopping || this.gaveUp) return;
    const now = Date.now();
    this.restartTimestamps = this.restartTimestamps.filter(
      (ts) => now - ts < this.opts.restartWindowMs,
    );
    if (this.restartTimestamps.length >= this.opts.maxRestarts) {
      this.gaveUp = true;
      this.child = null;
      this.handle = null;
      const fatal = new Error(
        `runtime crashed ${this.restartTimestamps.length + 1} times within ` +
          `${this.opts.restartWindowMs}ms; giving up. Last error: ${err.message}`,
      );
      this.opts.onFatal?.(fatal);
      return;
    }
    const attempt = this.restartTimestamps.length;
    this.restartTimestamps.push(now);
    const backoff = this.opts.backoffBaseMs * Math.pow(2, attempt);
    await this.opts.sleep(backoff);
    if (this.stopping || this.gaveUp) return;
    this.spawnChild(this.lastEnv);
  }

  private async waitForHealth(): Promise<void> {
    const deadline = Date.now() + this.opts.healthTimeoutMs;
    // Poll until healthy or timeout. Spacing is small for local startup.
    for (;;) {
      if (await this.opts.healthProbe(this.baseUrl)) return;
      if (Date.now() >= deadline) {
        throw new Error(
          `runtime did not become healthy at ${this.baseUrl} within ` +
            `${this.opts.healthTimeoutMs}ms`,
        );
      }
      await this.opts.sleep(200);
    }
  }
}
