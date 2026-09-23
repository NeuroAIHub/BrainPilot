#!/usr/bin/env node
/**
 * TEST ONLY — Linux/208 loopback fixture for real HTTP/UI execution-state wiring.
 * No model calls, model routing, literature search, or manuscript writing occur.
 *
 * Run after building the workspace ON 208, using a NEW task-owned directory:
 *   node scripts/workflow-ui-fixture-server.mjs --output /tmp/bp-workflow-ui-<unique>
 * The caller may background this process and stop its recorded PID afterwards.
 * Backend: 127.0.0.1:19332; runtime: 127.0.0.1:19333. Existing ports are never killed.
 */
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

if (process.platform !== "linux") throw new Error("TEST ONLY: run this UI fixture on the designated Linux/208 host, never locally.");
const args = process.argv.slice(2);
if (args.length !== 2 || !["--output", "--resume"].includes(args[0]) || !args[1]) {
  throw new Error("Usage: node scripts/workflow-ui-fixture-server.mjs --output <NEW-directory> | --resume <this-fixture-directory>");
}
const output = resolve(args[1]);
const resuming = args[0] === "--resume";
if (!resuming) await mkdir(output, { recursive: false, mode: 0o700 });
const ownerPath = join(output, "fixture-owner.json");
const owner = resuming ? JSON.parse(await readFile(ownerPath, "utf8"))
  : { kind: "brainpilot-workflow-control-fixture-v1", output, token: randomUUID() };
