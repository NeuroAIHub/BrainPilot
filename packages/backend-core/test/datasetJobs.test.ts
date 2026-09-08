import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { DatasetJobRegistry } from "../src/datasetJobs.js";
import type { DatasetDownloadJob } from "../src/datasets.js";
const job = (id: string, datasetId = id): DatasetDownloadJob => ({ id, datasetId, datasetName: datasetId, selectionId: "full", status: "queued", startedAt: new Date().toISOString(), targetDir: `/example/${id}` });

describe("durable dataset queue", () => {
  it("bounds concurrency and removes a cancelled queued task", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-queue-"));
    const store = await DatasetJobRegistry.open(root, 1);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    await store.start(job("first"), () => pending, () => {});
    const runSecond = vi.fn();
    const cleanupSecond = vi.fn();
    await store.start(job("second"), runSecond, cleanupSecond);
    expect(store.jobs.get("first")?.status).toBe("downloading");
    expect(store.jobs.get("second")?.status).toBe("queued");
    await store.cancel("second");
    release();
    await vi.waitFor(() => expect(store.jobs.get("first")?.status).toBe("completed"));
    expect(runSecond).not.toHaveBeenCalled();
    expect(cleanupSecond).toHaveBeenCalledTimes(1);
    expect(store.jobs.get("second")?.status).toBe("cancelled");
  });

  it("restores history and marks active jobs interrupted after a restart", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-history-"));
    const directory = path.join(root, "data", "datasets");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, ".jobs.json"), JSON.stringify([{ ...job("complete"), status: "completed" }, job("interrupted")]));
    const restored = await DatasetJobRegistry.open(root);
    expect(restored.jobs.get("complete")?.status).toBe("completed");
    expect(restored.jobs.get("interrupted")?.status).toBe("failed");
    expect(restored.jobs.get("interrupted")?.error).toContain("server restart");
    await restored.start(job("new"), async () => {}, () => {});
    await vi.waitFor(async () => {
      const persisted = JSON.parse(await readFile(path.join(directory, ".jobs.json"), "utf8"));
      expect(persisted.find((entry: DatasetDownloadJob) => entry.id === "new")?.status).toBe("completed");
      expect(persisted.find((entry: DatasetDownloadJob) => entry.id === "interrupted")?.status).toBe("failed");
    });
  });

  it("deduplicates pending requests for the same scope", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-dedupe-"));
    const store = await DatasetJobRegistry.open(root);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const run = vi.fn(() => pending);
    const result = await Promise.all([store.start(job("a", "same"), run, () => {}), store.start(job("b", "same"), run, () => {})]);
    expect(result[0]?.id).toBe(result[1]?.id);
    release();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });
  it("waits for active cancellation and saves terminal states during shutdown", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-shutdown-"));
    const store = await DatasetJobRegistry.open(root, 1);
    await store.start(job("running"), (signal) => new Promise((resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }), () => {});
    const queued = vi.fn();
    await store.start(job("queued"), queued, () => {});
    await store.shutdown();
    expect(queued).not.toHaveBeenCalled();
    expect(store.list().every((entry) => entry.status === "cancelled")).toBe(true);
    const restored = await DatasetJobRegistry.open(root);
    expect(restored.list().every((entry) => entry.status === "cancelled")).toBe(true);
    await expect(store.start(job("late"), async () => {}, () => {})).rejects.toThrow("shutting down");
  });

  it("does not dispatch another request before its initial history write succeeds", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-admission-"));
    const store = await DatasetJobRegistry.open(root, 2);
    const persistence = store as unknown as { save(): Promise<void> };
    const realSave = persistence.save.bind(store);
    let admitFirst!: () => void;
    let rejectSecond!: (reason: Error) => void;
    let finishFirst!: () => void;
    let writes = 0;
    vi.spyOn(persistence, "save").mockImplementation(() => {
      if (++writes === 1) return new Promise((resolve) => { admitFirst = resolve; });
      if (writes === 2) return new Promise((_resolve, reject) => { rejectSecond = reject; });
      return realSave();
    });
    const firstRun = new Promise<void>((resolve) => { finishFirst = resolve; });
    const first = store.start(job("first"), () => firstRun, () => {});
    const runSecond = vi.fn(async () => {});
    const second = store.start(job("second"), runSecond, () => {});
    const failure = expect(second).rejects.toThrow("disk write failed");
    admitFirst();
    await first;
    expect(store.jobs.get("second")?.status).toBe("queued");
    rejectSecond(new Error("disk write failed"));
    await failure;
    finishFirst();
    await vi.waitFor(() => expect(store.jobs.get("first")?.status).toBe("completed"));
    expect(runSecond).not.toHaveBeenCalled();
  });

});
