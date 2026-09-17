import { describe, it, expect } from "vitest";
import { reduceMessagesForEvent } from "../contexts/messageReducer";
import { mergeRehydratedMessages } from "../contexts/SessionContext";
import { normalizeAgUiEvent } from "../contracts/backend";
import type { ChatMessage, WebSocketEvent } from "../contracts/backend";

// Reload replays the persisted terminal RUN_ERROR through the SSE ring buffer.
// Without a recorded terminal identity that replay landed after a newer user
// turn, escaped the current-turn scan and appended a second, phantom error card.

const TS = "2026-03-01T10:00:00.000Z";

function user(id: string, content = "run"): ChatMessage {
  return { id, role: "user", content, createdAt: TS };
}

function ev(raw: Record<string, unknown>): WebSocketEvent {
  return normalizeAgUiEvent(raw);
}

function diagnosticEvent(overrides: Record<string, unknown> = {}): WebSocketEvent {
  return ev({
    type: "system_message",
    id: "sys-1",
    agent: "principal",
    level: "error",
    message: "provider rejected",
    details: '401 {"request_id":"req-1"}',
    recoverable: true,
    ...overrides,
  });
}

function runError(overrides: Record<string, unknown> = {}): WebSocketEvent {
  return ev({
    type: "RUN_ERROR",
    agentName: "principal",
    message: "provider rejected",
    _eventId: "err-1",
    _ts: TS,
    ...overrides,
  });
}

describe("terminal RUN_ERROR identity (replay dedupe)", () => {
  it("promotes the rich diagnostic into exactly one terminal card", () => {
    const withDiagnostic = reduceMessagesForEvent([user("u1")], diagnosticEvent());
    const out = reduceMessagesForEvent(withDiagnostic, runError());

    const errors = out.filter((m) => m.kind === "system_message");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe("sys-1"); // original id + details retained
    expect(errors[0]!.systemMessage).toMatchObject({
      terminal: true,
      details: '401 {"request_id":"req-1"}',
    });
  });

  it("ignores a replayed RUN_ERROR after a later user turn and keeps the live stream", () => {
    const afterFailure = reduceMessagesForEvent(
      reduceMessagesForEvent([user("u1")], diagnosticEvent()),
      runError(),
    );
    // The user asks again; the answer for that newer turn is mid-stream.
    const streaming: ChatMessage[] = [
      ...afterFailure,
      user("u2", "try again"),
      {
        id: "a2",
        role: "assistant",
        content: "partial answer",
        createdAt: TS,
        agent: "principal",
        streaming: true,
      },
    ];

    const out = reduceMessagesForEvent(streaming, runError());

    expect(out).toBe(streaming); // unchanged state, not a re-reduction
    expect(out.filter((m) => m.systemMessage?.terminal)).toHaveLength(1);
    expect(out.find((m) => m.id === "a2")!.streaming).toBe(true);
  });

  it("keeps the terminal identity when the rich diagnostic itself is replayed", () => {
    const promoted = reduceMessagesForEvent(
      reduceMessagesForEvent([user("u1")], diagnosticEvent()),
      runError(),
    );

    const out = reduceMessagesForEvent(promoted, diagnosticEvent());

    const errors = out.filter((m) => m.kind === "system_message");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.systemMessage?.terminal).toBe(true);
    // Still recognized as the same failure, so a later RUN_ERROR replay is a no-op.
    expect(reduceMessagesForEvent(out, runError())).toBe(out);
  });

  it("keeps a genuinely distinct failure distinct even with identical text", () => {
    const first = reduceMessagesForEvent(
      reduceMessagesForEvent([user("u1")], diagnosticEvent()),
      runError(),
    );

    const out = reduceMessagesForEvent(first, runError({ _eventId: "err-2" }));

    const errors = out.filter((m) => m.systemMessage?.terminal);
    expect(errors).toHaveLength(2);
    expect(errors[1]!.id).toBe("err-2");
  });

  it("stamps an appended terminal card with the event time, not wall clock", () => {
    const out = reduceMessagesForEvent([user("u1")], runError({ _ts: "2026-02-02T03:04:05.000Z" }));

    const terminal = out.find((m) => m.systemMessage?.terminal)!;
    expect(terminal.createdAt).toBe("2026-02-02T03:04:05.000Z");
  });

  it("retains the promotion when history rehydrate merges over the live row", () => {
    const live = reduceMessagesForEvent(
      reduceMessagesForEvent([user("u1")], diagnosticEvent()),
      runError(),
    );
    // Persisted history holds the pre-promotion diagnostic.
    const history = reduceMessagesForEvent([user("u1")], diagnosticEvent());

    const merged = mergeRehydratedMessages(live, history);

    const errors = merged.filter((m) => m.kind === "system_message");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.systemMessage?.terminal).toBe(true);
    expect(reduceMessagesForEvent(merged, runError())).toBe(merged);
  });
});

// Captured reproduction (redacted): the runtime persists a rich diagnostic keyed
// by `run-error:<session>:<run>:<agent>` that absorbed the RUN_ERROR event id,
// while on reload the SSE tail can deliver the raw RUN_ERROR first and build a
// standalone card keyed by that event id. Both rows describe one failure under
// two different row ids, so a row-id-only hydration join showed two cards.
// These fixtures go through the real normalizer with the wire's snake_case keys
// (`_event_id`, `agent_name`, `run_id`) instead of pre-camelized fields.
const EVENT_UUID = "1f0b7c26-0000-4c6a-9d1e-5b7a2c9e4d31";
const OTHER_EVENT_UUID = "7a3e91d4-0000-4b12-8c55-3d6f1e0a2b98";
const RICH_ID = "run-error:sess-7:run-7:principal";
const DETAILS = '401 {"request_id":"req-7"}';