if (owner.kind !== "brainpilot-workflow-control-fixture-v1" || owner.output !== output || typeof owner.token !== "string") {
  throw new Error("Resume requires this script's exact task-owned fixture directory");
}
if (!resuming) await writeFile(ownerPath, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataRoot = join(output, "data");
if (!resuming) await mkdir(dataRoot, { mode: 0o700 });
const BACKEND_PORT = 19332;
const RUNTIME_PORT = 19333;
const backendUrl = `http://127.0.0.1:${BACKEND_PORT}`;
const runtimeUrl = `http://127.0.0.1:${RUNTIME_PORT}`;
const pluginId = "org.brainpilot.paperorchestra";
const fixtureBoundary = "TEST ONLY: real backend/runtime/WorkflowHost state and Stop wiring; synthetic AgentSessions; no model routing, provider call, or writing-quality evidence.";
const fixtureEnv = {
  BP_LOCAL_MODE: "1", BP_ORCHESTRATOR: "static", BP_RUNTIME_URL: runtimeUrl,
  BP_DATA_DIR: dataRoot, BP_MOCK: "1", BP_KB_ROOT: join(output, "knowledge-base"),
  PI_CODING_AGENT_DIR: join(output, "pi-agent"),
};
// The backend's provider bootstrap receives this isolated configuration, not
// the shell's provider credentials. The runtime uses the injected factory.
Object.assign(process.env, fixtureEnv);
await writeFile(join(output, "README.txt"), `${fixtureBoundary}\n\n${backendUrl}\n${runtimeUrl}\nThis directory is disposable fixture data. No existing project or production service is used.\n`, "utf8");

const { serve } = await import("@hono/node-server");
const { SessionManager } = await import("../packages/runtime/dist/session-manager.js");
const { createServer } = await import("../packages/runtime/dist/server.js");
const { MockAgentSession } = await import("../packages/runtime/dist/mock-agent.js");
const { defineWorkflow } = await import("../packages/plugin-sdk/dist/workflow.js");
const { startServer: startBackend } = await import("../packages/backend-core/dist/server.js");
const { StaticRuntimeOrchestrator } = await import("../packages/backend-core/dist/static-orchestrator.js");

const definition = {
  schemaVersion: 1, id: "paper-writing", version: "0.1.0",
  title: "[TEST FIXTURE] Workflow Stop wiring",
  description: fixtureBoundary,
  applicableWhen: ["The designated tester explicitly runs this isolated UI fixture."],
  notApplicableWhen: ["Any real writing, scientific, or model-routing task."],
  requiredCapabilities: ["agent", "writeArtifact"], resume: false,
  inputSchema: { type: "object", additionalProperties: false, required: ["fixture"], properties: { fixture: { const: true } } },
  outputSchema: { type: "object", additionalProperties: false, required: ["fixture"], properties: { fixture: { const: true } } },
};
const workflow = defineWorkflow({ definition, run: async (input, ctx) => {
  const artifacts = [await ctx.writeArtifact({ path: "retained-note.txt", content: "TEST FIXTURE: committed before Stop; preserve this material.\n", mediaType: "text/plain", role: "test-material" })];
  for (const stageId of ["hold-1", "hold-2"]) {
    await ctx.runAgent({ stageId, instructions: fixtureBoundary, inputs: input, outputSchema: definition.outputSchema, tools: [] });
    artifacts.push(await ctx.writeArtifact({ path: `${stageId}-finished.txt`, content: `${stageId} completed through a real host-validated submit_result.\n`, mediaType: "text/plain", role: "test-material" }));
  }
  artifacts.push(await ctx.writeArtifact({ path: "fixture-result.txt", content: "TEST FIXTURE RESULT: both accepted stages completed; this is not a scientific manuscript.\n", mediaType: "text/plain", role: "result" }));
  return { summary: "TEST FIXTURE RESULT: two controlled stages completed.", artifacts, data: input };
} });
const modelBinding = {
  model: { id: "fixture-no-model-call", provider: "fixture-only", api: "openai-completions", input: ["text"] },
  modelRuntime: { fixtureOnly: true }, thinkingLevel: "off",
};
const stageDiagnostics = [];
const stageControls = new Map();
let logQueue = Promise.resolve();
function record(value) {
  logQueue = logQueue.then(() => appendFile(join(output, "fixture-events.jsonl"), JSON.stringify({ pid: process.pid, time: Date.now(), ...value }) + "\n"));
  return logQueue;
}
const agentFactory = async (params) => {
  if (!params.workflowModelBinding) {
    const cfg = { sessionId: params.sessionId, agentName: params.agentName, systemTools: params.systemTools };
    const session = new MockAgentSession(cfg);
    const prompt = session.prompt.bind(session);
    session.prompt = async (text, opts) => {
      const terminal = text.includes("A previously accepted workflow has settled");
      const settledRunId = terminal ? /"runId":"([^"]+)"/.exec(text)?.[1] : undefined;
      cfg.scriptText = terminal ? `TEST FIXTURE RESULT DELIVERY ${settledRunId}: saved workflow artifacts are available in the session files.` : "TEST FIXTURE: scripted Principal turn; no model routing claim.";
      await record({ kind: "principal-prompt", sessionId: params.sessionId, agentName: params.agentName, terminal, runId: settledRunId, text });
      return prompt(text, opts);
    };
    session.subscribe(event => {
      if (event.type === "tool_execution_end") void record({ kind: "tool-result", sessionId: params.sessionId, toolName: event.toolName, result: event.result, isError: event.isError });
    });
    session.getWorkflowModelBinding = () => modelBinding;
    return session;
  }
  const listeners = new Set();
  let streaming = false;
  let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  let pending;
  const [, ownedRunId, stageId] = /^workflow-(wf_[^:]+):([^:]+):/.exec(params.agentName) ?? [];
  if (!ownedRunId || !stageId || params.workflowModelBinding.modelRuntime !== modelBinding.modelRuntime) throw new Error("Fixture stage identity or frozen binding mismatch");
  const diagnostic = { sessionId: params.sessionId, runId: ownedRunId, stageId, agentName: params.agentName, started: false, aborted: false, disposed: false, submitted: false };
  stageDiagnostics.push(diagnostic);
  stageControls.set(`${ownedRunId}:${stageId}`, () => release("complete"));
  return {
    sessionId: params.sessionId,
    get isStreaming() { return streaming; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async prompt() {
      streaming = true; diagnostic.started = true;
      pending = (async () => {
        await record({ kind: "stage-start", ...diagnostic });
        const outcome = await gate;
        if (outcome === "complete" && !diagnostic.aborted) {
          const submit = params.systemTools.find(tool => tool.name === "submit_result");
          if (!submit) throw new Error("Real host submit_result tool is missing");
          await submit.execute({ result: { fixture: true } });
          diagnostic.submitted = true;
        }
        for (const listener of listeners) listener({ type: "message_end", message: {
          role: "assistant", stopReason: diagnostic.aborted ? "aborted" : "stop",
          usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0 },
        } });
      })();
      try { await pending; } finally { streaming = false; }
    },
    setThinkingLevel() {},
    async abort() { diagnostic.aborted = true; release("abort"); await pending; },
    dispose() { diagnostic.disposed = true; stageControls.delete(`${ownedRunId}:${stageId}`); void record({ kind: "stage-dispose", ...diagnostic }); },
  };
};

