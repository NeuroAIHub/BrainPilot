#!/usr/bin/env node
/**
 * 208/Linux only. Real default SessionManager, realAgentFactory, workflow,
 * configured BrainPilot literature tools, LaTeX/PDF and Principal routing.
 * This driver observes execution. It does not answer tools or choose a workflow
 * on behalf of the Principal, and it never declares synthetic data empirical.
 * Optional --max-provider-requests N bounds model HTTP attempts (including
 * failures/retries, excluding literature services). A negative workflow_start is recorded and
 * rejected before host execution; the normal tool catalog remains visible.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, cp, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { installDriverStopControl } from "./workflow-driver-stop-control.mjs";
import { observeProviderStream } from "./workflow-stream-observer.mjs";
import { verifyPendingUserQuestion } from "./workflow-user-input-evidence.mjs";
import { accountFinalAttempt, isSubmittedSuccess } from "./workflow-writing-acceptance.mjs";
import { accountWritingFinalization } from "./workflow-writing-finalization.mjs";

// Small synchronous guards run before any delegated work or billable fetch.
function guardObservedTool(name, isWriting, onBlocked) {
  if (name !== "workflow_start" || isWriting) return;
  onBlocked("unexpected_workflow_attempt");
  throw new Error("Negative routing observation attempted workflow_start; execution was stopped before host acceptance.");
}
function recordWorkflowStartAttempt(event, agent, isWriting, attempts, onBlocked) {
  if (event.type !== "tool_execution_start" || event.toolName !== "workflow_start") return;
  if (!attempts.some(item => item.agent === agent && item.toolCallId === event.toolCallId)) {
    attempts.push({ agent, toolCallId: event.toolCallId, arguments: event.args, at: new Date().toISOString() });
  }
  if (!isWriting) onBlocked("unexpected_workflow_attempt");
}
function reserveProviderRequest(url, method, providerOrigin, started, maximum, onBlocked) {
  const isProvider = url?.origin === providerOrigin && method === "POST"
    && /\/(?:messages|chat\/completions|responses)\/?$/u.test(url.pathname);
  if (!isProvider) return { started, isProvider: false };
  if (maximum !== undefined && started >= maximum) {
    onBlocked("provider_request_budget");
    throw new Error("The configured provider request budget was reached; no additional request was sent.");
  }
  return { started: started + 1, isProvider: true };
}
function stoppedObservation(reason) {
  if (reason === "unexpected_workflow_attempt" || reason === "unexpected_workflow_acceptance") {
    return { result: "failed", evidence: "routing_failure" };
  }
  return { result: reason === "provider_request_budget" ? "incomplete" : "interrupted", evidence: "partial", productFailure: false };
}

const argv = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Expected --name value arguments.");
  argv.set(key.slice(2), value);
}
const allowedArgs = new Set(["output", "scenario", "provider-env", "mcp-config", "kb-root", "thinking-level", "preflight", "model-id", "timeout-ms", "max-provider-requests"]);
for (const key of argv.keys()) if (!allowedArgs.has(key)) throw new Error("Unknown argument: --" + key);
if (process.platform !== "linux") throw new Error("Run only in the designated isolated 208 Linux test directory.");
assert(argv.has("output") && isAbsolute(argv.get("output")), "--output must be a NEW absolute isolated directory.");
assert(argv.has("provider-env") && isAbsolute(argv.get("provider-env")), "--provider-env must be an explicit absolute provider reference.");
const scenario = argv.get("scenario") ?? "positive";
assert(["positive", "explicit-positive", "qa", "short-report", "local-edit", "discussion", "missing-inputs", "capability-missing"].includes(scenario), "Unsupported scenario.");
const isWritingScenario = scenario === "positive" || scenario === "explicit-positive";
const observationKind = scenario === "capability-missing" ? "capability-boundary" : scenario === "explicit-positive" ? "explicit-workflow-execution" : "intent-routing";
const output = resolve(argv.get("output"));
const operatorStopFile = join(output, "STOP");
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(checkout, "scripts/fixtures/workflow-real");
const credentialReference = argv.get("provider-env");
const mcpConfigReference = argv.get("mcp-config");
const kbRootReference = argv.get("kb-root");
for (const [name, path] of [["mcp-config", mcpConfigReference], ["kb-root", kbRootReference]]) {
  assert(path === undefined || isAbsolute(path), "--" + name + " must be an existing absolute reference.");
}
const thinkingLevel = argv.get("thinking-level") ?? "low";
assert(["off", "low"].includes(thinkingLevel), "--thinking-level must be off or low.");
const harnessVersion = 4;
const timeoutMs = Number(argv.get("timeout-ms") ?? (isWritingScenario ? 45 * 60_000 : 5 * 60_000));
assert(Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 240 * 60_000, "Total limit must be at most 240 minutes.");
const maxProviderRequests = argv.has("max-provider-requests") ? Number(argv.get("max-provider-requests")) : undefined;
assert(maxProviderRequests === undefined || Number.isSafeInteger(maxProviderRequests) && maxProviderRequests > 0, "--max-provider-requests must be a positive integer.");
const stageTimeoutMs = 600_000;
const providerCap = 2;
await mkdir(output, { recursive: false, mode: 0o700 }); // Never reuse or overwrite prior evidence.
const dataRoot = join(output, "data");
await mkdir(join(dataRoot, "bp_template"), { recursive: true, mode: 0o700 });

async function readEnvValues(path) {
  const values = {};
  for (const line of (await readFile(path, "utf8")).split(/\r?\n/u)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value; // Read as data, never shell-source it.
  }
  return values;
}
const sourceEnv = await readEnvValues(credentialReference);
const mcpConfigRaw = mcpConfigReference ? await readFile(mcpConfigReference, "utf8") : undefined;
const mcpConfig = mcpConfigRaw === undefined ? undefined : JSON.parse(mcpConfigRaw);
assert(mcpConfig === undefined || mcpConfig && typeof mcpConfig === "object" && !Array.isArray(mcpConfig) &&
  mcpConfig.mcpServers && typeof mcpConfig.mcpServers === "object" && !Array.isArray(mcpConfig.mcpServers),
"--mcp-config must reference an existing runtime projection with a mcpServers object.");
const mcpSpecs = Object.values(mcpConfig?.mcpServers ?? {});
assert(mcpSpecs.every(spec => spec && typeof spec === "object" && !Array.isArray(spec)), "MCP projection contains an invalid server specification.");
const remotePaperLibraryConfigured = Object.keys(mcpConfig?.mcpServers ?? {}).some(name => /^(?:preset-)?neuro_sci_papersearch$/u.test(name));
const domainResources = kbRootReference || remotePaperLibraryConfigured ? "full" : "base";
const kbSource = kbRootReference ? await readFile(join(kbRootReference, "source", "KB_source.json")) : undefined;
const apiKey = sourceEnv.SQZ_API_KEY || sourceEnv.CUSTOM_API_KEY || sourceEnv.ANTHROPIC_API_KEY;
const configuredModel = sourceEnv.BP_MODEL || sourceEnv.ANTHROPIC_MODEL;
const modelId = argv.get("model-id") ?? configuredModel;
const rawBaseUrl = sourceEnv.CUSTOM_BASE_URL || sourceEnv.ANTHROPIC_BASE_URL;
const profileApi = sourceEnv.BP_API || sourceEnv.CUSTOM_API || "anthropic-messages";
assert(apiKey && modelId && rawBaseUrl, "The existing provider reference lacks required fields.");
const providerOrigin = new URL(rawBaseUrl).origin;
const hash = value => createHash("sha256").update(value).digest("hex");
const mcpSecrets = mcpSpecs.flatMap(spec => {
  const values = [...Object.values(spec.headers ?? {}), ...Object.values(spec.env ?? {})].filter(value => typeof value === "string");
  try {
    const url = new URL(spec.url);
    values.push(url.username, url.password, ...url.searchParams.values());
  } catch { /* stdio servers have no URL */ }
  return values.flatMap(value => [value, value.replace(/^Bearer\s+/iu, "")]);
});
const secrets = [...new Set([apiKey, ...mcpSecrets, process.env.SEMANTIC_SCHOLAR_API_KEY, process.env.S2_API_KEY]
  .filter(value => typeof value === "string" && value.length > 0).flatMap(value => [value, value.trim()]).filter(Boolean))]
  .sort((a, b) => b.length - a.length);
