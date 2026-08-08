import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";

export const MONITOR_DEFAULT_TIMEOUT_MS = 300_000;
export const MONITOR_MAX_TIMEOUT_MS = 3_600_000;
export const MONITOR_MAX_LINE_BYTES = 8 * 1024;
export const MONITOR_MAX_STDERR_BYTES = 16 * 1024;
export const MONITOR_BATCH_MS = 200;
export const MONITOR_RATE_WINDOW_MS = 10_000;
export const MONITOR_RATE_MAX_LINES = 50;

export type MonitorStatus = "running" | "stopping" | "completed" | "failed" | "timed_out" | "flooded";

export interface MonitorInfo {
  id: string;
  ownerAgent: string;
  description: string;
  command: string;
  status: MonitorStatus;
  persistent: boolean;
  /** Whether this process must finish before aggregate session work can settle. */
  blocking: boolean;
  timeoutMs: number;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stderr?: string;
}

export interface MonitorEventBatch {
  monitorId: string;
  ownerAgent: string;
  description: string;
  timestamp: string;
  lines: string[];
}

interface RunningMonitor {
  info: MonitorInfo;
  child: ChildProcess;
  decoder: StringDecoder;
  stdoutBuffer: string;
  stderrBuffer: string;
  pendingLines: string[];
  batchTimer?: NodeJS.Timeout;
  timeoutTimer?: NodeJS.Timeout;
  rateWindowStartedAt: number;
  rateLines: number;
  terminalPromise: Promise<void>;
  resolveTerminal: () => void;
}

export interface MonitorManagerOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  onEvents: (batch: MonitorEventBatch) => boolean;
  onState?: (info: MonitorInfo) => void;
}

function publicInfo(running: RunningMonitor): MonitorInfo {
  return { ...running.info, ...(running.stderrBuffer ? { stderr: running.stderrBuffer } : {}) };
}

export function monitorEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  const sensitive = /(api[_-]?key|token|secret|password|credential|authorization|cookie)/i;
  for (const [key, value] of Object.entries(source)) {
    if (!sensitive.test(key) && value !== undefined) out[key] = value;
  }
  return out;
}

export class MonitorManager {
  private readonly monitors = new Map<string, RunningMonitor>();

  constructor(private readonly opts: MonitorManagerOptions) {}