const manager = new SessionManager({
  dataRoot, persist: true, agentFactory, workflowImplementations: [workflow],
  // One waiting stage plus a Principal turn exercises cached-tool admission
  // while work is active; capacity=1 would test scheduler queuing instead.
  maxConcurrentAgents: 2, memLimitBytes: null, workflowStageTimeoutMs: 15 * 60_000,
});
let runtimeServer;
let backend;
let sessionId;
let runId;
let stopPromise;
let expiry;

function ready(server) {
  if (server.listening) return Promise.resolve();
  return new Promise((resolveReady, reject) => {
    const onError = (error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolveReady(); };
    server.once("error", onError); server.once("listening", onListening);
  });
}
async function request(path, method = "GET", body) {
  const response = await fetch(`${backendUrl}${path}`, {
    method, signal: AbortSignal.timeout(10_000),
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Fixture ${method} ${path} failed (${response.status}): ${text.slice(0, 1000)}`);
  return text ? JSON.parse(text) : null;
}
async function waitFor(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Fixture did not reach ${label}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}
async function closeRuntime() {
  if (!runtimeServer) return;
  const server = runtimeServer;
  await new Promise((resolveClose) => {
    server.close(() => resolveClose());
    server.closeIdleConnections?.(); server.closeAllConnections?.();
  });
}
function stop(reason) {
  if (stopPromise) return stopPromise;
  stopPromise = (async () => {
    clearTimeout(expiry);
    await Promise.all([manager.shutdownAndSave(), backend?.stop()]);
    await writeFile(join(output, "fixture-final.json"), JSON.stringify({
      testOnly: true, reason, sessionId, runId,
      state: sessionId ? manager.getSessionState(sessionId) : undefined,
      runs: sessionId ? manager.listWorkflowRuns(sessionId) : [], stageDiagnostics,
    }, null, 2));
    await closeRuntime();
    await logQueue;
  })();
  return stopPromise;
}

try {
  await manager.ensurePersistentLayout();
  if (resuming) await manager.restoreFromDisk();
  const { app } = createServer({ manager, instanceId: `workflow-ui-fixture-${randomUUID()}` });
  // TEST CONTROL ONLY: these routes do not exist in product servers. The latch
  // changes only the injected mock AgentSession; real host submission, workflow
  // state, HTTP controls and durable terminal delivery run normally afterwards.
  app.use("/__fixture/*", async (c, next) => {
    if (c.req.header("x-fixture-token") !== owner.token) return c.json({ error: "fixture token required" }, 403);
    await next();
  });
  app.get("/__fixture/diagnostics", async c => {
    await logQueue;
    return c.json({ testOnly: true, pid: process.pid, stageDiagnostics, events: (await readFile(join(output, "fixture-events.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) });
  });
  app.post("/__fixture/release/:runId/:stageId", c => {
    const releaseStage = stageControls.get(`${c.req.param("runId")}:${c.req.param("stageId")}`);
    if (!releaseStage) return c.json({ error: "fixture stage is not waiting" }, 409);
    releaseStage();
    return c.json({ testOnly: true, effect: "release mocked model response only" });
  });
  runtimeServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: RUNTIME_PORT });
  await ready(runtimeServer);
  const priorSignals = new Map(["SIGINT", "SIGTERM"].map((signal) => [signal, new Set(process.listeners(signal))]));
  backend = await startBackend({
    port: BACKEND_PORT, hostname: "127.0.0.1", mode: "static",
    // Only this newly-created, dedicated fixture has a known single-user scope.
    // Production StaticRuntimeOrchestrator must remain undeclared/fail-closed.
    orchestrator: Object.assign(new StaticRuntimeOrchestrator({ baseUrl: runtimeUrl, healthTimeoutMs: 5_000 }), {
      workflowSettingsScope: "single-user",
    }),
    dataDir: dataRoot, serveWeb: true, webRoot: join(checkout, "packages", "web", "dist"),
    eager: true, env: fixtureEnv, kbManagementEnabled: false,
  });
  // startBackend normally owns process exit. This test harness owns two servers
  // and must save/cancel the runtime before exiting, so replace only its newly
  // installed signal handlers with one coordinated cleanup handler.
  for (const signal of ["SIGINT", "SIGTERM"]) {
    for (const handler of process.listeners(signal)) {
      if (!priorSignals.get(signal).has(handler)) process.removeListener(signal, handler);
    }
    process.once(signal, () => { void stop(signal).then(() => process.exit(0), (error) => { console.error(error); process.exit(1); }); });
  }
  await ready(backend.server);
  await request("/api/sessions"); // Establish the real backend/runtime sync connection.
  if (!resuming) {
    await request("/api/plugins/install", "POST", { id: pluginId });
    await request(`/api/plugins/${pluginId}/enabled`, "PUT", { enabled: true });
    if (!manager.listWorkflowDefinitions().find((item) => item.id === definition.id)?.enabled) throw new Error("Real plugin API did not enable the fixture implementation in the runtime");
    const session = await request("/api/sessions", "POST", { title: "[TEST FIXTURE] Workflow controls — no model", domainResources: "base", thinkingLevel: "off" });
    sessionId = session.id;
    await request(`/api/sessions/${sessionId}/messages`, "POST", { content: 'TEST FIXTURE inspect catalog. [[tool:workflow_search {}]]' });
    await waitFor(() => manager.getSessionState(sessionId)?.workState.active === false, "idle Principal");
    await request(`/api/sessions/${sessionId}/messages`, "POST", { content: 'TEST FIXTURE scripted selection. [[tool:workflow_start {"workflowId":"paper-writing","input":{"fixture":true}}]]' });
    await waitFor(() => manager.listWorkflowRuns(sessionId).length === 1 && stageDiagnostics.some(item => item.started)
      && manager.getSessionState(sessionId)?.runState.active === false && manager.getSessionState(sessionId)?.workState.active === true, "PI idle with Workflow running");
    runId = manager.listWorkflowRuns(sessionId)[0].id;
    const state = await request(`/api/sessions/${sessionId}/state`);
    if (state.runState.active || !state.workState.active) throw new Error("Backend proxy did not expose the expected real runtime state");
  } else {
    const previous = JSON.parse(await readFile(join(output, "fixture-ready.json"), "utf8"));
    sessionId = previous.sessionId; runId = previous.runId;
  }
  const manifest = {
    status: "ready", testOnly: true, fixtureBoundary, pid: process.pid, output, resuming,
    backendUrl, runtimeUrl, sessionId, runId, pluginId,
    stateUrl: `${backendUrl}/api/sessions/${sessionId}/state`,
    workflowStateUrl: `${backendUrl}/api/sessions/${sessionId}/workflows`,
    pluginToggleUrl: `${backendUrl}/api/plugins/${pluginId}/enabled`,
    sessionInterruptUrl: `${backendUrl}/api/sessions/${sessionId}/interrupt`,
    expected: resuming ? { restored: true } : { principalActive: false, aggregateWorkActive: true, workflowStatus: "running" },
    maximumLifetimeMinutes: 30,
  };
  await writeFile(join(output, "fixture-ready.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest));
  expiry = setTimeout(() => { void stop("fixture-expired").then(() => process.exit(0), () => process.exit(1)); }, 30 * 60_000);
  expiry.unref();
} catch (error) {
  console.error(`[workflow-ui-fixture] ${error instanceof Error ? error.message : String(error)}`);
  await stop("startup-failed").catch((cleanupError) => console.error(cleanupError));
  process.exitCode = 1;
}
