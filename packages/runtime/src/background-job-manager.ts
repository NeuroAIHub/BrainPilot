import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { monitorEnvironment } from "./monitor-manager.js";

export const BACKGROUND_JOB_DEFAULT_TIMEOUT_MS = 3_600_000;
export const BACKGROUND_JOB_MAX_TIMEOUT_MS = 86_400_000;
export const BACKGROUND_JOB_MAX_ACTIVE_PER_AGENT = 4;
export const BACKGROUND_JOB_MAX_ACTIVE_PER_SESSION = 8;
export const BACKGROUND_JOB_MAX_LOG_BYTES = 64 * 1024 * 1024;
export const BACKGROUND_JOB_TAIL_BYTES = 16 * 1024;

export type BackgroundJobStatus = "running" | "completed" | "failed" | "timed_out" | "cancelled";

export interface BackgroundJobInfo {
  id: string;
  ownerAgent: string;
  jobKey: string;
  description: string;
  command: string;
  status: BackgroundJobStatus;
  timeoutMs: number;
  logPath: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  stdoutTail?: string;
  stderrTail?: string;
  logTruncated?: boolean;
}

export interface BackgroundJobCompletion {
  jobId: string;
  ownerAgent: string;
  jobKey: string;
  description: string;
  status: Exclude<BackgroundJobStatus, "running" | "cancelled">;
  timestamp: string;
  durationMs: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  logPath: string;
  logTruncated: boolean;
}

interface RunningJob {
  info: BackgroundJobInfo;
  child: ChildProcess;
  logStream: WriteStream;
  stdoutTail: Buffer;
  stderrTail: Buffer;
  logBytes: number;
  logTruncated: boolean;
  timeoutTimer?: NodeJS.Timeout;
  terminalPromise: Promise<void>;
  resolveTerminal: () => void;
}

export interface BackgroundJobManagerOptions {
  cwd: string;
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  onComplete: (completion: BackgroundJobCompletion) => boolean;
  onState?: (info: BackgroundJobInfo) => void;
}

function appendTail(current: Buffer, chunk: Buffer): Buffer {
  const combined = Buffer.concat([current, chunk]);
  return combined.length <= BACKGROUND_JOB_TAIL_BYTES
    ? combined
    : combined.subarray(combined.length - BACKGROUND_JOB_TAIL_BYTES);
}

function active(status: BackgroundJobStatus): boolean {
  return status === "running";
}

export class BackgroundJobManager {
  private readonly jobs = new Map<string, RunningJob>();
  private startOperations: Promise<void> = Promise.resolve();

  constructor(private readonly opts: BackgroundJobManagerOptions) {}

