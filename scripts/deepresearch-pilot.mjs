#!/usr/bin/env node
/**
 * Controlled deep-research pilot. 208/Linux only. Two arms over one identical
 * source-controlled corpus:
 *   --arm workflow    the driver starts the registered deep-research workflow
 *   --arm librarian   the real librarian expert receives the same request as text
 * Real SessionManager, realAgentFactory, real provider: no response, tool result,
 * workflow implementation or model choice is ever simulated. External retrieval is
 * deliberately unavailable in this phase (empty private MCP projection, denied
 * retrieval tools, provider-only network), so this observes a provided-corpus run
 * and is NOT evidence of live-retrieval parity. It never claims scientific merit.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { inspect } from "node:util";
import { fileURLToPath } from "node:url";
import { installDriverStopControl } from "./workflow-driver-stop-control.mjs";
import { observeProviderStream } from "./workflow-stream-observer.mjs";

class Blocked extends Error {}
const hash = value => createHash("sha256").update(value).digest("hex");

/* ----------------------------- arguments ----------------------------- */
const argv = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index], value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value || value.startsWith("--")) throw new Error("Expected --name value arguments.");
  argv.set(key.slice(2), value);
}
const allowedArgs = new Set(["arm", "output", "provider-env", "source-packet", "request", "model-id",
  "thinking-level", "timeout-ms", "max-provider-requests", "token-soft-limit"]);
for (const key of argv.keys()) if (!allowedArgs.has(key)) throw new Error("Unknown argument: --" + key);
if (process.platform !== "linux") throw new Error("Run only in the designated isolated 208 Linux test directory.");
const arm = argv.get("arm");
assert(arm === "workflow" || arm === "librarian", "--arm must be workflow or librarian.");
for (const name of ["output", "provider-env", "source-packet", "request"]) {
  assert(argv.has(name) && isAbsolute(argv.get(name)), "--" + name + " must be an absolute path.");
}
const output = resolve(argv.get("output"));
const operatorStopFile = join(output, "STOP");
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const credentialReference = argv.get("provider-env");
const sourcePacketDir = resolve(argv.get("source-packet"));
const requestReference = resolve(argv.get("request"));
const thinkingLevel = argv.get("thinking-level") ?? "low";
assert(["off", "low"].includes(thinkingLevel), "--thinking-level must be off or low.");
const timeoutMs = Number(argv.get("timeout-ms") ?? 5_400_000);
assert(Number.isSafeInteger(timeoutMs) && timeoutMs >= 60_000 && timeoutMs <= 240 * 60_000, "--timeout-ms must be 60000..14400000.");
const maxProviderRequests = Number(argv.get("max-provider-requests") ?? 80);
assert(Number.isSafeInteger(maxProviderRequests) && maxProviderRequests > 0, "--max-provider-requests must be a positive integer.");
const tokenSoftLimit = Number(argv.get("token-soft-limit") ?? 1_500_000);
assert(Number.isSafeInteger(tokenSoftLimit) && tokenSoftLimit > 0, "--token-soft-limit must be a positive integer.");
const harnessVersion = 1;
const providerCap = 2;
const boundary = "Real SessionManager/Pi/provider over one caller-supplied corpus with external retrieval " +
  "deliberately unavailable. Engineering observation of one arm; not a scientific or comparative result.";

// Never reuse or overwrite prior evidence.
await lstat(output).then(() => { throw new Error("--output must be a NEW directory that does not exist yet."); },
  error => { if (error.code !== "ENOENT") throw error; });
await mkdir(output, { recursive: false, mode: 0o700 });
const dataRoot = join(output, "data");
await mkdir(join(dataRoot, "bp_template"), { recursive: true, mode: 0o700 });

