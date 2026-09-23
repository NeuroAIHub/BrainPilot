import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { defineWorkflow, type WorkflowDefinition, type WorkflowImplementation, type WorkflowModelBinding, type WorkflowRun } from "@brainpilot/plugin-sdk/workflow";
import { WorkflowRunManager } from "../workflows/run-manager.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
const schema = { type: "object", properties: { count: { type: "integer", minimum: 0 } }, required: ["count"], additionalProperties: false };
const definition: WorkflowDefinition = {
  schemaVersion: 1, id: "table-qc", version: "0.1.0", title: "Table QC", description: "A non-writing SDK fixture.",
  applicableWhen: ["Input observations exist."], notApplicableWhen: ["A conceptual answer is sufficient."], requiredCapabilities: ["text"],
  inputSchema: schema, outputSchema: schema, resume: false,
};
const binding: WorkflowModelBinding = { id: "pi-binding-1", providerId: "test-provider", modelId: "same-model", thinkingLevel: "medium" };

async function fixture(implementation: WorkflowImplementation) {
  const dir = await mkdtemp(join(tmpdir(), "workflow-owner-"));
  directories.push(dir);
  let enabled = true;
  let implementations = [implementation];
  const terminal: WorkflowRun[] = [];
  const stages: string[] = [];
  const writes: string[] = [];
  const snapshots: WorkflowModelBinding[] = [];
  const statePath = join(dir, "runs.json");
  const manager = new WorkflowRunManager({
    sessionId: "session-one", statePath,
    implementations: () => implementations,
    isEnabled: () => enabled,
    availableCapabilities: () => ["text"],
    createContext: (run, signal) => {
      snapshots.push(run.modelBinding);
      return {
        readText: async () => "count,unit\n1,ms",
        runAgent: async (request) => { stages.push(request.stageId); return { count: 1 }; },
        writeArtifact: async (request) => {
          if (signal.aborted) throw new Error("aborted before artifact commit");
          writes.push(request.path);
          return { path: `${run.id}/${request.path}`, mediaType: request.mediaType, role: request.role,
            sha256: createHash("sha256").update(request.content).digest("hex"), producerRunId: run.id };
        },
      };
    },
    onTerminal: async (run) => { terminal.push(run); },
  });
  return { manager, statePath, terminal, stages, writes, snapshots,
    setEnabled: (value: boolean) => { enabled = value; },
    replace: (value: WorkflowImplementation) => { implementations = [value]; },
    start: (key = "once", input: unknown = { count: 1 }, modelBinding = binding) => manager.start({ workflowId: definition.id, idempotencyKey: key, input, modelBinding }),
  };
}

const simple = () => defineWorkflow({ definition, run: async (input) => ({ summary: "Checked the table.", artifacts: [], data: input }) });