  start(input: {
    ownerAgent: string;
    jobKey: string;
    description: string;
    command: string;
    timeoutMs?: number;
    replaceExisting?: boolean;
  }): Promise<BackgroundJobInfo> {
    return this.withStartLock(async () => {
      const ownerAgent = input.ownerAgent.trim();
      const jobKey = input.jobKey.trim();
      const description = input.description.trim();
      const command = input.command.trim();
      if (!ownerAgent) throw new Error("owner agent is required");
      if (!jobKey) throw new Error("job_key is required");
      if (!description) throw new Error("description is required");
      if (!command) throw new Error("command is required");
      const requested = input.timeoutMs ?? BACKGROUND_JOB_DEFAULT_TIMEOUT_MS;
      if (!Number.isFinite(requested) || requested < 1_000 || requested > BACKGROUND_JOB_MAX_TIMEOUT_MS) {
        throw new Error(`timeout_ms must be between 1000 and ${BACKGROUND_JOB_MAX_TIMEOUT_MS}`);
      }
      const existing = [...this.jobs.values()].find((job) =>
        active(job.info.status)
        && job.info.ownerAgent === ownerAgent
        && job.info.jobKey === jobKey,
      );
      if (existing) {
        if (!input.replaceExisting) {
          throw new Error(`background job ${existing.info.id} is already running for job_key ${jobKey}`);
        }
        await this.stopInternal(existing);
      }
      const allActive = [...this.jobs.values()].filter((job) => active(job.info.status));
      if (allActive.length >= BACKGROUND_JOB_MAX_ACTIVE_PER_SESSION) {
        throw new Error(`session already has ${BACKGROUND_JOB_MAX_ACTIVE_PER_SESSION} active background jobs`);
      }
      if (allActive.filter((job) => job.info.ownerAgent === ownerAgent).length >= BACKGROUND_JOB_MAX_ACTIVE_PER_AGENT) {
        throw new Error(`agent already has ${BACKGROUND_JOB_MAX_ACTIVE_PER_AGENT} active background jobs`);
      }

      await mkdir(this.opts.stateDir, { recursive: true });
      this.pruneTerminalJobs();
      const id = `job_${randomUUID()}`;
      const logPath = join(this.opts.stateDir, `${id}.log`);
      const logStream = createWriteStream(logPath, { flags: "a", mode: 0o600 });
      logStream.on("error", () => { /* diagnostics remain available in the in-memory tails */ });
      const child = spawn(command, {
        cwd: this.opts.cwd,
        env: monitorEnvironment(this.opts.env),
        shell: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      let resolveTerminal!: () => void;
      const terminalPromise = new Promise<void>((resolve) => { resolveTerminal = resolve; });
      const job: RunningJob = {
        info: {
          id,
          ownerAgent,
          jobKey,
          description,
          command,
          status: "running",
          timeoutMs: Math.floor(requested),
          logPath,
          startedAt: new Date().toISOString(),
        },
        child,
        logStream,
        stdoutTail: Buffer.alloc(0),
        stderrTail: Buffer.alloc(0),
        logBytes: 0,
        logTruncated: false,
        terminalPromise,
        resolveTerminal,
      };
      this.jobs.set(id, job);
      child.stdout?.on("data", (chunk: Buffer) => this.consume(job, "stdout", chunk));
      child.stderr?.on("data", (chunk: Buffer) => this.consume(job, "stderr", chunk));
      child.once("error", (error) => {
        this.consume(job, "stderr", Buffer.from(error.message));
        this.finish(job, "failed", null, null, true);
      });
      child.once("exit", (code, signal) => {
        if (job.info.finishedAt) return;
        const status = job.info.status === "running"
          ? code === 0 ? "completed" : "failed"
          : job.info.status;
        this.finish(job, status, code, signal, status !== "cancelled");
      });
      job.timeoutTimer = setTimeout(() => {
        if (job.info.status !== "running") return;
        void this.terminate(job, "timed_out");
      }, job.info.timeoutMs);
      job.timeoutTimer.unref?.();
      this.opts.onState?.(this.publicInfo(job, false));
      return this.publicInfo(job, false);
    });
  }

  list(ownerAgent?: string): BackgroundJobInfo[] {
    return [...this.jobs.values()]
      .filter((job) => !ownerAgent || job.info.ownerAgent === ownerAgent)
      .map((job) => this.publicInfo(job, false))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  get(id: string, ownerAgent?: string): BackgroundJobInfo | undefined {
    const job = this.jobs.get(id);
    if (!job || (ownerAgent && job.info.ownerAgent !== ownerAgent)) return undefined;
    return this.publicInfo(job);
  }

  hasRunning(ownerAgent?: string): boolean {
    return [...this.jobs.values()].some((job) =>
      active(job.info.status) && (!ownerAgent || job.info.ownerAgent === ownerAgent),
    );
  }

  async stop(id: string, ownerAgent?: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || (ownerAgent && job.info.ownerAgent !== ownerAgent) || !active(job.info.status)) return false;
    await this.stopInternal(job);
    return true;
  }

  async stopOwner(ownerAgent: string): Promise<number> {
    const jobs = [...this.jobs.values()].filter((job) =>
      active(job.info.status) && job.info.ownerAgent === ownerAgent,
    );
    await Promise.all(jobs.map((job) => this.stopInternal(job)));
    return jobs.length;
  }

  async stopAll(): Promise<number> {
    const jobs = [...this.jobs.values()].filter((job) => active(job.info.status));
    await Promise.all(jobs.map((job) => this.stopInternal(job)));
    return jobs.length;
  }

  stopAllImmediate(): void {
    for (const job of this.jobs.values()) {
      if (!active(job.info.status)) continue;
      job.info.status = "cancelled";
      this.killProcess(job, "SIGKILL");
    }
  }

  private publicInfo(job: RunningJob, includeTails = true): BackgroundJobInfo {
    return {
      ...job.info,
      ...(includeTails && job.stdoutTail.length ? { stdoutTail: job.stdoutTail.toString("utf8") } : {}),
      ...(includeTails && job.stderrTail.length ? { stderrTail: job.stderrTail.toString("utf8") } : {}),
      ...(job.logTruncated ? { logTruncated: true } : {}),
    };
  }

  private consume(job: RunningJob, stream: "stdout" | "stderr", chunk: Buffer): void {
    if (stream === "stdout") job.stdoutTail = appendTail(job.stdoutTail, chunk);
    else job.stderrTail = appendTail(job.stderrTail, chunk);
    if (job.logBytes >= BACKGROUND_JOB_MAX_LOG_BYTES) {
      job.logTruncated = true;
      return;
    }
    const remaining = BACKGROUND_JOB_MAX_LOG_BYTES - job.logBytes;
    const accepted = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
    if (accepted.length) job.logStream.write(accepted);
    job.logBytes += accepted.length;
    if (accepted.length < chunk.length) job.logTruncated = true;
  }

  private async stopInternal(job: RunningJob): Promise<void> {
    if (!active(job.info.status)) return;
    await this.terminate(job, "cancelled");
  }

  private async terminate(job: RunningJob, status: "cancelled" | "timed_out"): Promise<void> {
    if (job.info.finishedAt) return;
    job.info.status = status;
    this.opts.onState?.(this.publicInfo(job, false));
    this.killProcess(job, "SIGTERM");
    const settled = await Promise.race([
      job.terminalPromise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
    ]);
    if (!settled) {
      this.killProcess(job, "SIGKILL");
      await Promise.race([
        job.terminalPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 250)),
      ]);
    }
  }

