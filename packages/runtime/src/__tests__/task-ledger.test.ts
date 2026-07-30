import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_PENDING_NOTIFICATIONS, TaskLedger, TaskLedgerCorruptError, TaskQueueFullError } from "../task-ledger.js";

const dirs: string[] = [];
afterEach(async () => Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))));

describe("TaskLedger", () => {
  it("allocates stable IDs and sorts pending tasks before terminal tasks", async () => {
    const ledger = new TaskLedger("s");
    const first = await ledger.dispatch("principal", "engineer", "first");
    const second = await ledger.dispatch("principal", "engineer", "second");
    await ledger.complete(second.id, "engineer", "done at results/two.md");
    expect(first.id).toBe("task_000001");
    expect(second.id).toBe("task_000002");
    expect(ledger.list().map((task) => task.id)).toEqual([first.id, second.id]);
  });

  it("routes interleaved replies to each task creator and supports out-of-order completion", async () => {
    const ledger = new TaskLedger("s");
    const a = await ledger.dispatch("principal", "engineer", "A");
    const b = await ledger.dispatch("auditor", "engineer", "B");
    await ledger.acknowledge(ledger.peekBatch("engineer").map((event) => event.id));
    await ledger.complete(b.id, "engineer", "B result");
    await ledger.complete(a.id, "engineer", "A result");
    expect(ledger.peekBatch("auditor")[0]).toMatchObject({ kind: "completed", task_id: b.id, content: "B result" });
    expect(ledger.peekBatch("principal")[0]).toMatchObject({ kind: "completed", task_id: a.id, content: "A result" });
  });

  it("enforces assignee ownership and idempotent completion", async () => {
    const ledger = new TaskLedger("s");
    const task = await ledger.dispatch("principal", "engineer", "work");
    await expect(ledger.complete(task.id, "writer", "wrong")).rejects.toThrow("assigned to engineer");
    await expect(ledger.complete(task.id, "engineer", "ok")).resolves.toMatchObject({ status: "completed" });
    expect(ledger.peekBatch("engineer")).toEqual([]);
    await expect(ledger.complete(task.id, "engineer", "ok")).resolves.toMatchObject({ reply: "ok" });
    await expect(ledger.complete(task.id, "engineer", "different")).rejects.toThrow("different reply");
  });

  it("persists tasks and unacknowledged notifications across restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "task-ledger-"));
    dirs.push(dir);
    const path = join(dir, "tasks.json");
    const first = new TaskLedger("s", path);
    const task = await first.dispatch("principal", "engineer", "persist me");
    await first.flush();
    const raw = JSON.parse(await readFile(path, "utf8"));
    expect(raw.tasks).toHaveLength(1);

    const restored = new TaskLedger("s", path);
    await restored.recover();
    expect(restored.list()[0]?.id).toBe(task.id);
    expect(restored.peekBatch("engineer")[0]?.task_id).toBe(task.id);
  });

  it("keeps notifications until acknowledged and applies backpressure", async () => {
    const ledger = new TaskLedger("s");
    for (let i = 0; i < MAX_PENDING_NOTIFICATIONS; i++) {
      await ledger.dispatch("principal", "engineer", `task ${i}`);
    }
    await expect(ledger.dispatch("principal", "engineer", "overflow")).rejects.toBeInstanceOf(TaskQueueFullError);
    const batch = ledger.peekBatch("engineer");
    expect(batch).toHaveLength(3);
    expect(ledger.peekBatch("engineer")).toEqual(batch);
    await ledger.acknowledge(batch.map((event) => event.id));
    expect(ledger.count("engineer")).toBe(MAX_PENDING_NOTIFICATIONS - 3);
  });

  it("persists one reminder claim and sends one unhandled event per task", async () => {
    const ledger = new TaskLedger("s");
    const task = await ledger.dispatch("principal", "engineer", "work");
    expect(await ledger.claimReminder("engineer")).toBe(true);
    expect(await ledger.claimReminder("engineer")).toBe(false);
    expect(await ledger.notifyUnhandled("engineer")).toEqual([task.id]);
    expect(await ledger.notifyUnhandled("engineer")).toEqual([]);
    expect(ledger.peekBatch("principal")[0]).toMatchObject({ kind: "unhandled", task_id: task.id });
  });

  it("persists global and per-agent delivery pauses without deleting notifications", async () => {
    const dir = await mkdtemp(join(tmpdir(), "task-ledger-pause-"));
    dirs.push(dir);
    const path = join(dir, "tasks.json");
    const ledger = new TaskLedger("s", path);
    await ledger.dispatch("principal", "engineer", "work");
    await ledger.pauseAgent("engineer");
    await ledger.pauseDelivery();
    expect(ledger.isPaused("engineer")).toBe(true);
    expect(ledger.count("engineer")).toBe(1);

    const restored = new TaskLedger("s", path);
    await restored.recover();
    expect(restored.isPaused("engineer")).toBe(true);
    expect(restored.count("engineer")).toBe(1);
    await restored.resumeDelivery();
    expect(restored.isPaused("engineer")).toBe(false);
  });

  it("treats a missing ledger as empty but rejects corruption without overwriting it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "task-ledger-corrupt-"));
    dirs.push(dir);
    const path = join(dir, "tasks.json");
    await expect(new TaskLedger("missing", path).recover()).resolves.toBeUndefined();
    const corrupt = '{"next_task_seq":1,"tasks":[';
    await writeFile(path, corrupt, "utf8");
    await expect(new TaskLedger("bad", path).recover()).rejects.toBeInstanceOf(TaskLedgerCorruptError);
    expect(await readFile(path, "utf8")).toBe(corrupt);
  });
});
