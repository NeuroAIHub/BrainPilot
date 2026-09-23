#!/usr/bin/env node
/** A single saved-input refinement diagnostic, not workflow resume or acceptance.
 * Default --mode prepare performs no provider calls. --mode run permits at most
 * one actual provider fetch, using the ordinary Principal's captured Pi binding.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { installDriverStopControl } from "./workflow-driver-stop-control.mjs";
import { observeProviderStream, providerRequestMetadata } from "./workflow-stream-observer.mjs";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(process.argv[i]?.startsWith("--") && process.argv[i + 1], "Expected --name value arguments.");
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
for (const name of args.keys()) assert(["source-study", "output", "mode", "provider-env", "thinking-level", "tool-choice", "timeout-ms"].includes(name), "Unknown argument: " + name);
assert(process.platform === "linux", "Use the isolated 208 Linux test checkout.");
assert(isAbsolute(args.get("source-study") ?? "") && isAbsolute(args.get("output") ?? ""), "--source-study and --output must be absolute paths.");
const sourceStudy = resolve(args.get("source-study")), output = resolve(args.get("output"));
const mode = args.get("mode") ?? "prepare";
assert(["prepare", "run"].includes(mode), "--mode must be prepare or run.");
const thinkingLevel = args.get("thinking-level") ?? "low";
assert(["low", "off"].includes(thinkingLevel), "This diagnostic only supports the saved low binding or an explicit off comparison.");
// Optional wire diagnostic only: "auto" keeps the current request untouched.
const toolChoiceArg = args.get("tool-choice") ?? "auto";
assert(["auto", "required"].includes(toolChoiceArg), "--tool-choice must be auto or required.");
const toolChoiceDiagnostic = toolChoiceArg === "required";
assert(!toolChoiceDiagnostic || thinkingLevel === "off", "--tool-choice required requires --thinking-level off.");
// Operator-facing observation window. The default stays at the saved 360000 ms; the
// same value still bounds the single admitted provider request, so widening the
// diagnostic window widens the stage window by exactly that amount and nothing else.
// The ceiling allows up to 40 min so an observed slow generation can run to a result
// here; the production refinement deadline is unchanged.
const timeoutMsArg = args.get("timeout-ms") ?? "360000";
assert(/^[0-9]+$/u.test(timeoutMsArg), "--timeout-ms must be a positive integer.");
const deadlineMs = Number(timeoutMsArg);
assert(deadlineMs >= 10_000 && deadlineMs <= 2_400_000, "--timeout-ms must be between 10000 and 2400000.");
assert(!output.startsWith(sourceStudy + "/") && output !== sourceStudy, "Never write into original study evidence.");
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(output, { recursive: false, mode: 0o700 });
const started = Date.now(), hash = value => createHash("sha256").update(value).digest("hex");
const boundary = "Single refinement candidate from saved synthetic-study inputs; no Principal prompt, routing, full workflow, resume, compilation, new review, or scientific validation.";
const controller = new AbortController();
let manager, host, sessionId, runId, binding, principalSession, report, timer, heartbeat, stopReason, storageError;
let providerRequests = 0, blockedRequests = 0, stagePrompts = 0, principalPrompts = 0, submissions = 0;
let secretValues = [], writes = Promise.resolve(), stopPromise;
const usage = [], messages = [], stageSessions = new Set(), streamObservers = new Set();
const redact = value => secretValues.reduce((result, secret) => {
  for (const form of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) result = result.split(form).join("[REDACTED]");
  return result;
}, String(value));
const stringify = value => redact(JSON.stringify(value));
function save(name, value, append = false) {
  const content = stringify(value) + "\n";
  const task = writes.then(async () => {
    if (append) return appendFile(join(output, name), content, { mode: 0o600 });
    const temporary = join(output, "." + name + ".tmp");
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, join(output, name));
  });
  writes = task.catch(error => { storageError = redact(error.message); });
  return task;
}
const event = value => save("events.ndjson", { at: new Date().toISOString(), ...value }, true);
function snapshot() {
  return { boundary, mode, elapsedMs: Date.now() - started, stopReason, sessionId, runId,
    providerRequests, blockedRequests, stagePrompts, principalPrompts, submissions, usage, messages,
    run: runId ? host?.manager.get(runId) : undefined, storageError };
}
async function stop(reason) {
  if (stopPromise) return stopPromise;
  stopReason = reason;
  stopPromise = (async () => {
    // Fence the Host run before aborting HTTP, so transport cancellation cannot
    // race ahead and persist a model failure for an operator Stop.
    const cancelRun = host?.manager.cancelAll();
    controller.abort(new Error(reason));
    await event({ type: "stop_requested", reason });
    await save("report.json", { ...snapshot(), result: "interrupted", evidence: "partial", productFailure: false });
    await cancelRun;
  })();
  return stopPromise;
}
const stopControl = installDriverStopControl({ stopFile: join(output, "STOP"), onStop: stop,
  onError: error => { void event({ type: "stop_error", error: redact(error.message) }); } });
timer = setTimeout(() => { void stop("overall_deadline"); }, deadlineMs);
const originalFetch = globalThis.fetch;
const originalConsole = Object.fromEntries(["log", "info", "warn", "error", "debug"].map(name => [name, console[name].bind(console)]));
for (const name of Object.keys(originalConsole)) console[name] = (...items) => originalConsole[name](...items.map(item =>
  redact(typeof item === "string" ? item : inspect(item, { depth: 5, maxArrayLength: 30 }))));

try {
  const manifestBytes = await readFile(join(sourceStudy, "manifest.json"));
  const sourceManifest = JSON.parse(manifestBytes);
  const stagesBytes = await readFile(join(sourceStudy, "stages.json"));
  const stages = JSON.parse(stagesBytes);
  const selected = stages.filter(stage => stage.stageId === "attempt-1-refinement-1");
  assert.equal(selected.length, 1, "Expected one saved initial refinement request.");
  const sourceStage = selected[0];
  const status = JSON.parse(await readFile(join(sourceStudy, "status.json"), "utf8"));
  const originalStageId = sourceStage.agent.replace(/^workflow-/, "");
  const originalRunId = originalStageId.split(":")[0];
  const historyPath = join(sourceStudy, "data/.bp", status.sessionId, "workflow-stages", originalRunId, hash(originalStageId).slice(0, 16), "history.jsonl");
  const historyBytes = await readFile(historyPath);
  const history = historyBytes.toString("utf8").trim().split("\n").map(JSON.parse);
  const users = history.filter(row => row.message?.role === "user");
  assert.equal(users.length, 1, "Do not silently choose among several saved turns.");
  const content = users[0].message.content;
  assert.equal(content.filter(part => part.type === "text").length, 1);
  const originalText = content.find(part => part.type === "text").text;
  const originalInput = JSON.parse(originalText);
  assert.equal(originalInput.version, "v1");
  assert.equal(typeof originalInput.prompt, "string");
  // Two saved-input shapes exist. Older studies kept the material redundantly in
  // top-level fields alongside the prompt; current studies are already deduplicated
  // to {prompt, version}. Accept either, but never accept losing material silently.
  const legacyFields = ["current_latex", "reviewer_feedback", "citation_map"];
  const includedLegacyFields = legacyFields.filter(name => Object.hasOwn(originalInput, name));
  const sourceShape = includedLegacyFields.length === legacyFields.length
    ? "legacy_redundant_fields"
    : includedLegacyFields.length === 0 ? "deduplicated_prompt_only" : "partial_legacy_fields";
  assert.notEqual(sourceShape, "partial_legacy_fields", "Refuse a partially deduplicated saved input: " + includedLegacyFields.join(", "));
  if (sourceShape === "legacy_redundant_fields") {
    for (const name of legacyFields) {
      const rendered = name === "current_latex" ? originalInput[name] : JSON.stringify(originalInput[name], null, 2);
      assert(originalInput.prompt.includes(rendered), "Refuse lossy deduplication: " + name);
    }
  }
  const inputs = { prompt: originalInput.prompt, version: originalInput.version };
  const imageParts = content.filter(part => part.type === "image");
  assert.equal(imageParts.length, 6, "This diagnostic must preserve the six original pages.");
  const imageEvidence = imageParts.map((part, index) => {
    assert.equal(part.mimeType, "image/png");
    const bytes = Buffer.from(part.data, "base64");
    assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    return { index: index + 1, bytes: bytes.length, sha256: hash(bytes), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  });
  const recordedModel = history.find(row => row.type === "model_change");
  assert.equal(recordedModel.modelId, "kimi-k3");
  // The saved source run may have been recorded with thinking low or off; record what
  // the source actually used instead of assuming, while the probe binding stays low/off.
  const recordedThinking = history.find(row => row.type === "thinking_level_change")?.thinkingLevel;
  assert(["low", "off"].includes(recordedThinking), "Unexpected saved source thinking level: " + recordedThinking);
  const credentialReference = args.get("provider-env") ?? sourceManifest.credentialReference;
  const env = {};
  for (const line of (await readFile(credentialReference, "utf8")).split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  const apiKey = env.SQZ_API_KEY || env.CUSTOM_API_KEY || env.ANTHROPIC_API_KEY;
  const baseUrl = env.CUSTOM_BASE_URL || env.ANTHROPIC_BASE_URL;
  const api = env.BP_API || env.CUSTOM_API || "anthropic-messages";
  assert(apiKey && baseUrl, "Provider credential reference is incomplete.");
  secretValues = [apiKey].filter(Boolean);
  const preflight = JSON.parse(await readFile(sourceManifest.preflightPath, "utf8"));
  assert.equal(preflight.modelId, recordedModel.modelId);
  assert.equal(preflight.endpointHash, hash(baseUrl));
  assert.equal(preflight.protocol, api);
  for (const capability of ["text", "tool", "image"]) assert.equal(preflight[capability]?.status, "passed");
  const dataRoot = join(output, "data");
  Object.assign(process.env, { BP_LOCAL_MODE: "1", BP_DATA_DIR: dataRoot, BP_KB_ROOT: join(output, "knowledge-base"),
    PI_CODING_AGENT_DIR: join(output, "pi-agent"), PI_CODING_AGENT_SESSION_DIR: join(output, "pi-sessions"), BP_WORKFLOW_PROBE_API_KEY: apiKey });
  delete process.env.BP_MOCK; delete process.env.BP_SHARED_DIR;
  // No provider call may occur while loading/initializing runtimes or preparing.
  let requestAdmission = false;
  globalThis.fetch = async (request, init) => {
    const url = new URL(typeof request === "string" || request instanceof URL ? request : request.url);
    if (mode !== "run" || !requestAdmission || url.origin !== new URL(baseUrl).origin || providerRequests >= 1 || controller.signal.aborted) {
      blockedRequests++;
      void event({ type: "fetch_blocked", reason: providerRequests >= 1 ? "one_request_budget" : "not_admitted", origin: url.origin });
      if (requestAdmission) void stop("request_budget_or_network_boundary");
      throw new Error("Probe permits one provider request and no other network calls.");
    }
    providerRequests++;
    let body; try { body = JSON.parse(init?.body ?? "{}"); } catch { /* metadata only */ }
    assert.equal(body?.model, "kimi-k3", "Provider model differs from saved run.");
    // Wire-only diagnostic option: with --tool-choice required the single admitted
    // request forces the stage's submit_result tool, so a stalled refinement can be
    // attributed to tool selection rather than to transport. Default "auto" is a no-op.
    let requestInit = init;
    if (toolChoiceDiagnostic) {
      assert.equal(api, "anthropic-messages", "Forced tool choice requires the Anthropic messages protocol.");
      assert.equal(thinkingLevel, "off", "Forced tool choice diagnostic requires --thinking-level off.");
      assert(!body?.thinking || body.thinking.type === "disabled", "Forced tool choice diagnostic requires thinking disabled on the wire.");
      assert.deepEqual((body?.tools ?? []).map(tool => tool.name ?? tool.function?.name), ["submit_result"],
        "Forced tool choice requires submit_result as the only available tool.");
      body = { ...body, tool_choice: { type: "tool", name: "submit_result" } };
      requestInit = { ...init, body: JSON.stringify(body) };
    }
    // Metadata is recorded from the body as sent, after any tool_choice addition.
    await event({ type: "provider_request", number: providerRequests, ...providerRequestMetadata(body),
      requestChars: typeof requestInit?.body === "string" ? requestInit.body.length : undefined,
      forcedToolChoice: toolChoiceDiagnostic ? { type: "tool", name: "submit_result" } : undefined,
      toolNames: (body?.tools ?? []).map(tool => tool.name ?? tool.function?.name) });
    const signals = [controller.signal, init?.signal, request instanceof Request ? request.signal : undefined].filter(Boolean);
    const effectiveSignal = AbortSignal.any(signals);
    const response = await originalFetch(request, { ...requestInit, signal: effectiveSignal, redirect: "error" });
    await event({ type: "provider_response", number: providerRequests, status: response.status });
    if (body?.stream) {
      const observing = observeProviderStream(response, body, record => save("provider-streams.ndjson", record, true), { signal: effectiveSignal });
      streamObservers.add(observing);
      void observing.finally(() => streamObservers.delete(observing)).catch(() => {});
    }
    return response;
  };
  const { refinementInstructions, adaptRefinementInput } = await import("../packages/runtime/dist/workflows/prompts/paper-writing.js");
  const { refinementSchema } = await import("../packages/runtime/dist/workflows/paper-writing.js");
  assert(refinementSchema, "Build the updated runtime before using the exported production schema.");
  // Use the current production response envelope on the preserved saved material.
  // The upstream code-fence directive is the only changed user-prompt text.
  inputs.prompt = adaptRefinementInput(originalInput.prompt);
  const currentStageInstructionHash = hash(refinementInstructions + "\n\nReturn this stage's result with submit_result. Successful submission completes the stage.");
  const provenance = { boundary, mode, createdAt: new Date().toISOString(), sourceStudy, historyPath,
    originalRunId, originalSessionId: status.sessionId, sourceStageId: sourceStage.stageId, credentialReference,
    modelId: recordedModel.modelId, providerId: recordedModel.provider, thinkingLevel, sourceThinkingLevel: recordedThinking, thinkingComparison: thinkingLevel !== recordedThinking, protocol: api, endpointHash: hash(baseUrl),
    preflightPath: sourceManifest.preflightPath, deadlineMs, providerRequestLimit: 1,
    sourceShape, includedLegacyFields,
    // Explicit wire diagnostic, not product behavior: "auto" means the saved request was
    // sent unchanged; "required" forced tool_choice on the single admitted request only.
    toolChoiceDiagnostic: { requested: toolChoiceArg, applied: toolChoiceDiagnostic,
      toolChoice: toolChoiceDiagnostic ? { type: "tool", name: "submit_result" } : "auto",
      note: "Test-wrapper request payload only. Not an SDK or production change, and not acceptance of refinement quality." },
    responseEnvelopeAdaptation: "Current native submit_result envelope replaces only the saved code-fence response directive; all manuscript/review inputs and six page images remain intact.",
    sourceStageInstructionHash: sourceStage.instructionHash, currentStageInstructionHash,
    // Material hashes are omitted when the saved input carries no separate field to hash:
    // the deduplicated prompt already contains that material and is never rewritten.
    hashes: { sourceManifest: hash(manifestBytes), sourceStages: hash(stagesBytes), originalHistory: hash(historyBytes),
      originalInput: hash(originalText), reducedInput: hash(JSON.stringify(inputs)), prompt: hash(inputs.prompt),
      originalLatex: Object.hasOwn(originalInput, "current_latex") ? hash(originalInput.current_latex) : null,
      originalReview: Object.hasOwn(originalInput, "reviewer_feedback") ? hash(JSON.stringify(originalInput.reviewer_feedback)) : null,
      instructions: hash(refinementInstructions), outputSchema: hash(JSON.stringify(refinementSchema)),
      productionSource: hash(await readFile(join(checkout, "packages/runtime/src/workflows/paper-writing.ts"))) },
    originalInputChars: originalText.length, reducedInputChars: JSON.stringify(inputs).length, images: imageEvidence };
  await save("manifest.json", provenance);
  await save("inputs.json", inputs);
  if (mode === "prepare") {
    report = { ...snapshot(), result: "prepared", originalEvidenceUnchanged: hash(await readFile(historyPath)) === provenance.hashes.originalHistory };
  } else {
    await mkdir(join(dataRoot, "bp_template"), { recursive: true, mode: 0o700 });
    await writeFile(join(dataRoot, "bp_template/providers.json"), JSON.stringify({ selectedProfileId: recordedModel.provider, profiles: [{
      id: recordedModel.provider, baseUrl, api, apiKeyEnv: "BP_WORKFLOW_PROBE_API_KEY", models: [recordedModel.modelId],
      reasoningModels: [recordedModel.modelId], contextWindow: 200_000, inputModalities: { [recordedModel.modelId]: ["text", "image"] },
    }] }), { mode: 0o600 });
    const { SessionManager } = await import("../packages/runtime/dist/session-manager.js");
    const { realAgentFactory } = await import("../packages/runtime/dist/agent-factory.js");
    const { WorkflowHost } = await import("../packages/runtime/dist/workflows/host.js");
    const { defineWorkflow } = await import("@brainpilot/plugin-sdk/workflow");
    const pi = await import("@earendil-works/pi-coding-agent");
    assert.equal(resolve(pi.getAgentDir()), resolve(process.env.PI_CODING_AGENT_DIR));
    manager = new SessionManager({ dataRoot, persist: true, memLimitBytes: null, maxConcurrentAgents: 1,
      agentFactory: async params => {
        assert.equal(params.agentName, "principal", "Only the ordinary Principal may be initialized by SessionManager.");
        const session = await realAgentFactory(params);
        principalSession = session;
        session.prompt = async () => { principalPrompts++; throw new Error("Stage-only probe must never prompt the Principal."); };
        return session;
      } });
    const session = await manager.createSession({ title: "Research writing study", providerId: recordedModel.provider,
      modelId: recordedModel.modelId, domainResources: "base", thinkingLevel });
    sessionId = session.id;
    const principal = await manager.ensureAgent(sessionId, "principal");
    binding = principal.getWorkflowModelBinding();
    assert.equal(binding.model.id, recordedModel.modelId); assert.equal(binding.model.provider, recordedModel.provider);
    assert.equal(binding.thinkingLevel, thinkingLevel); assert.equal(binding.model.api, api); assert(binding.model.input.includes("image"));
    const workspace = join(dataRoot, "workspaces", sessionId);
    await mkdir(join(workspace, "saved-pages"), { mode: 0o700 });
    const images = [];
    for (let i = 0; i < imageParts.length; i++) {
      const path = "saved-pages/page-" + (i + 1) + ".png";
      const bytes = Buffer.from(imageParts[i].data, "base64");
      await writeFile(join(workspace, path), bytes, { mode: 0o600, flag: "wx" });
      assert.equal(hash(await readFile(join(workspace, path))), imageEvidence[i].sha256);
      images.push(path);
    }
    const implementation = defineWorkflow({ definition: { schemaVersion: 1, id: "paper-refinement-probe", version: "0.1.0",
      title: "Saved-input refinement diagnostic", description: boundary, applicableWhen: ["Operator requests this diagnostic."],
      notApplicableWhen: ["Ordinary user workflow execution or resume."], requiredCapabilities: ["agent", "images", "writeArtifact"],
      inputSchema: true, outputSchema: refinementSchema, resume: false },
      run: async (_input, ctx) => {
        const result = await ctx.runAgent({ stageId: "refinement-1", instructions: refinementInstructions, inputs,
          outputSchema: refinementSchema, tools: [], images });
        if (!result.latex.trim()) return { summary: "The model submitted no refinement candidate.", data: result, artifacts: [] };
        const artifacts = [await ctx.writeArtifact({ path: "candidate.tex", content: result.latex, mediaType: "application/x-tex", role: "refinement-candidate" }),
          await ctx.writeArtifact({ path: "candidate-worklog.json", content: JSON.stringify(result.worklog, null, 2) + "\n", mediaType: "application/json", role: "refinement-worklog" })];
        return { summary: "One candidate generated; no compile or scientific evaluation performed.", data: result, artifacts };
      } });
    host = new WorkflowHost({ sessionId, workspaceDir: workspace, stateDir: join(output, "stage-state"), persist: true,
      implementations: () => [implementation], isEnabled: () => true, captureBinding: async () => binding,
      runWithCapacity: async (fn, signal) => { signal.throwIfAborted(); return fn(); }, stageTimeoutMs: deadlineMs,
      onUsage: (stageId, value) => { usage.push({ stageId, usage: value }); },
      onChanged: () => {}, onTerminal: async () => {}, // No Principal outbox: this is not a product workflow run.
      agentFactory: async params => {
        assert.equal(params.workflowModelBinding.modelRuntime, binding.modelRuntime);
        assert.deepEqual(params.workflowModelBinding.model, binding.model);
        assert.equal(params.workflowModelBinding.thinkingLevel, binding.thinkingLevel);
        assert.equal(params.systemPrompt, refinementInstructions + "\n\nReturn this stage's result with submit_result. Successful submission completes the stage.");
        const tools = params.systemTools.map(tool => ({ ...tool, execute: async value => {
          const result = await tool.execute(value);
          if (tool.name === "submit_result" && !result.isError) { submissions++; await event({ type: "validated_submit", resultHash: hash(JSON.stringify(value.result)) }); }
          return result;
        } }));
        const stage = await realAgentFactory({ ...params, systemTools: tools });
        stageSessions.add(stage);
        const unsubscribe = stage.subscribe(event_ => {
          if (event_.type === "message_end" && event_.message?.role === "assistant") {
            const message = event_.message;
            const record = { stopReason: message.stopReason, error: message.errorMessage, usage: message.usage,
              toolNames: (message.content ?? []).filter(part => part.type === "toolCall").map(part => part.name) };
            messages.push(record); void event({ type: "message_end", ...record });
          } else if (event_.type === "auto_retry_start" || event_.type === "auto_retry_end") void event({ ...event_ });
        });
        const prompt = stage.prompt.bind(stage), dispose = stage.dispose.bind(stage);
        stage.prompt = async (text, options) => {
          stagePrompts++; assert.equal(stagePrompts, 1); assert.equal(text, JSON.stringify(inputs));
          assert.deepEqual(options.images.map(part => hash(Buffer.from(part.data, "base64"))), imageEvidence.map(item => item.sha256));
          requestAdmission = true;
          try { return await prompt(text, options); } finally { requestAdmission = false; }
        };
        stage.dispose = () => { unsubscribe(); stageSessions.delete(stage); dispose(); };
        return stage;
      } });
    controller.signal.throwIfAborted();
    heartbeat = setInterval(() => { void save("status.json", snapshot()); }, 5000);
    const run = await host.start({ workflowId: implementation.definition.id, input: {}, idempotencyKey: randomUUID() });
    runId = run.id;
    await host.manager.wait(runId);
    const terminal = host.manager.get(runId);
    for (const artifact of terminal.artifacts) assert.equal(hash(await readFile(join(workspace, artifact.path))), artifact.sha256);
    assert.equal(hash(await readFile(historyPath)), provenance.hashes.originalHistory, "Original history changed during diagnostic.");
    const stageComplete = terminal.status === "succeeded" && submissions === 1 && providerRequests === 1
      && principalPrompts === 0 && stagePrompts === 1 && !blockedRequests;
    const hasCandidate = typeof terminal.result?.data?.latex === "string" && terminal.result.data.latex.trim().length > 0;
    report = { ...snapshot(), result: stopReason ? "interrupted" : stageComplete ? (hasCandidate ? "candidate_generated" : "no_candidate") : "failed",
      stageComplete, hasCandidate,
      samePrincipalBinding: true, originalEvidenceUnchanged: true, fullWorkflowValidated: false, scientificEffectivenessValidated: false };
  }
} catch (error) {
  report = { ...snapshot(), result: stopReason ? "interrupted" : "failed", error: redact(error.stack ?? error.message) };
} finally {
  clearTimeout(timer); clearInterval(heartbeat);
  await stopPromise?.catch(() => {});
  await host?.manager.cancelAll().catch(() => {});
  await manager?.shutdownAndSave().catch(error => { storageError = redact(error.message); });
  for (const stage of stageSessions) stage.dispose();
  principalSession?.dispose();
  // Cancel any unfinished observation and flush its real prefix before exit.
  // Promise.race alone left a clone reader running without saving metadata.
  if (!controller.signal.aborted) controller.abort(new Error("probe_cleanup"));
  await Promise.allSettled([...streamObservers]);
  report ??= { ...snapshot(), result: "failed" };
  report.storageError = storageError;
  await save("status.json", snapshot());
  await save("report.json", report);
  await writes;
  globalThis.fetch = originalFetch;
  delete process.env.BP_WORKFLOW_PROBE_API_KEY;
  process.exitCode = ["prepared", "candidate_generated"].includes(report.result) && !storageError ? 0 : 2;
  console.log(JSON.stringify({ output, result: report.result, providerRequests, principalPrompts, submissions }));
  stopControl.dispose();
  for (const [name, method] of Object.entries(originalConsole)) console[name] = method;
}
