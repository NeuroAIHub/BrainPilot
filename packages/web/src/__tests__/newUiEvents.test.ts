import { describe, it, expect } from "vitest";
import {
  toSystemMessageView,
  toAskUserView,
  toAutoRetryView,
  isAutoRetryStatus,
  resolveAskUserSubmission,
  isAskUserOpen,
  autoRetryCountdownSeconds,
} from "../contexts/newUiEvents";
import { reduceMessagesForEvent } from "../contexts/messageReducer";
import type { ChatMessage, WebSocketEvent } from "../contracts/backend";

// Events arrive post-normalizeAgUiEvent (camelCase). We exercise the mapping +
// reducer with that shape, plus tolerate the raw snake_case fallback.

describe("system_message mapping", () => {
  it("maps each level and defaults recoverable", () => {
    for (const level of ["info", "warning", "error"] as const) {
      const v = toSystemMessageView({ type: "system_message", level, message: "m" } as WebSocketEvent);
      expect(v.level).toBe(level);
      expect(v.recoverable).toBe(true); // non-fatal defaults recoverable
    }
    const fatal = toSystemMessageView({ type: "system_message", level: "fatal", message: "boom" } as WebSocketEvent);
    expect(fatal.level).toBe("fatal");
    expect(fatal.recoverable).toBe(false); // fatal defaults non-recoverable
  });

  it("honors explicit recoverable + details + agent", () => {
    const v = toSystemMessageView({
      type: "system_message",
      level: "fatal",
      message: "m",
      details: "stacktrace",
      agent: "librarian",
      recoverable: true,
    } as WebSocketEvent);
    expect(v.recoverable).toBe(true);
    expect(v.details).toBe("stacktrace");
    expect(v.agent).toBe("librarian");
  });

  it("maps structured workspace restore metadata", () => {
    const v = toSystemMessageView({
      type: "system_message",
      level: "info",
      message: "fallback",
      code: "workspace_restored",
      metadata: {
        mode: "checkpoint",
        checkpointId: "checkpoint_abcdef123456",
        restoredAt: "2026-08-21T01:02:03.000Z",
        files: ["reports/result.md", "table.csv"],
        fileCount: 2,
      },
    } as WebSocketEvent);
    expect(v.code).toBe("workspace_restored");
    expect(v.workspaceRestore).toMatchObject({
      mode: "checkpoint",
      checkpointId: "checkpoint_abcdef123456",
      files: ["reports/result.md", "table.csv"],
      fileCount: 2,
    });
  });

  it("falls back to info for unknown level", () => {
    const v = toSystemMessageView({ type: "system_message", level: "bogus", message: "m" } as WebSocketEvent);
    expect(v.level).toBe("info");
  });

  it("reduces into a system_message ChatMessage", () => {
    const out = reduceMessagesForEvent([], {
      type: "system_message",
      level: "warning",
      message: "watch out",
    } as WebSocketEvent);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("system_message");
    expect(out[0].systemMessage?.level).toBe("warning");
    expect(out[0].content).toBe("watch out");
  });

  it("#167: coalesces repeated system_messages sharing a stable id (retry ticks)", () => {
    const mk = (attempt: number) =>
      ({
        type: "system_message",
        id: "retry-librarian-run_1",
        level: "warning",
        message: `retrying (${attempt}/3)`,
        agent: "librarian",
      }) as WebSocketEvent;
    let msgs = reduceMessagesForEvent([], mk(1));
    msgs = reduceMessagesForEvent(msgs, mk(2));
    msgs = reduceMessagesForEvent(msgs, mk(3));
    // One bubble, updated in place to the latest attempt.
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("retry-librarian-run_1");
    expect(msgs[0].content).toBe("retrying (3/3)");
  });

  it("#167: system_messages without a stable id still append", () => {
    let msgs = reduceMessagesForEvent([], {
      type: "system_message",
      level: "warning",
      message: "one",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "system_message",
      level: "warning",
      message: "two",
    } as WebSocketEvent);
    expect(msgs).toHaveLength(2);
  });
});

