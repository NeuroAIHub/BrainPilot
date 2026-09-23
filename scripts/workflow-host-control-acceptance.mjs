#!/usr/bin/env node
/**
 * TEST ONLY — 208/Linux. No provider calls and no writing/routing-quality claim.
 * Drives real backend plugin, session/message/interrupt/file/history HTTP routes.
 * The injected AgentSession's release latch only makes deterministic completion
 * possible; it is explicitly NOT a user workflow control or approval flow.
 *
 * node scripts/workflow-host-control-acceptance.mjs --output <NEW-dir> [--ui-stop]
 * With --ui-stop, ui-ready.json identifies a real running conversation. Click its
 * real browser Stop button within 5 minutes; no fixture Stop endpoint is used.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") throw new Error("This acceptance driver runs only on the designated Linux/208 host.");
const args = process.argv.slice(2);
if (args[0] !== "--output" || !args[1] || args.length > 3 || (args[2] && args[2] !== "--ui-stop")) {
  throw new Error("Usage: --output <NEW-directory> [--ui-stop]");
}
const output = resolve(args[1]);
await mkdir(output, { recursive: false, mode: 0o700 });
const fixtureOutput = join(output, "fixture");
const fixtureScript = join(dirname(fileURLToPath(import.meta.url)), "workflow-ui-fixture-server.mjs");
const useUiStop = args[2] === "--ui-stop";
const report = {
  testOnly: true, boundary: "Real product HTTP/UI control and persistence wiring with injected deterministic AgentSessions. No provider/model routing or manuscript quality was tested. The release latch is test orchestration only.",
  startedAt: new Date().toISOString(), checks: [], requests: [], fixtureOutput, useUiStop,
};
let child;
let generation = 0;
let ready;
let token;
const backendUrl = "http://127.0.0.1:19332";
const runtimeUrl = "http://127.0.0.1:19333";
const startDirective = 'TEST FIXTURE scripted tool request. [[tool:workflow_start {"workflowId":"paper-writing","input":{"fixture":true}}]]';
const delay = ms => new Promise(done => setTimeout(done, ms));

async function waitFor(fn, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(50);
  }
  throw new Error(`Timeout: ${label}${last ? ` (${last.message})` : ""}`);
}
async function portsFree() {
  for (const port of [19332, 19333]) {
    await new Promise((done, reject) => {
      const probe = createServer(); probe.once("error", error => reject(new Error(`Port ${port} is occupied; no existing process will be stopped: ${error.message}`)));
      probe.listen(port, "127.0.0.1", () => probe.close(done));
    });
  }
}
async function boot(resume = false) {
  await portsFree();
  generation++;
  const log = createWriteStream(join(output, `server-${generation}.log`), { flags: "wx" });
  child = spawn(process.execPath, [fixtureScript, resume ? "--resume" : "--output", fixtureOutput], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.once("close", () => log.end());
  const pid = child.pid;
  ready = await waitFor(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Owned fixture exited; inspect server-${generation}.log`);
    const value = JSON.parse(await readFile(join(fixtureOutput, "fixture-ready.json"), "utf8"));
    return value.pid === pid && value.status === "ready" ? value : false;
  }, "owned fixture ready", 60_000);
  token = JSON.parse(await readFile(join(fixtureOutput, "fixture-owner.json"), "utf8")).token;
  return ready;
}
async function stopOwned(signal = "SIGTERM") {
  const owned = child;
  if (!owned || owned.exitCode !== null || owned.signalCode !== null) return;
  // This handle was created above; never look up or kill another port's owner.
  const done = new Promise(resolveExit => owned.once("exit", resolveExit));
  owned.kill(signal);
  await Promise.race([done, delay(15_000).then(() => { throw new Error("Owned fixture did not exit after requested signal"); })]);
  child = undefined;
  await waitFor(async () => { await portsFree(); return true; }, "owned fixture ports released");
}
async function http(path, method = "GET", body, options = {}) {
  const response = await fetch(`${options.control ? runtimeUrl : backendUrl}${path}`, {
    method, signal: AbortSignal.timeout(15_000), headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(options.control ? { "x-fixture-token": token } : {}),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (!options.quiet) report.requests.push({ method, path, status: response.status, testControl: !!options.control });
  assert(response.ok, `${method} ${path}: ${response.status} ${text.slice(0, 1000)}`);
  return options.raw ? text : text ? JSON.parse(text) : null;
}
const catalog = sid => http(`/api/sessions/${sid}/workflows`, "GET", undefined, { quiet: true });
const state = sid => http(`/api/sessions/${sid}/state`, "GET", undefined, { quiet: true });
const diagnostics = () => http("/__fixture/diagnostics", "GET", undefined, { control: true, quiet: true });
const terminalEvents = async runId => (await diagnostics()).events.filter(e => e.kind === "principal-prompt" && e.terminal && e.runId === runId);
const runState = async (sid, id) => (await catalog(sid)).runs.find(run => run.id === id);
async function stageWaiting(sid, id, stageId) {
  await waitFor(async () => (await diagnostics()).stageDiagnostics.some(stage => stage.runId === id && stage.stageId === stageId && stage.started && !stage.disposed), `${stageId} waiting`);
  const current = await state(sid);
  assert.equal(current.runState.active, false, "Principal must be idle while the stage owns execution");
  assert.equal(current.workState.active, true);
  assert.equal((await runState(sid, id)).status, "running");
}
async function toggle(enabled) {
  await http(`/api/plugins/${ready.pluginId}/enabled`, "PUT", { enabled });
  const projection = JSON.parse(await readFile(join(fixtureOutput, "data", "workflow-availability.json"), "utf8"));
  assert.equal(projection.enabledWorkflowIds.includes("paper-writing"), enabled);
  return projection;
}
async function release(id, stageId) { await http(`/__fixture/release/${id}/${stageId}`, "POST", {}, { control: true }); }
async function send(sid, content) { return http(`/api/sessions/${sid}/messages`, "POST", { content }); }
async function principalIdle(sid) { await waitFor(async () => !(await state(sid)).runState.active, "Principal idle"); }
async function deniedStart(sid) {
  const before = (await diagnostics()).events.filter(e => e.kind === "tool-result" && e.sessionId === sid && e.toolName === "workflow_start").length;
  const runs = (await catalog(sid)).runs.length;
  await send(sid, startDirective);
  const event = await waitFor(async () => {
    const events = (await diagnostics()).events.filter(e => e.kind === "tool-result" && e.sessionId === sid && e.toolName === "workflow_start");
    return events.length > before ? events.at(-1) : false;
  }, "real registered tool rejects disabled start");
  assert.equal(event.isError, true); assert.match(String(event.result), /disabled/i);
  await principalIdle(sid); assert.equal((await catalog(sid)).runs.length, runs);
  return event;
}
async function newSession(title) {
  const created = await http("/api/sessions", "POST", { title: `[TEST FIXTURE] ${title}`, domainResources: "base", thinkingLevel: "off" });
  return created.id;
}
async function startNew(sid) {
  const prior = new Set((await catalog(sid)).runs.map(r => r.id));
  await send(sid, 'TEST FIXTURE inspect before scripted selection. [[tool:workflow_search {}]]'); await principalIdle(sid);
  await send(sid, startDirective);
  return waitFor(async () => (await catalog(sid)).runs.find(r => !prior.has(r.id)), "new run accepted");
}
async function artifactText(sid, path) {
  return http(`/api/sandbox/${sid}/files/raw?path=${encodeURIComponent(path)}`, "GET", undefined, { raw: true });
}
async function retained(sid, id) {
  const run = await runState(sid, id);
  const artifact = run.artifacts.find(a => a.path.endsWith("/retained-note.txt"));
  assert(artifact, "already committed material is retained");
  assert.match(await artifactText(sid, artifact.path), /committed before Stop/);
  return artifact;
}
async function historyDeliveries(sid, id) {
  const history = await http(`/api/sessions/${sid}/history?limit=0`);
  const messages = new Map();
  const finished = new Set();
  for (const event of history.events) {
    if (event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_CHUNK") {
      messages.set(event.message_id, (messages.get(event.message_id) ?? "") + event.delta);
      if (event.type === "TEXT_MESSAGE_CHUNK") finished.add(event.message_id);
    } else if (event.type === "TEXT_MESSAGE_END") finished.add(event.message_id);
  }
  return [...messages].filter(([messageId, content]) => finished.has(messageId) && content.includes(`TEST FIXTURE RESULT DELIVERY ${id}`));
}
async function ledgerKeyCount(sid, id) {
  const ledger = JSON.parse(await readFile(join(fixtureOutput, "data", ".bp", sid, "tasks.json"), "utf8"));
  return (ledger.system_keys ?? []).filter(key => key === `workflow:${id}:terminal`).length;
}
function check(name, detail) { report.checks.push({ name, passed: true, ...detail }); console.log(JSON.stringify({ check: name, passed: true })); }

try {
  const manifest = await boot();
  const succeededSid = manifest.sessionId; const succeededId = manifest.runId;
  await stageWaiting(succeededSid, succeededId, "hold-1");
  const off = await toggle(false);
  await stageWaiting(succeededSid, succeededId, "hold-1");
  await deniedStart(succeededSid);
  const disabledSid = await newSession("disabled new-session admission");
  await deniedStart(disabledSid);
  check("real plugin disable blocks cached Principal and new-session tools; accepted run remains active", { revision: off.revision });
  await release(succeededId, "hold-1");
  await stageWaiting(succeededSid, succeededId, "hold-2");
  assert.equal((await catalog(succeededSid)).definitions.find(d => d.id === "paper-writing").enabled, false);
  await release(succeededId, "hold-2");
  await waitFor(async () => (await runState(succeededSid, succeededId)).status === "succeeded" && !(await state(succeededSid)).workState.active, "success and result return");
  await waitFor(async () => (await terminalEvents(succeededId)).length === 1, "one terminal delivery");
  const succeeded = await runState(succeededSid, succeededId);
  const finalArtifact = succeeded.artifacts.find(a => a.path.endsWith("/fixture-result.txt")); assert(finalArtifact);
  assert.match(await artifactText(succeededSid, finalArtifact.path), /both accepted stages completed/);
  assert.equal(await ledgerKeyCount(succeededSid, succeededId), 1);
  const initialHistory = await historyDeliveries(succeededSid, succeededId);
  assert.equal(initialHistory.length, 1, "one final message in real persisted event history");
  check("disabled accepted run enters its next stage and returns one persisted result", { sessionId: succeededSid, runId: succeededId, artifacts: succeeded.artifacts });

  await toggle(true);
  const stoppedSid = await newSession("PI idle + workflow running; browser Stop");
  const stoppedRun = await startNew(stoppedSid); await stageWaiting(stoppedSid, stoppedRun.id, "hold-1");
  const retainedBefore = await retained(stoppedSid, stoppedRun.id);
  const stopOff = await toggle(false); await stageWaiting(stoppedSid, stoppedRun.id, "hold-1");
  if (useUiStop) {
    const ui = { testOnly: true, pid: child.pid, backendUrl, sessionId: stoppedSid, runId: stoppedRun.id,
      sessionTitle: "[TEST FIXTURE] PI idle + workflow running; browser Stop", expected: "Click the real conversation Stop button after reload/navigation; verify the interrupt request in browser evidence." };
    await writeFile(join(output, "ui-ready.json"), JSON.stringify(ui, null, 2)); console.log(JSON.stringify({ uiReady: ui }));
    await waitFor(async () => (await runState(stoppedSid, stoppedRun.id)).status === "cancelled", "real browser Stop", 300_000);
  } else {
    const interruption = await http(`/api/sessions/${stoppedSid}/interrupt`, "POST", {});
    assert.equal(interruption.interrupted, true); assert.equal(interruption.scope, "session");
  }
  await waitFor(async () => !(await state(stoppedSid)).workState.active, "Stop fully settled");
  const stopped = await runState(stoppedSid, stoppedRun.id); assert.equal(stopped.status, "cancelled");
  assert.deepEqual(await retained(stoppedSid, stopped.id), retainedBefore);
  assert(!stopped.artifacts.some(a => a.path.endsWith("/fixture-result.txt")));
  const stoppedStage = (await diagnostics()).stageDiagnostics.find(s => s.runId === stopped.id);
  assert(stoppedStage.aborted && stoppedStage.disposed && !stoppedStage.submitted);
  assert.equal((await terminalEvents(stopped.id)).length, 0);
  check("session Stop cancels the real host stage while preserving committed material", { via: useUiStop ? "browser UI -> backend interrupt" : "backend HTTP interrupt", sessionId: stoppedSid, runId: stopped.id });

  await stopOwned(); await boot(true);
  assert.equal((await runState(succeededSid, succeededId)).status, "succeeded");
  assert.equal((await runState(stoppedSid, stopped.id)).status, "cancelled");
  assert.deepEqual(await retained(stoppedSid, stopped.id), retainedBefore);
  const restoredAvailability = JSON.parse(await readFile(join(fixtureOutput, "data", "workflow-availability.json"), "utf8"));
  assert.deepEqual(restoredAvailability, stopOff);
  await deniedStart(succeededSid); await deniedStart(disabledSid);
  assert.equal((await terminalEvents(succeededId)).length, 1);
  assert.equal(await ledgerKeyCount(succeededSid, succeededId), 1);
  assert.equal((await historyDeliveries(succeededSid, succeededId)).length, initialHistory.length);
  check("process restart restores disabled revision, succeeded/cancelled state and files without duplicate outbox", { revision: restoredAvailability.revision });

  await toggle(true);
  const crashSid = await newSession("owned process crash recovery");
  const crashRun = await startNew(crashSid); await stageWaiting(crashSid, crashRun.id, "hold-1");
  const crashRetained = await retained(crashSid, crashRun.id);
  await toggle(false);
  await stopOwned("SIGKILL"); // Only the exact fresh child owned by this driver.
  await boot(true);
  await waitFor(async () => (await runState(crashSid, crashRun.id)).status === "interrupted", "in-flight run restored as interrupted");
  // A user turn is a supported retry point for durable terminal reconciliation.
  await send(crashSid, "TEST FIXTURE inspect restored result; do not start a workflow."); await principalIdle(crashSid);
  await waitFor(async () => (await terminalEvents(crashRun.id)).length === 1, "interrupted result delivered once");
  await send(crashSid, "TEST FIXTURE ordinary follow-up; no new workflow."); await principalIdle(crashSid);
  assert.equal((await terminalEvents(crashRun.id)).length, 1);
  assert.equal(await ledgerKeyCount(crashSid, crashRun.id), 1);
  assert.deepEqual(await retained(crashSid, crashRun.id), crashRetained);
  assert.equal((await diagnostics()).stageDiagnostics.length, 0, "restore must not restart workflow model stages");
  assert.equal((await terminalEvents(succeededId)).length, 1);
  check("owned runtime crash restores interrupted run, preserves material and delivers failure once without replay", { sessionId: crashSid, runId: crashRun.id });
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = error.stack ?? String(error); process.exitCode = 1;
  console.error(report.error);
} finally {
  if (token && child && child.exitCode === null && child.signalCode === null) report.diagnostics = await diagnostics().catch(error => ({ error: String(error) }));
  await stopOwned().catch(error => { report.cleanupError = String(error); process.exitCode = 1; });
  report.finishedAt = new Date().toISOString();
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, report: join(output, "report.json") }));
}
