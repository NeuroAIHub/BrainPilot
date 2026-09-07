import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DatasetDownloadJob } from "./datasets.js";

type Task = { ready: boolean; job: DatasetDownloadJob; controller: AbortController; run: (signal: AbortSignal) => Promise<void>; cleanup: () => void };
/** One process owns a data root. Only public job metadata is written to disk. */
export class DatasetJobRegistry {
  readonly jobs = new Map<string, DatasetDownloadJob>();
  private pending: Task[] = [];
  private active = new Map<string, Task>();
  private writes = Promise.resolve();
  private closing = false;
  private executions = new Map<string, Promise<void>>();
  private constructor(private readonly file: string, private readonly concurrency = 2) {}

  static async open(dataDir: string, concurrency = 2): Promise<DatasetJobRegistry> {
    const registry = new DatasetJobRegistry(path.resolve(dataDir, "data", "datasets", ".jobs.json"), concurrency);
    let previous: unknown;
    try { previous = JSON.parse(await readFile(registry.file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Could not read dataset download history", { cause: error }); }
    if (previous !== undefined && !Array.isArray(previous)) throw new Error("Invalid dataset download history");
    for (const item of (previous ?? []) as DatasetDownloadJob[]) {
      if (!item || typeof item.id !== "string" || typeof item.datasetId !== "string" || typeof item.startedAt !== "string") continue;
      if (item.status === "queued" || item.status === "downloading") {
        item.status = "failed";
        item.error = "Download interrupted by a server restart. Retry to resume available partial files.";
        item.finishedAt = new Date().toISOString();
      }
      registry.jobs.set(item.id, item);
    }
    return registry;
  }

  list(): DatasetDownloadJob[] { return [...this.jobs.values()].reverse().sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }

  private save(): Promise<void> {
    // Retain 100 recent terminal records plus active jobs; never persist a task closure or credential.
    const terminal = this.list().filter((job) => job.status !== "queued" && job.status !== "downloading");
    for (const old of terminal.slice(100)) this.jobs.delete(old.id);
    const snapshot = JSON.stringify(this.list());
    const write = this.writes.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, snapshot, { mode: 0o600 });
      await rename(temporary, this.file);
    });
    this.writes = write;
    return write;
  }

  async start(job: DatasetDownloadJob, run: Task["run"], cleanup: Task["cleanup"]): Promise<DatasetDownloadJob> {
    if (this.closing) { cleanup(); throw new Error("The download service is shutting down"); }
    const existing = this.list().find((item) => item.datasetId === job.datasetId && item.selectionId === job.selectionId && (item.status === "queued" || item.status === "downloading"));
    if (existing) { cleanup(); return existing; }
    if (this.pending.length + this.active.size >= 32) { cleanup(); throw new Error("The download queue is full. Wait for a download to finish."); }
    const task = { ready: false, job, run, cleanup, controller: new AbortController() };
    this.jobs.set(job.id, job);
    this.pending.push(task);
    try { await this.save(); }
    catch (error) { this.pending = this.pending.filter((item) => item !== task); this.jobs.delete(job.id); cleanup(); throw error; }
    task.ready = true;
    this.pump();
    return job;
  }

  async cancel(id: string): Promise<DatasetDownloadJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Download job not found");
    const queued = this.pending.find((task) => task.job.id === id);
    if (queued) {
      this.pending = this.pending.filter((task) => task !== queued);
      queued.controller.abort(); queued.cleanup();
      job.status = "cancelled"; job.finishedAt = new Date().toISOString();
      await this.save();
    } else this.active.get(id)?.controller.abort();
    return job;
  }

  async shutdown(): Promise<void> {
    this.closing = true;
    const ids = [...this.pending.map((task) => task.job.id), ...this.active.keys()];
    for (const id of ids) {
      const job = this.jobs.get(id);
      if (job) job.error = "Download interrupted by server shutdown. Retry to resume available partial files.";
      await this.cancel(id);
    }
    await Promise.all(this.executions.values());
    await this.writes;
  }

  private pump(): void {
    if (this.closing) return;
    while (this.active.size < this.concurrency && this.pending[0]?.ready) {
      const task = this.pending.shift()!;
      this.active.set(task.job.id, task);
      this.executions.set(task.job.id, this.execute(task));
    }
  }

  private async execute(task: Task): Promise<void> {
    const { job, controller } = task;
    try {
      job.status = "downloading";
      await this.save();
      controller.signal.throwIfAborted();
      await task.run(controller.signal);
      controller.signal.throwIfAborted();
      job.status = "completed";
    } catch (error) {
      job.status = controller.signal.aborted ? "cancelled" : "failed";
      if (!controller.signal.aborted) job.error = error instanceof Error ? error.message : String(error);
    } finally {
      task.cleanup();
      job.finishedAt = new Date().toISOString();
      try { await this.save(); }
      catch { job.error = "Could not save download history. Check available disk space."; }
      this.active.delete(job.id);
      this.executions.delete(job.id);
      this.pump();
    }
  }
}