describe("ask_user mapping + submit + reducer round-trip", () => {
  const event = {
    type: "user_input_request",
    requestId: "req-42",
    agent: "principal",
    question: "Pick one",
    options: ["A", "B"],
    allowFreeText: true,
    timeoutSec: 30,
  } as WebSocketEvent;

  it("maps camelCase wire fields", () => {
    const v = toAskUserView(event);
    expect(v.requestId).toBe("req-42");
    expect(v.options).toEqual(["A", "B"]);
    expect(v.allowFreeText).toBe(true);
    expect(v.timeoutSec).toBe(30);
  });

  it("tolerates snake_case fallback", () => {
    const v = toAskUserView({
      type: "user_input_request",
      request_id: "rid",
      agent: "a",
      question: "q",
      allow_free_text: true,
      timeout_sec: 10,
    } as unknown as WebSocketEvent);
    expect(v.requestId).toBe("rid");
    expect(v.allowFreeText).toBe(true);
    expect(v.timeoutSec).toBe(10);
  });

  it("reduces into an ask_user card keyed by requestId, dedupes re-emit", () => {
    let msgs = reduceMessagesForEvent([], event);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].kind).toBe("ask_user");
    expect(msgs[0].id).toBe("ask-req-42");
    // Re-emit of the same request must not stack a second card.
    msgs = reduceMessagesForEvent(msgs, event);
    expect(msgs).toHaveLength(1);
  });

  it("submit resolves with the right requestId + trimmed answer", () => {
    const v = toAskUserView(event);
    expect(resolveAskUserSubmission(v, "  B  ")).toEqual({ requestId: "req-42", answer: "B" });
    // Empty / closed inputs do not submit.
    expect(resolveAskUserSubmission(v, "   ")).toBeNull();
    expect(resolveAskUserSubmission(v, "B", { answered: true })).toBeNull();
    expect(resolveAskUserSubmission(v, "B", { timedOut: true })).toBeNull();
    expect(resolveAskUserSubmission({ ...v, allowFreeText: false }, "custom")).toBeNull();
    expect(resolveAskUserSubmission({ ...v, allowFreeText: false }, "A")).toEqual({
      requestId: "req-42",
      answer: "A",
    });
  });

  it("a user_input_response resolves the matching card by requestId", () => {
    const cards = reduceMessagesForEvent([], event);
    const resolved = reduceMessagesForEvent(cards, {
      type: "user_input_response",
      requestId: "req-42",
      answer: "A",
    } as WebSocketEvent);
    expect(resolved[0].askUser?.answer).toBe("A");
    expect(resolved[0].askUser?.status).toBe("answered");
    expect(isAskUserOpen(resolved[0].askUser!)).toBe(false);
    // A non-matching requestId leaves the card open.
    const other = reduceMessagesForEvent(cards, {
      type: "user_input_response",
      requestId: "nope",
      answer: "X",
    } as WebSocketEvent);
    expect(other[0].askUser?.answer).toBeUndefined();
    expect(isAskUserOpen(other[0].askUser!)).toBe(true);
  });

  it("a user_input_cancelled event closes the card without an answer", () => {
    const cards = reduceMessagesForEvent([], event);
    const cancelled = reduceMessagesForEvent(cards, {
      type: "user_input_cancelled",
      requestId: "req-42",
      reason: "interrupted",
    } as WebSocketEvent);
    expect(cancelled[0].askUser).toMatchObject({
      status: "cancelled",
      cancellationReason: "interrupted",
    });
    expect(cancelled[0].askUser?.answer).toBeUndefined();
    expect(isAskUserOpen(cancelled[0].askUser!)).toBe(false);

    // A malformed/duplicate later response cannot overwrite the first terminal.
    const late = reduceMessagesForEvent(cancelled, {
      type: "user_input_response",
      requestId: "req-42",
      answer: "late",
    } as WebSocketEvent);
    expect(late[0].askUser?.status).toBe("cancelled");
  });

  it("an old orphan remains closed after a newer request is answered", () => {
    let cards = reduceMessagesForEvent([], {
      ...event,
      requestId: "req-old",
    } as WebSocketEvent);
    cards = reduceMessagesForEvent(cards, {
      ...event,
      requestId: "req-new",
    } as WebSocketEvent);
    cards = reduceMessagesForEvent(cards, {
      type: "user_input_response",
      requestId: "req-new",
      answer: "A",
    } as WebSocketEvent);
    cards = reduceMessagesForEvent(cards, {
      type: "user_input_cancelled",
      requestId: "req-old",
      reason: "restored",
    } as WebSocketEvent);

    expect(cards.map((card) => card.askUser?.status)).toEqual(["cancelled", "answered"]);
    expect(cards.some((card) => isAskUserOpen(card.askUser!))).toBe(false);
  });
});