const redact = value => secrets.reduce((result, secret) => {
  for (const representation of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])) {
    result = result.split(representation).join("[REDACTED]");
  }
  return result;
}, String(value)).replace(/https?:\/\/[^\s"'<>\\]+/gu, value => {
  try { const url = new URL(value); url.username = ""; url.password = ""; url.search = ""; url.hash = ""; return url.href; }
  catch { return value.replace(/[?#].*$/u, ""); }
});
const resourceReferences = {
  mcp: { reference: mcpConfigReference, configured: Boolean(mcpConfigRaw), fingerprint: mcpConfigRaw === undefined ? undefined : hash(mcpConfigRaw) },
  paperLibrary: { reference: kbRootReference ?? (remotePaperLibraryConfigured ? mcpConfigReference : undefined),
    configured: Boolean(kbSource) || remotePaperLibraryConfigured,
    fingerprint: kbSource !== undefined ? hash(kbSource) : remotePaperLibraryConfigured ? hash(mcpConfigRaw) : undefined },
};
// Redact string values before serialization so short configured secrets can
// never corrupt JSON numbers, escape sequences or structural punctuation.
const json = value => JSON.stringify(value, (_key, item) => typeof item === "string" ? redact(item) : item);
const originalConsole = Object.fromEntries(["log", "info", "warn", "error", "debug"].map(name => [name, console[name].bind(console)]));
for (const name of Object.keys(originalConsole)) console[name] = (...items) =>
  originalConsole[name](...items.map(item => redact(typeof item === "string" ? item : inspect(item, { depth: 6, maxArrayLength: 60 }))));

Object.assign(process.env, {
  BP_LOCAL_MODE: "1", BP_DATA_DIR: dataRoot, BP_KB_ROOT: kbRootReference ?? join(output, "knowledge-base"),
  PI_CODING_AGENT_DIR: join(output, "pi-agent"), PI_CODING_AGENT_SESSION_DIR: join(output, "pi-sessions"),
  BP_WORKFLOW_ACCEPTANCE_API_KEY: apiKey,
});
delete process.env.BP_MOCK;
delete process.env.BP_SHARED_DIR;
const privateMcpProjectionPath = join(dataRoot, "bp_template", "mcp_servers.json");

const observations = { events: [], calls: [], workflowStartAttempts: [], stages: [], http: [], providerHttp: [], usage: [], principalMessages: [], principalPrompts: [] };
const observerAbort = new AbortController();
let providerRequestsStarted = 0;
const bindings = new Map();
let manager, sessionId, workspace, preflight;
let storageError, stopReason, promptTasks = 0, maxPromptTasks = 0;
let streamWrites = Promise.resolve();
let checkpointWrites = Promise.resolve();
let heartbeat, deadlineTimer, unsubBus;
let stopPromise;
let observationOrder = 0;
const startedAt = Date.now();
const boundary = "Real Principal/Pi/provider, default workflow, configured BrainPilot literature tools and native PDF tools; anonymous synthetic research inputs. Engineering acceptance only, not academic effectiveness.";
class Blocked extends Error {}

function append(stream, value) {
  const row = { at: new Date().toISOString(), ...value };
  streamWrites = streamWrites.then(() => appendFile(join(output, stream + ".ndjson"), json(row) + "\n", { mode: 0o600 }))
    .catch(error => { storageError = redact(error.message); });
}
function atomicJson(name, value) {
  const content = json(value) + "\n";
  const operation = checkpointWrites.then(async () => {
    const temporary = join(output, "." + name + "." + randomUUID() + ".tmp");
    try {
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, join(output, name));
    } finally { await rm(temporary, { force: true }).catch(() => {}); }
  });
  checkpointWrites = operation.catch(error => { storageError = redact(error.message); });
  return operation;
}
function snapshot() {
  return {
    at: new Date().toISOString(), elapsedMs: Date.now() - startedAt, scenario, sessionId, stopReason,
    workState: sessionId && manager?.getSessionState(sessionId),
    runs: sessionId ? manager?.listWorkflowRuns(sessionId) ?? [] : [],
    stages: observations.stages, calls: observations.calls, workflowStartAttemptEvents: observations.workflowStartAttempts, usage: observations.usage,
    http: observations.http, providerHttp: observations.providerHttp, providerRequestsStarted, maxProviderRequests,
    providerCap, maxObservedPromptTasks: maxPromptTasks,
    storageError,
  };
}
async function checkpoint() {
  const state = snapshot();
  await atomicJson("status.json", state);
  await atomicJson("stages.json", observations.stages);
  await atomicJson("usage.json", { observations: observations.usage, session: state.workState?.tokenUsage });
}
async function stop(reason) {
  if (stopPromise) return stopPromise;
  stopReason = reason;
  observerAbort.abort(new Error(reason));
  stopPromise = (async () => {
    append("events", { type: "stop_requested", reason });
    // Persist the classification before awaiting potentially slow provider
    // cancellation. Later completion may enrich this partial report.
    await atomicJson("real-acceptance-report.json", {
      boundary, harnessVersion, scenario, ...stoppedObservation(reason),
      stopReason, modelId, sessionId, elapsedMs: Date.now() - startedAt,
      workflowStartAttempts: observations.workflowStartAttempts.length,
      runs: sessionId ? manager?.listWorkflowRuns(sessionId) ?? [] : [],
      stageCount: observations.stages.length, providerRequestsStarted, maxProviderRequests, academicEffectivenessValidated: false,
    }).catch(error => { storageError = redact(error.message); });
    await streamWrites;
    if (manager && sessionId) await manager.interrupt(sessionId).catch(error => append("events", { type: "stop_error", error: redact(error.message) }));
  })();
  return stopPromise;
}
const stopControl = installDriverStopControl({ stopFile: operatorStopFile, onStop: stop,
  onError: error => append("events", { type: "stop_control_error", error: redact(error.message) }) });

const originalFetch = globalThis.fetch;
const providerObservers = new Set();
globalThis.fetch = async (request, init) => {
  let url;
  try { url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url); } catch { /* preserve native fetch behavior */ }
  if (stopReason) throw new Error("Driver stopped before another network request: " + stopReason);
  const method = String(init?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
  const reservation = reserveProviderRequest(url, method, providerOrigin, providerRequestsStarted, maxProviderRequests,
    reason => { void stop(reason); });
  providerRequestsStarted = reservation.started; // Reserve before fetch, including failures and retries.
  const providerRow = reservation.isProvider
    ? { number: providerRequestsStarted, path: url.pathname, startedAt: new Date().toISOString() } : undefined;
  if (providerRow) { observations.providerHttp.push(providerRow); append("provider-http", providerRow); }
  const row = url && url.origin !== providerOrigin
    ? { startedAt: new Date().toISOString(), origin: url.origin, method } : undefined;
  if (row) observations.http.push(row);
  try {
    // With a request budget, automatic redirects must not send an uncounted
    // second model request. The actual response remains unchanged for Pi.
    const response = await originalFetch(request, providerRow && maxProviderRequests !== undefined ? { ...init, redirect: "error" } : init);
    if (providerRow) {
      Object.assign(providerRow, { status: response.status, finishedAt: new Date().toISOString() });
      append("provider-http", providerRow);
    }
    if (url?.origin === providerOrigin && typeof init?.body === "string") {
      let body; try { body = JSON.parse(init.body); } catch { /* no observer for non-JSON bodies */ }
      if (body?.stream) {
        // The observed clone must stop when the real model request stops: bind it to the
        // driver stop signal and to whatever cancellation signal the actual request carries,
        // so a cancelled request does not leave the clone reading for the full stage window.
        const requestSignal = request instanceof Request ? request.signal : undefined;
        const observerSignals = [observerAbort.signal, init?.signal, requestSignal].filter(signal => signal instanceof AbortSignal);
        const observing = observeProviderStream(response, body, record => append("provider-streams", record), { signal: AbortSignal.any(observerSignals) })
          .catch(error => append("events", { type: "provider_observer_error", error: redact(error.message) }));
        providerObservers.add(observing);
        void observing.finally(() => providerObservers.delete(observing));
      }
    }
    if (row) {
      Object.assign(row, { status: response.status, finishedAt: new Date().toISOString(), retryAfter: response.headers.get("retry-after") });
      append("http", row);
    }
    return response;
  } catch (error) {
    if (providerRow) { Object.assign(providerRow, { error: redact(error.message), finishedAt: new Date().toISOString() }); append("provider-http", providerRow); }
    if (row) { Object.assign(row, { error: redact(error.message), finishedAt: new Date().toISOString() }); append("http", row); }
    throw error;
  }
};

try {
  if (argv.has("preflight")) preflight = JSON.parse(await readFile(argv.get("preflight"), "utf8"));
  const preflightIdentityMatches = preflight?.modelId === modelId && preflight?.endpointHash === hash(rawBaseUrl) && preflight?.protocol === profileApi;
  const textVerified = preflightIdentityMatches && preflight?.text?.status === "passed";
  const toolVerified = preflightIdentityMatches && preflight?.tool?.status === "passed";
  const imageVerified = preflightIdentityMatches && preflight?.text?.status === "passed" && preflight?.image?.status === "passed";
  if (scenario !== "capability-missing" && !(textVerified && toolVerified && imageVerified)) throw new Blocked(
    "Formal intent-routing observations require the same matching successful text, automatic-tool and image preflights. No model is substituted and no capability is invented.",
  );
  if (scenario === "capability-missing" && !(textVerified && toolVerified)) throw new Blocked("Capability-missing requires matching successful text and automatic-tool preflights so provider failure cannot masquerade as a capability-boundary result.");
  if (scenario === "capability-missing" && imageVerified) throw new Blocked("The selected model has verified image capability; this missing-capability scenario does not apply and the driver will not remove a verified capability.");
  const profileId = "workflow-real-existing-profile";
  const modalities = imageVerified ? ["text", "image"] : ["text"];
  await atomicJson("manifest.json", {
    startedAt: new Date(startedAt).toISOString(), harnessVersion, scenario, boundary, credentialReference,
    resourceReferences, thinkingLevel, domainResources,
    privateConfigurationPathsExcludedFromEvidence: ["data/bp_template/mcp_servers.json"],
    modelId, configuredModel, protocol: profileApi, modelWasExplicitlySelected: argv.has("model-id"),
    observationKind,
    routingEnvironmentSatisfied: textVerified && toolVerified && imageVerified,
    endpointHash: hash(rawBaseUrl), preflightPath: argv.get("preflight"), preflightIdentityMatches, textVerified, toolVerified, imageVerified,
    preflight, declaredInputModalities: modalities, providerCap, stageTimeoutMs, timeoutMs, maxProviderRequests,
    dataRoot, nodeVersion: process.version, pid: process.pid, operatorStopFile,
    limitations: ["One synthetic fixture or one routing observation", "Model scores are not publication/scientific validation", "Literature provenance and nonempty citations are required; service failures are never replaced with mock data", "The temporary private MCP projection must never be included in evidence archives and is removed on cleanup"],
  });
  // Copy the already-resolved runtime projection exactly, with private mode.
  // Credentials are used only by the existing MCP bridge; this is not evidence.
  if (mcpConfigRaw !== undefined) await writeFile(privateMcpProjectionPath, mcpConfigRaw, { mode: 0o600, flag: "wx" });
  // Generic provider configuration, using the same public path as ordinary
  // sessions. The key remains an environment reference; no binding is altered.
  await writeFile(join(dataRoot, "bp_template/providers.json"), JSON.stringify({
    selectedProfileId: profileId, profiles: [{
      id: profileId, baseUrl: rawBaseUrl, api: profileApi,
      apiKeyEnv: "BP_WORKFLOW_ACCEPTANCE_API_KEY", models: [modelId], reasoningModels: [modelId], contextWindow: 200_000,
      inputModalities: { [modelId]: modalities },
    }],
  }, null, 2) + "\n", { mode: 0o600 });

  const { SessionManager } = await import("../packages/runtime/dist/session-manager.js");
  const { realAgentFactory } = await import("../packages/runtime/dist/agent-factory.js");
  const pi = await import("@earendil-works/pi-coding-agent");
  assert.equal(resolve(pi.getAgentDir()), resolve(process.env.PI_CODING_AGENT_DIR), "Pi config isolation did not take effect.");
  const factory = async params => {
    const isStage = Boolean(params.workflowModelBinding);
    const stageId = isStage ? /attempt-\d+-[^:]+/u.exec(params.agentName)?.[0] ?? params.agentName : undefined;
    const row = {
      id: randomUUID(), agent: params.agentName, role: params.role, stageId, createdAt: new Date().toISOString(),
      status: "creating", toolNames: params.allowedToolNames, instructionHash: hash(params.systemPrompt ?? ""), instructionChars: params.systemPrompt?.length ?? 0,
      stopReasons: [], errors: [], submittedResults: 0, imageCount: 0, samePrincipalBinding: null,
    };
    if (isStage) {
      const principal = bindings.get(params.sessionId);
      assert(principal, "A stage has no observed principal model binding.");
      assert.equal(params.workflowModelBinding.modelRuntime, principal.modelRuntime, "A stage changed the principal model runtime.");
      assert.equal(params.workflowModelBinding.model.id, principal.model.id);
      assert.equal(params.workflowModelBinding.model.provider, principal.model.provider);
      assert.equal(params.workflowModelBinding.thinkingLevel, principal.thinkingLevel);
      row.samePrincipalBinding = true;
      // A stage row spans every prompt that stage receives, so each prompt is
      // kept as its own attempt instead of overwriting the row.
      row.promptAttempts = [];
      observations.stages.push(row);
    }
    const tools = params.systemTools.map(tool => ({
      ...tool,
      execute: async arguments_ => {
        const call = { id: randomUUID(), agent: params.agentName, stageId, name: tool.name, startedAt: new Date().toISOString(),
          status: "running", argumentHash: hash(JSON.stringify(arguments_)), arguments: isStage ? undefined : arguments_ };
        observations.calls.push(call); append("calls", call);
        try {
          // The model sees the normal catalog and schema. A forbidden decision
          // is recorded as a routing failure, but cannot launch a costly stage.
          guardObservedTool(tool.name, isWritingScenario, reason => { void stop(reason); });
          const result = await tool.execute(arguments_);
          call.status = result.isError ? "returned_error" : "completed";
          call.finishedAt = new Date().toISOString();
          if (tool.name === "submit_result" && !result.isError) {
            row.submittedResults++;
            call.resultHash = hash(JSON.stringify(arguments_.result));
          }
          if (tool.name === "workflow_search" && !result.isError) {
            for (const block of result.content ?? []) {
              if (block.type !== "text" || typeof block.text !== "string") continue;
              try {
                const payload = JSON.parse(block.text);
                if (Array.isArray(payload.workflows)) call.catalog = payload.workflows.map(item => ({
                  id: item.id, enabled: item.enabled, missingCapabilities: item.missingCapabilities,
                  hostCapabilitiesSatisfied: item.hostCapabilitiesSatisfied,
                }));
              } catch { /* Observe only; never alter a real tool response. */ }
            }
          }
          if (result.isError) call.error = redact(result.content?.filter(item => item.type === "text").map(item => item.text).join("\n") ?? "Tool error");
          append("calls", call); return result;
        } catch (error) {
          call.status = "failed"; call.finishedAt = new Date().toISOString(); call.error = redact(error.message);
          append("calls", call); throw error;
        }
      },
    }));
    const session = await realAgentFactory({ ...params, systemTools: tools });
    if (!isStage && params.agentName === "principal") {
      const binding = session.getWorkflowModelBinding();
      bindings.set(params.sessionId, binding);
      append("events", { type: "principal_model_binding", modelId: binding.model.id, provider: binding.model.provider,
        api: binding.model.api, inputModalities: binding.model.input, thinkingLevel: binding.thinkingLevel, piVersion: pi.VERSION });
      if (isWritingScenario && !binding.model.input?.includes("image")) {
        session.dispose();
        throw new Blocked("The registered principal model lacks image capability despite the preflight; fix the generic provider declaration, not the binding.");
      }
    }
    row.status = "created";
    let activePrincipalPrompt, stageStartedMs;
    const unsubscribe = session.subscribe(event => {
      // Pi emits this before schema validation. Count invalid arguments too,
      // once by actual toolCallId; the execute wrapper is not a second attempt.
      recordWorkflowStartAttempt(event, params.agentName, isWritingScenario, observations.workflowStartAttempts,
        reason => { void stop(reason); });
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const message = event.message;
        if (message.stopReason) row.stopReasons.push(message.stopReason);
        if (message.errorMessage) row.errors.push(redact(message.errorMessage));
        if (message.usage) observations.usage.push({ agent: params.agentName, stageId, at: new Date().toISOString(), usage: message.usage });
        const visible = (message.content ?? []).filter(item => item.type === "text").map(item => item.text).join("\n");
        const record = { type: "assistant_message_end", order: ++observationOrder, promptId: activePrincipalPrompt?.id,
          agent: params.agentName, stageId, stopReason: message.stopReason,
          toolCalls: (message.content ?? []).filter(item => item.type === "toolCall").map(item => item.name),
          error: message.errorMessage ? redact(message.errorMessage) : undefined, usage: message.usage,
          text: params.agentName === "principal" ? visible : visible.slice(0, 4000) };
        if (params.agentName === "principal") observations.principalMessages.push(record);
        append("events", record);
      } else if (event.type === "auto_retry_start" || event.type === "auto_retry_end") {
        append("events", { agent: params.agentName, stageId, ...event });
      }
    });
    const prompt = session.prompt.bind(session), dispose = session.dispose.bind(session);
    session.prompt = async (text, options) => {
      if (stopReason) throw new Error("Driver stopped before a new provider prompt: " + stopReason);
      let principalPrompt;
      if (params.agentName === "principal") {
        const terminalMarker = "A previously accepted workflow has settled.";
        const terminalRunIds = text.includes(terminalMarker) ? (manager?.listWorkflowRuns(params.sessionId) ?? [])
          .filter(run => ["succeeded", "failed", "interrupted"].includes(run.status) && text.includes(run.id)).map(run => run.id) : [];
        principalPrompt = { id: randomUUID(), order: ++observationOrder, startedAt: new Date().toISOString(),
          inputHash: hash(text), inputChars: text.length, terminalRunIds, ambiguousOverlap: Boolean(activePrincipalPrompt), status: "running" };
        if (activePrincipalPrompt) activePrincipalPrompt.ambiguousOverlap = true;
        else activePrincipalPrompt = principalPrompt;
        observations.principalPrompts.push(principalPrompt);
        append("principal-prompts", principalPrompt);
      }
      const started = Date.now(), imageCount = options?.images?.length ?? 0;
      row.status = "running";
      let attempt;
      if (isStage) {
        // Keep the first prompt's identity on the row; every prompt is an attempt.
        stageStartedMs ??= started;
        row.startedAt ??= new Date(started).toISOString();
        row.inputHash ??= hash(text); row.inputChars ??= text.length;
        row.imageCount = Math.max(row.imageCount ?? 0, imageCount);
        attempt = { order: row.promptAttempts.length + 1, startedAt: new Date(started).toISOString(),
          inputHash: hash(text), inputChars: text.length, imageCount, status: "running" };
        row.promptAttempts.push(attempt);
      } else {
        row.startedAt = new Date().toISOString();
        row.inputHash = hash(text); row.inputChars = text.length; row.imageCount = imageCount;
      }
      promptTasks++; maxPromptTasks = Math.max(maxPromptTasks, promptTasks);
      append("events", { type: "prompt_started", agent: params.agentName, stageId, inputChars: text.length,
        imageCount, attempt: attempt?.order });
      try { await prompt(text, options); row.status = row.stopReasons.at(-1) === "error" ? "model_error" : "completed"; }
      catch (error) { row.status = "failed"; row.errors.push(redact(error.message)); throw error; }
      finally {
        promptTasks--;
        const durationMs = Date.now() - started;
        row.finishedAt = new Date().toISOString();
        // A stage duration spans its first prompt start through this last finish.
        row.durationMs = attempt ? Date.now() - stageStartedMs : durationMs;
        if (attempt) { attempt.status = row.status; attempt.finishedAt = row.finishedAt; attempt.durationMs = durationMs; }
        if (principalPrompt) {
          principalPrompt.status = row.status; principalPrompt.finishedAt = row.finishedAt;
          if (activePrincipalPrompt === principalPrompt) activePrincipalPrompt = undefined;
          append("principal-prompts", principalPrompt);
        }
        append("events", { type: "prompt_finished", agent: params.agentName, stageId, status: row.status,
          durationMs, stageDurationMs: attempt ? row.durationMs : undefined, attempt: attempt?.order,
          submittedResults: row.submittedResults, errors: row.errors });
      }
    };
    // This observer sees only teardown failures that surface through dispose itself;
    // producer cleanup that fails elsewhere is invisible here, which is why the pure
    // finalization accounting below also vets explicit runtime issues.
    const recordDisposeFailure = error => {
      const message = redact(error?.message ?? error);
      if (isStage) {
        row.status = "failed";
        row.cleanupError = message;
        row.errors.push("dispose cleanup failed: " + message);
      }
      append("events", { type: "dispose_failed", agent: params.agentName, stageId, stage: isStage, error: message });
    };
    session.dispose = () => {
      row.disposedAt = new Date().toISOString();
      let result;
      try { unsubscribe(); result = dispose(); }
      catch (error) { recordDisposeFailure(error); throw error; }
      // A returned thenable is chained so an asynchronous teardown rejection is
      // recorded and rethrown instead of becoming an unhandled rejection; a
      // successful undefined or synchronous value passes through unchanged.
      if (result && typeof result.then === "function") {
        return Promise.resolve(result).catch(error => { recordDisposeFailure(error); throw error; });
      }
      return result;
    };
    return session;
  };
  // Default production registry and real factory. No workflow implementation,
  // response generator, tool chooser, or native-tool runner is substituted.
  manager = new SessionManager({
    dataRoot, persist: true, agentFactory: factory, maxConcurrentAgents: providerCap,
    memLimitBytes: null, workflowStageTimeoutMs: stageTimeoutMs,
  });
  assert(manager.listWorkflowDefinitions().some(item => item.id === "paper-writing"), "Default writing workflow missing.");
  await manager.setWorkflowAvailability({ revision: 1, enabledWorkflowIds: ["paper-writing"] });
  const session = await manager.createSession({
    title: "Research writing study", providerId: profileId, modelId,
    domainResources, thinkingLevel,
  });
  sessionId = session.id;
  workspace = join(dataRoot, "workspaces", sessionId);
  const researchRoot = join(workspace, "materials");
  await mkdir(researchRoot, { mode: 0o700 });
  const researchEntries = ["raw_materials", "latex_template", "local_edit.md"];
  for (const entry of researchEntries) await cp(join(fixtureDir, entry), join(researchRoot, entry), { recursive: true });
  // Harness README, scenarios, expected outcomes and logs are never copied to
  // the Agent's workspace or included in its prompts.
  assert.deepEqual((await readdir(researchRoot)).sort(), [...researchEntries].sort());
  if (scenario === "missing-inputs") await rm(join(researchRoot, "raw_materials/experimental_log.md"));
  const inputHashes = {};
  async function inventory(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) await inventory(path);
      else if (item.isFile()) inputHashes[path.slice(workspace.length + 1)] = hash(await readFile(path));
    }
  }
  await inventory(researchRoot);
  const sourceHashes = {};
  for (const path of [
    "packages/runtime/src/workflows/paper-writing.ts", "packages/runtime/src/workflows/prompts/upstream-prompts.json",
    "packages/runtime/src/workflows/host.ts", "packages/runtime/src/workflows/native-tools.ts",
    "packages/runtime/dist/workflows/paper-writing.js", "packages/runtime/dist/workflows/host.js",
    "packages/runtime/dist/agent-factory.js", "scripts/workflow-real-acceptance.mjs", "scripts/workflow-user-input-evidence.mjs",
  ]) sourceHashes[path] = hash(await readFile(join(checkout, path)));
  await atomicJson("input-source-manifest.json", { harnessVersion, sessionId, inputHashes, sourceHashes,
    copiedResearchEntries: researchEntries, harnessFilesExcluded: true, fixture: "synthetic research constants; genuine software/provider execution" });
  unsubBus = manager.subscribe(sessionId, event => {
    if (["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_START", "TEXT_MESSAGE_END"].includes(event.type)) return;
    const name = event.name ?? event.type;
    if (name === "session_state") return;
    const record = { type: "session_event", event };
    observations.events.push(record); append("session-events", record);
  });
  const materials = "The research materials are in /workspace/materials/raw_materials and /workspace/materials/latex_template, including template.tex and guidelines.md.";
  const manuscriptRequest = "Please turn the supplied methodology and results into a complete anonymous research manuscript. " + materials +
    " The materials are synthetic; keep that label, the supplied values and the non-significant result. Include relevant scholarly references published before September 2026 and follow the supplied template and guidelines. Deliver the editable LaTeX source, bibliography and compiled PDF when the manuscript is ready.";
  const prompts = {
    positive: manuscriptRequest,
    "explicit-positive": "Use the enabled PaperOrchestra writing workflow for this task. " + manuscriptRequest,
    "capability-missing": manuscriptRequest,
    qa: "What is the difference between preprocessing an EEG signal and classifying it? Give a brief explanation. " + materials,
    "short-report": "Read the supplied experimental_log.md and give a three-sentence progress report summarizing the synthetic comparison and its limitation. " + materials,
    "local-edit": "Read /workspace/materials/local_edit.md and improve only the wording of its two sentences while preserving the non-significant result and lack of validation. Reply with the revised wording. " + materials,
    discussion: "I am deciding whether a writing workflow is useful. Explain the tradeoff between using a full manuscript workflow and asking for local writing help; this is a design discussion. " + materials,
    "missing-inputs": "I want a complete manuscript, but the experimental_log.md is missing and I have no completed results to supply yet. Inspect what is available and tell me what is needed before drafting. Do not invent experimental results. " + materials,
  };
  await atomicJson("request.json", { scenario, prompt: prompts[scenario] });
  deadlineTimer = setTimeout(() => { void stop("overall_deadline"); }, Math.max(0, timeoutMs - (Date.now() - startedAt)));
  let checkpointBusy = false;
  heartbeat = setInterval(() => {
    if (checkpointBusy) return;
    checkpointBusy = true;
    void checkpoint().catch(error => { storageError = redact(error.message); }).finally(() => { checkpointBusy = false; });
    console.log(JSON.stringify({ event: "progress", scenario, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      runs: manager.listWorkflowRuns(sessionId).map(run => ({ id: run.id, status: run.status })),
      stages: observations.stages.length, runningStages: observations.stages.filter(stage => stage.status === "running").map(stage => stage.stageId),
      s2Requests: observations.http.length }));
  }, 5000);
  const sent = await manager.sendMessage(sessionId, prompts[scenario]);
  assert(sent.accepted, "Runtime rejected the user message.");
  let idlePolls = 0;
  let settledReason = "idle";
  let pendingUserInputEvidence;
  for (;;) {
    await stopControl.poll();
    const runs = manager.listWorkflowRuns(sessionId);
    const attempts = observations.workflowStartAttempts;
    if (!isWritingScenario && attempts.length) {
      settledReason = "unexpected_workflow_attempt"; await stop(settledReason); break;
    }
    if (!isWritingScenario && runs.length) {
      settledReason = "unexpected_workflow_acceptance"; await stop(settledReason); break;
    }
    if (stopReason) { settledReason = stopReason; break; }
    const pendingQuestion = observations.calls.some(call => call.agent === "principal" && call.name === "ask_user" && call.status === "running");
    if (pendingQuestion && !runs.some(run => run.status === "queued" || run.status === "running")) {
      // A running tool alone can still fail validation or persistence. Require
      // the real displayed event and its identical durable record before Stop
      // cancels the pending question and may append a cleanup model error.
      const persistedEvents = (await readFile(join(dataRoot, ".bp", sessionId, "events.jsonl"), "utf8"))
        .split(/\r?\n/u).filter(line => line.trim()).map(line => JSON.parse(line));
      const verified = verifyPendingUserQuestion({ sessionId, calls: observations.calls,
        principalMessages: observations.principalMessages, sessionEvents: observations.events, persistedEvents });
      if (verified) {
        pendingUserInputEvidence = { ...verified, observedAt: new Date().toISOString() };
        await atomicJson("pending-user-input-evidence.json", pendingUserInputEvidence);
        settledReason = "needs_user_input"; await stop("question_observed_without_answering"); break;
      }
    }
    const active = manager.getSessionState(sessionId)?.workState.active === true;
    idlePolls = active ? 0 : idlePolls + 1;
    if (idlePolls >= 2 && !runs.some(run => run.status === "queued" || run.status === "running")) break;
    await new Promise(done => setTimeout(done, 1000));
  }
  clearTimeout(deadlineTimer); clearInterval(heartbeat);
  await checkpoint();
  const runs = manager.listWorkflowRuns(sessionId);
  const attempts = observations.workflowStartAttempts;
  const lastPrincipal = observations.principalMessages.at(-1);
  const finalPrincipalUsable = Boolean(lastPrincipal && lastPrincipal.stopReason !== "error" && !lastPrincipal.error &&
    (lastPrincipal.text?.trim() || lastPrincipal.toolCalls?.length));
  const principalUsable = settledReason === "needs_user_input" ? Boolean(pendingUserInputEvidence) : finalPrincipalUsable;
  const report = {
    boundary, harnessVersion, scenario, result: "incomplete", settledReason, sessionId, modelId, protocol: profileApi, imageVerified,
    resourceReferences, thinkingLevel, domainResources,
    observationKind,
    routingEnvironmentSatisfied: textVerified && toolVerified && imageVerified,
    resultDelivered: isWritingScenario ? false : null,
    configuredProviderCap: providerCap, stageTimeoutMs, elapsedMs: Date.now() - startedAt,
    workflowSearchCalls: observations.calls.filter(call => call.name === "workflow_search").length,
    workflowStartAttempts: attempts.length, acceptedRuns: runs.length,
    workflowStartAttemptEvents: attempts,
    providerRequestsStarted, maxProviderRequests, providerHttp: observations.providerHttp,
    samePrincipalModel: observations.stages.length ? observations.stages.every(stage => stage.samePrincipalBinding === true) : null,
    stageCount: observations.stages.length, stageFailures: observations.stages.filter(stage => stage.status === "failed" || stage.status === "model_error"),
    retrievalHttpRequests: observations.http.length, retrievalHttpFailures: observations.http.filter(call => !call.status || call.status >= 400),
    toolCalls: observations.calls.map(({ agent, stageId, name, status, error, catalog }) => ({ agent, stageId, name, status, error, catalog })),
    principalMessages: observations.principalMessages, principalUsable, finalPrincipalUsable,
    pendingUserInputEvidence: pendingUserInputEvidence ?? null, issues: [],
    academicEffectivenessValidated: false,
  };
  if (!isWritingScenario) {
    const routingCorrect = attempts.length === 0 && runs.length === 0;
    const completedOrQuestion = settledReason === "idle" || settledReason === "needs_user_input";
    let capabilityExplanationAccepted = true;
    if (scenario === "capability-missing") {
      const missingImagesObserved = observations.calls.some(call => call.agent === "principal" && call.name === "workflow_search" &&
        call.status === "completed" && call.catalog?.some(item => item.id === "paper-writing" && item.missingCapabilities?.includes("images") && item.hostCapabilitiesSatisfied === false));
      const explanation = lastPrincipal?.text ?? "";
      const explainsImageLimitation = /image|vision|visual|multimodal|图片|图像|视觉|多模态/iu.test(explanation) &&
        /model|provider|模型|提供方/iu.test(explanation) &&
        /text[- ]only|only text|lack|missing|not support|doesn.t support|cannot|can.t|unable|unavailable|not available|不支持|不具备|缺少|缺乏|无法|不能|仅.*文本|只.*文本/iu.test(explanation);
      capabilityExplanationAccepted = missingImagesObserved && explainsImageLimitation && settledReason === "idle";
      Object.assign(report, { missingImagesObserved, explainsImageLimitation, manualExplanationReviewRequired: true });
      if (!capabilityExplanationAccepted) report.issues.push("Capability-missing acceptance requires a real catalog response reporting missing images, zero starts, and a completed Principal explanation of the model's image limitation.");
    }
    report.result = routingCorrect && completedOrQuestion && principalUsable && capabilityExplanationAccepted ? "passed_observation" : "failed";
    if (!principalUsable) report.issues.push("No usable Principal response/tool selection was observed; a provider failure is not a negative-routing pass.");
    report.issues.push("This is one live routing observation with synthetic materials, not a measured generalized accuracy or mis-trigger rate.");
  } else {
    assert(principalUsable, "Principal completion/delivery had no usable final response or tool selection.");
    assert.equal(runs.length, 1, "A full positive run requires one accepted workflow; acceptance alone is insufficient.");
    const run = runs[0];
    await atomicJson("workflow-run.json", run);
    assert.equal(run.status, "succeeded", run.error ?? "The workflow did not complete.");
    assert.equal(run.result?.data?.status, "completed");
    const data = run.result.data;
    const terminalPrompts = observations.principalPrompts.filter(prompt => prompt.terminalRunIds.includes(run.id) &&
      prompt.status === "completed" && !prompt.ambiguousOverlap);
    const terminalById = new Map(terminalPrompts.map(prompt => [prompt.id, prompt]));
    const mentionsPath = (message, path) => {
      let decoded = message;
      try { decoded = decodeURIComponent(message); } catch { /* raw paths may still match */ }
      const relativePath = path.startsWith("/workspace/") ? path.slice(11) : path;
      return message.includes(relativePath) || decoded.includes(relativePath);
    };
    const deliveryMessages = observations.principalMessages.filter(message => {
      const received = terminalById.get(message.promptId);
      return received && message.order > received.order && message.stopReason === "stop" && !message.error && message.text.trim() &&
        mentionsPath(message.text, data.finalTexPath) && mentionsPath(message.text, data.finalPdfPath);
    });
    const resultDelivered = deliveryMessages.length > 0;
    const root = await realpath(workspace);
    const readArtifact = async path => {
      const target = await realpath(resolve(workspace, path.startsWith("/workspace/") ? path.slice(11) : path));
      assert(target.startsWith(root + sep), "Artifact escaped the isolated session workspace.");
      return readFile(target);
    };
    for (const artifact of run.artifacts) assert.equal(hash(await readArtifact(artifact.path)), artifact.sha256, "Artifact hash mismatch: " + artifact.path);
    const latex = (await readArtifact(data.finalTexPath)).toString("utf8");
    const pdf = await readArtifact(data.finalPdfPath);
    assert(latex.includes("\\begin{document}") && latex.includes("\\end{document}"), "Final editable source lacks LaTeX document boundaries.");
    assert(pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) && pdf.subarray(-1024).includes(Buffer.from("%%EOF")) && pdf.length > 1000, "Final artifact is not a complete PDF.");
    const refinedPdf = run.artifacts.find(artifact => artifact.path.endsWith("/final_refined_paper.pdf"));
    assert(refinedPdf && refinedPdf.sha256 === hash(pdf), "The final/refined PDF copies differ or are missing.");
    const citationMap = JSON.parse((await readArtifact(data.citationMapPath)).toString("utf8"));
    const bibliography = (await readArtifact(data.bibliographyPath)).toString("utf8");
    const contentWorklog = JSON.parse((await readArtifact(data.contentWorklogPath)).toString("utf8"));
    const formatWorklog = JSON.parse((await readArtifact(data.formatWorklogPath)).toString("utf8"));
    const finalReview = JSON.parse((await readArtifact(data.finalReviewPath)).toString("utf8"));
    const citationKeys = Object.keys(citationMap);
    const verifiedPapers = JSON.parse((await readArtifact(join(dirname(data.citationMapPath), "papers.json"))).toString("utf8"));
    const citationProvenance = [];
    for (const key of citationKeys) {
      const paper = Array.isArray(verifiedPapers) ? verifiedPapers.find(item => item?.citation_key === key) : undefined;
      let verified = false;
      if (paper && ["brainpilot-library", "tavily-page"].includes(paper.source_kind) &&
        typeof paper.metadata_sha256 === "string" && /^[a-f0-9]{64}$/u.test(paper.metadata_sha256) &&
        typeof paper.evidence_path === "string" && paper.evidence_path.endsWith("/verification.json") &&
        run.artifacts.some(artifact => artifact.path === paper.evidence_path && artifact.role === "literature-verification-evidence")) {
        const evidence = JSON.parse((await readArtifact(paper.evidence_path)).toString("utf8"));
        verified = Array.isArray(evidence) && evidence.some(item => item?.status === "verified" &&
          item.accepted_metadata && hash(JSON.stringify(item.accepted_metadata)) === paper.metadata_sha256 &&
          item.accepted_metadata.title === paper.title && paper.title === citationMap[key]?.title &&
          (paper.source_kind === "brainpilot-library"
            ? Array.isArray(item.evidence?.localPapers) && item.evidence.localPapers.some(metadata => hash(JSON.stringify(metadata)) === paper.metadata_sha256)
            : Array.isArray(item.evidence?.pages) && item.evidence.pages.length > 0));
      }
      citationProvenance.push({ citationKey: key, sourceKind: paper?.source_kind, evidencePath: paper?.evidence_path,
        metadataSha256: paper?.metadata_sha256, verified });
    }
    const provenanceValid = citationKeys.length > 0 && citationProvenance.every(item => item.verified);
    const citedKeys = [...new Set([...latex.matchAll(/\\cite\w*\*?(?:\[[^\]]*\])*\{([^}]+)\}/gu)].flatMap(match => match[1].split(",").map(key => key.trim())))];
    const unknownCitedKeys = citedKeys.filter(key => !Object.hasOwn(citationMap, key));
    const bibliographyKeys = new Set([...bibliography.matchAll(/@\w+\s*\{\s*([^,\s]+)\s*,/gu)].map(match => match[1]));
    const referencesValid = provenanceValid && citedKeys.length > 0 && unknownCitedKeys.length === 0 &&
      citationKeys.every(key => typeof citationMap[key]?.title === "string" && citationMap[key].title.trim() && typeof citationMap[key]?.abstract === "string" && citationMap[key].abstract.trim() && bibliographyKeys.has(key));
    const syntheticLabel = /synthetic/iu.test(latex);
    const nullResult = /not (?:statistically )?significant|non[- ]significant|nonsignificant/iu.test(latex);
    const decimalsRetained = ["0.71", "0.73", "0.02", "0.42"].every(value => latex.includes(value));
    const originalsUnchanged = [];
    for (const [path, expected] of Object.entries(inputHashes)) originalsUnchanged.push(hash(await readFile(join(workspace, path))) === expected);
    assert(originalsUnchanged.every(Boolean), "A supplied research input was modified.");
    const submittedStages = observations.stages.filter(isSubmittedSuccess);
    // Required-stage satisfaction is judged only against the attempt that produced this manuscript;
    // earlier-attempt successes never cover a missing final-attempt stage.
    const finalAttemptAccounting = accountFinalAttempt({ stages: observations.stages, finalTexPath: data.finalTexPath });
    const mainStages = finalAttemptAccounting.completeFinalAttempt;
    const finalReviewValid = !Object.hasOwn(finalReview, "Error") && Number.isFinite(finalReview.Overall) && finalReview.Overall >= 1;
    const visionActuallyUsed = finalAttemptAccounting.visionUsedFinalAttempt;
    // Model-free lifecycle accounting: an incomplete refinement review round, a
    // persisted final-attempt peer review error, an unattributable final source, or
    // an explicit runtime cleanup failure all block acceptance even when the stage
    // metadata and compiled PDF look finished.
    const finalizationAccounting = accountWritingFinalization({
      finalTexPath: data.finalTexPath, contentWorklog, artifacts: run.artifacts, runtimeIssues: run.result.issues ?? [],
    });
    const engineeringComplete = referencesValid && syntheticLabel && nullResult && decimalsRetained && mainStages &&
      finalReviewValid && visionActuallyUsed && resultDelivered && finalizationAccounting.complete;
    // Only errors belonging to an attempt that a later attempt actually superseded
    // are recovered. An attempted refinement that failed and was not retried
    // prevents full acceptance: the workflow kept earlier valid output, so the
    // error is reported as an issue rather than claimed as recovered telemetry.
    const attemptOfStageId = stageId => {
      const match = /^attempt-(\d+)-/u.exec(String(stageId ?? ""));
      return match ? Number(match[1]) : undefined;
    };
    const recoveredAttemptSet = new Set(finalAttemptAccounting.recoveredAttempts);
    const isRecoveredStageError = stage => recoveredAttemptSet.has(attemptOfStageId(stage.stageId));
    const recoveredStageErrors = finalAttemptAccounting.completeFinalAttempt ? report.stageFailures.filter(isRecoveredStageError) : [];
    const fallbackStageErrors = finalAttemptAccounting.completeFinalAttempt
      ? report.stageFailures.filter(stage => !isRecoveredStageError(stage)) : [];
    Object.assign(report, {
      runId: run.id, runtimeStatus: run.status, upstreamCommit: data.upstreamCommit, artifactCount: run.artifacts.length,
      finalTexPath: join(workspace, data.finalTexPath), finalPdfPath: join(workspace, data.finalPdfPath),
      verifiedCitationCount: citationKeys.length, citedKeyCount: citedKeys.length, unknownCitedKeys, referencesValid,
      provenanceValid, citationProvenance,
      syntheticLabel, nullResult, decimalsRetained, originalsUnchanged: originalsUnchanged.every(Boolean),
      mainStages, finalReviewValid, validatedStageSubmissions: submittedStages.length, visionActuallyUsed,
      finalizationAccounting, finalizationComplete: finalizationAccounting.complete,
      finalAttemptAccounting, finalAttemptHasError: finalAttemptAccounting.finalAttemptHasError,
      recoveredAttempts: finalAttemptAccounting.recoveredAttempts, recoveredStageErrors, fallbackStageErrors,
      engineeringComplete, scientificQualityValidated: false,
      resultDelivered, terminalPromptCount: terminalPrompts.length, deliveryMessageOrders: deliveryMessages.map(message => message.order),
      finalScore: data.finalScore, finalReview, contentOutcomes: Object.values(contentWorklog).map(value => value.outcome),
      formatOutcomes: Object.values(formatWorklog).map(value => value.outcome), runtimeIssues: run.result.issues ?? [],
    });
    if (!referencesValid) report.issues.push("Citation completeness/identity acceptance is incomplete; retrieval errors and empty maps were not replaced with mocks.");
    if (report.retrievalHttpFailures.length) report.issues.push("Some external retrieval HTTP attempts failed; inspect the safe origin/status telemetry and workflow provenance artifacts for retry outcomes and literature coverage.");
    if (!syntheticLabel || !nullResult || !decimalsRetained) report.issues.push("The synthetic-input fidelity screen failed. Read the manuscript; this screen is not a scientific quality assessment.");
    if (!mainStages || !finalReviewValid || !visionActuallyUsed) report.issues.push("Some required real model stages or image processing did not complete successfully.");
    for (const reason of finalizationAccounting.reasons) report.issues.push("Finalization lifecycle acceptance is incomplete: " + reason);
    if (recoveredStageErrors.length) report.issues.push("Earlier errors were recovered; see telemetry. The final attempt completed every required stage.");
    if (fallbackStageErrors.length) report.issues.push("Some stages failed and the workflow retained earlier valid output; see issues.");
    if (!resultDelivered) report.issues.push("No completed Principal reply linked the actual final TeX and PDF after receiving this run's terminal outbox message; an initial start acknowledgment is not delivery.");
    report.result = engineeringComplete ? "passed_engineering_acceptance" : "incomplete";
    report.issues.push("Bibliographic metadata/abstract verification does not establish full-text claim support; model review scores are not academic acceptance or scientific-effectiveness evidence.");
  }
  if (storageError) { report.result = "failed"; report.issues.push("Telemetry storage failed: " + storageError); }
  if (stopReason && (/^(?:operator_|overall_deadline)/u.test(stopReason) || stopReason === "provider_request_budget" || stopReason.startsWith("unexpected_workflow_"))) {
    Object.assign(report, stoppedObservation(stopReason));
  }
  await atomicJson("real-acceptance-report.json", report);
  process.exitCode = report.result.startsWith("passed") ? 0 : ["incomplete", "interrupted"].includes(report.result) ? 2 : 1;
} catch (error) {
  const blocked = error instanceof Blocked;
  const interrupted = Boolean(stopReason && /^(?:operator_|overall_deadline)/u.test(stopReason));
  const budgetLimited = stopReason === "provider_request_budget";
  await atomicJson("real-acceptance-report.json", {
    boundary, harnessVersion, scenario, result: budgetLimited ? "incomplete" : interrupted ? "interrupted" : blocked ? "blocked" : "failed",
    ...(budgetLimited ? { evidence: "partial", productFailure: false } : {}),
    ...(interrupted ? { evidence: "partial", productFailure: false } : {}),
    modelId, protocol: profileApi, credentialReference, resourceReferences, thinkingLevel, domainResources, preflightPath: argv.get("preflight"),
    message: redact(error.message), stack: blocked ? undefined : redact(error.stack ?? ""),
    sessionId, stopReason, runs: sessionId ? manager?.listWorkflowRuns(sessionId) ?? [] : [],
    workflowStartAttempts: observations.workflowStartAttempts.length, workflowStartAttemptEvents: observations.workflowStartAttempts,
    providerRequestsStarted, maxProviderRequests, providerHttp: observations.providerHttp,
    stageCount: observations.stages.length, stageFailures: observations.stages.filter(stage => stage.errors.length),
    retrievalHttpRequests: observations.http.length, retrievalHttpFailures: observations.http.filter(call => !call.status || call.status >= 400),
    elapsedMs: Date.now() - startedAt, academicEffectivenessValidated: false,
  });
  process.exitCode = interrupted || budgetLimited ? 2 : blocked ? 3 : 1;
} finally {
  clearInterval(heartbeat); clearTimeout(deadlineTimer);
  observerAbort.abort(new Error("driver_cleanup"));
  await stopPromise?.catch(error => append("events", { type: "stop_error", error: redact(error.message) }));
  if (manager && sessionId) await manager.interrupt(sessionId).catch(() => {});
  unsubBus?.();
  await checkpoint().catch(error => { storageError = redact(error.message); });
  try { await manager?.shutdownAndSave(); }
  catch (error) {
    process.exitCode = 1;
    await atomicJson("cleanup-error.json", { error: redact(error.message) }).catch(() => {});
  }
  await atomicJson("stages.json", observations.stages).catch(() => {});
  await Promise.allSettled([...providerObservers]);
  await streamWrites; await checkpointWrites;
  await rm(privateMcpProjectionPath, { force: true });
  globalThis.fetch = originalFetch;
  delete process.env.BP_WORKFLOW_ACCEPTANCE_API_KEY;
  console.log(JSON.stringify({ resultCode: process.exitCode ?? 0, scenario, output, report: join(output, "real-acceptance-report.json") }));
  stopControl.dispose();
  for (const [name, method] of Object.entries(originalConsole)) console[name] = method;
}
