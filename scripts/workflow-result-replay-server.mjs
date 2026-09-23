#!/usr/bin/env node
/**
 * 208/Linux only. UI access check for already saved real workflow artifacts.
 * Copies one settled session into a new directory; never re-runs its model.
 * Usage: --source <completed-driver-output> --output <NEW-replay-directory>
 *        [--source-kind writing-acceptance|draft-delivery] [--ttl-minutes 30]
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { createServer as createPortProbe } from "node:net";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "linux", "Use only the isolated 208 Linux host.");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  assert(["--source", "--output", "--source-kind", "--ttl-minutes"].includes(process.argv[i]) && process.argv[i + 1], "Usage: --source completed-output --output NEW-replay-dir [--source-kind writing-acceptance|draft-delivery] [--ttl-minutes 30]");
  args.set(process.argv[i], process.argv[i + 1]);
}
assert(args.has("--source") && args.has("--output"));
const sourceKind = args.get("--source-kind") ?? "writing-acceptance";
assert(["writing-acceptance", "draft-delivery"].includes(sourceKind), "Unsupported replay source kind.");
const draftDelivery = sourceKind === "draft-delivery";
const ttlMinutes = Number(args.get("--ttl-minutes") ?? 30);
assert(Number.isSafeInteger(ttlMinutes) && ttlMinutes >= 1 && ttlMinutes <= 1440, "--ttl-minutes must be an integer from 1 to 1440.");
const source = await realpath(args.get("--source")); const output = resolve(args.get("--output"));
assert(!output.startsWith(source + sep) && output !== source, "Replay must be separate from the original run.");
const sourceReportPath = join(source, draftDelivery ? "recovery-report.json" : "real-acceptance-report.json");
const sourceReportBytes = await readFile(sourceReportPath);
const sourceReport = JSON.parse(sourceReportBytes.toString("utf8"));
if (draftDelivery) {
  assert.equal(sourceReport.status, "passed", "Draft delivery must already have passed its real recovery check.");
  assert.equal(sourceReport.mode, "user-followup");
  assert.equal(sourceReport.deliveredActualPaths, true);
  assert.equal(sourceReport.pendingCount, 0);
  assert.equal(sourceReport.terminalKeyCount, 1);
  assert.equal(sourceReport.workflowStartAttempts, 0);
  assert.equal(sourceReport.otherAgentAttempts, 0);
  assert.equal(sourceReport.originalSourceUnchanged, true);
  assert.equal(sourceReport.workspacePreservation?.unchanged, true);
  assert.equal(sourceReport.cleanupComplete, true, "Wait for the recovery driver to finish cleanup.");
  assert(Number.isFinite(Date.parse(sourceReport.finishedAt)), "Recovery has no completed timestamp.");
} else {
  assert(["positive", "explicit-positive"].includes(sourceReport.scenario) && sourceReport.runtimeStatus === "succeeded", "Wait for the original workflow to finish and write its final report.");
  const sourceStatus = JSON.parse(await readFile(join(source, "status.json"), "utf8"));
  assert.equal(sourceStatus.workState?.workState?.active, false, "Source driver still has active work; do not copy a live run.");
}
const sessionId = sourceReport.sessionId; const runId = sourceReport.runId;
assert(/^[a-zA-Z0-9-]+$/.test(sessionId) && /^wf_[a-zA-Z0-9-]+$/.test(runId));
const sourceState = join(source, "data", ".bp", sessionId); const sourceWorkspace = join(source, "data", "workspaces", sessionId);
const sourceLedgerBytes = await readFile(join(sourceState, "tasks.json"));
const ledger = JSON.parse(sourceLedgerBytes.toString("utf8"));
assert.equal(ledger.notifications.length, 0, "Source still has undelivered notifications; do not create a replay that could synthesize delivery.");
assert(ledger.system_keys?.includes(`workflow:${runId}:terminal`), "Source terminal outbox has not settled.");
if (draftDelivery) {
  assert.equal(ledger.tasks.length, 0, "Draft replay must not contain unrelated task work.");
  assert.equal(ledger.system_keys.filter(key => key === `workflow:${runId}:terminal`).length, 1);
}
const stored = JSON.parse(await readFile(join(sourceState, "workflows.json"), "utf8"));
assert(stored.runs.every(run => ["succeeded", "failed", "cancelled", "interrupted"].includes(run.status)), "Source contains a live run.");
const run = stored.runs.find(item => item.id === runId); assert.equal(run?.status, "succeeded");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const sourceEventsBytes = await readFile(join(sourceState, "events.jsonl"));
const sourceEventsHash = hash(sourceEventsBytes);
const sourceReportHash = hash(sourceReportBytes); const sourceLedgerHash = hash(sourceLedgerBytes);
const sourceDeliveryMessages = [];
if (draftDelivery) {
  const events = sourceEventsBytes.toString("utf8").split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line));
  const latestState = events.filter(event => event.session_id === sessionId && event.type === "CUSTOM" && event.name === "session_state").at(-1);
  assert.equal(latestState?.value?.workState?.active, false, "Latest saved source state still has active work.");
  assert.equal(latestState?.value?.runState?.active, false, "Latest saved source state still has an active run.");
  const messages = new Map();
  for (const event of events) {
    if (event.session_id !== sessionId || event.agent_name !== "principal") continue;
    if (event.type === "TEXT_MESSAGE_START" && event.role === "assistant") messages.set(event.message_id, { messageId: event.message_id, runId: event.run_id, text: "", ended: false });
    const message = messages.get(event.message_id); if (!message) continue;
    if (event.type === "TEXT_MESSAGE_CONTENT") message.text += event.delta;
    if (event.type === "TEXT_MESSAGE_END") message.ended = true;
  }
  assert(Array.isArray(sourceReport.deliveryTexts) && sourceReport.deliveryTexts.length, "Recovery has no recorded delivery text.");
  for (const message of messages.values()) {
    if (!message.ended || !sourceReport.deliveryTexts.includes(message.text)) continue;
    sourceDeliveryMessages.push({ messageId: message.messageId, runId: message.runId, textSha256: hash(message.text) });
  }
  assert(sourceDeliveryMessages.length, "The reported final delivery is not present as a completed real assistant message in events.jsonl.");
}
const finalPaths = [run.result.data.finalTexPath, run.result.data.finalPdfPath];
const expectedArtifacts = new Map();
for (const artifact of run.artifacts) {
  assert(typeof artifact.path === "string" && typeof artifact.sha256 === "string");
  assert(!expectedArtifacts.has(artifact.path) || expectedArtifacts.get(artifact.path) === artifact.sha256, "Conflicting stored artifact identities.");
  expectedArtifacts.set(artifact.path, artifact.sha256);
}
for (const path of finalPaths) assert(expectedArtifacts.has(path), "Final artifact is absent from the saved run.");
if (draftDelivery) {
  assert(Array.isArray(sourceReport.deliveryMatches) && sourceReport.deliveryMatches.length);
  for (const group of sourceReport.deliveryMatches) for (const delivered of group) {
    assert.equal(expectedArtifacts.get(delivered.requestedPath), delivered.sha256, "Recovery delivery identity does not match the saved run.");
    for (const path of delivered.matchingPaths) {
      const copy = (sourceReport.copiedArtifacts ?? []).find(file => file.path === path);
      assert.equal(expectedArtifacts.get(path) ?? copy?.sha256, delivered.sha256, "Delivery path is neither a published alias nor a verified copy.");
      expectedArtifacts.set(path, delivered.sha256);
    }
  }
}
const originals = [];
for (const [path, expectedHash] of expectedArtifacts) {
  assert(typeof path === "string" && !path.startsWith("/") && !path.split("/").includes(".."));
  const file = await realpath(join(sourceWorkspace, path)); assert(file.startsWith(sourceWorkspace + sep));
  const bytes = await readFile(file);
  assert.equal(hash(bytes), expectedHash); originals.push({ path, sha256: hash(bytes), bytes: bytes.length });
}
// Refuse existing port owners. Only servers created below will ever be stopped.
for (const port of [19332, 19333]) await new Promise((done, reject) => {
  const server = createPortProbe(); server.once("error", reject); server.listen(port, "127.0.0.1", () => server.close(done));
});
await mkdir(output, { recursive: false, mode: 0o700 });
const dataRoot = join(output, "data"); const replayState = join(dataRoot, ".bp", sessionId); const workspace = join(dataRoot, "workspaces", sessionId);
await mkdir(replayState, { recursive: true }); await mkdir(dirname(workspace), { recursive: true });
// events.jsonl is the real Web transcript. Do not copy provider credentials,
// Pi auth/config/history, managed plugins or executable extensions.
for (const name of ["meta.json", "events.jsonl", "tasks.json", "trace.json", "usage.json", "stats.json", "workflows.json", "provider.json"]) {
  const from = join(sourceState, name);
  try { const info = await lstat(from); assert(info.isFile() && !info.isSymbolicLink()); await cp(from, join(replayState, name), { errorOnExist: true, force: false }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
}
// Label only the copied session. Its original messages and artifact bytes stay
// unchanged, and viewers can distinguish this result from a fresh live run.
const replayMetaPath = join(replayState, "meta.json");
const replayMeta = JSON.parse(await readFile(replayMetaPath, "utf8"));
const originalDate = typeof replayMeta.createdAt === "string" ? replayMeta.createdAt.slice(0, 10) : "historical";
replayMeta.title = `[Read-only result ${originalDate}] ${replayMeta.title ?? "Writing workflow"}`;
await writeFile(replayMetaPath, JSON.stringify(replayMeta, null, 2) + "\n");
let files = 0, bytes = 0;
async function inspectWorkspace(path) {
  const info = await lstat(path); assert(!info.isSymbolicLink(), "Replay does not follow links back into original or external data.");
  if (info.isDirectory()) { for (const name of await readdir(path)) await inspectWorkspace(join(path, name)); }
  else { assert(info.isFile()); files++; bytes += info.size; assert(files <= 30_000 && bytes <= 1_000_000_000, "Replay copy exceeds its bounded scope."); }
}
await inspectWorkspace(sourceWorkspace);
await cp(sourceWorkspace, workspace, { recursive: true, dereference: false, errorOnExist: true, force: false });
assert.equal(hash(await readFile(join(sourceState, "events.jsonl"))), sourceEventsHash, "Original history changed during copy; retry after it settles.");
assert.equal(hash(await readFile(join(sourceState, "tasks.json"))), sourceLedgerHash, "Original ledger changed during copy; retry after it settles.");
assert.equal(hash(await readFile(sourceReportPath)), sourceReportHash, "Original report changed during copy; retry after it settles.");
for (const artifact of originals) assert.equal(hash(await readFile(join(workspace, artifact.path))), artifact.sha256);

const boundary = draftDelivery
  ? "Read-only UI access check for an already delivered draft using its real copied assistant message and saved artifacts. This is existing-draft UI delivery, not complete writing, refinement, citation, scientific-quality or automatic-terminal-delivery acceptance. No model call, synthesized message, new workflow or additional writing run."
  : "Read-only UI replay of an already completed real workflow's copied artifacts/history. No model call, new workflow, or additional writing run.";
const observations = { agentCreationAttempts: 0, deniedMutations: [], blockedExternalRequests: [] };
const previousFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["http://127.0.0.1:19332", "http://127.0.0.1:19333"].includes(url.origin)) {
    observations.blockedExternalRequests.push({ origin: url.origin, path: url.pathname });
    throw new Error("Read-only result replay forbids external network requests");
  }
  return previousFetch(input, options);
};
const env = { BP_LOCAL_MODE: "1", BP_ORCHESTRATOR: "static", BP_RUNTIME_URL: "http://127.0.0.1:19333", BP_DATA_DIR: dataRoot,
  BP_MOCK: "1", BP_KB_ROOT: join(output, "knowledge-base"), PI_CODING_AGENT_DIR: join(output, "pi-agent") };
Object.assign(process.env, env); delete process.env.BP_SHARED_DIR;
const { serve } = await import("@hono/node-server");
const { SessionManager } = await import("../packages/runtime/dist/session-manager.js");
const { createServer } = await import("../packages/runtime/dist/server.js");
const { createApp } = await import("../packages/backend-core/dist/app.js");
const { StaticRuntimeOrchestrator } = await import("../packages/backend-core/dist/static-orchestrator.js");
const manager = new SessionManager({ dataRoot, persist: true, memLimitBytes: null, workflowImplementations: [],
  agentFactory: async () => { observations.agentCreationAttempts++; throw new Error("Read-only result replay cannot create or prompt an agent"); } });
let runtimeServer, backendServer, expiry, stopPromise;
const shutdown = new AbortController();
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readOnlyFetch = (app, runtime = false) => (request, ...rest) => {
  const path = new URL(request.url).pathname;
  // The backend's ordinary initial empty capability/config synchronization is
  // allowed. No session POST, tool call, file write or workflow registry exists.
  const sync = runtime && request.method === "PUT" && ["/runtime/capabilities", "/config/workflows"].includes(path);
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !sync) {
    observations.deniedMutations.push({ method: request.method, path });
    return Response.json({ error: "This isolated result replay is read-only." }, { status: 403 });
  }
  return app.fetch(request, ...rest);
};
const ready = server => server.listening ? Promise.resolve() : new Promise((done, reject) => { server.once("listening", done); server.once("error", reject); });
const close = server => !server ? Promise.resolve() : new Promise(done => { server.close(done); server.closeIdleConnections?.(); server.closeAllConnections?.(); });
function stop(reason) {
  return stopPromise ??= (async () => {
    clearTimeout(expiry); shutdown.abort(); await Promise.all([close(backendServer), close(runtimeServer)]); await manager.shutdownAndSave();
    const sourceHistoryUnchanged = hash(await readFile(join(sourceState, "events.jsonl"))) === sourceEventsHash;
    const sourceLedgerUnchanged = hash(await readFile(join(sourceState, "tasks.json"))) === sourceLedgerHash;
    const sourceReportUnchanged = hash(await readFile(sourceReportPath)) === sourceReportHash;
    const sourceArtifactsUnchanged = (await Promise.all(originals.map(async artifact => hash(await readFile(join(sourceWorkspace, artifact.path))) === artifact.sha256))).every(Boolean);
    await writeFile(join(output, "replay-final.json"), JSON.stringify({ boundary, sourceKind, reason, sessionId, runId, observations, sourceHistoryUnchanged, sourceLedgerUnchanged, sourceReportUnchanged, sourceArtifactsUnchanged }, null, 2));
    globalThis.fetch = previousFetch;
  })();
}
try {
  await manager.ensurePersistentLayout(); const restored = await manager.restoreFromDisk(); assert(restored.includes(sessionId));
  assert.equal(observations.agentCreationAttempts, 0); assert.equal(manager.getSessionState(sessionId).workState.active, false);
  const { app: runtimeApp } = createServer({ manager, instanceId: `result-replay-${randomUUID()}` });
  runtimeServer = serve({ fetch: readOnlyFetch(runtimeApp, true), hostname: "127.0.0.1", port: 19333 }); await ready(runtimeServer);
  const backendApp = createApp({ orchestrator: new StaticRuntimeOrchestrator({ baseUrl: "http://127.0.0.1:19333" }),
    dataDir: dataRoot, env, serveWeb: true, webRoot: join(checkout, "packages/web/dist"), kbManagementEnabled: false, shutdownSignal: shutdown.signal });
  backendServer = serve({ fetch: readOnlyFetch(backendApp), hostname: "127.0.0.1", port: 19332 }); await ready(backendServer);
  const manifest = { boundary, sourceKind, status: "ready", source, output, pid: process.pid, sessionId, runId, backendUrl: "http://127.0.0.1:19332", originals, ttlMinutes,
    sourceHistorySha256: sourceEventsHash, sourceReportSha256: sourceReportHash, sourceDeliveryMessages,
    expected: "Open the original completed assistant delivery message and click its existing TeX/PDF links. Do not synthesize a replacement message or treat draft access as complete writing acceptance." };
  await writeFile(join(output, "replay-ready.json"), JSON.stringify(manifest, null, 2)); console.log(JSON.stringify(manifest));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { void stop(signal).then(() => process.exit(0), error => { console.error(error); process.exit(1); }); });
  expiry = setTimeout(() => { void stop("expired").then(() => process.exit(0)); }, ttlMinutes * 60_000); expiry.unref();
} catch (error) { console.error(error); await stop("startup-failed"); process.exitCode = 1; }