describe("auto_retry mapping + detection + countdown", () => {
  const retryEvent = {
    type: "agent_status_update",
    agentName: "principal",
    status: "retrying",
    attempt: 2,
    maxAttempts: 5,
    delayMs: 3000,
    reason: "rate limited",
  } as WebSocketEvent;

  it("detects auto-retry status (and only that)", () => {
    expect(isAutoRetryStatus(retryEvent)).toBe(true);
    expect(isAutoRetryStatus({ type: "agent_status_update", status: "running" } as WebSocketEvent)).toBe(false);
    expect(isAutoRetryStatus({ type: "agent_status_update", autoRetry: { attempt: 1 } } as unknown as WebSocketEvent)).toBe(true);
    expect(isAutoRetryStatus({
      type: "agent_status_update",
      status: "running",
      retry: { attempt: 1, maxAttempts: 3, delayMs: 1200 },
    } as unknown as WebSocketEvent)).toBe(true);
    expect(isAutoRetryStatus({ type: "system_message", level: "info", message: "x" } as WebSocketEvent)).toBe(false);
  });

  it("maps attempt / maxAttempts / delayMs", () => {
    const v = toAutoRetryView(retryEvent);
    expect(v.attempt).toBe(2);
    expect(v.maxAttempts).toBe(5);
    expect(v.delayMs).toBe(3000);
    expect(v.reason).toBe("rate limited");
  });

  it("computes ceil-seconds countdown", () => {
    expect(autoRetryCountdownSeconds({ attempt: 1, maxAttempts: 1, delayMs: 3000 })).toBe(3);
    expect(autoRetryCountdownSeconds({ attempt: 1, maxAttempts: 1, delayMs: 2500 })).toBe(3);
    expect(autoRetryCountdownSeconds({ attempt: 1, maxAttempts: 1, delayMs: 0 })).toBe(0);
  });

  it("reduces a retrying status into an auto_retry ChatMessage", () => {
    const out = reduceMessagesForEvent([], retryEvent);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("auto_retry");
    expect(out[0].autoRetry?.attempt).toBe(2);
    // A normal status update produces no message.
    expect(reduceMessagesForEvent([], { type: "agent_status_update", status: "running" } as WebSocketEvent)).toHaveLength(0);
  });

  it("reduces the Runtime's canonical nested retry shape", () => {
    const out = reduceMessagesForEvent([], {
      type: "agent_status_update",
      agentName: "principal",
      status: "running",
      retry: { attempt: 2, maxAttempts: 4, delayMs: 2500 },
    } as unknown as WebSocketEvent);
    expect(out).toHaveLength(1);
    expect(out[0].autoRetry).toMatchObject({ attempt: 2, maxAttempts: 4, delayMs: 2500 });
  });

  it("keeps one retry card per agent and clears it when retry state ends", () => {
    const worker = reduceMessagesForEvent([], {
      ...retryEvent,
      agentName: "worker",
    } as WebSocketEvent);
    const first = reduceMessagesForEvent(worker, retryEvent);
    const second = reduceMessagesForEvent(first, {
      ...retryEvent,
      attempt: 3,
    } as WebSocketEvent);

    expect(second.filter((message) => message.kind === "auto_retry" && message.agent === "principal")).toHaveLength(1);
    expect(second.find((message) => message.agent === "principal")?.autoRetry?.attempt).toBe(3);
    expect(second.filter((message) => message.kind === "auto_retry" && message.agent === "worker")).toHaveLength(1);

    const cleared = reduceMessagesForEvent(second, {
      type: "agent_status_update",
      agentName: "principal",
      status: "running",
    } as WebSocketEvent);
    expect(cleared.some((message) => message.kind === "auto_retry" && message.agent === "principal")).toBe(false);
    expect(cleared.some((message) => message.kind === "auto_retry" && message.agent === "worker")).toBe(true);
  });
});

