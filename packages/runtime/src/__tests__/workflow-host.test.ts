import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineWorkflow, type WorkflowDefinition, type WorkflowImplementation, type WorkflowRun } from "@brainpilot/plugin-sdk/workflow";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, PiUsage, PromptOptions, WorkflowAgentModelBinding } from "../types.js";
import { WorkflowHost, type WorkflowHostOptions } from "../workflows/host.js";
import { RealAgentSession } from "../agent-factory.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }
/** Resolves when the stage's own cancellation reaches the fixture "provider request". */
function cancelled(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => { signal.addEventListener("abort", () => resolve(), { once: true }); });
}
const outputSchema = { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 1 } }, additionalProperties: false };
const definition: WorkflowDefinition = {
  schemaVersion: 1, id: "host-fixture", version: "0.1.0", title: "Host fixture", description: "Exercises model-only workflow execution.",
  applicableWhen: ["A test explicitly requests the fixture."], notApplicableWhen: ["A user requests scientific evidence."],
  requiredCapabilities: ["agent", "readText", "writeArtifact"], inputSchema: true, outputSchema, resume: false,
};
type FactoryParams = Parameters<AgentSessionFactory>[0];
interface StageControl {
  params: FactoryParams;
  aborted: Promise<void>;
  emit(event: PiAgentEvent): void;
  submit(value: unknown): Promise<unknown>;
}

async function setup(implementation: WorkflowImplementation, stage?: (control: StageControl) => Promise<void>, options: {
  modelInput?: string[];
  runWithCapacity?: WorkflowHostOptions["runWithCapacity"];
  onTerminal?: WorkflowHostOptions["onTerminal"];
  stageTimeoutMs?: number;
  stageCleanupGraceMs?: number;
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), "workflow-host-")); dirs.push(dir);
  const workspaceDir = join(dir, "workspace"); const stateDir = join(dir, "state");
  await mkdir(workspaceDir);
  let enabled = true;
  const modelRuntime = { opaque: "host-only", secret: "not-a-public-run-field" };
  let binding: WorkflowAgentModelBinding = { model: { id: "actual-model", provider: "actual-provider", api: "openai-completions", contextWindow: 200_000,
    input: options.modelInput ?? ["text"] }, modelRuntime, thinkingLevel: "medium" };
  const factories: FactoryParams[] = [];
  const promptCalls: Array<{ params: FactoryParams; text: string; options?: PromptOptions }> = [];
  const releaseAbortedStages: Array<() => void> = [];
  const controls: Array<{ aborts: number; disposed: boolean; listeners: Set<(event: PiAgentEvent) => void> }> = [];
  const usage: PiUsage[] = [];
  const terminal: WorkflowRun[] = [];
  const factory: AgentSessionFactory = async (params) => {
    factories.push(params);
    const aborted = deferred();
    releaseAbortedStages.push(aborted.resolve);
    const control = { aborts: 0, disposed: false, listeners: new Set<(event: PiAgentEvent) => void>() };
    controls.push(control);
    let inFlight: Promise<void> | undefined;
    let streaming = false;
    const emit = (event: PiAgentEvent) => { for (const listener of control.listeners) listener(event); };
    const submit = (value: unknown) => params.systemTools.find((tool) => tool.name === "submit_result")!.execute({ result: value });
    const session: IAgentSession = {
      sessionId: params.sessionId,
      get isStreaming() { return streaming; },
      subscribe: (listener) => { control.listeners.add(listener); return () => { control.listeners.delete(listener); }; },
      prompt: async (text, promptOptions) => {
        promptCalls.push({ params, text, options: promptOptions });
        streaming = true;
        inFlight = (async () => {
          if (stage) await stage({ params, aborted: aborted.promise, emit, submit });
          else {
            await submit({ text: "stage output" });
            emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { input: 3, output: 2, totalTokens: 5 } } });
          }
        })();
        try { await inFlight; } finally { streaming = false; }
      },
      setThinkingLevel: () => {},
      abort: async () => { control.aborts++; aborted.resolve(); await inFlight?.catch(() => undefined); },
      dispose: () => { control.disposed = true; },
    };
    return session;
  };
  const host = new WorkflowHost({
    sessionId: "session", workspaceDir, stateDir, persist: true,
    implementations: () => [implementation], isEnabled: () => enabled,
    captureBinding: async () => binding,
    agentFactory: factory, runWithCapacity: options.runWithCapacity ?? (async (fn, signal) => { signal.throwIfAborted(); return fn(); }),
    onUsage: (_stageId, value) => { usage.push(value); }, onChanged: () => {},
    onTerminal: async (run) => { terminal.push(run); await options.onTerminal?.(run); },
    stageTimeoutMs: options.stageTimeoutMs,
    stageCleanupGraceMs: options.stageCleanupGraceMs,
  });
  return { host, dir, workspaceDir, stateDir, factories, controls, usage, terminal, modelRuntime, promptCalls,
    releaseFixtureStages: () => { for (const release of releaseAbortedStages) release(); },
    setEnabled: (value: boolean) => { enabled = value; },
    replaceBinding: () => { binding = { model: { id: "next-model", provider: "next-provider" }, modelRuntime: { opaque: "new" }, thinkingLevel: "high" }; },
    start: (input: unknown = {}, idempotencyKey = "once") => host.start({ workflowId: definition.id, input, idempotencyKey }),
  };
}