describe("WorkflowRunManager", () => {
  it("deduplicates concurrent starts and rejects reuse with different input", async () => {
    let executions = 0;
    const f = await fixture(defineWorkflow({ definition, run: async (input) => { executions++; return { summary: "done", artifacts: [], data: input }; } }));
    const [a, b] = await Promise.all([f.start(), f.start()]);
    expect(a.id).toBe(b.id);
    await f.manager.wait(a.id);
    expect(executions).toBe(1);
    await expect(f.start("once", { count: 2 })).rejects.toMatchObject({ code: "WORKFLOW_IDEMPOTENCY_CONFLICT" });
    f.setEnabled(false);
    expect((await f.start()).id).toBe(a.id); // historical acknowledgement, no new run
    await expect(f.start("new")).rejects.toMatchObject({ code: "WORKFLOW_DISABLED" });
    expect(f.terminal).toHaveLength(1);
  });

  it("checks the live gate again after preflight yields", async () => {
    const entered = deferred(); const release = deferred();
    const f = await fixture(defineWorkflow({ ...simple(), preflight: async () => { entered.resolve(); await release.promise; return []; } }));
    const pending = f.start();
    await entered.promise;
    f.setEnabled(false);
    release.resolve();
    await expect(pending).rejects.toMatchObject({ code: "WORKFLOW_DISABLED" });
    expect(f.manager.list()).toEqual([]);
    expect(f.terminal).toEqual([]);
  });

  it("Stop aborts a preflight waiting for its signal without accepting or deadlocking", async () => {
    const entered = deferred();
    let runCalls = 0;
    const f = await fixture(defineWorkflow({
      definition,
      preflight: async (_input, context) => {
        entered.resolve();
        await new Promise<void>((_resolve, reject) => {
          context.signal.addEventListener("abort", () => reject(new Error("preflight aborted")), { once: true });
          context.signal.throwIfAborted();
        });
        return [];
      },
      run: async () => { runCalls++; return { summary: "must not execute", artifacts: [], data: { count: 1 } }; },
    }));
    const startResult = f.start().then(() => "unexpected acceptance", (error: Error) => error.message);
    await entered.promise;
    expect(f.manager.hasActive()).toBe(true);
    expect(await f.manager.cancelAll()).toBe(1);
    expect(await startResult).toContain("preflight aborted");
    expect(f.manager.hasActive()).toBe(false);
    expect(f.manager.list()).toEqual([]);
    expect(f.terminal).toEqual([]);
    expect(runCalls).toBe(0);
  });

  it("keeps an accepted run, later stages, implementation, and model binding after disable", async () => {
    const entered = deferred(); const release = deferred();
    const f = await fixture(defineWorkflow({ definition, run: async (input, ctx) => {
      await ctx.runAgent({ stageId: "first", instructions: "Inspect", inputs: input, outputSchema: schema });
      entered.resolve(); await release.promise;
      const data = await ctx.runAgent({ stageId: "second", instructions: "Summarize", inputs: input, outputSchema: schema });
      expect(ctx.modelBinding.modelId).toBe("same-model");
      const artifact = await ctx.writeArtifact({ path: "report.txt", content: "checked", mediaType: "text/plain", role: "qc-report" });
      return { summary: "Checked.", artifacts: [artifact], data };
    } }));
    const sourceBinding = { ...binding };
    const run = await f.start("fixed", { count: 1 }, sourceBinding);
    await entered.promise;
    sourceBinding.modelId = "changed-model";
    f.setEnabled(false);
    f.replace(defineWorkflow({ definition: { ...definition, version: "0.2.0" }, run: async () => { throw new Error("must not replace running code"); } }));
    await expect(f.start("second-run")).rejects.toMatchObject({ code: "WORKFLOW_DISABLED" });
    release.resolve();
    const result = await f.manager.wait(run.id);
    expect(result?.status).toBe("succeeded");
    expect(result?.workflowVersion).toBe("0.1.0");
    expect(result?.modelBinding.modelId).toBe("same-model");
    expect(f.stages).toEqual(["first", "second"]);
    expect(f.writes).toEqual(["report.txt"]);
  });

  it("session Stop waits for active work and rejects late results/artifacts", async () => {
    const entered = deferred(); const release = deferred();
    const f = await fixture(defineWorkflow({ definition, run: async (_input, ctx) => {
      entered.resolve(); await release.promise; // deliberately ignores cancellation until released
      const artifact = await ctx.writeArtifact({ path: "late.txt", content: "late", mediaType: "text/plain", role: "result" });
      return { summary: "must not succeed", artifacts: [artifact], data: { count: 1 } };
    } }));
    const run = await f.start(); await entered.promise;
    let stopped = false;
    const stopping = f.manager.cancelAll().then((count) => { stopped = true; return count; });
    expect(stopped).toBe(false);
    await expect(f.start("during-stop")).rejects.toMatchObject({ code: "WORKFLOW_STOPPING" });
    release.resolve();
    expect(await stopping).toBe(1);
    expect(f.manager.get(run.id)).toMatchObject({ status: "cancelled", artifacts: [] });
    expect(f.writes).toEqual([]);
    expect(f.terminal.map((item) => item.status)).toEqual(["cancelled"]);
    expect(f.manager.hasActive()).toBe(false);
  });

  it("refuses missing scientific prerequisites and strict input mismatch before acceptance", async () => {
    const f = await fixture(defineWorkflow({ ...simple(), preflight: async () => [{ kind: "scientific", status: "unknown", message: "Sampling units are missing." }] }));
    await expect(f.start()).rejects.toMatchObject({ code: "WORKFLOW_PREFLIGHT" });
    await expect(f.start("bad", { count: "1" })).rejects.toThrow();
    expect(f.manager.list()).toEqual([]);
  });

  it("validates domain result data and refuses forged artifact references", async () => {
    const f = await fixture(defineWorkflow({ definition, run: async () => ({ summary: "bad data", artifacts: [], data: { count: "1" } }) }));
    const badData = await f.start();
    expect((await f.manager.wait(badData.id))?.status).toBe("failed");
    f.replace(defineWorkflow({ definition, run: async () => ({ summary: "forged", artifacts: [{ path: "outside.txt", mediaType: "text/plain", role: "result", sha256: "0".repeat(64), producerRunId: "someone-else" }], data: { count: 1 } }) }));
    const forged = await f.start("forged");
    expect((await f.manager.wait(forged.id))?.error).toContain("uncommitted");
  });

  it("prevents output traversal and overwriting a committed artifact", async () => {
    const f = await fixture(defineWorkflow({ definition, run: async (_input, ctx) => {
      await expect(ctx.writeArtifact({ path: "../outside", content: "no", mediaType: "text/plain", role: "result" })).rejects.toThrow("inside");
      const request = { path: "result.txt", content: "first", mediaType: "text/plain", role: "result" };
      const artifact = await ctx.writeArtifact(request);
      await expect(ctx.writeArtifact({ ...request, content: "overwrite" })).rejects.toThrow("immutable");
      return { summary: "done", artifacts: [artifact], data: { count: 1 } };
    } }));
    const run = await f.start();
    expect((await f.manager.wait(run.id))?.status).toBe("succeeded");
    expect(f.writes).toEqual(["result.txt"]);
  });

  it("restores active records as interrupted without executing or replaying notifications", async () => {
    const f = await fixture(simple());
    const run = await f.start(); await f.manager.wait(run.id); await f.manager.flush();
    const stored = JSON.parse(await readFile(f.statePath, "utf8"));
    stored.runs[0].status = "running";
    delete stored.runs[0].result;
    delete stored.runs[0].finishedAt;
    await writeFile(f.statePath, JSON.stringify(stored));
    let notifications = 0;
    const restored = new WorkflowRunManager({ sessionId: "session-one", statePath: f.statePath,
      implementations: () => [], isEnabled: () => false,
      createContext: () => { throw new Error("must not execute during restore"); }, onTerminal: () => { notifications++; } });
    await restored.restore();
    expect(restored.get(run.id)).toMatchObject({ status: "interrupted", modelBinding: binding });
    expect(restored.hasActive()).toBe(false);
    expect(notifications).toBe(0);
    expect((await restored.start({ workflowId: definition.id, input: { count: 1 }, idempotencyKey: "once", modelBinding: binding })).id).toBe(run.id);
  });
});