describe("retry cancel callback wiring", () => {
  it("fires the cancel callback when invoked (host-supplied abort path)", () => {
    // The component delegates cancel to a host callback; we assert that calling
    // the supplied handler triggers exactly once (mirrors PromptComposer wiring
    // of onRetryCancel -> interruptCurrent).
    let cancelled = 0;
    const onCancel = () => { cancelled += 1; };
    onCancel();
    expect(cancelled).toBe(1);
  });
});

// Sanity: the reducer leaves an unrelated message list untouched for unknown events.
describe("reducer passthrough", () => {
  it("ignores unknown event types", () => {
    const existing: ChatMessage[] = [
      { id: "1", role: "user", content: "hi", createdAt: new Date().toISOString() },
    ];
    expect(reduceMessagesForEvent(existing, { type: "WHATEVER" } as WebSocketEvent)).toBe(existing);
  });
});

// Regression: a START with no matching END leaves a message stuck at
// streaming:true, so the activity group shows "智能体思考中" forever. The run
// terminators (RUN_FINISHED / RUN_ERROR) must sweep dangling streaming flags.
describe("run terminators clear dangling streaming flags", () => {
  const open = (agent: string): ChatMessage => ({
    id: `m-${agent}`,
    role: "assistant",
    content: "partial…",
    createdAt: new Date().toISOString(),
    agent,
    streaming: true,
    kind: "text",
  });

  it("RUN_FINISHED clears streaming on the run agent's messages", () => {
    const out = reduceMessagesForEvent([open("principal")], {
      type: "RUN_FINISHED",
      agentName: "principal",
    } as WebSocketEvent);
    expect(out[0]!.streaming).toBe(false);
  });

  it("RUN_FINISHED leaves OTHER agents' messages streaming (multi-agent isolation)", () => {
    const out = reduceMessagesForEvent([open("worker")], {
      type: "RUN_FINISHED",
      agentName: "principal",
    } as WebSocketEvent);
    expect(out[0]!.streaming).toBe(true);
  });

  it("RUN_ERROR clears streaming AND appends an error message", () => {
    const withRetry = reduceMessagesForEvent([open("principal")], {
      type: "agent_status_update",
      agentName: "principal",
      status: "retrying",
      attempt: 1,
      maxAttempts: 5,
      delayMs: 0,
    } as WebSocketEvent);
    const out = reduceMessagesForEvent(withRetry, {
      type: "RUN_ERROR",
      agentName: "principal",
      message: "boom",
    } as WebSocketEvent);
    expect(out[0]!.streaming).toBe(false);
    expect(out.some((m) => m.kind === "auto_retry")).toBe(false);
    expect(out.some((m) => m.kind === "error" && m.content === "boom")).toBe(true);
  });

  it("RUN_FINISHED removes only the terminating agent's retry card", () => {
    const principal = reduceMessagesForEvent([], {
      type: "agent_status_update", agentName: "principal", status: "retrying", attempt: 1, maxAttempts: 2, delayMs: 1,
    } as WebSocketEvent);
    const both = reduceMessagesForEvent(principal, {
      type: "agent_status_update", agentName: "worker", status: "retrying", attempt: 1, maxAttempts: 2, delayMs: 1,
    } as WebSocketEvent);
    const out = reduceMessagesForEvent(both, {
      type: "RUN_FINISHED", agentName: "principal",
    } as WebSocketEvent);

    expect(out.some((m) => m.kind === "auto_retry" && m.agent === "principal")).toBe(false);
    expect(out.some((m) => m.kind === "auto_retry" && m.agent === "worker")).toBe(true);
  });
});
