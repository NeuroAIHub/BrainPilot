import { describe, expect, it } from "vitest";
import { createBackgroundJobTool, type ToolDeps } from "../tools/system-tools.js";

function text(result: Awaited<ReturnType<ReturnType<typeof createBackgroundJobTool>["execute"]>>): string {
  return result.content.map((item) => item.text).join("\n");
}

function fixture() {
  const jobs: Array<Record<string, unknown>> = [{
    id: "job_a",
    jobKey: "training-a",
    description: "train model A",
    command: "python train.py",
    status: "running",
    timeoutMs: 60_000,
    logPath: "/tmp/job_a.log",
    startedAt: "2026-08-14T00:00:00.000Z",
    stdoutTail: "epoch 10",
  }];
  const deps = {
    listBackgroundJobs: () => jobs,
    getBackgroundJob: (jobId: string) => jobs.find((job) => job.id === jobId),
    stopBackgroundJob: async () => true,
  } as unknown as ToolDeps;
  return { jobs, tool: createBackgroundJobTool(deps) };
}

describe("background_job polling guard", () => {
  it("returns one compact running status, then terminates an unchanged repeat", async () => {
    const { jobs, tool } = fixture();

    const first = await tool.execute({ action: "get", job_id: "job_a" });
    expect(first.terminate).toBeUndefined();
    expect(text(first)).toContain("still running");
    expect(text(first)).not.toContain("epoch 10");
    expect(text(first)).not.toContain("python train.py");

    const repeated = await tool.execute({ action: "get", job_id: "job_a" });
    expect(repeated.terminate).toBe(true);
    expect(text(repeated)).toContain("ending this turn");

    jobs[0]!.status = "completed";
    jobs[0]!.stdoutTail = "training complete";
    const completed = await tool.execute({ action: "get", job_id: "job_a" });
    expect(completed.terminate).toBeUndefined();
    expect(text(completed)).toContain("training complete");
  });

  it("shares the unchanged-running guard across list and get", async () => {
    const { tool } = fixture();
    const listed = await tool.execute({ action: "list" });
    expect(listed.terminate).toBeUndefined();
    expect(text(listed)).not.toContain("epoch 10");
    expect(text(listed)).not.toContain("python train.py");

    const queried = await tool.execute({ action: "get", job_id: "job_a" });
    expect(queried.terminate).toBe(true);
  });
});
