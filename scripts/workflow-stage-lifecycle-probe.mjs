#!/usr/bin/env node
/**
 * Real-transport verification for the workflow stage lifecycle.
 *
 * This runs the ACTUAL `realAgentFactory`, `WorkflowHost` and installed Pi SDK
 * against a loopback HTTP fixture that speaks Anthropic SSE. No provider
 * credential, no user/project configuration and no Internet access is used: the
 * only model is a synthetic local `stage-probe` entry resolved through the
 * production per-session provider path (`resolveSessionModel`, reached by giving
 * `realAgentFactory` a `providerConfig`) with an explicit fixture API key.
 *
 * What it can show: a stage's deadline or its parent Stop closes a real HTTP
 * response, the stage issues exactly the requests its delivery contract needs
 * (one, or two when a rejected delivery is corrected), no request is retried
 * after the fence, no partial tool-call JSON is ever accepted, and the process
 * exits.
 * What it cannot show: anything about a real provider, a real model's behaviour,
 * or scientific quality. Negative cases NEVER receive a fabricated valid end of
 * message, and a socket this probe had to destroy itself is never counted as a
 * released transport.
 *
 *   node scripts/workflow-stage-lifecycle-probe.mjs --output /absolute/NEW-dir
 *   node scripts/workflow-stage-lifecycle-probe.mjs --output /absolute/NEW-dir --case success
 *
 * Without `--case` all five cases run, each in its own child process (so natural
 * exit is observable per case) under `<output>/<case>/`.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

const CASES = ["success", "idle-noEOF", "active-partialJSON-noEOF", "parent-stop", "delivery-correction"];
/** Cases that must end in a succeeded run; each has its own expected final text. */
const SUCCESSFUL_CASES = new Map([["success", "complete"], ["delivery-correction", "complete-after-correction"]]);
const BOUNDARY = "Loopback transport lifecycle diagnostic for native workflow stages: no provider credential, no Internet request, no model or scientific validation.";
/** Finite stage deadline under test. */
const STAGE_TIMEOUT_MS = 1500;
/** Bounded wait for third-party teardown after a stage is fenced. */
const CLEANUP_GRACE_MS = 1000;
/** Per-case in-process watchdog: writes a failed report and cleans the owned fixture. */
const WATCHDOG_MS = 12_000;
/** Parent's own bound per child; a killed child is always a failed case. */
const CHILD_LIMIT_MS = 20_000;
/** The lifecycle's deadline starts when the stage lifecycle is constructed, which
 *  is marginally before the first observable stamp (the stage factory call). */
const DEADLINE_TOLERANCE_MS = 300;
/** Slack allowed on top of the cleanup grace for teardown + bookkeeping. */
const TEARDOWN_SLACK_MS = 2000;
const PROVIDER_ID = "fixture";
const MODEL_ID = "stage-probe";
const FIXTURE_KEY = "fixture-only";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(process.argv[i]?.startsWith("--") && process.argv[i + 1], "Expected --name value arguments.");
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
for (const name of args.keys()) assert(["output", "case"].includes(name), "Unknown argument: " + name);
assert(process.platform === "linux", "Run this transport probe on the isolated 208 Linux checkout.");
const output = args.get("output");
assert(isAbsolute(output ?? ""), "--output must be an absolute path to a NEW directory.");
const probeCase = args.get("case") ?? "all";
assert(probeCase === "all" || CASES.includes(probeCase), "--case must be one of: " + CASES.join(", "));
const limits = { stageTimeoutMs: STAGE_TIMEOUT_MS, cleanupGraceMs: CLEANUP_GRACE_MS, watchdogMs: WATCHDOG_MS,
  childLimitMs: CHILD_LIMIT_MS, deadlineToleranceMs: DEADLINE_TOLERANCE_MS, teardownSlackMs: TEARDOWN_SLACK_MS };
const redact = (value) => String(value).split(FIXTURE_KEY).join("[REDACTED]");

if (probeCase === "all") await runAllCases();
else await runOneCase();

/* ------------------------------- parent mode ------------------------------- */

