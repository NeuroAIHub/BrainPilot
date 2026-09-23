import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rawEvent = row => row.event ?? row;
const options = value => value === undefined ? [] : Array.isArray(value) && value.every(option => typeof option === "string") ? value.map(option => option.trim()) : null;
const questionIdentity = event => JSON.stringify({
  type: event.type, sessionId: event.session_id, eventId: event._event_id, requestId: event.request_id,
  agent: event.agent ?? event.agent_name, runId: event.run_id, at: event._ts,
  question: event.question, options: event.options ?? [], allowFreeText: event.allow_free_text !== false, timeoutSec: event.timeout_sec,
});

/** All supplied streams must describe the same instant, before driver cleanup. */
export function verifyPendingUserQuestion({ sessionId, calls, principalMessages, sessionEvents, persistedEvents }) {
  const last = principalMessages.at(-1);
  if (!last || last.agent !== "principal" || last.stopReason !== "toolUse" || last.error || !last.toolCalls?.includes("ask_user")) return null;
  const observed = sessionEvents.map(rawEvent);
  const saved = persistedEvents.map(rawEvent);
  for (const request of observed.toReversed()) {
    if (request.type !== "user_input_request" || request.session_id !== sessionId || request.agent !== "principal" ||
      !request.request_id || !request._event_id || typeof request.question !== "string" || !request.question.trim() || !Number.isFinite(Date.parse(request._ts))) continue;
    const durable = saved.find(event => questionIdentity(event) === questionIdentity(request));
    if (!durable) continue;
    if ([...observed, ...saved].some(event => event.session_id === sessionId && event.request_id === request.request_id &&
      ["user_input_response", "user_input_cancelled"].includes(event.type))) continue;
    const call = calls.find(item => item.agent === "principal" && !item.stageId && item.name === "ask_user" && item.status === "running" &&
      !item.error && typeof item.arguments?.question === "string" && item.arguments.question.trim() === request.question &&
      JSON.stringify(options(item.arguments?.options)) === JSON.stringify(request.options ?? []) &&
      (item.arguments?.allow_free_text !== false) === (request.allow_free_text !== false) &&
      Date.parse(item.startedAt) <= Date.parse(request._ts));
    if (!call) continue;
    return { kind: "persisted_pending_user_input", sessionId, requestId: request.request_id, eventId: request._event_id,
      requestAt: request._ts, question: request.question, options: [...(request.options ?? [])],
      toolCallObservationId: call.id, principalPromptId: last.promptId, principalMessageOrder: last.order,
      toolReturnedAnswer: false, scope: "Question was persisted and awaiting the user's answer before driver cleanup; no answer or completed manuscript is implied." };
  }
  return null;
}

/** Reclassify a preserved observation at its explicit question-cleanup boundary. */
export function recomputeWaitingQuestion({ report, events, calls, sessionEvents, persistedEvents }) {
  const stop = events.find(event => event.type === "stop_requested" && event.reason === "question_observed_without_answering");
  const cutoff = Date.parse(stop?.at);
  if (report.scenario !== "missing-inputs" || report.settledReason !== "needs_user_input" || report.workflowStartAttempts !== 0 ||
    report.acceptedRuns !== 0 || report.routingEnvironmentSatisfied !== true || !Number.isFinite(cutoff)) return null;
  const before = row => Date.parse(row.at ?? row._ts ?? row.event?._ts) < cutoff;
  const priorCalls = new Map();
  for (const call of calls.filter(before)) priorCalls.set(call.id, call);
  const evidence = verifyPendingUserQuestion({ sessionId: report.sessionId, calls: [...priorCalls.values()],
    principalMessages: events.filter(event => before(event) && event.type === "assistant_message_end" && event.agent === "principal"),
    sessionEvents: sessionEvents.filter(before), persistedEvents: persistedEvents.filter(before) });
  return evidence ? { result: "passed_observation", originalResult: report.result, settledReason: "needs_user_input", asOf: stop.at,
    cleanupReason: stop.reason, workflowStartAttempts: 0, acceptedRuns: 0, evidence,
    scope: "One live missing-input routing observation. The saved ask_user request was pending before the driver's intentional cancellation; this does not validate an answer, resumed execution or manuscript completion." } : null;
}

