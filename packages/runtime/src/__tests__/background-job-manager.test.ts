import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BackgroundJobManager,
  type BackgroundJobCompletion,
  type BackgroundJobInfo,
} from "../background-job-manager.js";

function nodeCommand(source: string): string {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(source)}`;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for background job");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bp-background-job-"));
  const completions: BackgroundJobCompletion[] = [];
  const states: BackgroundJobInfo[] = [];
  const manager = new BackgroundJobManager({
    cwd: root,
    stateDir: join(root, "state"),
    onComplete: (event) => { completions.push(event); return true; },
    onState: (state) => states.push(state),
  });
  return { root, manager, completions, states };
}

describe("BackgroundJobManager", () => {
  it("wakes exactly once when a silent command completes", async () => {
    const { manager, completions } = await fixture();
    const job = await manager.start({
      ownerAgent: "engineer",
      jobKey: "silent-training",
      description: "silent training",
      command: nodeCommand("setTimeout(() => {}, 30)"),
      timeoutMs: 2_000,
    });
    expect(job.status).toBe("running");
    expect(completions).toEqual([]);
    await waitFor(() => completions.length === 1);
    expect(completions[0]).toMatchObject({ jobId: job.id, status: "completed", exitCode: 0 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(completions).toHaveLength(1);
  });

  it("captures output without emitting progress completions", async () => {
    const { manager, completions } = await fixture();
    const job = await manager.start({
      ownerAgent: "experimentalist",
      jobKey: "output-training",
      description: "output training",
      command: nodeCommand("console.log('progress'); console.error('diagnostic'); setTimeout(() => {}, 80)"),
      timeoutMs: 2_000,
    });
    await waitFor(() => manager.get(job.id)?.stdoutTail?.includes("progress") === true);
    expect(completions).toEqual([]);
    await waitFor(() => completions.length === 1);
    expect(completions[0]?.stdoutTail).toContain("progress");
    expect(completions[0]?.stderrTail).toContain("diagnostic");
    expect(await readFile(job.logPath, "utf8")).toContain("progress");
  });

  it("rejects duplicate job keys and atomically replaces when requested", async () => {
    const { manager } = await fixture();
    const first = await manager.start({
      ownerAgent: "engineer",
      jobKey: "experiment-b",
      description: "original",
      command: nodeCommand("setInterval(() => {}, 1000)"),
    });
    await expect(manager.start({
      ownerAgent: "engineer",
      jobKey: "experiment-b",
      description: "duplicate",
      command: nodeCommand("setTimeout(() => {}, 10)"),
    })).rejects.toThrow(first.id);
    const replacement = await manager.start({
      ownerAgent: "engineer",
      jobKey: "experiment-b",
      description: "replacement",
      command: nodeCommand("setTimeout(() => {}, 10)"),
      replaceExisting: true,
    });
    expect(manager.get(first.id)?.status).toBe("cancelled");
    expect(replacement.id).not.toBe(first.id);
    await waitFor(() => manager.get(replacement.id)?.finishedAt !== undefined);
  });

  it("times out and notifies the owner", async () => {
    const { manager, completions } = await fixture();
    await manager.start({
      ownerAgent: "engineer",
      jobKey: "timeout",
      description: "timeout",
      command: nodeCommand("setInterval(() => {}, 1000)"),
      timeoutMs: 1_000,
    });
    await waitFor(() => completions.length === 1);
    expect(completions[0]?.status).toBe("timed_out");
  });

  it("does not emit a completion wakeup for an explicit stop", async () => {
    const { manager, completions } = await fixture();
    const job = await manager.start({
      ownerAgent: "engineer",
      jobKey: "cancel",
      description: "cancel",
      command: nodeCommand("setInterval(() => {}, 1000)"),
    });
    expect(await manager.stop(job.id, "engineer")).toBe(true);
    expect(manager.get(job.id)?.status).toBe("cancelled");
    expect(completions).toEqual([]);
  });
});