function rawDiagnostic(overrides: Record<string, unknown> = {}): WebSocketEvent {
  return ev({
    type: "system_message",
    id: RICH_ID,
    agent_name: "principal",
    run_id: "run-7",
    level: "error",
    message: "provider rejected the request",
    details: DETAILS,
    recoverable: true,
    timestamp: TS,
    ...overrides,
  });
}

function rawRunError(overrides: Record<string, unknown> = {}): WebSocketEvent {
  return ev({
    type: "RUN_ERROR",
    agent_name: "principal",
    run_id: "run-7",
    message: "provider rejected the request",
    _event_id: EVENT_UUID,
    _ts: TS,
    ...overrides,
  });
}

/** History as persisted after the failure: the promoted rich diagnostic. */
function savedRichHistory(): ChatMessage[] {
  return reduceMessagesForEvent(
    reduceMessagesForEvent([user("u1")], rawDiagnostic()),
    rawRunError(),
  );
}

describe("terminal identity across row ids (hydration aliases)", () => {
  it("consumes a standalone live terminal already covered by the saved diagnostic", () => {
    const history = savedRichHistory();
    // Reload: RUN_ERROR replays before history arrives, so the live tail holds the
    // fallback card keyed by the transport event id alone.
    const live = reduceMessagesForEvent([user("u1")], rawRunError());
    expect(live.at(-1)!.id).toBe(EVENT_UUID);

    const merged = mergeRehydratedMessages(live, history);

    const errors = merged.filter((m) => m.kind === "system_message");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe(RICH_ID); // richer diagnostic keeps its stable id
    expect(errors[0]!.createdAt).toBe(TS);
    expect(errors[0]!.systemMessage).toMatchObject({ terminal: true, details: DETAILS });
    expect(errors[0]!.terminalEventIds).toContain(EVENT_UUID);
    expect(reduceMessagesForEvent(merged, rawRunError())).toBe(merged);
  });

  it("keeps the rich id when history saved the standalone card and the live row is rich", () => {
    const history = reduceMessagesForEvent([user("u1")], rawRunError());
    const live = reduceMessagesForEvent(
      reduceMessagesForEvent([user("u1")], rawDiagnostic()),
      rawRunError(),
    );

    const merged = mergeRehydratedMessages(live, history);

    const errors = merged.filter((m) => m.kind === "system_message");
    expect(errors).toHaveLength(1);
    // Not demoted to the transport event id, and the raw details survive.
    expect(errors[0]!.id).toBe(RICH_ID);
    expect(errors[0]!.systemMessage).toMatchObject({ terminal: true, details: DETAILS });
    expect(errors[0]!.terminalEventIds).toContain(EVENT_UUID);
    expect(reduceMessagesForEvent(merged, rawRunError())).toBe(merged);
  });

  it("collapses several live representations of one known terminal into a single card", () => {
    const history = savedRichHistory();
    const standalone = reduceMessagesForEvent([user("u1")], rawRunError()).at(-1)!;
    // A legacy row (pre-stable-id persistence) that already absorbed the same event.
    const legacy: ChatMessage = {
      id: "legacy-terminal",
      role: "system",
      content: "provider rejected the request",
      createdAt: TS,
      agent: "principal",
      streaming: false,
      kind: "system_message",
      terminalEventIds: [EVENT_UUID],
      systemMessage: {
        level: "error",
        message: "provider rejected the request",
        agent: "principal",
        recoverable: true,
        terminal: true,
      },
    };

    const merged = mergeRehydratedMessages([user("u1"), standalone, legacy], history);

    expect(merged).toHaveLength(2); // the user turn plus one recovery card
    const errors = merged.filter((m) => m.kind === "system_message");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe(RICH_ID);
    expect(errors[0]!.systemMessage?.details).toBe(DETAILS);
  });

  it("keeps a live terminal with a distinct event id as its own card", () => {
    const history = savedRichHistory();
    const live = reduceMessagesForEvent(history, rawRunError({ _event_id: OTHER_EVENT_UUID }));

    const merged = mergeRehydratedMessages(live, history);

    const errors = merged.filter((m) => m.systemMessage?.terminal);
    expect(errors).toHaveLength(2);
    expect(errors.map((m) => m.id)).toEqual([RICH_ID, OTHER_EVENT_UUID]);
  });

  it("stays at one card when a later reload replays the diagnostic and RUN_ERROR", () => {
    const history = savedRichHistory();
    const hydrated = mergeRehydratedMessages(
      reduceMessagesForEvent([user("u1")], rawRunError()),
      history,
    );

    const replayed = reduceMessagesForEvent(
      reduceMessagesForEvent(hydrated, rawDiagnostic()),
      rawRunError(),
    );

    const errors = replayed.filter((m) => m.kind === "system_message");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.id).toBe(RICH_ID);
    expect(errors[0]!.systemMessage?.terminal).toBe(true);
    // A second hydration pass must not resurrect the standalone card either.
    expect(
      mergeRehydratedMessages(replayed, history).filter((m) => m.kind === "system_message"),
    ).toHaveLength(1);
  });
});