const lines = text => text.split(/\r?\n/u).filter(line => line.trim()).map(line => JSON.parse(line));
const sha256 = text => createHash("sha256").update(text).digest("hex");
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--self-check" && process.argv.length === 3) {
    const request = { type: "user_input_request", session_id: "fixture", agent: "principal", _event_id: "event-1", request_id: "request-1",
      run_id: "run-1", _ts: "2026-09-13T00:00:01.000Z", question: "Please supply the log.", options: ["Supply it", "Pause"], allow_free_text: true };
    const call = { id: "call-1", agent: "principal", name: "ask_user", status: "running", startedAt: "2026-09-13T00:00:00.900Z",
      arguments: { question: request.question, options: request.options } };
    const message = { type: "assistant_message_end", agent: "principal", stopReason: "toolUse", toolCalls: ["ask_user"], promptId: "prompt-1", order: 1 };
    const snapshot = { sessionId: "fixture", calls: [call], principalMessages: [message], sessionEvents: [{ event: request }], persistedEvents: [request] };
    assert.equal(verifyPendingUserQuestion(snapshot)?.requestId, request.request_id);
    for (const change of [
      { persistedEvents: [] }, { sessionEvents: [] }, { calls: [] },
      { calls: [{ ...call, status: "failed", error: "Persistence failed" }] },
      { calls: [{ ...call, arguments: { question: "A different question" } }] },
      { calls: [{ ...call, agent: "writer" }] },
      { calls: [{ ...call, arguments: { question: request.question, options: "invalid options" } }] },
      { calls: [{ ...call, arguments: { question: request.question, options: request.options, allow_free_text: false } }] },
      { principalMessages: [{ ...message, stopReason: "stop", toolCalls: [], text: "I plan to ask for the log." }] },
      { principalMessages: [message, { ...message, stopReason: "error", error: "Provider failure", toolCalls: [] }] },
      { persistedEvents: [{ ...request, question: "Unrelated saved question" }] },
      { persistedEvents: [request, { type: "user_input_cancelled", session_id: "fixture", request_id: request.request_id }] },
      { sessionEvents: [{ event: request }, { event: { type: "user_input_response", session_id: "fixture", request_id: request.request_id } }] },
    ]) assert.equal(verifyPendingUserQuestion({ ...snapshot, ...change }), null);
    const stopAt = "2026-09-13T00:00:02.000Z";
    const history = {
      report: { scenario: "missing-inputs", settledReason: "needs_user_input", workflowStartAttempts: 0, acceptedRuns: 0,
        routingEnvironmentSatisfied: true, sessionId: "fixture", result: "failed" },
      events: [{ ...message, at: "2026-09-13T00:00:00.800Z" }, { type: "stop_requested", reason: "question_observed_without_answering", at: stopAt },
        { ...message, stopReason: "error", error: "Cancelled by driver", at: "2026-09-13T00:00:02.002Z" }],
      calls: [{ ...call, at: call.startedAt }, { ...call, status: "failed", error: "ask_user interrupted", at: "2026-09-13T00:00:02.001Z" }],
      sessionEvents: [{ event: request, at: request._ts }],
      persistedEvents: [request, { type: "user_input_cancelled", session_id: "fixture", request_id: request.request_id, _ts: "2026-09-13T00:00:02.001Z" }],
    };
    assert.equal(recomputeWaitingQuestion(history)?.result, "passed_observation");
    assert.equal(recomputeWaitingQuestion({ ...history, events: history.events.map(event => event.error ? { ...event, at: "2026-09-13T00:00:01.500Z" } : event) }), null);
    assert.equal(recomputeWaitingQuestion({ ...history, report: { ...history.report, workflowStartAttempts: 1 } }), null);
    assert.equal(recomputeWaitingQuestion({ ...history, persistedEvents: [] }), null);
    assert.equal(recomputeWaitingQuestion({ ...history, events: history.events.filter(event => event.type !== "stop_requested") }), null);
    console.log(JSON.stringify({ status: "passed", providerRequests: 0, credentialsRead: false,
      acceptedPendingQuestionCases: 1, rejectedUnprovenQuestionCases: 13, historicalCleanupCases: 5 }));
  } else if (process.argv[2] === "--recompute" && process.argv[3] && process.argv[4] === "--output" && process.argv[5] && process.argv.length === 6) {
    const study = resolve(process.argv[3]); const output = resolve(process.argv[5]);
    const reportText = await readFile(join(study, "real-acceptance-report.json"), "utf8");
    const report = JSON.parse(reportText); assert(/^[A-Za-z0-9-]+$/u.test(report.sessionId));
    const paths = { events: "events.ndjson", calls: "calls.ndjson", sessionEvents: "session-events.ndjson",
      persistedEvents: `data/.bp/${report.sessionId}/events.jsonl` };
    const streams = {}; const sourceHashes = { "real-acceptance-report.json": sha256(reportText) };
    for (const [name, path] of Object.entries(paths)) {
      const content = await readFile(join(study, path), "utf8"); streams[name] = lines(content); sourceHashes[path] = sha256(content);
    }
    const result = recomputeWaitingQuestion({ report, ...streams });
    assert(result, "Saved evidence does not establish a persisted pending question before intentional driver cleanup.");
    for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(sha256(await readFile(join(study, path))), expected, `Source changed: ${path}`);
    const evidence = { ...result, originalStudy: study, reclassifiedAt: new Date().toISOString(), sourceHashes,
      classifierSha256: sha256(await readFile(fileURLToPath(import.meta.url))), originalEvidencePreserved: true, newModelRequests: 0 };
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ result: evidence.result, originalResult: report.result, output, newModelRequests: 0 }));
  } else throw new Error("Use --self-check or --recompute EXISTING-STUDY --output NEW-EVIDENCE.json");
}