const oneStage = () => defineWorkflow({ definition, run: async (input, ctx) => {
  const data = await ctx.runAgent({ stageId: "inspect", instructions: "Inspect supplied evidence.", inputs: input, outputSchema, tools: [] });
  return { summary: "Stage done.", artifacts: [], data };
} });

describe("native WorkflowHost", () => {
  it("captures real session getters, excluding opaque credentials from the public run", () => {
    const model = { id: "effective", provider: "provider", api: "openai-completions", contextWindow: 100_000 };
    const modelRuntime = { opaque: "private" };
    const session = new RealAgentSession({ model, modelRuntime, thinkingLevel: "medium", sessionId: "pi", isStreaming: false } as never, new Map());
    const snapshot = session.getWorkflowModelBinding();
    model.id = "later-setting";
    expect(snapshot.model.id).toBe("effective");
    expect(snapshot.modelRuntime).toBe(modelRuntime);
    expect(Object.isFrozen(snapshot.model)).toBe(true);
  });

  it("uses the same actual model/runtime for all isolated stages even after disable/settings changes", async () => {
    const entered = deferred(); const release = deferred();
    const f = await setup(defineWorkflow({ definition, run: async (input, ctx) => {
      await ctx.runAgent({ stageId: "one", instructions: "First stage.", inputs: input, outputSchema, tools: [] });
      entered.resolve(); await release.promise;
      const data = await ctx.runAgent({ stageId: "two", instructions: "Second stage.", inputs: input, outputSchema, tools: [] });
      return { summary: "Both stages done.", artifacts: [], data };
    } }));
    const run = await f.start(); await entered.promise;
    f.setEnabled(false); f.replaceBinding();
    await expect(f.start({}, "new-key")).rejects.toThrow("WORKFLOW_DISABLED");
    release.resolve();
    expect((await f.host.manager.wait(run.id))?.status).toBe("succeeded");
    expect(f.factories).toHaveLength(2);
    for (const params of f.factories) {
      expect(params.workflowModelBinding?.model.id).toBe("actual-model");
      expect(params.workflowModelBinding?.modelRuntime).toBe(f.modelRuntime);
      expect(params.thinkingLevel).toBe("medium");
      expect(params.providerConfig).toBeUndefined();
      expect(params.allowedToolNames).toEqual(["submit_result"]);
      expect(params.skillPaths).toEqual([]);
      expect(params.suppressCoordinationHooks).toBe(true);
      expect(params.cwd).not.toBe(f.workspaceDir);
    }
    expect(f.factories[0]!.historyPath).not.toBe(f.factories[1]!.historyPath);
    expect(f.usage).toEqual([{ input: 3, output: 2, totalTokens: 5 }, { input: 3, output: 2, totalTokens: 5 }]);
    const persisted = await readFile(join(f.stateDir, "workflows.json"), "utf8");
    expect(persisted).not.toContain("not-a-public-run-field");
    expect(f.controls.every((control) => control.disposed && control.listeners.size === 0)).toBe(true);
  });

  it("freezes input text from preflight and writes only a separate run artifact", async () => {
    const entered = deferred(); const release = deferred();
    const f = await setup(defineWorkflow({ definition,
      preflight: async (_input, ctx) => { expect(await ctx.readText("results.txt")).toBe("original evidence"); return []; },
      run: async (_input, ctx) => {
        entered.resolve(); await release.promise;
        const text = await ctx.readText("results.txt");
        const artifact = await ctx.writeArtifact({ path: "report.txt", content: text, mediaType: "text/plain", role: "report" });
        return { summary: "Evidence preserved.", artifacts: [artifact], data: { text } };
      },
    }));
    await writeFile(join(f.workspaceDir, "results.txt"), "original evidence");
    const run = await f.start(); await entered.promise;
    await writeFile(join(f.workspaceDir, "results.txt"), "user's concurrent update");
    release.resolve();
    const finished = await f.host.manager.wait(run.id);
    expect(finished?.result?.data).toEqual({ text: "original evidence" });
    expect(await readFile(join(f.workspaceDir, "results.txt"), "utf8")).toBe("user's concurrent update");
    expect(await readFile(join(f.workspaceDir, finished!.artifacts[0]!.path), "utf8")).toBe("original evidence");
  });

  it("cleans only the settled run's scratch files before delivering its terminal result", async () => {
    const entered = deferred(); const release = deferred();
    let workPath = "";
    const f = await setup(defineWorkflow({ definition, run: async (_input, ctx) => {
      const artifacts = [];
      for (const path of ["final.tex", "final.pdf", "compile.log", "figures/original.png"]) {
        artifacts.push(await ctx.writeArtifact({ path, content: `published ${path}`, mediaType: "text/plain", role: "fixture" }));
      }
      entered.resolve(); await release.promise;
      return { summary: "done", artifacts, data: { text: "done" } };
    } }), undefined, { onTerminal: async () => {
      await expect(lstat(workPath)).rejects.toMatchObject({ code: "ENOENT" });
    } });
    const run = await f.start(); await entered.promise;
    workPath = join(f.workspaceDir, "workflow-runs", run.id, ".work");
    const otherWork = join(f.workspaceDir, "workflow-runs", "wf_other", ".work");
    await mkdir(join(workPath, "render-fixture"), { recursive: true });
    await mkdir(otherWork, { recursive: true });
    await writeFile(join(workPath, "render-fixture", "page-1.png"), "temporary rendered page");
    await writeFile(join(workPath, "render-fixture", "input.pdf"), "temporary PDF copy");
    await writeFile(join(otherWork, "keep.txt"), "another run");
    await writeFile(join(f.workspaceDir, "original-material.txt"), "research material");
    release.resolve();
    const finished = await f.host.manager.wait(run.id);
    expect(finished?.status).toBe("succeeded");
    expect(finished?.terminalDeliveryError).toBeUndefined();
    expect(f.terminal).toHaveLength(1);
    for (const artifact of finished!.artifacts) {
      expect(await readFile(join(f.workspaceDir, artifact.path), "utf8")).toBe(`published ${artifact.path.split(`workflow-runs/${run.id}/`)[1]}`);
    }
    expect(await readFile(join(otherWork, "keep.txt"), "utf8")).toBe("another run");
    expect(await readFile(join(f.workspaceDir, "original-material.txt"), "utf8")).toBe("research material");
  });

  it("waits for a cancelled stage to settle before cleaning scratch files and delivering cancellation", async () => {
    const entered = deferred(); const aborted = deferred(); const release = deferred();
    const f = await setup(defineWorkflow({ definition, run: async (_input, ctx) => {
      await ctx.writeArtifact({ path: "draft.tex", content: "preserved draft", mediaType: "application/x-tex", role: "draft" });
      await ctx.runAgent({ stageId: "slow", instructions: "Wait for Stop.", inputs: {}, outputSchema });
      return { summary: "unexpected", artifacts: [], data: { text: "unexpected" } };
    } }), async control => {
      entered.resolve(); await control.aborted; aborted.resolve(); await release.promise;
    });
    const run = await f.start(); await entered.promise;
    const workPath = join(f.workspaceDir, "workflow-runs", run.id, ".work");
    await mkdir(workPath, { recursive: true });
    await writeFile(join(workPath, "page.png"), "still in use by the stage");
    const stopping = f.host.manager.cancelAll();
    try {
      await aborted.promise;
      expect(await readFile(join(workPath, "page.png"), "utf8")).toBe("still in use by the stage");
      expect(f.terminal).toEqual([]);
      release.resolve(); await stopping;
      expect(f.host.manager.get(run.id)?.status).toBe("cancelled");
      await expect(lstat(workPath)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(f.workspaceDir, "workflow-runs", run.id, "draft.tex"), "utf8")).toBe("preserved draft");
      expect(f.terminal.map(item => item.status)).toEqual(["cancelled"]);
    } finally { release.resolve(); f.releaseFixtureStages(); await stopping; }
  });

  it.each(["workspace", "workflow-runs", "run", ".work"] as const)("preserves a %s symlink and its target while still delivering the terminal result", async layer => {
    const entered = deferred(); const release = deferred();
    const f = await setup(defineWorkflow({ definition, run: async () => {
      entered.resolve(); await release.promise;
      return { summary: "done", artifacts: [], data: { text: "done" } };
    } }));
    const run = await f.start(); await entered.promise;
    const target = join(f.dir, "preserved-target");
    const parts = ["workflow-runs", run.id, ".work"];
    const index = layer === "workspace" ? -1 : layer === "workflow-runs" ? 0 : layer === "run" ? 1 : 2;
    const linkPath = index === -1 ? f.workspaceDir : join(f.workspaceDir, ...parts.slice(0, index + 1));
    const targetWork = join(target, ...parts.slice(index + 1));
    await mkdir(targetWork, { recursive: true });
    await writeFile(join(targetWork, "keep.txt"), "must remain untouched");
    if (index === -1) await rm(f.workspaceDir, { recursive: true });
    else await mkdir(join(f.workspaceDir, ...parts.slice(0, index)), { recursive: true });
    await symlink(target, linkPath);
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      release.resolve();
      const finished = await f.host.manager.wait(run.id);
      expect(finished?.status).toBe("succeeded");
      expect(finished?.terminalDeliveryError).toBeUndefined();
      expect(f.terminal).toHaveLength(1);
      expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("Temporary cleanup skipped or failed"));
      expect((await lstat(linkPath)).isSymbolicLink()).toBe(true);
      expect(await readFile(join(targetWork, "keep.txt"), "utf8")).toBe("must remain untouched");
    } finally { diagnostic.mockRestore(); release.resolve(); await f.host.manager.cancelAll(); }
  });

  it("preserves a published artifact even if an implementation placed it under .work", async () => {
    const f = await setup(defineWorkflow({ definition, run: async (_input, ctx) => {
      const artifact = await ctx.writeArtifact({ path: ".work/published.tex", content: "published manuscript", mediaType: "application/x-tex", role: "manuscript" });
      return { summary: "done", artifacts: [artifact], data: { text: "done" } };
    } }));
    const diagnostic = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const run = await f.start();
      const finished = await f.host.manager.wait(run.id);
      expect(finished?.status).toBe("succeeded");
      expect(await readFile(join(f.workspaceDir, finished!.artifacts[0]!.path), "utf8")).toBe("published manuscript");
      expect(f.terminal).toHaveLength(1);
      expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("published artifact"));
    } finally { diagnostic.mockRestore(); }
  });

  it("rejects inputs outside the workspace, including symlink escapes", async () => {
    const f = await setup(defineWorkflow({ ...oneStage(), preflight: async (input, ctx) => { await ctx.readText((input as { path: string }).path); return []; } }));
    await writeFile(join(f.dir, "outside.txt"), "must not read");
    await symlink(join(f.dir, "outside.txt"), join(f.workspaceDir, "escape.txt"));
    await expect(f.start({ path: "../outside.txt" }, "outside")).rejects.toThrow("outside");
    await expect(f.start({ path: "escape.txt" }, "symlink")).rejects.toThrow("outside");
    expect(f.factories).toEqual([]);
  });

  it("rejects output-directory symlinks even when their target is inside the workspace", async () => {
    const f = await setup(defineWorkflow({ definition, run: async (_input, ctx) => {
      const artifact = await ctx.writeArtifact({ path: "report.txt", content: "must not land in materials", mediaType: "text/plain", role: "report" });
      return { summary: "done", artifacts: [artifact], data: { text: "done" } };
    } }));
    const materials = join(f.workspaceDir, "materials"); await mkdir(materials);
    await symlink(materials, join(f.workspaceDir, "workflow-runs"));
    const run = await f.start();
    expect((await f.host.manager.wait(run.id))?.status).toBe("failed");
    expect(await readdir(materials)).toEqual([]);
  });

  it("does not overwrite a pre-existing output file", async () => {
    let target = "";
    let workspaceDir = "";
    const f = await setup(defineWorkflow({ definition, run: async (_input, ctx) => {
      const folder = join(workspaceDir, "workflow-runs", ctx.runId); await mkdir(folder, { recursive: true });
      target = join(folder, "report.txt"); await writeFile(target, "preserve this file");
      const artifact = await ctx.writeArtifact({ path: "report.txt", content: "overwrite", mediaType: "text/plain", role: "report" });
      return { summary: "done", artifacts: [artifact], data: { text: "done" } };
    } }));
    workspaceDir = f.workspaceDir;
    const run = await f.start();
    expect((await f.host.manager.wait(run.id))?.status).toBe("failed");
    expect(await readFile(target, "utf8")).toBe("preserve this file");
  });

  it("Stop aborts the Pi session, awaits idle, and disposes listeners without a successful result", async () => {
    const entered = deferred();
    const f = await setup(oneStage(), async ({ aborted, emit }) => {
      entered.resolve(); await aborted;
      emit({ type: "message_end", message: { role: "assistant", stopReason: "aborted", usage: { input: 2, output: 1, totalTokens: 3 } } });
    });
    const run = await f.start(); await entered.promise;
    expect(await f.host.manager.cancelAll()).toBe(1);
    expect(f.host.manager.get(run.id)).toMatchObject({ status: "cancelled", artifacts: [] });
    expect(f.host.manager.get(run.id)?.result).toBeUndefined();
    expect(f.controls[0]?.aborts).toBe(1);
    expect(f.controls[0]?.disposed).toBe(true);
    expect(f.controls[0]?.listeners.size).toBe(0);
    expect(f.usage).toEqual([{ input: 2, output: 1, totalTokens: 3 }]);
    expect(f.terminal.map((item) => item.status)).toEqual(["cancelled"]);
  });

  it("does not call plain prose or a post-submission provider failure successful", async () => {
    const noSubmit = await setup(oneStage(), async ({ emit }) => {
      emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Looks done." }] } });
    });
    const noResult = await noSubmit.start();
    expect((await noSubmit.host.manager.wait(noResult.id))?.error).toContain("without a validated submit_result");
    // Exactly one correction: a stage that misses the tool call twice fails.
    expect(noSubmit.promptCalls).toHaveLength(2);
    const providerError = await setup(oneStage(), async ({ submit, emit }) => {
      await submit({ text: "submitted before error" });
      emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "provider failed", usage: { input: 1, output: 1, totalTokens: 2 } } });
    });
    const failed = await providerError.start();
    expect((await providerError.host.manager.wait(failed.id))?.status).toBe("failed");
    expect(providerError.usage).toEqual([{ input: 1, output: 1, totalTokens: 2 }]);
    expect(providerError.promptCalls).toHaveLength(1);
  });

  it("corrects a normally stopped turn that delivered no result, and uses only the resubmitted tool value", async () => {
    let turns = 0;
    const f = await setup(oneStage(), async ({ emit, submit }) => {
      if (++turns === 1) {
        emit({ type: "message_end", message: { role: "assistant", stopReason: "stop",
          content: [{ type: "text", text: JSON.stringify({ text: "plain prose answer" }) }], usage: { input: 5, output: 4, totalTokens: 9 } } });
        return;
      }
      await submit({ text: "resubmitted tool result" });
      emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { input: 2, output: 1, totalTokens: 3 } } });
    });
    const run = await f.start({ caption: "original inputs" });
    expect(await f.host.manager.wait(run.id)).toMatchObject({ status: "succeeded", result: { data: { text: "resubmitted tool result" } } });
    // One stage session, one extra turn inside it: same session, same binding.
    expect(f.factories).toHaveLength(1);
    expect(f.promptCalls).toHaveLength(2);
    expect(f.promptCalls[1]!.params).toBe(f.promptCalls[0]!.params);
    expect(f.promptCalls[1]!.params.workflowModelBinding?.modelRuntime).toBe(f.modelRuntime);
    expect(f.promptCalls[1]!.params.workflowModelBinding?.model.id).toBe("actual-model");
    // The original turn and its inputs stay in history; the correction adds no images.
    expect(JSON.parse(f.promptCalls[0]!.text)).toEqual({ caption: "original inputs" });
    expect(f.promptCalls[1]!.text).toContain("submit_result");
    expect(f.promptCalls[1]!.options).toBeUndefined();
    expect(f.usage).toEqual([{ input: 5, output: 4, totalTokens: 9 }, { input: 2, output: 1, totalTokens: 3 }]);
    expect(f.terminal.map((item) => item.status)).toEqual(["succeeded"]);
  });

  it.each(["error", "length", "aborted"] as const)("sends no delivery correction after a %s turn without a result", async (stopReason) => {
    const f = await setup(oneStage(), async ({ emit }) => {
      emit({ type: "message_end", message: { role: "assistant", stopReason,
        ...(stopReason === "error" ? { errorMessage: "provider failed" } : {}), usage: { input: 1, output: 1, totalTokens: 2 } } });
    });
    const run = await f.start();
    expect((await f.host.manager.wait(run.id))?.status).toBe("failed");
    expect(f.host.manager.get(run.id)?.result).toBeUndefined();
    expect(f.promptCalls).toHaveLength(1);
  });

  it("sends no delivery correction once parent Stop reached the stage", async () => {
    const entered = deferred();
    const f = await setup(oneStage(), async ({ emit, aborted }) => {
      entered.resolve(); await aborted;
      emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Looks done." }] } });
    });
    const run = await f.start(); await entered.promise;
    try {
      expect(await f.host.manager.cancelAll()).toBe(1);
      expect(f.host.manager.get(run.id)).toMatchObject({ status: "cancelled", artifacts: [] });
      expect(f.host.manager.get(run.id)?.result).toBeUndefined();
      expect(f.promptCalls).toHaveLength(1);
      expect(f.controls[0]?.aborts).toBe(1);
      expect(f.controls[0]?.disposed).toBe(true);
      expect(f.controls[0]?.listeners.size).toBe(0);
      expect(f.terminal.map((item) => item.status)).toEqual(["cancelled"]);
    } finally { f.releaseFixtureStages(); await f.host.manager.cancelAll(); }
  });

  it("accepts a complete retry after an earlier stream error and retains both attempts' usage", async () => {
    const f = await setup(oneStage(), async ({ emit, submit }) => {
      emit({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "incomplete stream", usage: { input: 2, output: 1, totalTokens: 3 } } });
      emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse", usage: { input: 4, output: 2, totalTokens: 6 } } });
      await submit({ text: "complete recovered result" });
    });
    const run = await f.start();
    expect(await f.host.manager.wait(run.id)).toMatchObject({ status: "succeeded", result: { data: { text: "complete recovered result" } } });
    expect(f.usage.map(value => value.totalTokens)).toEqual([3, 6]);
  });

  it("keeps parent Stop authoritative after valid submission but before the stage is idle", async () => {
    const submitted = deferred();
    const f = await setup(oneStage(), async ({ emit, submit, aborted }) => {
      emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse" } });
      await submit({ text: "valid result" }); submitted.resolve();
      await aborted;
    });
    const run = await f.start(); await submitted.promise;
    await f.host.manager.cancelAll();
    expect(f.host.manager.get(run.id)).toMatchObject({ status: "cancelled", artifacts: [] });
    expect(f.host.manager.get(run.id)?.result).toBeUndefined();
  });

  it("does not let a valid submission bypass the stage timeout while the session is still active", async () => {
    const f = await setup(oneStage(), async ({ emit, submit, aborted }) => {
      emit({ type: "message_end", message: { role: "assistant", stopReason: "toolUse" } });
      await submit({ text: "valid result" });
      await aborted;
    }, { stageTimeoutMs: 20 });
    const run = await f.start();
    expect(await f.host.manager.wait(run.id)).toMatchObject({ status: "failed", error: "Workflow stage exceeded its time limit" });
    expect(f.controls[0]?.aborts).toBe(1);
    expect(f.host.manager.get(run.id)?.result).toBeUndefined();
  });

  it("lets a stage widen its own deadline past the host's configured stage budget", async () => {
    // The host budget alone (20ms) fences this stage long before it submits, so
    // the run can only succeed if the stage's own request budget is in force.
    const f = await setup(defineWorkflow({ definition, run: async (input, ctx) => {
      const data = await ctx.runAgent({ stageId: "slow", instructions: "Outlast the host budget.", inputs: input, outputSchema, tools: [], timeoutMs: 500 });
      return { summary: "Stage done.", artifacts: [], data };
    } }), async ({ submit }) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      await submit({ text: "stage output" });
    }, { stageTimeoutMs: 20 });
    const run = await f.start();
    expect(await f.host.manager.wait(run.id)).toMatchObject({ status: "succeeded", result: { data: { text: "stage output" } } });
    expect(f.controls[0]?.aborts).toBe(0);
    expect(f.terminal.map((item) => item.status)).toEqual(["succeeded"]);
  });

  it("keeps parent Stop authoritative over a stage's widened deadline and rejects a late result", async () => {
    const entered = deferred(); const aborted = deferred(); const release = deferred();
    let lateSubmission: unknown;
    const f = await setup(defineWorkflow({ definition, run: async (input, ctx) => {
      await ctx.runAgent({ stageId: "slow", instructions: "Await Stop rather than the widened deadline.", inputs: input, outputSchema, tools: [], timeoutMs: 500 });
      return { summary: "unexpected", artifacts: [], data: { text: "unexpected" } };
    } }), async ({ aborted: stageAborted, submit }) => {
      entered.resolve(); await stageAborted; aborted.resolve();
      await release.promise;
      try { await submit({ text: "late result" }); }
      catch (error) { lateSubmission = error; }
    }, { stageTimeoutMs: 20 });
    const run = await f.start(); await entered.promise;
    const stopping = f.host.manager.cancelAll();
    try {
      await aborted.promise;
      // The stage's own cancellation has reached it; the run cannot be terminal
      // yet because the fixture deliberately keeps its cleanup in flight, and
      // the manager correctly waits for owned cleanup before writing state.
      expect(f.factories[0]?.workflowStageCancellation?.signal.aborted).toBe(true);
      expect(f.terminal).toEqual([]);
      release.resolve(); await stopping;
      expect(lateSubmission).toBeDefined();
      expect(f.host.manager.get(run.id)).toMatchObject({ status: "cancelled" });
      expect(f.host.manager.get(run.id)?.result).toBeUndefined();
      expect(f.controls[0]?.aborts).toBe(1);
      expect(f.terminal.map((item) => item.status)).toEqual(["cancelled"]);
    } finally { release.resolve(); f.releaseFixtureStages(); await stopping; }
  });

  it("rejects missing image capability before accepting a run or creating a stage", async () => {
    let executed = false;
    const f = await setup(defineWorkflow({ definition: { ...definition, requiredCapabilities: [...definition.requiredCapabilities, "images"] },
      run: async (_input, ctx) => {
        executed = true;
        const data = await ctx.runAgent({ stageId: "vision", instructions: "Inspect page layout.", inputs: {}, outputSchema, images: ["missing.png"] });
        return { summary: "done", artifacts: [], data };
      },
    }), undefined, { modelInput: ["text"] });
    await expect(f.start()).rejects.toMatchObject({ code: "WORKFLOW_PREFLIGHT", message: expect.stringContaining("images") });
    expect(executed).toBe(false);
    expect(f.factories).toEqual([]);
    expect(f.host.manager.list()).toEqual([]);
    expect(f.terminal).toEqual([]);
  });

  it("passes actual PNG bytes through PromptOptions.images on the same captured model binding", async () => {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
    const f = await setup(defineWorkflow({ definition: { ...definition, requiredCapabilities: [...definition.requiredCapabilities, "images"] },
      run: async (_input, ctx) => {
        const data = await ctx.runAgent({ stageId: "vision", instructions: "Inspect this page.",
          inputs: { caption: "PNG fixture" }, outputSchema, tools: [], images: ["page.png"] });
        return { summary: "Image delivered.", artifacts: [], data };
      },
    }), undefined, { modelInput: ["text", "image"] });
    await writeFile(join(f.workspaceDir, "page.png"), png);
    const run = await f.start();
    expect((await f.host.manager.wait(run.id))?.status).toBe("succeeded");
    expect(f.promptCalls).toHaveLength(1);
    const call = f.promptCalls[0]!;
    expect(call.options?.images).toEqual([{ type: "image", mimeType: "image/png", data: png.toString("base64") }]);
    expect(Buffer.from(call.options!.images![0]!.data, "base64")).toEqual(png);
    expect(JSON.parse(call.text)).toEqual({ caption: "PNG fixture" });
    expect(call.params.workflowModelBinding?.modelRuntime).toBe(f.modelRuntime);
    expect(call.params.workflowModelBinding?.model.id).toBe("actual-model");
    expect(call.params.thinkingLevel).toBe("medium");
    expect(call.params.providerConfig).toBeUndefined();
  });

  it("permits parallel stages through the host's shared capacity callback", async () => {
    const bothStarted = deferred(); const release = deferred();
    let started = 0; let active = 0; let peak = 0; let capacityCalls = 0;
    const f = await setup(defineWorkflow({ definition, run: async (input, ctx) => {
      const results = await Promise.all([
        ctx.runAgent({ stageId: "left", instructions: "Left branch.", inputs: input, outputSchema }),
        ctx.runAgent({ stageId: "right", instructions: "Right branch.", inputs: input, outputSchema }),
      ]) as Array<{ text: string }>;
      return { summary: "Both branches joined.", artifacts: [], data: { text: results.map((item) => item.text).join("|") } };
    } }), async ({ params, aborted, submit }) => {
      if (++started === 2) bothStarted.resolve();
      await Promise.race([release.promise, aborted]);
      await submit({ text: params.agentName.includes(":left:") ? "left" : "right" });
    }, {
      runWithCapacity: async (fn, signal) => {
        signal.throwIfAborted(); capacityCalls++; active++; peak = Math.max(peak, active);
        try { return await fn(); } finally { active--; }
      },
    });
    const run = await f.start();
    const finished = f.host.manager.wait(run.id);
    try {
      await Promise.race([bothStarted.promise, finished.then(() => { throw new Error("Workflow ended before both parallel stages started"); })]);
      expect(peak).toBe(2);
      expect(capacityCalls).toBe(2);
      expect(f.host.manager.hasActive()).toBe(true);
      release.resolve();
      expect(await finished).toMatchObject({ status: "succeeded", result: { data: { text: "left|right" } } });
      expect(active).toBe(0);
      expect(f.factories.every((params) => params.workflowModelBinding?.modelRuntime === f.modelRuntime)).toBe(true);
      expect(f.terminal).toHaveLength(1);
    } finally {
      release.resolve(); f.releaseFixtureStages(); await f.host.manager.cancelAll();
    }
  });

  it("joins a cancelled sibling after another stage fails and rejects a late artifact write", async () => {
    const siblingStarted = deferred(); const siblingAborted = deferred(); const releaseSibling = deferred();
    let lateWrite: (() => Promise<unknown>) | undefined;
    const f = await setup(defineWorkflow({ definition, run: async (input, ctx) => {
      lateWrite = () => ctx.writeArtifact({ path: "late.txt", content: "must not publish", mediaType: "text/plain", role: "late" });
      await Promise.all([
        ctx.runAgent({ stageId: "slow", instructions: "Await cancellation.", inputs: input, outputSchema }),
        ctx.runAgent({ stageId: "fail", instructions: "Controlled failing branch.", inputs: input, outputSchema }),
      ]);
      return { summary: "must not succeed", artifacts: [], data: { text: "unexpected" } };
    } }), async ({ params, aborted }) => {
      if (params.agentName.includes(":slow:")) {
        siblingStarted.resolve();
        await aborted; siblingAborted.resolve();
        await releaseSibling.promise;
        await expect(lateWrite!()).rejects.toThrow(/cancel/i);
        return;
      }
      await siblingStarted.promise;
      throw new Error("fixture stage failure");
    });
    const run = await f.start();
    let settled = false;
    const finished = f.host.manager.wait(run.id).then((result) => { settled = true; return result; });
    try {
      await Promise.race([siblingAborted.promise, finished.then(() => { throw new Error("Workflow settled without cancelling its sibling"); })]);
      expect(f.host.manager.hasActive()).toBe(true);
      expect(settled).toBe(false);
      expect(f.terminal).toEqual([]);
      releaseSibling.resolve();
      expect(await finished).toMatchObject({ status: "failed", error: "fixture stage failure", artifacts: [] });
      const slowIndex = f.factories.findIndex((params) => params.agentName.includes(":slow:"));
      expect(f.controls[slowIndex]?.aborts).toBe(1);
      expect(f.controls.every((control) => control.disposed && control.listeners.size === 0)).toBe(true);
      expect(f.host.manager.hasActive()).toBe(false);
      expect(f.terminal).toHaveLength(1);
      await expect(readFile(join(f.workspaceDir, "workflow-runs", run.id, "late.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      releaseSibling.resolve(); f.releaseFixtureStages(); await f.host.manager.cancelAll();
    }
  });
});