async function runAllCases() {
  await mkdir(output, { recursive: false, mode: 0o700 });
  const script = fileURLToPath(import.meta.url);
  const started = Date.now();
  const cases = [];
  for (const name of CASES) {
    const caseOutput = join(output, name);
    const child = spawn(process.execPath, [script, "--output", caseOutput, "--case", name], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", killedByParent = false;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const at = Date.now();
    const timer = setTimeout(() => { killedByParent = true; child.kill("SIGKILL"); }, CHILD_LIMIT_MS);
    const [code, signal] = await new Promise((done) => child.once("exit", (...values) => done(values)));
    clearTimeout(timer);
    let evidence;
    try { evidence = JSON.parse(await readFile(join(caseOutput, "report.json"), "utf8")); }
    catch (error) { evidence = { result: "failed", error: "report.json unreadable: " + redact(error.message) }; }
    // A case only passes when its own checks passed AND its process ended by
    // itself: a killed child proves the opposite of what this probe verifies.
    const naturalExit = !killedByParent && signal === null;
    cases.push({ case: name, elapsedMs: Date.now() - at, childExitCode: code, childSignal: signal, killedByParent,
      naturalExit, stdoutTail: redact(stdout).slice(-1000), stderrTail: redact(stderr).slice(-2000),
      reportPath: join(caseOutput, "report.json"), evidence,
      result: naturalExit && code === 0 && evidence.result === "passed" ? "passed" : "failed" });
  }
  const summary = { kind: "workflow-stage-transport-probe", boundary: BOUNDARY, transport: "loopback-http-sse (127.0.0.1)",
    startedAt: new Date(started).toISOString(), elapsedMs: Date.now() - started, limits, cases,
    claims: { provesLoopbackHttpCancellation: true, provesRemoteProviderBehaviour: false, providerCredentialsUsed: false,
      modelBehaviourValidated: false, scientificValidation: false },
    result: cases.every((item) => item.result === "passed") ? "passed" : "failed" };
  await writeFile(join(output, "report.json"), JSON.stringify(summary, null, 2) + "\n", { mode: 0o600 });
  process.exitCode = summary.result === "passed" ? 0 : 2;
  console.log(JSON.stringify({ output, result: summary.result,
    cases: cases.map((item) => ({ case: item.case, result: item.result, elapsedMs: item.elapsedMs, naturalExit: item.naturalExit })) }));
}

/* -------------------------------- case mode -------------------------------- */

async function runOneCase() {
  const t0 = Date.now();
  const at = () => Date.now() - t0;
  await mkdir(output, { recursive: false, mode: 0o700 });
  const agentDir = join(output, "pi-agent");
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  // Isolation first: every path the runtime or Pi may write to lives under
  // --output, and no ambient provider credential or model override survives.
  Object.assign(process.env, {
    BP_DATA_DIR: join(output, "data"),
    BP_KB_ROOT: join(output, "knowledge-base"),
    PI_CODING_AGENT_DIR: agentDir,
    PI_CODING_AGENT_SESSION_DIR: join(output, "pi-sessions"),
    [`BP_PROVIDER_${PROVIDER_ID.toUpperCase()}`]: FIXTURE_KEY,
  });
  for (const name of ["BP_MOCK", "BP_SHARED_DIR", "BP_LOCAL_MODE", "BP_MODELS_JSON", "BP_MODEL_PROVIDER",
    "BP_MODEL_INPUT_MODALITIES", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL",
    "OPENAI_API_KEY", "OPENAI_BASE_URL"]) delete process.env[name];

  const diagnostics = [];
  const originalWarn = console.warn;
  // Lifecycle cleanup warnings are evidence; they are kept in the report rather
  // than echoed, so no provider payload reaches this process's stderr.
  console.warn = (...items) => {
    if (diagnostics.length >= 50) return;
    diagnostics.push(redact(items.map((item) => typeof item === "string" ? item : inspect(item, { depth: 2 })).join(" ")).slice(0, 400));
  };

  const frames = {};
  const requests = [];
  const responses = [];
  const sockets = new Set();
  let fixtureError;
  let host, principal, terminal, fatal, cancelPromise;
  let runAgentCalls = 0, stageFactoryCalls = 0, stagePrompts = 0, principalPrompts = 0;
  let submitAttempts = 0, submitAccepted = 0, submitRejected = 0, retries = 0, foreignFetchAttempts = 0;
  let watchdogFired = false;
  /** First stage prompt text, captured before the real prompt runs, so the fixture can
   *  check the correction request still carries it. Never written to the report. */
  let firstStagePromptText = null;
  /** Literal first-turn assistant payload the correction case must still see echoed back. */
  const REJECTED_DELIVERY_JSON = '{"result":{"text":"plaintext-not-accepted"}}';
  const usage = [], messages = [];
  const timing = { hostStartAt: null, stageFactoryAt: null, stagePromptAt: null, stageAbortAt: null,
    cancelRequestedAt: null, runFinishedAt: null };

  /** Parent Stop, invoked only once the fixture has a real request in flight. */
  async function requestParentStop() {
    if (timing.cancelRequestedAt !== null) return;
    timing.cancelRequestedAt = at();
    cancelPromise = host?.manager.cancelAll();
    await cancelPromise?.catch(() => {});
  }

  const server = createServer((request, response) => {
    void handleFixtureRequest(request, response).catch((error) => { fixtureError = redact(error.message); });
  });
  server.on("connection", (socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const baseUrl = `${origin}/v1`;

  async function handleFixtureRequest(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = undefined; }
    const number = requests.length + 1;
    // Flattened only to derive the two booleans below; the text itself never leaves this scope.
    const conversationText = (Array.isArray(body?.messages) ? body.messages : [])
      .flatMap((message) => typeof message?.content === "string" ? [message.content]
        : Array.isArray(message?.content)
          ? message.content.filter((part) => typeof part?.text === "string").map((part) => part.text)
          : [])
      .join("\n");
    // Request metadata only: no header values (no key), no message text.
    const record = { number, at: at(), method: request.method, path: new URL(request.url, origin).pathname,
      model: typeof body?.model === "string" ? body.model : null, stream: body?.stream === true,
      toolNames: Array.isArray(body?.tools) ? body.tools.map((tool) => typeof tool?.name === "string" ? tool.name : "?") : [],
      messageCount: Array.isArray(body?.messages) ? body.messages.length : 0,
      // Context preservation across a delivery correction, as booleans only.
      retainsOriginalStagePrompt: typeof firstStagePromptText === "string" && firstStagePromptText.length > 0
        && conversationText.includes(firstStagePromptText),
      retainsRejectedDeliveryPayload: conversationText.includes(REJECTED_DELIVERY_JSON),
      bodyBytes: chunks.reduce((total, chunk) => total + chunk.length, 0),
      headerNames: Object.keys(request.headers).sort(),
      hasAuthHeader: Boolean(request.headers["x-api-key"] || request.headers.authorization) };
    requests.push(record);
    const tracked = { number, arrivedAt: record.at, closedAt: null, endedByFixture: false, clientAborted: null,
      framesSent: 0, keepalives: 0, rejected: false };
    responses.push(tracked);
    if (record.method !== "POST" || record.path !== "/v1/messages" || !record.stream) {
      tracked.rejected = true;
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "fixture accepts streaming POST /v1/messages only" } }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (type, data) => {
      if (response.writableEnded || response.destroyed) return;
      frames[type] = (frames[type] ?? 0) + 1;
      tracked.framesSent++;
      response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    };
    let timer;
    response.on("close", () => {
      if (timer) clearInterval(timer);
      tracked.closedAt = at();
      tracked.endedByFixture = response.writableEnded === true;
      tracked.clientAborted = response.writableEnded !== true;
    });
    send("message_start", { message: { id: `msg_fixture_${number}`, type: "message", role: "assistant", model: MODEL_ID,
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 7, output_tokens: 0 } } });
    if (probeCase === "delivery-correction" && number === 1) {
      // A well-formed message that answers in plain text instead of calling the
      // submission tool: the stream completes, but no submission exists.
      send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index: 0, delta: { type: "text_delta", text: '{"result":{"text":"plaintext-not-accepted"}}' } });
      send("content_block_stop", { index: 0 });
      send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 17 } });
      send("message_stop", {});
      response.end();
      return;
    }
    if (probeCase === "success" || probeCase === "delivery-correction") {
      const text = probeCase === "delivery-correction" ? "complete-after-correction" : "complete";
      send("content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_fixture_${number}`, name: "submit_result", input: {} } });
      send("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ result: { text } }) } });
      send("content_block_stop", { index: 0 });
      send("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 19 } });
      send("message_stop", {});
      response.end();
      return;
    }
    if (probeCase === "active-partialJSON-noEOF") {
      // An open tool_use block whose arguments never become valid JSON, and
      // neither the block nor the message ever stops: no submission exists.
      send("content_block_start", { index: 0, content_block: { type: "tool_use", id: `toolu_fixture_${number}`, name: "submit_result", input: {} } });
      send("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: '{"result":{"text":"' } });
      timer = setInterval(() => { send("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: "partial" } }); }, 100);
    } else if (probeCase === "parent-stop") {
      send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      timer = setInterval(() => { send("content_block_delta", { index: 0, delta: { type: "text_delta", text: "fixture stream" } }); }, 100);
      if (number === 1) setTimeout(() => { void requestParentStop(); }, 200).unref();
    } else {
      // idle-noEOF: an opened message that never produces another event or EOF.
      timer = setInterval(() => {
        if (response.writableEnded || response.destroyed) return;
        tracked.keepalives++;
        response.write(": fixture keepalive\n\n");
      }, 100);
    }
    timer?.unref?.();
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.origin !== origin) {
      foreignFetchAttempts++;
      throw new Error("This probe permits loopback fixture requests only.");
    }
    return originalFetch(input, init);
  };

  async function hardStop() {
    try { await host?.manager.cancelAll(); } catch { /* the run status records it */ }
    for (const socket of sockets) socket.destroy();
  }
  const watchdog = setTimeout(() => { watchdogFired = true; void hardStop(); }, WATCHDOG_MS);

  try {
    const { realAgentFactory } = await import("../packages/runtime/dist/agent-factory.js");
    const { WorkflowHost } = await import("../packages/runtime/dist/workflows/host.js");
    const { defineWorkflow } = await import("@brainpilot/plugin-sdk/workflow");
    const pi = await import("@earendil-works/pi-coding-agent");
    assert.equal(resolve(pi.getAgentDir()), resolve(agentDir), "Pi must use this probe's isolated agent dir.");

    const sessionId = "stage-transport-probe";
    const principalDir = join(output, "principal");
    await mkdir(principalDir, { recursive: true, mode: 0o700 });
    // The synthetic model + opaque ModelRuntime are built by the production
    // per-session path (resolveSessionModel) inside the real factory, so the
    // stage below runs on a binding captured exactly as a real session's is.
    // This session is never prompted; it only carries the binding.
    principal = await realAgentFactory({
      sessionId, agentName: "principal", role: "principal", cwd: principalDir,
      historyPath: join(principalDir, "history.jsonl"), systemTools: [], allowedToolNames: [], skillPaths: [],
      suppressCoordinationHooks: true, systemPrompt: "Binding capture only; this session is never prompted.",
      thinkingLevel: "off",
      providerConfig: { providerId: PROVIDER_ID, baseUrl, api: "anthropic-messages", apiKey: FIXTURE_KEY, modelId: MODEL_ID },
    });
    principal.prompt = async () => { principalPrompts++; throw new Error("This probe never prompts the binding-capture session."); };
    const binding = principal.getWorkflowModelBinding();
    assert.equal(binding.model.id, MODEL_ID, "The captured binding must be the synthetic fixture model.");
    assert.equal(binding.model.provider, PROVIDER_ID);
    assert.equal(binding.model.api, "anthropic-messages");
    assert(binding.modelRuntime, "The captured binding must carry the opaque ModelRuntime.");

    const outputSchema = { type: "object", additionalProperties: false, required: ["text"],
      properties: { text: { type: "string", minLength: 1 } } };
    const inputs = { instruction: 'call submit_result({"result":{"text":"complete"}})' };
    const implementation = defineWorkflow({
      definition: { schemaVersion: 1, id: "stage-transport-probe", version: "0.1.0",
        title: "Stage transport lifecycle probe", description: BOUNDARY,
        applicableWhen: ["An operator runs the stage transport lifecycle probe."],
        notApplicableWhen: ["Any product workflow run."],
        requiredCapabilities: ["agent"], inputSchema: true, outputSchema, resume: false },
      run: async (_input, ctx) => {
        runAgentCalls++;
        const data = await ctx.runAgent({ stageId: "stage", instructions: 'Fixture stage. Call submit_result({"result":{"text":"complete"}}) and nothing else.',
          inputs, outputSchema, tools: [] });
        return { summary: "Fixture stage submitted a result.", data, artifacts: [] };
      },
    });

    const workspaceDir = join(output, "workspace");
    await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
    host = new WorkflowHost({
      sessionId, workspaceDir, stateDir: join(output, "stage-state"), persist: false,
      implementations: () => [implementation], isEnabled: () => true, captureBinding: async () => binding,
      runWithCapacity: async (fn, signal) => { signal.throwIfAborted(); return fn(); },
      stageTimeoutMs: STAGE_TIMEOUT_MS, stageCleanupGraceMs: CLEANUP_GRACE_MS,
      onUsage: (stageId, value) => { usage.push({ stageId, usage: value }); },
      onChanged: () => {},
      onTerminal: async () => {}, // No Principal outbox: this is not a product run.
      agentFactory: async (params) => {
        stageFactoryCalls++;
        timing.stageFactoryAt ??= at();
        assert.equal(params.workflowModelBinding.modelRuntime, binding.modelRuntime, "The stage must reuse the captured ModelRuntime.");
        assert.equal(params.workflowModelBinding.model.id, MODEL_ID);
        assert(params.workflowStageCancellation, "The host must hand the stage its own cancellation.");
        assert.deepEqual(params.allowedToolNames, ["submit_result"], "Stages get submit_result only: no broad tools or skills.");
        assert.deepEqual(params.systemTools.map((tool) => tool.name), ["submit_result"]);
        assert.deepEqual(params.skillPaths, []);
        const systemTools = params.systemTools.map((tool) => ({ ...tool, execute: async (value, options) => {
          submitAttempts++;
          try {
            const result = await tool.execute(value, options);
            if (!result.isError) submitAccepted++;
            return result;
          } catch (error) { submitRejected++; throw error; }
        } }));
        const stage = await realAgentFactory({ ...params, systemTools });
        const unsubscribe = stage.subscribe((piEvent) => {
          if (piEvent.type === "auto_retry_start") retries++;
          if (piEvent.type !== "message_end") return;
          const message = piEvent.message;
          if (message?.role !== "assistant") return;
          // Metadata only: never the model's text or the provider's payload.
          messages.push({ at: at(), stopReason: message.stopReason ?? null, errorPresent: Boolean(message.errorMessage),
            toolNames: (message.content ?? []).filter((part) => part.type === "toolCall").map((part) => part.name) });
        });
        const prompt = stage.prompt.bind(stage), abort = stage.abort.bind(stage), dispose = stage.dispose.bind(stage);
        stage.prompt = async (text, promptOptions) => {
          stagePrompts++; timing.stagePromptAt ??= at();
          if (firstStagePromptText === null && typeof text === "string") firstStagePromptText = text;
          return prompt(text, promptOptions);
        };
        // The lifecycle aborts the session right after it fences, so this is the
        // closest observable stamp for the fence itself.
        stage.abort = async () => { timing.stageAbortAt ??= at(); return abort(); };
        stage.dispose = () => { unsubscribe(); dispose(); };
        return stage;
      },
    });

    timing.hostStartAt = at();
    const run = await host.start({ workflowId: implementation.definition.id, input: {}, idempotencyKey: randomUUID() });
    await host.manager.wait(run.id);
    timing.runFinishedAt = at();
    await cancelPromise?.catch(() => {});
    const record = host.manager.get(run.id);
    terminal = { id: record.id, status: record.status, artifacts: record.artifacts.length,
      ...(record.error ? { error: redact(record.error).slice(0, 400) } : {}),
      ...(SUCCESSFUL_CASES.has(probeCase) ? { data: record.result?.data } : {}) };
  } catch (error) {
    fatal = redact(error?.stack ?? String(error)).slice(0, 2000);
  }

  clearTimeout(watchdog);
  try { await host?.manager.cancelAll(); } catch { /* recorded through the run status */ }
  try { principal?.dispose(); } catch { /* best effort */ }
  // Measured BEFORE this probe touches any socket: a response still open here
  // was not released by the stage, and destroying it is not a pass.
  const openResponsesAtCleanup = responses.filter((item) => item.closedAt === null).length;
  const openSocketsAtCleanup = sockets.size;
  server.closeAllConnections?.();
  await new Promise((done) => server.close(() => done()));
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;

  const first = requests[0];
  const closedAt = responses[0]?.closedAt ?? null;
  const signatures = new Set(requests.map((item) =>
    JSON.stringify({ method: item.method, path: item.path, model: item.model, stream: item.stream, toolNames: item.toolNames })));
  const requestsAfterFence = timing.stageAbortAt === null ? 0 : requests.filter((item) => item.at > timing.stageAbortAt).length;
  const deadlineFloor = timing.stageFactoryAt === null ? null : timing.stageFactoryAt + STAGE_TIMEOUT_MS - DEADLINE_TOLERANCE_MS;
  const deadlineCeiling = timing.stageFactoryAt === null ? null : timing.stageFactoryAt + STAGE_TIMEOUT_MS + CLEANUP_GRACE_MS + TEARDOWN_SLACK_MS;
  const cleanupIncomplete = /cleanup incomplete|may still be open|did not stop within/.test(
    (terminal?.error ?? "") + " " + diagnostics.join(" "));
  const checks = {
    noFatalError: !fatal,
    noFixtureError: !fixtureError,
    watchdogDidNotFire: !watchdogFired,
    ...(probeCase === "delivery-correction"
      // A rejected delivery is re-prompted on the same stage: two requests and two
      // stage prompts, still one stage and one agent run.
      ? { oneStageTwoRequests: requests.length === 2 && stageFactoryCalls === 1 && stagePrompts === 2 && runAgentCalls === 1 }
      : { oneStageOneRequest: requests.length === 1 && stageFactoryCalls === 1 && stagePrompts === 1 && runAgentCalls === 1 }),
    requestReachedFixtureEndpoint: Boolean(first && first.method === "POST" && first.path === "/v1/messages" && first.stream === true),
    requestUsedFixtureModel: first?.model === MODEL_ID,
    onlySubmitResultOffered: JSON.stringify(first?.toolNames ?? []) === JSON.stringify(["submit_result"]),
    unchangedRequestSource: signatures.size === 1,
    noRequestAfterFence: requestsAfterFence === 0,
    noProviderRetry: retries === 0,
    noForeignNetwork: foreignFetchAttempts === 0,
    principalNeverPrompted: principalPrompts === 0,
    transportReleasedWithoutForce: closedAt !== null && openResponsesAtCleanup === 0 && !watchdogFired,
    // Establishes cleanup and HTTP termination only; this probe does not exercise a real
    // capacity semaphore, so it says nothing about provider-semaphore release.
    cleanupComplete: !cleanupIncomplete,
  };
  if (SUCCESSFUL_CASES.has(probeCase)) Object.assign(checks, {
    runSucceeded: terminal?.status === "succeeded",
    oneAcceptedSubmission: submitAccepted === 1 && submitAttempts === 1 && submitRejected === 0,
    // The correction case expects its own final text, so request 1's plaintext
    // cannot pass itself off as the stage's output.
    resultMatchesFixture: terminal?.data?.text === SUCCESSFUL_CASES.get(probeCase),
    noDuplicateDownstreamResult: messages.filter((item) => item.toolNames.includes("submit_result")).length === 1,
    fixtureCompletedTheMessage: responses.length > 0 && responses.every((item) => item.endedByFixture === true),
    allResponsesClosedWithoutForce: responses.length > 0 && responses.every((item) => item.closedAt !== null),
    noArtifacts: terminal?.artifacts === 0,
    ...(probeCase === "delivery-correction" ? {
      // The re-prompt must carry the original stage prompt and the rejected
      // delivery back to the model, not start a fresh conversation.
      correctionRetainedStagePrompt: requests[1]?.retainsOriginalStagePrompt === true,
      correctionRetainedRejectedDelivery: requests[1]?.retainsRejectedDeliveryPayload === true,
    } : {}),
  });
  else if (probeCase === "parent-stop") Object.assign(checks, {
    stopRequestedAfterRequestArrived: timing.cancelRequestedAt !== null && first !== undefined && timing.cancelRequestedAt >= first.at,
    runCancelled: terminal?.status === "cancelled",
    noAcceptedSubmission: submitAccepted === 0,
    fixtureNeverEndedTheMessage: responses[0]?.endedByFixture === false,
    responseClosedByClient: responses[0]?.clientAborted === true,
    closedAfterStop: closedAt !== null && timing.cancelRequestedAt !== null
      && closedAt >= timing.cancelRequestedAt && closedAt <= timing.cancelRequestedAt + CLEANUP_GRACE_MS + TEARDOWN_SLACK_MS,
    // Stop, not the deadline, ended this stage.
    closedBeforeStageDeadline: closedAt !== null && timing.hostStartAt !== null && closedAt < timing.hostStartAt + STAGE_TIMEOUT_MS,
  });
  else Object.assign(checks, {
    runFailed: terminal?.status === "failed",
    failedOnStageDeadline: /exceeded its time limit/.test(terminal?.error ?? ""),
    noAcceptedSubmission: submitAccepted === 0,
    fixtureNeverEndedTheMessage: responses[0]?.endedByFixture === false,
    responseClosedByClient: responses[0]?.clientAborted === true,
    closedAfterStageDeadline: closedAt !== null && deadlineFloor !== null && closedAt >= deadlineFloor,
    closedWithinCleanupGrace: closedAt !== null && deadlineCeiling !== null && closedAt <= deadlineCeiling,
    runFinishedAfterTransportClosed: timing.runFinishedAt !== null && closedAt !== null
      && timing.runFinishedAt >= closedAt && timing.runFinishedAt <= closedAt + CLEANUP_GRACE_MS + TEARDOWN_SLACK_MS,
  });

  const report = {
    kind: "workflow-stage-transport-probe", case: probeCase, boundary: BOUNDARY,
    transport: "loopback-http-sse (127.0.0.1)", startedAt: new Date(t0).toISOString(), elapsedMs: at(), limits,
    counts: { providerRequests: requests.length, requestsAfterFence, retries, runAgentCalls, stageFactoryCalls,
      stagePrompts, principalPrompts, submitAttempts, submitAccepted, submitRejected, foreignFetchAttempts,
      distinctRequestSignatures: signatures.size, openResponsesAtCleanup, openSocketsAtCleanup, sseFramesSent: frames },
    boundaries: { stageDeadlineFloorMs: deadlineFloor, stageDeadlineCeilingMs: deadlineCeiling,
      closedAfterRequestMs: closedAt !== null && first ? closedAt - first.at : null,
      closedAfterStageFactoryMs: closedAt !== null && timing.stageFactoryAt !== null ? closedAt - timing.stageFactoryAt : null,
      closedAfterStopMs: closedAt !== null && timing.cancelRequestedAt !== null ? closedAt - timing.cancelRequestedAt : null },
    timing: { ...timing, requestArrivedAt: first?.at ?? null, responseClosedAt: closedAt, watchdogFired },
    requests, responses, messages, usage, diagnostics,
    run: terminal ?? null, fixtureError: fixtureError ?? null, error: fatal ?? null, checks,
    claims: { provesLoopbackHttpCancellation: true, provesRemoteProviderBehaviour: false, providerCredentialsUsed: false,
      modelBehaviourValidated: false, scientificValidation: false,
      note: "Fabricated end-of-message events are sent in the completed fixtures only (success, delivery-correction); a socket destroyed by this probe is never counted as released." },
    result: Object.values(checks).every(Boolean) ? "passed" : "failed",
  };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  process.exitCode = report.result === "passed" ? 0 : 2;
  console.log(JSON.stringify({ output, case: probeCase, result: report.result, elapsedMs: report.elapsedMs,
    providerRequests: requests.length, submitAccepted, runStatus: terminal?.status ?? null,
    failedChecks: Object.entries(checks).filter(([, value]) => !value).map(([name]) => name) }));
}