/* ------------------------- provider reference ------------------------- */
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
const apiKey = sourceEnv.SQZ_API_KEY || sourceEnv.CUSTOM_API_KEY || sourceEnv.ANTHROPIC_API_KEY;
const configuredModel = sourceEnv.BP_MODEL || sourceEnv.ANTHROPIC_MODEL;
const modelId = argv.get("model-id") ?? configuredModel;
const rawBaseUrl = sourceEnv.CUSTOM_BASE_URL || sourceEnv.ANTHROPIC_BASE_URL;
const profileApi = sourceEnv.BP_API || sourceEnv.CUSTOM_API || "anthropic-messages";
assert(apiKey && modelId && rawBaseUrl, "The existing provider reference lacks required fields.");
const providerOrigin = new URL(rawBaseUrl).origin;
const secrets = [...new Set([apiKey, ...Object.entries(sourceEnv)
  .filter(([name]) => /KEY|TOKEN|SECRET|PASSWORD/u.test(name)).map(([, value]) => value)]
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
// Redact string values before serialization so a short configured secret can never
// corrupt JSON numbers, escape sequences or structural punctuation.
const json = value => JSON.stringify(value, (_key, item) => typeof item === "string" ? redact(item) : item);
const originalConsole = Object.fromEntries(["log", "info", "warn", "error", "debug"].map(name => [name, console[name].bind(console)]));
for (const name of Object.keys(originalConsole)) console[name] = (...items) =>
  originalConsole[name](...items.map(item => redact(typeof item === "string" ? item : inspect(item, { depth: 6, maxArrayLength: 60 }))));

/* --------------------------- isolation env --------------------------- */
Object.assign(process.env, {
  BP_LOCAL_MODE: "1", BP_DATA_DIR: dataRoot, BP_KB_ROOT: join(output, "knowledge-base"),
  PI_CODING_AGENT_DIR: join(output, "pi-agent"), PI_CODING_AGENT_SESSION_DIR: join(output, "pi-sessions"),
  BP_RESEARCH_PILOT_API_KEY: apiKey,
});
delete process.env.BP_MOCK;
delete process.env.BP_SHARED_DIR;
const privateMcpProjectionPath = join(dataRoot, "bp_template", "mcp_servers.json");

/* ------------------------------ corpus ------------------------------- */
const requiredSources = 7;
/** Resolve a caller-supplied relative path inside a root, rejecting escapes and links. */
async function containedFile(root, relativePath) {
  assert(typeof relativePath === "string" && relativePath.length > 0 && !relativePath.includes("\0"), "A corpus path must be a non-empty string.");
  assert(!isAbsolute(relativePath), "A corpus path must be relative: " + relativePath);
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, relativePath);
  assert(target === canonicalRoot || target.startsWith(canonicalRoot + sep), "A corpus path escapes its root: " + relativePath);
  const info = await lstat(target);
  assert(info.isFile(), "A corpus path must be a regular file: " + relativePath);
  const canonical = await realpath(target);
  assert(canonical.startsWith(canonicalRoot + sep), "A corpus path resolves outside its root: " + relativePath);
  return canonical;
}

const packetIndex = JSON.parse(await readFile(join(sourcePacketDir, "source-packet-index.json"), "utf8"));
const packetSources = Array.isArray(packetIndex?.sources) ? packetIndex.sources : [];
assert(packetSources.length > 0, "source-packet-index.json has no sources[].");
// Only the corpus the operator already marked ready; nothing is fetched or invented here.
const readySources = packetSources.filter(source => source?.status === "ready_remote_corpus");
assert(readySources.length === requiredSources,
  `Expected exactly ${requiredSources} ready_remote_corpus sources, found ${readySources.length}.`);

/** sourceId -> { text, metadata }: the exact bytes the run is allowed to reason over. */
const corpus = new Map();
for (const source of readySources) {
  const sourceId = source.id ?? source.source_id;
  assert(typeof sourceId === "string" && sourceId.length > 0, "A ready source has no id.");
  assert(!corpus.has(sourceId), "Duplicate source id in the packet index: " + sourceId);
  assert(typeof source.text_sha256 === "string" && /^[0-9a-f]{64}$/u.test(source.text_sha256),
    "A ready source has no valid text_sha256: " + sourceId);
  const path = await containedFile(sourcePacketDir, source.text_path);
  const text = await readFile(path, "utf8");
  const actual = hash(text);
  assert(actual === source.text_sha256.toLowerCase(),
    `Source ${sourceId} failed its text_sha256 check; the corpus on disk is not the declared corpus.`);
  assert(text.trim().length > 0, "Source text is empty: " + sourceId);
  corpus.set(sourceId, {
    text,
    metadata: {
      sourceId, textSha256: actual, textChars: text.length, textPath: source.text_path,
      title: source.title, url: source.primary_url ?? source.source_url,
      publishedDate: source.first_publication_date, year: source.publication_year,
      doi: source.doi, licenseUrl: source.license_url,
      venue: source.venue, authors: source.authors, license: source.license,
      retrievedAt: source.retrieved_at ?? source.retrievedAt,
    },
  });
}

/* ------------------------------ request ------------------------------ */
const request = JSON.parse(await readFile(requestReference, "utf8"));
assert(request && typeof request === "object" && !Array.isArray(request), "The request file must contain a JSON object.");
for (const field of ["question", "scope", "cutoffDate"]) {
  assert(typeof request[field] === "string" && request[field].trim().length > 0, `The request needs a non-empty ${field}.`);
}
assert(/^\d{4}-\d{2}-\d{2}$/u.test(request.cutoffDate), "request.cutoffDate must be YYYY-MM-DD.");
// External retrieval is deliberately unavailable, and the workflow budget defaults are non-zero.
// The request must pin both retrieval budgets to 0 before dispatch, or the run would spend
// stages on tool calls this harness denies and the observation would measure the denial.
const requestBudget = request.budget;
assert(requestBudget && typeof requestBudget === "object" && !Array.isArray(requestBudget),
  "The controlled request must declare a budget object.");
for (const field of ["maxResearchCalls", "maxExtractUrls"]) {
  assert(requestBudget[field] === 0, `Controlled mode requires request.budget.${field} === 0; found ` + inspect(requestBudget[field]));
}
const inputPaths = request.inputPaths;
assert(Array.isArray(inputPaths) && inputPaths.length === requiredSources,
  `The request must declare exactly ${requiredSources} inputPaths, one per ready source.`);
assert(new Set(inputPaths).size === inputPaths.length, "request.inputPaths must be unique.");
for (const path of inputPaths) {
  assert(typeof path === "string" && path.startsWith("materials/") && !path.includes("..") && !isAbsolute(path),
    "Each request inputPath must be a relative materials/… path: " + path);
}
// Deterministic, auditable pairing: the packet's ready sources in id order fill the
// declared inputPaths in their declared order. Recorded in the manifest as evidence.
const sourceIdsInOrder = [...corpus.keys()].sort();
const materialPlan = inputPaths.map((path, index) => ({ path, sourceId: sourceIdsInOrder[index] }));

/* ----------------------- private configuration ----------------------- */
const profileId = "research-pilot";
await writeFile(join(dataRoot, "bp_template", "providers.json"), JSON.stringify({
  selectedProfileId: profileId,
  profiles: [{
    id: profileId, baseUrl: rawBaseUrl, api: profileApi, apiKeyEnv: "BP_RESEARCH_PILOT_API_KEY",
    models: [modelId], reasoningModels: [modelId], contextWindow: 200_000,
    inputModalities: { [modelId]: ["text"] },
  }],
}, null, 2) + "\n", { mode: 0o600 });
// External retrieval is deliberately unavailable: an empty projection, not a broken one.
await writeFile(privateMcpProjectionPath, JSON.stringify({ mcpServers: {} }, null, 2) + "\n", { mode: 0o600 });

const { SessionManager } = await import("../packages/runtime/dist/session-manager.js");
const { realAgentFactory } = await import("../packages/runtime/dist/agent-factory.js");
const { deepResearchWorkflow } = await import("../packages/runtime/dist/workflows/deep-research.js");

/* ---------------------------- observations ---------------------------- */
const startedAt = Date.now();
const observations = {
  agents: [], calls: [], denials: [], messages: [], usage: [], providerHttp: [], blockedHttp: [],
  deniedProviderRequests: [], events: [],
};
let manager, sessionId, workspace;
let storageError, stopReason, stopPromise;
let providerRequestsStarted = 0;
let heartbeat, deadlineTimer, unsubscribeBus;
let observationOrder = 0;
let streamWrites = Promise.resolve();
let checkpointWrites = Promise.resolve();
const observerAbort = new AbortController();
const globalAbort = new AbortController();
const providerObservers = new Set();
const trackedTasks = new Set();

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
/** Run an invocation as a tracked task so overall stop stays responsive. */
function track(promise) {
  const task = promise.then(value => ({ status: "fulfilled", value }), error => ({ status: "rejected", error }));
  trackedTasks.add(task);
  void task.finally(() => trackedTasks.delete(task));
  return task;
}
const cleanupDeadlineMs = 30_000;
/** Bound one drain by a deadline; the timer is always cleared once the race settles. */
function bounded(work, deadlineMs) {
  let timer;
  const expiry = new Promise((_, reject) => {
    // Deliberately not unref'd: the deadline must still fire so the report records the timeout.
    timer = setTimeout(() => reject(new Error("The cleanup drain exceeded its " + deadlineMs + "ms deadline.")), deadlineMs);
  });
  return Promise.race([Promise.resolve(work), expiry]).finally(() => clearTimeout(timer));
}
function snapshot() {
  return {
    at: new Date().toISOString(), elapsedMs: Date.now() - startedAt, arm, sessionId, stopReason,
    state: sessionId && manager ? manager.getSessionState(sessionId) : undefined,
    runs: sessionId && manager ? manager.listWorkflowRuns(sessionId) : [],
    agents: observations.agents, denials: observations.denials, usage: observations.usage,
    providerRequestsStarted, maxProviderRequests, providerCap, tokenSoftLimit,
    deniedProviderRequests: observations.deniedProviderRequests.length,
    blockedHttp: observations.blockedHttp.length, storageError,
  };
}
async function checkpoint() {
  await atomicJson("status.json", snapshot());
}

/** Record the reason first, then stop the network; interrupt happens off the fetch path. */
async function stop(reason) {
  if (stopPromise) return stopPromise;
  stopReason = reason;
  append("events", { type: "stop_requested", reason });
  observerAbort.abort(new Error(reason));
  globalAbort.abort(new Error(reason));
  stopPromise = (async () => {
    await streamWrites;
    if (manager && sessionId) {
      await manager.interrupt(sessionId).catch(error => append("events", { type: "stop_error", error: redact(error.message) }));
    }
  })();
  return stopPromise;
}
const stopControl = installDriverStopControl({
  stopFile: operatorStopFile, onStop: stop,
  onError: error => append("events", { type: "stop_control_error", error: redact(error.message) }),
});

/* --------------------------- network boundary -------------------------- */
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  let url;
  try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); }
  catch { /* preserve native fetch behavior for unparsable inputs */ }
  const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (url && url.origin !== providerOrigin) {
    // External retrieval is deliberately unavailable in this phase; record and refuse.
    const row = { type: "blocked_request", origin: url.origin, method };
    observations.blockedHttp.push(row); append("http-blocked", row);
    throw new Error("This pilot allows the configured provider origin only; external retrieval is unavailable.");
  }
  if (stopReason) throw new Error("Driver stopped before another provider request: " + stopReason);
  const isProviderRequest = Boolean(url) && method === "POST";
  let providerRow;
  if (isProviderRequest) {
    // Refuse before counting. A denied attempt never reaches originalFetch, so it must not
    // consume budget nor claim a provider-request number no forwarded request ever used.
    if (providerRequestsStarted >= maxProviderRequests) {
      const denied = {
        type: "provider_request_denied", path: url.pathname, at: new Date().toISOString(),
        providerRequestsStarted, maxProviderRequests,
      };
      observations.deniedProviderRequests.push(denied);
      append("provider-http", denied); append("events", denied);
      void stop("provider_request_budget"); // Never await stop inside fetch.
      throw new Error("The provider request budget is exhausted.");
    }
    // Count only what is forwarded, so failures and retries still consume budget.
    providerRequestsStarted += 1;
    providerRow = { number: providerRequestsStarted, path: url.pathname, startedAt: new Date().toISOString() };
    observations.providerHttp.push(providerRow); append("provider-http", providerRow);
  }
  const requestSignal = input instanceof Request ? input.signal : undefined;
  const signals = [globalAbort.signal, init?.signal, requestSignal].filter(signal => signal instanceof AbortSignal);
  try {
    // Manual redirect: an automatic hop would send an uncounted second model request.
    const response = await originalFetch(input, { ...init, redirect: "manual", signal: AbortSignal.any(signals) });
    if (providerRow) {
      Object.assign(providerRow, { status: response.status, finishedAt: new Date().toISOString() });
      append("provider-http", providerRow);
    }
    if (isProviderRequest && typeof observeProviderStream === "function" && typeof init?.body === "string") {
      let body; try { body = JSON.parse(init.body); } catch { /* no observer for non-JSON bodies */ }
      if (body?.stream) {
        const observing = observeProviderStream(response, body, record => append("provider-streams", record),
          { signal: AbortSignal.any([observerAbort.signal, ...signals]) })
          .catch(error => append("events", { type: "provider_observer_error", error: redact(error.message) }));
        providerObservers.add(observing);
        void observing.finally(() => providerObservers.delete(observing));
      }
    }
    return response;
  } catch (error) {
    if (providerRow) {
      Object.assign(providerRow, { error: redact(error.message), finishedAt: new Date().toISOString() });
      append("provider-http", providerRow);
    }
    throw error;
  }
};