  private finish(
    job: RunningJob,
    status: BackgroundJobStatus,
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    notify: boolean,
  ): void {
    if (job.info.finishedAt) return;
    if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
    const finishedAt = new Date();
    const durationMs = Math.max(0, finishedAt.getTime() - Date.parse(job.info.startedAt));
    job.info = {
      ...job.info,
      status,
      finishedAt: finishedAt.toISOString(),
      durationMs,
      exitCode,
      signal,
    };
    job.logStream.end();
    const info = this.publicInfo(job);
    this.opts.onState?.(this.publicInfo(job, false));
    if (notify && status !== "running" && status !== "cancelled") {
      this.opts.onComplete({
        jobId: info.id,
        ownerAgent: info.ownerAgent,
        jobKey: info.jobKey,
        description: info.description,
        status,
        timestamp: info.finishedAt!,
        durationMs,
        exitCode,
        signal,
        logPath: info.logPath,
        logTruncated: info.logTruncated === true,
      });
    }
    job.resolveTerminal();
  }

  private killProcess(job: RunningJob, signal: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && job.child.pid) process.kill(-job.child.pid, signal);
      else job.child.kill(signal);
    } catch {
      /* process already exited */
    }
  }

  private pruneTerminalJobs(): void {
    const terminal = [...this.jobs.values()]
      .filter((job) => !active(job.info.status))
      .sort((left, right) => right.info.startedAt.localeCompare(left.info.startedAt));
    for (const job of terminal.slice(50)) this.jobs.delete(job.info.id);
  }

  private withStartLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.startOperations.then(operation, operation);
    this.startOperations = result.then(() => undefined, () => undefined);
    return result;
  }
}