  start(input: {
    ownerAgent: string;
    description: string;
    command: string;
    timeoutMs?: number;
    persistent?: boolean;
    blocking?: boolean;
  }): MonitorInfo {
    const description = input.description.trim();
    const command = input.command.trim();
    if (!description) throw new Error("description is required");
    if (!command) throw new Error("command is required");
    const persistent = input.persistent === true;
    // Finite commands are task work by default. Persistent subscriptions are
    // background infrastructure unless explicitly marked as blocking.
    const blocking = input.blocking ?? !persistent;
    const requested = input.timeoutMs ?? MONITOR_DEFAULT_TIMEOUT_MS;
    if (!Number.isFinite(requested) || requested <= 0 || requested > MONITOR_MAX_TIMEOUT_MS) {
      throw new Error(`timeout_ms must be between 1 and ${MONITOR_MAX_TIMEOUT_MS}`);
    }
    const timeoutMs = persistent ? 0 : Math.floor(requested);
    const child = spawn(command, {
      cwd: this.opts.cwd,
      env: monitorEnvironment(this.opts.env),
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const id = `mon_${randomUUID()}`;
    let resolveTerminal!: () => void;
    const terminalPromise = new Promise<void>((resolve) => { resolveTerminal = resolve; });
    const running: RunningMonitor = {
      info: {
        id,
        ownerAgent: input.ownerAgent,
        description,
        command,
        status: "running",
        persistent,
        blocking,
        timeoutMs,
        startedAt: new Date().toISOString(),
      },
      child,
      decoder: new StringDecoder("utf8"),
      stdoutBuffer: "",
      stderrBuffer: "",
      pendingLines: [],
      rateWindowStartedAt: Date.now(),
      rateLines: 0,
      terminalPromise,
      resolveTerminal,
    };
    this.monitors.set(id, running);
    child.stdout?.on("data", (chunk: Buffer) => this.consumeStdout(running, chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.consumeStderr(running, chunk));
    child.once("error", (error) => this.finish(running, "failed", null, null, error.message));
    child.once("exit", (code, signal) => {
      const tail = running.decoder.end();
      if (tail) this.consumeText(running, tail);
      if (running.stdoutBuffer) this.acceptLine(running, running.stdoutBuffer);
      this.flush(running);
      if (running.info.status === "running" || running.info.status === "stopping") {
        this.finish(running, code === 0 ? "completed" : "failed", code, signal);
      } else {
        this.finish(running, running.info.status, code, signal);
      }
    });
    if (!persistent) {
      running.timeoutTimer = setTimeout(() => {
        if (running.info.status !== "running") return;
        running.info.status = "timed_out";
        this.opts.onState?.(publicInfo(running));
        this.killProcess(running, "SIGTERM");
      }, timeoutMs);
      running.timeoutTimer.unref?.();
    }
    this.opts.onState?.(publicInfo(running));
    return publicInfo(running);
  }

  list(ownerAgent?: string): MonitorInfo[] {
    return [...this.monitors.values()]
      .filter((monitor) => !ownerAgent || monitor.info.ownerAgent === ownerAgent)
      .map(publicInfo);
  }

  hasRunning(ownerAgent?: string): boolean {
    return [...this.monitors.values()].some((monitor) =>
      (!ownerAgent || monitor.info.ownerAgent === ownerAgent)
      && (monitor.info.status === "running" || monitor.info.status === "stopping"),
    );
  }

  hasBlocking(): boolean {
    return [...this.monitors.values()].some((monitor) =>
      monitor.info.blocking
      && (monitor.info.status === "running" || monitor.info.status === "stopping"),
    );
  }

  async stop(id: string, ownerAgent?: string): Promise<boolean> {
    const running = this.monitors.get(id);
    if (!running || (ownerAgent && running.info.ownerAgent !== ownerAgent)) return false;
    if (running.info.status !== "running") return false;
    running.info.status = "stopping";
    this.opts.onState?.(publicInfo(running));
    this.killProcess(running, "SIGTERM");
    await this.waitThenKill(running);
    return true;
  }

  async stopOwner(ownerAgent: string): Promise<number> {
    const ids = this.list(ownerAgent)
      .filter((info) => info.status === "running")
      .map((info) => info.id);
    await Promise.all(ids.map((id) => this.stop(id, ownerAgent)));
    return ids.length;
  }

  async stopAll(): Promise<number> {
    const ids = this.list().filter((info) => info.status === "running").map((info) => info.id);
    await Promise.all(ids.map((id) => this.stop(id)));
    return ids.length;
  }

  stopAllImmediate(): void {
    for (const running of this.monitors.values()) {
      if (running.info.status !== "running" && running.info.status !== "stopping") continue;
      running.info.status = "stopping";
      this.killProcess(running, "SIGKILL");
    }
  }

  private consumeStdout(running: RunningMonitor, chunk: Buffer): void {
    this.consumeText(running, running.decoder.write(chunk));
  }

  private consumeText(running: RunningMonitor, text: string): void {
    if (running.info.status !== "running") return;
    running.stdoutBuffer += text;
    if (Buffer.byteLength(running.stdoutBuffer) > MONITOR_MAX_LINE_BYTES && !running.stdoutBuffer.includes("\n")) {
      this.flood(running, `stdout line exceeded ${MONITOR_MAX_LINE_BYTES} bytes`);
      return;
    }
    const lines = running.stdoutBuffer.split(/\r?\n/);
    running.stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) this.acceptLine(running, line);
  }

  private acceptLine(running: RunningMonitor, line: string): void {
    if (running.info.status !== "running") return;
    if (Buffer.byteLength(line) > MONITOR_MAX_LINE_BYTES) {
      this.flood(running, `stdout line exceeded ${MONITOR_MAX_LINE_BYTES} bytes`);
      return;
    }
    const now = Date.now();
    if (now - running.rateWindowStartedAt >= MONITOR_RATE_WINDOW_MS) {
      running.rateWindowStartedAt = now;
      running.rateLines = 0;
    }
    running.rateLines++;
    if (running.rateLines > MONITOR_RATE_MAX_LINES) {
      this.flood(running, "stdout event rate exceeded the monitor limit");
      return;
    }
    running.pendingLines.push(line);
    if (!running.batchTimer) {
      running.batchTimer = setTimeout(() => this.flush(running), MONITOR_BATCH_MS);
      running.batchTimer.unref?.();
    }
  }

  private flush(running: RunningMonitor): void {
    if (running.batchTimer) clearTimeout(running.batchTimer);
    running.batchTimer = undefined;
    if (running.pendingLines.length === 0) return;
    const lines = running.pendingLines.splice(0);
    const accepted = this.opts.onEvents({
      monitorId: running.info.id,
      ownerAgent: running.info.ownerAgent,
      description: running.info.description,
      timestamp: new Date().toISOString(),
      lines,
    });
    if (!accepted) this.flood(running, "monitor event queue is full");
  }

  private consumeStderr(running: RunningMonitor, chunk: Buffer): void {
    running.stderrBuffer = `${running.stderrBuffer}${chunk.toString("utf8")}`.slice(-MONITOR_MAX_STDERR_BYTES);
  }

  private flood(running: RunningMonitor, message: string): void {
    if (running.info.status !== "running") return;
    running.stderrBuffer = `${running.stderrBuffer}${running.stderrBuffer ? "\n" : ""}${message}`.slice(-MONITOR_MAX_STDERR_BYTES);
    running.info.status = "flooded";
    this.opts.onState?.(publicInfo(running));
    this.killProcess(running, "SIGTERM");
  }

  private finish(
    running: RunningMonitor,
    status: MonitorStatus,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    stderr?: string,
  ): void {
    if (running.info.finishedAt) return;
    if (running.timeoutTimer) clearTimeout(running.timeoutTimer);
    if (running.batchTimer) clearTimeout(running.batchTimer);
    if (stderr) this.consumeStderr(running, Buffer.from(stderr));
    running.info = {
      ...running.info,
      status,
      finishedAt: new Date().toISOString(),
      exitCode,
      signal,
    };
    this.opts.onState?.(publicInfo(running));
    running.resolveTerminal();
  }

  private killProcess(running: RunningMonitor, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && running.child.pid) process.kill(-running.child.pid, signal);
      else running.child.kill(signal);
    } catch {
      /* process already exited */
    }
  }

  private async waitThenKill(running: RunningMonitor): Promise<void> {
    const settled = await Promise.race([
      running.terminalPromise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!settled) {
      this.killProcess(running, "SIGKILL");
      await Promise.race([
        running.terminalPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 250)),
      ]);
    }
  }
}
