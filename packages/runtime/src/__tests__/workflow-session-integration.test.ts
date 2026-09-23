import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineWorkflow, type WorkflowDefinition, type WorkflowImplementation } from "@brainpilot/plugin-sdk/workflow";
import { SessionManager } from "../session-manager.js";
import { createServer } from "../server.js";
import { mockAgentFactory } from "../agent-factory.js";
import { TaskLedger, TaskLedgerCorruptError } from "../task-ledger.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, SystemTool, WorkflowAgentModelBinding } from "../types.js";

const dirs: string[] = [];
const managers: SessionManager[] = [];
const releases: Array<() => void> = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const release of releases.splice(0)) release();
  await Promise.all(managers.splice(0).map((manager) => manager.shutdownAndSave()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  releases.push(resolve);
  return { promise, resolve };
}
async function until(predicate: () => boolean, message = "workflow integration did not settle"): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const dataSchema = { type: "object", required: ["count"], properties: { count: { type: "integer", minimum: 0 } }, additionalProperties: false };
const definition: WorkflowDefinition = {
  schemaVersion: 1, id: "integration-qc", version: "0.1.0", title: "Integration QC", description: "A synthetic non-writing integration fixture.",
  applicableWhen: ["An integration test explicitly requests this fixture."], notApplicableWhen: ["A conceptual question is requested."],
  requiredCapabilities: ["agent", "readText", "writeArtifact"], inputSchema: dataSchema, outputSchema: dataSchema, resume: false,
};
const simple = () => defineWorkflow({ definition, run: async (input) => ({ summary: "Fixture completed.", artifacts: [], data: input }) });
type FactoryParams = Parameters<AgentSessionFactory>[0];
type RawEvent = { agentName: string; event: PiAgentEvent };
function tool(params: FactoryParams, name: string): SystemTool {
  const found = params.systemTools.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing ${name} on ${params.agentName}`);
  return found;
}
function parseTool(value: Awaited<ReturnType<SystemTool["execute"]>>): Record<string, unknown> {
  return JSON.parse(value.content.map((part) => part.text).join(""));
}

async function setup(implementation: WorkflowImplementation, options: {
  blockStage?: boolean; dataRoot?: string; modelInput?: string[]; bindingUnavailable?: boolean;
} = {}) {
  const dataRoot = options.dataRoot ?? await mkdtemp(join(tmpdir(), "workflow-session-"));
  if (!options.dataRoot) dirs.push(dataRoot);
  const captures: FactoryParams[] = [];
  const prompts: Array<{ agentName: string; text: string }> = [];
  const rawEvents: RawEvent[] = [];
  const stageStarted = deferred();
  const stageControls: Array<{ aborts: number; disposed: boolean }> = [];
  const opaque = { identity: "the-original-pi-runtime" };
  const binding: WorkflowAgentModelBinding = { model: { id: "effective-pi-model", provider: "test-provider", api: "openai-completions",
    input: options.modelInput ?? ["text"] }, modelRuntime: opaque, thinkingLevel: "medium" };
  const factory: AgentSessionFactory = async (params) => {
    captures.push(params);
    if (!params.workflowModelBinding) {
      const base = await mockAgentFactory(params);
      base.subscribe((event) => rawEvents.push({ agentName: params.agentName, event }));
      return {
        get sessionId() { return base.sessionId; }, get isStreaming() { return base.isStreaming; },
        subscribe: (listener) => base.subscribe(listener),
        prompt: async (text, opts) => { prompts.push({ agentName: params.agentName, text }); await base.prompt(text, opts); },
        setThinkingLevel: (level) => base.setThinkingLevel(level),
        getWorkflowModelBinding: () => { if (options.bindingUnavailable) throw new Error("PI binding unavailable"); return binding; },
        abort: () => base.abort(), dispose: () => base.dispose(),
      } satisfies IAgentSession;
    }
    const stopped = deferred();
    const control = { aborts: 0, disposed: false }; stageControls.push(control);
    const listeners = new Set<(event: PiAgentEvent) => void>();
    let running = false;
    let pending: Promise<void> | undefined;
    const emit = (event: PiAgentEvent) => { for (const listener of listeners) listener(event); };
    return {
      sessionId: params.sessionId, get isStreaming() { return running; },
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      prompt: async () => {
        running = true; stageStarted.resolve();
        pending = (async () => {
          if (options.blockStage) { await stopped.promise; return; }
          await tool(params, "submit_result").execute({ result: { count: 1 } });
          emit({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { input: 2, output: 1, totalTokens: 3 } } });
        })();
        try { await pending; } finally { running = false; }
      },
      setThinkingLevel: () => {},
      abort: async () => { control.aborts++; stopped.resolve(); await pending; },
      dispose: () => { control.disposed = true; },
    } satisfies IAgentSession;
  };
  const manager = new SessionManager({ dataRoot, persist: true, agentFactory: factory,
    workflowImplementations: [implementation], maxConcurrentAgents: 1, memLimitBytes: null });
  managers.push(manager);
  const { app } = createServer({ manager });
  const put = (revision: number, enabledWorkflowIds: string[]) => app.request("/config/workflows", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision, enabledWorkflowIds }),
  });
  const create = async () => manager.createSession({ domainResources: "base", thinkingLevel: "medium" });
  const principal = (sessionId: string) => captures.find((params) => params.sessionId === sessionId && params.agentName === "principal")!;
  const warm = async (sessionId: string) => {
    await manager.sendMessage(sessionId, "hello");
    await until(() => Boolean(principal(sessionId)) && manager.getSessionState(sessionId)?.workState.active === false);
    return principal(sessionId);
  };
  return { dataRoot, manager, app, put, create, warm, principal, captures, prompts, rawEvents, stageStarted, stageControls, opaque };
}

describe("Workflow SessionManager/server integration", () => {
  it("reuses the library only when both session resources and current library toggle permit it", async () => {
    const root = await mkdtemp(join(tmpdir(), "workflow-library-")); dirs.push(root);
    await mkdir(join(root, "source"));
    await writeFile(join(root, "source", "KB_source.json"), JSON.stringify({ papers: [{ title: "EEG fixture paper", authors: ["A. Author"],
      published_date: "2020-01-01", abstract: "EEG source metadata in an isolated library.", journal: "Fixture", pdf_url: "" }] }));
    vi.stubEnv("BP_KB_ROOT", root);
    const resultSets: Array<{ localPapers: unknown[] }> = [];
    const implementation = defineWorkflow({ definition, run: async (_input, ctx) => {
      const found = await ctx.runTool({ name: "research_search", input: { query: "EEG", maxResults: 3 } });
      const data = found.data as { localPapers: unknown[] }; resultSets.push(data);
      return { summary: "Research-source permission observation", artifacts: [], data: { count: data.localPapers.length } };
    } });
    const f = await setup(implementation); await f.put(1, [definition.id]);
    const run = async (resources: "full" | "base") => {
      const session = await f.manager.createSession({ domainResources: resources });
      await f.manager.startWorkflow(session.id, { workflowId: definition.id, input: { count: 0 } });
      await until(() => ["succeeded", "failed"].includes(f.manager.listWorkflowRuns(session.id)[0]?.status ?? ""));
      expect(f.manager.listWorkflowRuns(session.id)[0]?.status).toBe("succeeded");
    };
    await run("full"); expect(resultSets.at(-1)?.localPapers).toHaveLength(1);
    await run("base"); expect(resultSets.at(-1)?.localPapers).toHaveLength(0);
    await mkdir(join(f.dataRoot, "bp_template"), { recursive: true });
    await writeFile(join(f.dataRoot, "bp_template", "tool_toggles.json"), JSON.stringify({ search_papers_local: false }));
    await run("full"); expect(resultSets.at(-1)?.localPapers).toHaveLength(0);
    await writeFile(join(f.dataRoot, "bp_template", "tool_toggles.json"), JSON.stringify({ search_papers_local: true }));
    await run("full"); expect(resultSets.at(-1)?.localPapers).toHaveLength(1);
  });

  it("does not initialize a PI or guess image capabilities while listing an uninitialized session", async () => {
    const f = await setup(defineWorkflow({ ...simple(), definition: { ...definition, requiredCapabilities: [...definition.requiredCapabilities, "images"] } }));
    await f.put(1, [definition.id]); const session = await f.create();
    const response = await f.app.request(`/sessions/${session.id}/workflows`);
    expect(response.status).toBe(200);
    const body = await response.json() as { definitions: Array<Record<string, unknown>> };
    expect(body.definitions[0]).toMatchObject({ id: definition.id, enabled: true });
    expect(body.definitions[0]).not.toHaveProperty("missingCapabilities");
    expect(body.definitions[0]).not.toHaveProperty("hostCapabilitiesSatisfied");
    expect(f.manager.listWorkflowDefinitions()[0]).not.toHaveProperty("hostCapabilitiesSatisfied");
    expect(f.captures).toEqual([]);
  });

  it("reports missing image capability through the actual Principal search tool and session route", async () => {
    const f = await setup(defineWorkflow({ ...simple(), definition: { ...definition, requiredCapabilities: [...definition.requiredCapabilities, "images"] } }), { modelInput: ["text"] });
    await f.put(1, [definition.id]); const session = await f.create(); const principal = await f.warm(session.id);
    const result = parseTool(await tool(principal, "workflow_search").execute({}));
    expect((result.workflows as unknown[])[0]).toMatchObject({ enabled: true, missingCapabilities: ["images"], hostCapabilitiesSatisfied: false });
    const response = await f.app.request(`/sessions/${session.id}/workflows`);
    expect(await response.json()).toMatchObject({ definitions: [{ missingCapabilities: ["images"], hostCapabilitiesSatisfied: false }] });
    expect(f.manager.listWorkflowRuns(session.id)).toEqual([]);
    await expect(f.manager.startWorkflow(session.id, { workflowId: definition.id, input: { count: 1 } })).rejects.toMatchObject({ code: "WORKFLOW_PREFLIGHT" });
    expect(f.captures.filter((params) => params.workflowModelBinding)).toEqual([]);
  });

  it("keeps host capabilities separate from scientific preconditions and the enable switch", async () => {
    const f = await setup(defineWorkflow({ ...simple(), definition: { ...definition, requiredCapabilities: [...definition.requiredCapabilities, "images"] },
      preflight: async () => [{ kind: "scientific", status: "unknown", message: "Required input metadata are missing." }],
    }), { modelInput: ["text", "image"] });
    await f.put(1, [definition.id]); const session = await f.create(); const principal = await f.warm(session.id);
    const entry = (parseTool(await tool(principal, "workflow_search").execute({})).workflows as Array<Record<string, unknown>>)[0]!;
    expect(entry).toMatchObject({ missingCapabilities: [], hostCapabilitiesSatisfied: true });
    expect(entry).not.toHaveProperty("ready"); expect(entry).not.toHaveProperty("runnable");
    await expect(f.manager.startWorkflow(session.id, { workflowId: definition.id, input: { count: 1 } })).rejects.toThrow("Required input metadata are missing");
    await f.put(2, []);
    const disabled = parseTool(await tool(principal, "workflow_search").execute({ includeDisabled: true }));
    expect((disabled.workflows as unknown[])[0]).toMatchObject({ enabled: false, missingCapabilities: [], hostCapabilitiesSatisfied: true });
    expect(f.manager.listWorkflowRuns(session.id)).toEqual([]);
  });

  it("omits capability conclusions when an initialized PI cannot expose its actual binding", async () => {
    const f = await setup(simple(), { bindingUnavailable: true });
    await f.put(1, [definition.id]); const session = await f.create(); const principal = await f.warm(session.id);
    const result = parseTool(await tool(principal, "workflow_search").execute({}));
    const entry = (result.workflows as Array<Record<string, unknown>>)[0]!;
    expect(entry).toMatchObject({ id: definition.id, enabled: true });
    expect(entry).not.toHaveProperty("missingCapabilities");
    expect(entry).not.toHaveProperty("hostCapabilitiesSatisfied");
  });

  it("persists revisioned availability, rejects conflicts, and ignores stale snapshots", async () => {
    const f = await setup(simple());
    const enabled = await f.put(3, [definition.id, definition.id]);
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ revision: 3, enabledWorkflowIds: [definition.id] });
    expect((await f.put(3, [])).status).toBe(409);
    const stale = await f.put(2, []);
    expect(stale.status).toBe(200);
    expect(await stale.json()).toEqual({ revision: 3, enabledWorkflowIds: [definition.id] });
    expect(JSON.parse(await readFile(join(f.dataRoot, "workflow-availability.json"), "utf8"))).toEqual({ revision: 3, enabledWorkflowIds: [definition.id] });
    const invalid = await f.app.request("/config/workflows", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ revision: -1, enabledWorkflowIds: [] }) });
    expect(invalid.status).toBe(400);
    await f.manager.shutdownAndSave();
    const restored = await setup(simple(), { dataRoot: f.dataRoot });
    expect(restored.manager.listWorkflowDefinitions()[0]?.enabled).toBe(true);
    expect((await restored.put(3, [])).status).toBe(409);
    expect((await restored.put(4, [])).status).toBe(200);
    expect(restored.manager.listWorkflowDefinitions()[0]?.enabled).toBe(false);
  });

  it("denies new work through cached tools, a new turn in the same session, and a new session", async () => {
    const f = await setup(simple()); await f.put(1, [definition.id]);
    const session = await f.create();
    const cachedPrincipal = await f.warm(session.id);
    const cachedSearch = tool(cachedPrincipal, "workflow_search");
    const cachedStart = tool(cachedPrincipal, "workflow_start");
    expect((parseTool(await cachedSearch.execute({})).workflows as unknown[])).toHaveLength(1);
    await f.put(2, []);
    expect(parseTool(await cachedSearch.execute({}))).toEqual({ workflows: [] });
    await expect(cachedStart.execute({ workflowId: definition.id, input: { count: 1 } })).rejects.toThrow(/disabled/i);
    const before = f.rawEvents.filter(({ event }) => event.type === "tool_execution_end").length;
    await f.manager.sendMessage(session.id, `[[tool:workflow_start ${JSON.stringify({ workflowId: definition.id, input: { count: 1 } })}]]`);
    await until(() => f.rawEvents.filter(({ event }) => event.type === "tool_execution_end").length > before);
    const outcome = f.rawEvents.filter(({ event }) => event.type === "tool_execution_end").at(-1)!.event;
    expect(outcome).toMatchObject({ toolName: "workflow_start", isError: true });
    expect(JSON.stringify(outcome)).toMatch(/disabled/i);
    const next = await f.create(); const nextPrincipal = await f.warm(next.id);
    await expect(tool(nextPrincipal, "workflow_start").execute({ workflowId: definition.id, input: { count: 1 } })).rejects.toThrow(/disabled/i);
    expect(f.manager.listWorkflowRuns(session.id)).toEqual([]);
    expect(f.manager.listWorkflowRuns(next.id)).toEqual([]);
    expect(f.captures.filter((params) => params.workflowModelBinding)).toEqual([]);
  });

  it("an accepted workflow qualifies as delegation, remains active across disable, and delivers once", async () => {
    const entered = deferred(); const release = deferred();
    const f = await setup(defineWorkflow({ definition, run: async (input, ctx) => {
      await ctx.runAgent({ stageId: "one", instructions: "Inspect synthetic table.", inputs: input, outputSchema: dataSchema, tools: [] });
      entered.resolve(); await release.promise;
      const data = await ctx.runAgent({ stageId: "two", instructions: "Summarize synthetic table.", inputs: input, outputSchema: dataSchema, tools: [] });
      return { summary: "Both synthetic stages completed.", artifacts: [], data };
    } }));
    await f.put(1, [definition.id]); const session = await f.create();
    await f.manager.sendMessage(session.id, `Analyze this dataset using the fixture. [[tool:workflow_start ${JSON.stringify({ workflowId: definition.id, input: { count: 1 } })}]]`);
    await entered.promise;
    await until(() => f.manager.getSessionState(session.id)?.runState.active === false);
    const [accepted] = f.manager.listWorkflowRuns(session.id);
    expect(accepted?.status).toBe("running");
    expect(f.principal(session.id).principalWorkflowGuard?.hasQualifyingDelegation()).toBe(true);
    expect(f.manager.getSessionState(session.id)?.workState.active).toBe(true);
    expect(f.manager.metrics().runningAgents).toBeGreaterThan(0);
    await f.put(2, []);
    expect(f.manager.listWorkflowRuns(session.id)[0]?.status).toBe("running");
    await expect(f.manager.startWorkflow(session.id, { workflowId: definition.id, input: { count: 1 }, idempotencyKey: "different-new-run" })).rejects.toThrow(/disabled/i);
    release.resolve();
    await until(() => f.manager.listWorkflowRuns(session.id)[0]?.status === "succeeded"
      && f.prompts.some((item) => item.text.includes("A previously accepted workflow has settled"))
      && f.manager.getSessionState(session.id)?.workState.active === false);
    expect(f.captures.filter((params) => params.workflowModelBinding)).toHaveLength(2);
    expect(f.captures.filter((params) => params.workflowModelBinding).every((params) => params.workflowModelBinding!.modelRuntime === f.opaque)).toBe(true);
    expect(f.prompts.filter((item) => item.text.includes("A previously accepted workflow has settled"))).toHaveLength(1);
    // Provenance: the delivery instruction must name the workflow's own artifacts
    // and keep any later revision distinguishable from what this workflow produced.
    const terminal = f.prompts.find((item) => item.text.includes("A previously accepted workflow has settled"))!.text;
    expect(terminal).toContain("original final artifacts using their actual returned paths");
    expect(terminal).toContain("declared issues or incomplete stages");
    expect(terminal).toContain("link both the original workflow outputs and the later revision");
    expect(terminal).toContain("later edits do not count as stages completed by this workflow");
    expect(terminal).toContain("Preserve the original workflow artifacts");
    expect(terminal).toContain("not a new user instruction");
    expect(terminal).toContain("do not restart the workflow automatically");
    expect(terminal).toContain(accepted!.id);
    const reply = await f.app.request(`/sessions/${session.id}/workflows`);
    expect(reply.status).toBe(200);
    expect(await reply.json()).toMatchObject({ definitions: [{ id: definition.id, enabled: false }], runs: [{ id: accepted!.id, status: "succeeded" }] });
    const total = f.manager.getSessionState(session.id)!.tokenUsage;
    const workflowUsage = Object.entries(total.byAgent).filter(([name]) => name.startsWith("workflow:"));
    expect(workflowUsage).toHaveLength(2);
    expect(workflowUsage.map(([, value]) => value.total)).toEqual([3, 3]);
  });

  it("a rejected preflight is not qualifying delegation and ordinary Q&A starts no workflow", async () => {
    const f = await setup(defineWorkflow({ ...simple(), preflight: async () => [{ kind: "scientific", status: "unknown", message: "Units were not supplied." }] }));
    await f.put(1, [definition.id]); const session = await f.create();
    await f.manager.sendMessage(session.id, "What is spike sorting?");
    await until(() => Boolean(f.principal(session.id)) && f.manager.getSessionState(session.id)?.workState.active === false);
    expect(f.manager.listWorkflowRuns(session.id)).toEqual([]);
    expect(f.principal(session.id).principalWorkflowGuard?.hasQualifyingDelegation()).toBe(false);
    const before = f.rawEvents.filter(({ event }) => event.type === "tool_execution_end").length;
    await f.manager.sendMessage(session.id, `Analyze this dataset. [[tool:workflow_start ${JSON.stringify({ workflowId: definition.id, input: { count: 1 } })}]]`);
    await until(() => f.rawEvents.filter(({ event }) => event.type === "tool_execution_end").length > before);
    expect(f.manager.listWorkflowRuns(session.id)).toEqual([]);
    expect(f.principal(session.id).principalWorkflowGuard?.hasQualifyingDelegation()).toBe(false);
  });

  it("durably queues a completed result while Principal delivery is paused, then delivers on the next user turn", async () => {
    const entered = deferred(); const release = deferred();
    const f = await setup(defineWorkflow({ definition, run: async (input) => {
      entered.resolve(); await release.promise;
      return { summary: "Finished while delivery was paused.", artifacts: [], data: input };
    } }));
    await f.put(1, [definition.id]); const session = await f.create(); await f.warm(session.id);
    const accepted = await f.manager.startWorkflow(session.id, { workflowId: definition.id, input: { count: 1 }, idempotencyKey: "paused-delivery" });
    await entered.promise;
    const entry = (f.manager as unknown as { sessions: Map<string, { taskLedger: TaskLedger }> }).sessions.get(session.id)!;
    // Models can exhaust a previous task-result delivery while independent work
    // continues. Pausing delivery is not cancelling that accepted workflow.
    await entry.taskLedger.pauseAgent("principal");
    release.resolve();
    await until(() => f.manager.listWorkflowRuns(session.id)[0]?.status === "succeeded"
      && f.manager.getSessionState(session.id)?.workState.active === false);
    expect(entry.taskLedger.peekBatch("principal")).toHaveLength(1);
    expect(entry.taskLedger.peekBatch("principal")[0]?.content).toContain(accepted.id);
    expect(f.prompts.filter((item) => item.text.includes("A previously accepted workflow has settled"))).toEqual([]);
    await f.manager.sendMessage(session.id, "Please continue with the available result.");
    await until(() => f.prompts.some((item) => item.text.includes("A previously accepted workflow has settled"))
      && f.manager.getSessionState(session.id)?.workState.active === false);
    expect(f.manager.listWorkflowRuns(session.id)).toHaveLength(1);
    expect(f.prompts.filter((item) => item.text.includes("A previously accepted workflow has settled"))).toHaveLength(1);
  });

  it("reconciles a persisted terminal result after a crash before ledger enqueue, without rerunning or duplicate delivery", async () => {
    const f = await setup(simple()); await f.put(1, [definition.id]);
    const session = await f.create(); await f.warm(session.id);
    const accepted = await f.manager.startWorkflow(session.id, { workflowId: definition.id, input: { count: 1 }, idempotencyKey: "crash-boundary" });
    await until(() => f.manager.listWorkflowRuns(session.id)[0]?.status === "succeeded"
      && f.prompts.some((item) => item.text.includes("A previously accepted workflow has settled"))
      && f.manager.getSessionState(session.id)?.workState.active === false);
    await f.manager.shutdownAndSave();
    const path = join(f.dataRoot, ".bp", session.id, "tasks.json");
    const ledger = JSON.parse(await readFile(path, "utf8"));
    const key = `workflow:${accepted.id}:terminal`;
    // This is the durable shape at the real two-file crash boundary: run result
    // committed, but its once-only notification not committed to the task ledger.
    ledger.system_keys = (ledger.system_keys ?? []).filter((value: string) => value !== key);
    ledger.notifications = ledger.notifications.filter((value: { content: string }) => !value.content.includes(accepted.id));
    await writeFile(path, JSON.stringify(ledger));

    const restored = await setup(simple(), { dataRoot: f.dataRoot });
    await restored.manager.restoreFromDisk();
    expect(restored.manager.listWorkflowRuns(session.id)[0]).toMatchObject({ id: accepted.id, status: "succeeded" });
    // Restoration may queue first; an explicit turn must also reconcile before
    // declaring the task done, and must never execute this workflow again.
    await until(() => restored.manager.getSessionState(session.id)?.workState.active === false);
    await restored.manager.sendMessage(session.id, "Show the available completed result.");
    await until(() => restored.prompts.some((item) => item.text.includes("A previously accepted workflow has settled"))
      && restored.manager.getSessionState(session.id)?.workState.active === false);
    await restored.manager.restoreFromDisk();
    await restored.manager.sendMessage(session.id, "Thank you.");
    await until(() => restored.manager.getSessionState(session.id)?.workState.active === false);
    expect(restored.manager.listWorkflowRuns(session.id)).toHaveLength(1);
    expect(restored.captures.filter((params) => params.workflowModelBinding)).toEqual([]);
    expect(restored.prompts.filter((item) => item.text.includes("A previously accepted workflow has settled"))).toHaveLength(1);
    const saved = JSON.parse(await readFile(path, "utf8"));
    expect(saved.system_keys.filter((value: string) => value === key)).toHaveLength(1);
  });

  it("session Stop cancels a real stage owner and does not redeliver or automatically rerun it", async () => {
    const f = await setup(defineWorkflow({ definition, run: async (input, ctx) => {
      const data = await ctx.runAgent({ stageId: "blocking", instructions: "Wait for the controlled fixture.", inputs: input, outputSchema: dataSchema, tools: [] });
      return { summary: "Must not finish after Stop.", artifacts: [], data };
    } }), { blockStage: true });
    await f.put(1, [definition.id]); const session = await f.create();
    await f.manager.sendMessage(session.id, `[[tool:workflow_start ${JSON.stringify({ workflowId: definition.id, input: { count: 1 } })}]]`);
    await f.stageStarted.promise;
    expect(f.manager.getSessionState(session.id)?.workState.active).toBe(true);
    const response = await f.app.request(`/sessions/${session.id}/interrupt`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ interrupted: true });
    expect(f.manager.listWorkflowRuns(session.id)[0]).toMatchObject({ status: "cancelled", artifacts: [] });
    expect(f.stageControls[0]).toMatchObject({ aborts: 1, disposed: true });
    expect(f.manager.getSessionState(session.id)?.workState.active).toBe(false);
    await f.manager.sendMessage(session.id, "What completed before I stopped it?");
    await until(() => f.manager.getSessionState(session.id)?.workState.active === false);
    expect(f.manager.listWorkflowRuns(session.id)).toHaveLength(1);
    expect(f.prompts.filter((item) => item.text.includes("A previously accepted workflow has settled"))).toEqual([]);
    expect(f.captures.filter((params) => params.workflowModelBinding)).toHaveLength(1);
  });

  it("keeps workflow tools scoped to the Principal instead of exposing nested starts to experts", async () => {
    const f = await setup(simple()); const session = await f.create();
    await f.warm(session.id);
    await f.manager.ensureAgent(session.id, "engineer");
    const principalNames = f.principal(session.id).systemTools.map((item) => item.name);
    expect(principalNames).toEqual(expect.arrayContaining(["workflow_search", "workflow_start", "workflow_get", "workflow_cancel"]));
    const expert = f.captures.find((params) => params.agentName === "engineer")!;
    expect(expert.systemTools.map((item) => item.name)).not.toContain("workflow_start");
    expect((await f.app.request("/sessions/unknown/workflows")).status).toBe(404);
  });
});

describe("workflow terminal notification ledger", () => {
  it("deduplicates concurrent enqueue, acknowledgement, and restored delivery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-terminal-ledger-")); dirs.push(dir);
    const path = join(dir, "tasks.json"); const ledger = new TaskLedger("session", path);
    const attempts = await Promise.all([1, 2, 3].map(() => ledger.enqueueSystemOnce("wf:one:terminal", "principal", "result one")));
    expect(attempts.filter(Boolean)).toHaveLength(1);
    const pending = ledger.peekBatch("principal"); expect(pending).toHaveLength(1);
    await ledger.acknowledge(pending.map((item) => item.id));
    expect(await ledger.enqueueSystemOnce("wf:one:terminal", "principal", "duplicate result")).toBe(false);
    const restored = new TaskLedger("session", path); await restored.recover();
    expect(await restored.enqueueSystemOnce("wf:one:terminal", "principal", "duplicate after restart")).toBe(false);
    expect(restored.peekBatch("principal")).toEqual([]);
    expect(await restored.enqueueSystemOnce("wf:two:terminal", "principal", "result two")).toBe(true);
    expect(restored.peekBatch("principal")).toHaveLength(1);
  });

  it("rolls back a dedupe key when its persistence fails and rejects corrupt stored keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "workflow-terminal-failure-")); dirs.push(dir);
    const parent = join(dir, "blocked"); await writeFile(parent, "a file blocks mkdir");
    const path = join(parent, "tasks.json"); const ledger = new TaskLedger("session", path);
    await expect(ledger.enqueueSystemOnce("wf:one:terminal", "principal", "result")).rejects.toThrow();
    expect(ledger.peekBatch("principal")).toEqual([]);
    await rm(parent); await mkdir(parent);
    expect(await ledger.enqueueSystemOnce("wf:one:terminal", "principal", "result")).toBe(true);
    const stored = JSON.parse(await readFile(path, "utf8")); stored.system_keys = [17];
    await writeFile(path, JSON.stringify(stored));
    await expect(new TaskLedger("session", path).recover()).rejects.toBeInstanceOf(TaskLedgerCorruptError);
  });
});