/* ---------------------------- agent factory ---------------------------- */
// Identical external-retrieval restriction in both arms, applied before invocation.
// A direct manager.startWorkflow dispatch is the driver's own call and stays allowed.
const deniedTools = new Set(["search_papers_local", "get_domain_knowledge_local", "research_search", "research_resolve", "workflow_start"]);
const isDenied = name => deniedTools.has(name) || name.startsWith("mcp__");

const bindings = new Map();
const factory = async params => {
  const isStage = Boolean(params.workflowModelBinding);
  const row = {
    id: randomUUID(), agent: params.agentName, role: params.role, stage: isStage,
    createdAt: new Date().toISOString(), status: "creating",
    toolNames: params.allowedToolNames ?? [], skillPaths: params.skillPaths ?? [],
    instructionHash: hash(params.systemPrompt ?? ""), instructionChars: params.systemPrompt?.length ?? 0,
    stopReasons: [], errors: [], submittedResults: 0, deniedCalls: 0,
  };
  observations.agents.push(row);

  // Keep every other real tool, skill and subagent exactly as the product built it.
  const tools = params.systemTools.map(tool => ({
    ...tool,
    execute: async (...args) => {
      const call = {
        id: randomUUID(), agent: params.agentName, name: tool.name, startedAt: new Date().toISOString(),
        status: "running", argumentHash: hash(JSON.stringify(args[0] ?? null)),
      };
      if (isDenied(tool.name)) {
        call.status = "denied";
        call.finishedAt = new Date().toISOString();
        row.deniedCalls++;
        observations.denials.push({ agent: params.agentName, name: tool.name, at: call.finishedAt });
        observations.calls.push(call); append("calls", call);
        return { content: [{ type: "text", text: "External retrieval is unavailable in this pilot: " + tool.name + " is disabled. Use only the supplied source files." }], isError: true };
      }
      observations.calls.push(call); append("calls", call);
      try {
        const result = await tool.execute(...args);
        call.status = result?.isError ? "returned_error" : "completed";
        call.finishedAt = new Date().toISOString();
        // Only an actual submit_result execution that did not error counts.
        if (tool.name === "submit_result" && !result?.isError) row.submittedResults++;
        append("calls", call);
        return result;
      } catch (error) {
        call.status = "threw"; call.error = redact(error.message); call.finishedAt = new Date().toISOString();
        append("calls", call);
        throw error;
      }
    },
  }));

  const session = await realAgentFactory({ ...params, systemTools: tools });
  // Host-only snapshot: public model/provider/thinking fields only, never credentials.
  try {
    const binding = session.getWorkflowModelBinding?.();
    if (binding) {
      row.binding = { model: binding.model?.id, provider: binding.model?.provider, thinkingLevel: binding.thinkingLevel };
      bindings.set(params.sessionId, row.binding);
    }
  } catch (error) { row.bindingError = redact(error.message); }

  const seen = new WeakSet();
  const seenIds = new Set();
  const unsubscribe = session.subscribe(event => {
    if (event.type !== "message_end" || event.message?.role !== "assistant") return;
    const message = event.message;
    // Deduplicate by object identity, or by message id when one is available.
    if (typeof message === "object") { if (seen.has(message)) return; seen.add(message); }
    const messageId = message.id ?? event.messageId;
    if (messageId) { if (seenIds.has(messageId)) return; seenIds.add(messageId); }
    // Visible text only: thinking blocks are never recorded.
    const visible = (message.content ?? []).filter(item => item.type === "text").map(item => item.text).join("\n");
    if (message.stopReason) row.stopReasons.push(message.stopReason);
    if (message.errorMessage) row.errors.push(redact(message.errorMessage));
    const usage = message.usage;
    if (usage) {
      const total = typeof usage.totalTokens === "number" ? usage.totalTokens
        : (usage.input ?? 0) + (usage.output ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      observations.usage.push({ agent: params.agentName, at: new Date().toISOString(), totalTokens: total, usage });
    }
    const record = {
      type: "assistant_message_end", order: ++observationOrder, agent: params.agentName,
      stopReason: message.stopReason, error: message.errorMessage ? redact(message.errorMessage) : undefined,
      usage, textChars: visible.length, text: visible.slice(0, 4000),
    };
    observations.messages.push(record);
    append("messages", record);
  });

  const prompt = session.prompt.bind(session), dispose = session.dispose?.bind(session);
  session.prompt = async (text, options) => {
    if (stopReason) throw new Error("Driver stopped before a new provider prompt: " + stopReason);
    const started = Date.now();
    row.status = "running"; row.startedAt ??= new Date(started).toISOString();
    try {
      const value = await prompt(text, options); // Preserve the real return value.
      row.status = row.stopReasons.at(-1) === "error" ? "model_error" : "completed";
      return value;
    } catch (error) {
      row.status = "failed"; row.errors.push(redact(error.message));
      throw error;
    } finally {
      row.finishedAt = new Date().toISOString();
      row.durationMs = Date.now() - started;
      append("events", { type: "prompt_finished", agent: params.agentName, status: row.status, durationMs: row.durationMs });
    }
  };
  if (dispose) {
    // A dispose failure can surface synchronously or as a rejected thenable; both are recorded
    // and rethrown, and a successful return value is handed back unchanged.
    const disposeFailed = error => {
      row.status = "failed";
      row.cleanupError = redact(error?.message ?? String(error));
      row.errors.push("dispose cleanup failed: " + row.cleanupError);
      append("events", { type: "dispose_failed", agent: params.agentName, error: row.cleanupError });
    };
    session.dispose = (...args) => {
      row.disposedAt = new Date().toISOString();
      try {
        unsubscribe();
        const value = dispose(...args); // Preserve the real return value and errors.
        if (value && typeof value.then === "function") {
          return Promise.resolve(value).catch(error => { disposeFailed(error); throw error; });
        }
        return value;
      } catch (error) {
        disposeFailed(error);
        throw error;
      }
    };
  }
  row.status = "created";
  return session;
};

/* ------------------------------- the run ------------------------------- */
const report = {
  boundary, harnessVersion, arm, result: "incomplete", issues: [],
  modelId, protocol: profileApi, thinkingLevel,
  externalRetrievalAvailable: false,
  externalRetrievalRestriction: "Empty private MCP projection, provider-origin-only network, and " +
    "identical denial of " + [...deniedTools].join(", ") + " plus mcp__* in both arms.",
  scientificQualityValidated: false,
};
let reportPathReported, inputDigestsAfter;
// A failure can also land after verification (a late model error, a dispose rejection during the
// drain), so the same view is recomputed after cleanup and the wording is shared to stay dedupable.
const failedAgents = () => observations.agents.filter(agent =>
  agent.status === "failed" || agent.status === "model_error" || agent.cleanupError);
const agentFailureIssue = agents => "Some agent sessions failed, reported a model error, or failed to dispose: " +
  agents.map(agent => agent.agent + ": " + (agent.cleanupError ?? agent.status)).join("; ");

try {
  await atomicJson("manifest.json", {
    startedAt: new Date(startedAt).toISOString(), harnessVersion, arm, boundary,
    modelId, protocol: profileApi, endpointHash: hash(rawBaseUrl), thinkingLevel,
    sourcePacket: sourcePacketDir, requestReference, sourceCount: corpus.size,
    materialPlan, dataRoot, nodeVersion: process.version, pid: process.pid, operatorStopFile,
    providerCap, maxProviderRequests, tokenSoftLimit, timeoutMs,
    privateConfigurationPathsExcludedFromEvidence: ["data/bp_template/mcp_servers.json", "data/bp_template/providers.json"],
    limitations: [
      "One arm, one corpus, one run: never evidence that either arm is better.",
      "External retrieval is deliberately unavailable; this is not live-retrieval parity evidence.",
      "No scientific or academic quality judgement is made.",
    ],
  });

  manager = new SessionManager({
    dataRoot, persist: true, agentFactory: factory, maxConcurrentAgents: 2,
    memLimitBytes: null, workflowImplementations: [deepResearchWorkflow],
  });
  await manager.setWorkflowAvailability({ revision: 1, enabledWorkflowIds: arm === "workflow" ? ["deep-research"] : [] });
  const session = await manager.createSession({ providerId: profileId, modelId, thinkingLevel, domainResources: "full" });
  sessionId = session.id;
  workspace = join(dataRoot, "workspaces", sessionId);
  unsubscribeBus = manager.subscribe(sessionId, event => {
    if (["workflow_run_update", "error", "system_message"].includes(event.type)) append("bus", { type: event.type, event });
  });

  // Materialize the exact verified bodies, plus a minimal metadata manifest.
  // No grader instructions and no prep logs enter the workspace.
  for (const { path, sourceId } of materialPlan) {
    const entry = corpus.get(sourceId);
    const target = join(workspace, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, entry.text, { mode: 0o600, flag: "wx" });
  }
  await writeFile(join(workspace, "materials", "sources.json"),
    JSON.stringify({ sources: materialPlan.map(({ path, sourceId }) => ({ path, ...corpus.get(sourceId).metadata })) }, null, 2) + "\n",
    { mode: 0o600, flag: "wx" });

  // Hashes captured BEFORE dispatch, so tampering during the run is detectable.
  const inputDigestsBefore = {};
  for (const { path } of materialPlan) inputDigestsBefore[path] = hash(await readFile(join(workspace, path)));
  const preDispatch = {
    inputs: inputDigestsBefore,
    sources: Object.fromEntries([...corpus].map(([id, entry]) => [id, entry.metadata.textSha256])),
    requestHash: hash(JSON.stringify(request)),
    harnessHash: hash(await readFile(fileURLToPath(import.meta.url), "utf8")),
    // Every built file the observed run actually executes, including the workflow's contract,
    // ledger, prompts, research adapter and its declared definition. A missing file is a real
    // error here: it means the observed build is not the build this evidence claims.
    buildHashes: Object.fromEntries(await Promise.all(
      ["session-manager.js", "agent-factory.js", "workflows/deep-research.js",
        "workflows/deep-research-ledger.js", "workflows/deep-research-contract.js",
        "workflows/deep-research-reading.js",
        "workflows/prompts/deep-research.js", "workflows/research-tools.js",
        "workflows/deep-research.definition.json"].map(async name =>
        [name, hash(await readFile(join(checkout, "packages/runtime/dist", name)))]))),
  };
  await atomicJson("pre-dispatch.json", preDispatch);

  heartbeat = setInterval(() => { void checkpoint(); }, 15_000);
  deadlineTimer = setTimeout(() => { void stop("overall_deadline"); }, timeoutMs);
  heartbeat.unref?.(); deadlineTimer.unref?.();

  const commonQuestion = [
    "Question: " + request.question,
    "Scope: " + request.scope,
    request.exclusions ? "Exclusions: " + request.exclusions : undefined,
    "Cutoff date: " + request.cutoffDate,
    "Source files (already in your workspace): " + inputPaths.join(", "),
    "Save the report to materials/report.md. Use only supplied sources.",
  ].filter(Boolean).join("\n");

  // Dispatch as a tracked task: admission can return before completion, and the
  // overall stop path must stay responsive while the run proceeds.
  const dispatch = arm === "workflow"
    ? track(manager.startWorkflow(sessionId, { workflowId: "deep-research", input: request, idempotencyKey: randomUUID() }))
    : track(manager.sendMessage(sessionId, commonQuestion, "librarian"));
  append("events", { type: "dispatched", arm });

  // Admission can settle long before the run finishes, and it can also reject; record the
  // outcome as it lands so the loop never treats an unsettled dispatch as an idle run.
  let dispatchOutcome;
  void dispatch.then(outcome => { dispatchOutcome = outcome; });

  let idleStreak = 0;
  while (idleStreak < 2) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const state = manager.getSessionState(sessionId);
    const runs = manager.listWorkflowRuns(sessionId);
    const pending = runs.some(run => run.status === "queued" || run.status === "running");
    const idle = dispatchOutcome?.status === "fulfilled" && !state?.workState?.active && !pending;
    idleStreak = idle ? idleStreak + 1 : 0;
    const totals = observations.usage.reduce((sum, entry) => sum + (entry.totalTokens ?? 0), 0);
    if (!stopReason && totals > tokenSoftLimit) void stop("token_soft_limit");
    if (stopReason || dispatchOutcome?.status === "rejected") break;
  }
  // Never await dispatch or stopPromise here: an unsettled one would outlast the stop path.
  // Cleanup drains both under the shared deadline.
  if (dispatchOutcome?.status === "rejected") throw dispatchOutcome.error;
  const dispatchValue = dispatchOutcome?.value;

  /* ----------------------------- verification ---------------------------- */
  const runs = manager.listWorkflowRuns(sessionId);
  const run = arm === "workflow" ? runs.find(entry => entry.id === dispatchValue?.id) ?? runs.at(-1) : undefined;
  const failures = [];
  if (stopReason) failures.push("The run stopped early: " + stopReason);

  // The canonical report each arm is required to produce.
  let reportRelative;
  if (arm === "workflow") {
    if (run?.status !== "succeeded") failures.push("The workflow run did not succeed: " + (run?.status ?? "no run") + (run?.error ? " (" + redact(run.error) + ")" : ""));
    reportRelative = run?.result?.data?.reportPath;
    if (!reportRelative) failures.push("The workflow result carries no reportPath.");
  } else {
    reportRelative = "materials/report.md";
    if (dispatchValue && dispatchValue.accepted === false) failures.push("The librarian message was not accepted.");
  }

  let reportText;
  if (reportRelative) {
    try {
      const reportPath = await containedFile(workspace, reportRelative);
      reportText = await readFile(reportPath, "utf8");
      if (reportText.trim().length === 0) failures.push("The canonical report is empty.");
      else {
        await copyFile(reportPath, join(output, "report.md"));
        reportPathReported = reportRelative;
      }
    } catch (error) { failures.push("The canonical report is unreadable or escapes the workspace: " + redact(error.message)); }
  }

  // Inputs must be byte-identical to what was captured before dispatch.
  inputDigestsAfter = {};
  for (const { path } of materialPlan) {
    try { inputDigestsAfter[path] = hash(await readFile(join(workspace, path))); }
    catch (error) { failures.push("An input file became unreadable: " + redact(error.message)); }
  }
  const inputsUnchanged = materialPlan.every(({ path }) => inputDigestsAfter[path] === preDispatch.inputs[path]);
  if (!inputsUnchanged) failures.push("At least one supplied input file changed during the run.");

  // Every artifact the workflow registered must still hash to its registered value.
  const artifactChecks = [];
  for (const artifact of run?.artifacts ?? []) {
    const check = { path: artifact.path, role: artifact.role, expected: artifact.sha256 };
    try {
      const path = await containedFile(workspace, artifact.path);
      check.actual = hash(await readFile(path));
      check.matches = check.actual === artifact.sha256;
    } catch (error) { check.matches = false; check.error = redact(error.message); }
    if (!check.matches) failures.push("A registered workflow artifact does not match its recorded hash: " + artifact.path);
    artifactChecks.push(check);
  }
  // Every observed agent must carry a binding naming exactly this run's model and thinking level.
  // The provider strings only have to agree with one another: the runtime's provider value is not
  // assumed to equal the profile id, so it is checked for consistency, never for a literal match.
  const bindingChecks = observations.agents.map(agent => ({
    agent: agent.agent, id: agent.id, stage: agent.stage,
    binding: agent.binding, bindingError: agent.bindingError,
  }));
  if (bindingChecks.length === 0) failures.push("No agent session was observed, so no model binding could be verified.");
  for (const check of bindingChecks) {
    const label = check.agent + " (" + check.id + ")";
    if (check.bindingError) failures.push("An agent model binding could not be read: " + label + ": " + check.bindingError);
    if (!check.binding) { failures.push("An agent reported no workflow model binding: " + label); continue; }
    if (check.binding.model !== modelId) {
      failures.push("An agent binding names another model: " + label + ": " + inspect(check.binding.model) + " !== " + modelId);
    }
    if (check.binding.thinkingLevel !== thinkingLevel) {
      failures.push("An agent binding names another thinking level: " + label + ": " + inspect(check.binding.thinkingLevel) + " !== " + thinkingLevel);
    }
  }
  const boundProviders = [...new Set(bindingChecks.filter(check => check.binding).map(check => String(check.binding.provider)))];
  if (boundProviders.length > 1) failures.push("Agent bindings disagree on the provider: " + boundProviders.join(", "));

  const stageFailures = failedAgents();
  if (stageFailures.length) failures.push(agentFailureIssue(stageFailures));

  Object.assign(report, {
    result: failures.length === 0 ? "completed" : "incomplete",
    sessionId, elapsedMs: Date.now() - startedAt, stopReason,
    binding: bindings.get(sessionId), agentBindings: bindingChecks,
    workflowRun: run ? { id: run.id, status: run.status, error: run.error ? redact(run.error) : undefined } : undefined,
    reportPath: reportPathReported, reportChars: reportText?.length,
    providerRequestsStarted, maxProviderRequests, blockedExternalRequests: observations.blockedHttp.length,
    deniedProviderRequests: observations.deniedProviderRequests.length,
    usageTotalTokens: observations.usage.reduce((sum, entry) => sum + (entry.totalTokens ?? 0), 0),
    sessionTokenUsage: manager.getSessionState(sessionId)?.tokenUsage,
    stopReasons: observations.agents.flatMap(agent => agent.stopReasons),
    deniedToolCalls: observations.denials.length,
    files: { inputs: inputDigestsAfter, inputsUnchanged, artifacts: artifactChecks },
    failures, issues: failures,
  });
  if (report.result !== "completed") report.evidence = "partial";
  // One run, one arm: never a better-than conclusion.
  report.interpretation = "Engineering observation of a single " + arm + " run over a fixed corpus. " +
    "It does not establish that either arm is better, and it is not scientific validation.";
  process.exitCode = report.result === "completed" ? 0 : 2;
} catch (error) {
  const interrupted = Boolean(stopReason);
  Object.assign(report, {
    result: interrupted ? "interrupted" : "failed",
    evidence: "partial", sessionId, stopReason, elapsedMs: Date.now() - startedAt,
    message: redact(error?.message ?? String(error)),
    stack: redact(error?.stack ?? ""),
    providerRequestsStarted, blockedExternalRequests: observations.blockedHttp.length,
    deniedProviderRequests: observations.deniedProviderRequests.length,
  });
  report.issues.push("The pilot did not finish: " + report.message);
  process.exitCode = interrupted ? 2 : 1;
} finally {
  clearInterval(heartbeat); clearTimeout(deadlineTimer);
  // Cut the network and the stream observers first: nothing new may start while draining.
  globalAbort.abort(new Error("driver_cleanup"));
  observerAbort.abort(new Error("driver_cleanup"));
  const cleanupErrors = [];
  const drain = (async () => {
    await stopPromise?.catch(() => {});
    if (manager && sessionId) await manager.interrupt(sessionId).catch(() => {});
    unsubscribeBus?.();
    await Promise.allSettled([...trackedTasks]);
    await manager?.shutdownAndSave();
    await Promise.allSettled([...providerObservers]);
  })();
  void drain.catch(() => {}); // The bounded race owns the outcome; never leave this unhandled.
  // One deadline for the whole drain: a hung interrupt or shutdown must not hold the driver.
  try { await bounded(drain, cleanupDeadlineMs); }
  catch (error) { cleanupErrors.push(redact(error?.message ?? String(error))); }
  try {
    // The private projection and the key reference never belong in evidence, drain or no drain.
    await rm(privateMcpProjectionPath, { force: true });
    delete process.env.BP_RESEARCH_PILOT_API_KEY;
  } catch (error) { cleanupErrors.push(redact(error?.message ?? String(error))); }
  if (cleanupErrors.length) {
    // Cleanup failure downgrades the report and the exit code; it is never hidden.
    const message = cleanupErrors.join("; ");
    report.result = report.result === "completed" ? "incomplete" : report.result;
    report.cleanupError = message;
    report.issues.push("Cleanup failed: " + message);
    if (!process.exitCode) process.exitCode = 1;
  }
  // A dispose rejection or a late model error can land during the drain, after the
  // acceptance check already ran; recompute the same view so it still reaches the report.
  const lateAgentFailures = failedAgents();
  if (lateAgentFailures.length) {
    const message = agentFailureIssue(lateAgentFailures);
    if (!report.issues.includes(message)) report.issues.push(message);
    if (Array.isArray(report.failures) && !report.failures.includes(message)) report.failures.push(message);
    report.finalAgentFailures = lateAgentFailures.map(agent => ({
      agent: agent.agent, status: agent.status, cleanupError: agent.cleanupError,
    }));
    if (report.result === "completed") { report.result = "incomplete"; report.evidence = "partial"; }
    if (!process.exitCode) process.exitCode = 2;
  }
  if (storageError) {
    report.result = "failed";
    report.issues.push("Telemetry storage failed: " + storageError);
    process.exitCode = 1;
  }
  await atomicJson("report.json", report).catch(() => {});
  await checkpoint().catch(() => {});
  await streamWrites; await checkpointWrites;
  globalThis.fetch = originalFetch;
  stopControl.dispose();
  console.log(JSON.stringify({ result: report.result, arm, exitCode: process.exitCode ?? 0, output }));
  for (const [name, method] of Object.entries(originalConsole)) console[name] = method;
  // No forced process.exit: either the drain settled, or the timeout is recorded as a
  // cleanup failure and the runtime is left to exit on its own remaining work.
}
