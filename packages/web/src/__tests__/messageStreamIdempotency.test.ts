import { describe, it, expect } from "vitest";
import { reduceMessagesForEvent } from "../contexts/messageReducer";
import type { ChatMessage, WebSocketEvent } from "../contracts/backend";

/**
 * #314 — Restoring a conversation can concatenate assistant content more than
 * once. History rehydrate folds events.jsonl through reduceMessagesForEvent;
 * SSE then replays the in-memory ring buffer through the same reducer. START
 * is already keyed by messageId, but CONTENT used to always append — so the
 * same deltas landed twice in one message bubble.
 *
 * Fix: stream-append events (CONTENT / REASONING_CONTENT / TOOL_CALL_ARGS) are
 * idempotent via stable transport identity (_eventId) and by
 * ignoring further appends once a message is finalized (streaming:false).
 * Intentionally repeated model text (distinct events) must still survive.
 */

function fold(events: WebSocketEvent[]): ChatMessage[] {
  let msgs: ChatMessage[] = [];
  for (const ev of events) msgs = reduceMessagesForEvent(msgs, ev);
  return msgs;
}

function textTriad(
  messageId: string,
  deltas: string[],
  opts: { agentName?: string; tsBase?: string; end?: boolean } = {},
): WebSocketEvent[] {
  const agentName = opts.agentName ?? "principal";
  const tsBase = opts.tsBase ?? "2026-07-15T12:00:00.000Z";
  const out: WebSocketEvent[] = [
    {
      type: "TEXT_MESSAGE_START",
      messageId,
      role: "assistant",
      agentName,
      _ts: tsBase,
    } as WebSocketEvent,
  ];
  deltas.forEach((delta, i) => {
    out.push({
      type: "TEXT_MESSAGE_CONTENT",
      messageId,
      delta,
      agentName,
      // Distinct ms per delta so intentional repeats with identical text still
      // differ when _ts differs (and same-event replays share the exact _ts).
      _ts: `2026-07-15T12:00:00.00${i}Z`,
    } as WebSocketEvent);
  });
  if (opts.end !== false) {
    out.push({
      type: "TEXT_MESSAGE_END",
      messageId,
      agentName,
      _ts: "2026-07-15T12:00:01.000Z",
    } as WebSocketEvent);
  }
  return out;
}

describe("message stream idempotency (#314)", () => {
  it("does not re-append CONTENT when the same history stream is folded twice", () => {
    // Reproduces: history rehydrate, then SSE ring-buffer replay of the same
    // START/CONTENT/END events for a completed assistant message.
    const history = textTriad("msg_a", ["你爱后", "的风"]);
    const once = fold(history);
    expect(once).toHaveLength(1);
    expect(once[0]!.content).toBe("你爱后的风");
    expect(once[0]!.streaming).toBe(false);

    // Second pass — same events as SSE recent() would re-deliver.
    const twice = fold([...history, ...history]);
    expect(twice).toHaveLength(1);
    expect(twice[0]!.content).toBe("你爱后的风");
  });

  it("does not re-append when CONTENT is applied again after END (finalized)", () => {
    const history = textTriad("msg_b", ["hello ", "world"]);
    let msgs = fold(history);
    // Simulate a ring-buffer CONTENT with no identity (legacy / test shape):
    // finalized messages must still refuse further appends.
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "msg_b",
      delta: "hello ",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "msg_b",
      delta: "world",
    } as WebSocketEvent);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("hello world");
  });

  it("keeps a second continuation message from doubling under replay", () => {
    const first = textTriad("msg_c1", ["第一句。", "第二句。"], {
      tsBase: "2026-07-15T12:00:00.000Z",
    });
    const cont = textTriad("msg_c2", ["续写：", "还在说。"], {
      tsBase: "2026-07-15T12:01:00.000Z",
    });
    const stream = [...first, ...cont];
    const once = fold(stream);
    expect(once.map((m) => m.content)).toEqual(["第一句。第二句。", "续写：还在说。"]);

    const twice = fold([...stream, ...stream]);
    expect(twice.map((m) => m.content)).toEqual(["第一句。第二句。", "续写：还在说。"]);
    expect(twice).toHaveLength(2);
  });

  it("preserves intentionally repeated model text (distinct events)", () => {
    // Model genuinely emitted the same token twice as two separate CONTENT
    // events — different _ts — must not be collapsed by the idempotency key.
    const stream = textTriad("msg_d", ["yes", "yes", "yes"]);
    const msgs = fold(stream);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.content).toBe("yesyesyes");
  });

  it("preserves identical deltas emitted in the same millisecond (#463)", () => {
    const sameTimestamp = "2026-08-17T09:00:00.123Z";
    const stream = [
      {
        type: "TEXT_MESSAGE_START",
        messageId: "msg_same_ms",
        role: "assistant",
        _eventId: "start-1",
        _ts: sameTimestamp,
      },
      ...["content-1", "content-2", "content-3"].map((_eventId) => ({
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "msg_same_ms",
        delta: "/",
        _eventId,
        _ts: sameTimestamp,
      })),
    ] as WebSocketEvent[];

    let messages = fold(stream);
    expect(messages[0]!.content).toBe("///");

    // Replaying those exact persisted events remains idempotent.
    for (const event of stream.slice(1)) {
      messages = reduceMessagesForEvent(messages, event);
    }
    expect(messages[0]!.content).toBe("///");
  });

  it("preserves same-millisecond repeats in reasoning and tool arguments (#463)", () => {
    const sameTimestamp = "2026-08-17T09:00:00.123Z";
    const events = [
      { type: "TOOL_CALL_START", toolCallId: "tc_same_ms", toolCallName: "bash" },
      ...["tool-1", "tool-2"].map((_eventId) => ({
        type: "TOOL_CALL_ARGS",
        toolCallId: "tc_same_ms",
        delta: "{",
        _eventId,
        _ts: sameTimestamp,
      })),
      { type: "REASONING_MESSAGE_START", messageId: "reason_same_ms" },
      ...["reason-1", "reason-2"].map((_eventId) => ({
        type: "REASONING_MESSAGE_CONTENT",
        messageId: "reason_same_ms",
        delta: "x",
        _eventId,
        _ts: sameTimestamp,
      })),
    ] as WebSocketEvent[];

    const messages = fold(events);
    expect(messages.find((message) => message.id === "tc_same_ms")?.toolInput).toBe("{{");
    expect(messages.find((message) => message.id === "reason_same_ms")?.content).toBe("xx");
  });

  it("still streams live CONTENT without _ts (identity optional)", () => {
    // Live / unit paths may omit transport _ts. Incremental append must work.
    let msgs = fold([
      {
        type: "TEXT_MESSAGE_START",
        messageId: "msg_e",
        role: "assistant",
      } as WebSocketEvent,
    ]);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "msg_e",
      delta: "Hel",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "msg_e",
      delta: "lo",
    } as WebSocketEvent);
    expect(msgs[0]!.content).toBe("Hello");
    expect(msgs[0]!.streaming).toBe(true);
  });

  it("dedupes mid-stream CONTENT replay via stable _ts identity", () => {
    // History rehydrate of an unfinished message, then SSE ring buffer replays
    // the same CONTENT events while streaming is still true.
    const partial = textTriad("msg_f", ["ab", "cd"], { end: false });
    let msgs = fold(partial);
    expect(msgs[0]!.content).toBe("abcd");
    expect(msgs[0]!.streaming).toBe(true);

    // Replay identical CONTENT events (same _ts + delta).
    for (const ev of partial) {
      if (ev.type === "TEXT_MESSAGE_CONTENT") {
        msgs = reduceMessagesForEvent(msgs, ev);
      }
    }
    expect(msgs[0]!.content).toBe("abcd");

    // A genuinely new live delta (new _ts) still appends.
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "msg_f",
      delta: "ef",
      _ts: "2026-07-15T12:00:00.009Z",
    } as WebSocketEvent);
    expect(msgs[0]!.content).toBe("abcdef");
  });

  it("dedupes TOOL_CALL_ARGS and REASONING_MESSAGE_CONTENT the same way", () => {
    const toolStart = {
      type: "TOOL_CALL_START",
      toolCallId: "tc1",
      toolCallName: "bash",
      agentName: "principal",
      _ts: "2026-07-15T12:00:00.000Z",
    } as WebSocketEvent;
    const toolArgs = {
      type: "TOOL_CALL_ARGS",
      toolCallId: "tc1",
      delta: '{"cmd":"ls"}',
      _ts: "2026-07-15T12:00:00.001Z",
    } as WebSocketEvent;
    const toolEnd = {
      type: "TOOL_CALL_END",
      toolCallId: "tc1",
      _ts: "2026-07-15T12:00:00.002Z",
    } as WebSocketEvent;

    let msgs = fold([toolStart, toolArgs, toolEnd, toolStart, toolArgs, toolEnd]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.toolInput).toBe('{"cmd":"ls"}');

    const reason = [
      {
        type: "REASONING_MESSAGE_START",
        messageId: "r1",
        agentName: "principal",
        _ts: "2026-07-15T12:00:00.000Z",
      } as WebSocketEvent,
      {
        type: "REASONING_MESSAGE_CONTENT",
        messageId: "r1",
        delta: "think ",
        _ts: "2026-07-15T12:00:00.001Z",
      } as WebSocketEvent,
      {
        type: "REASONING_MESSAGE_CONTENT",
        messageId: "r1",
        delta: "hard",
        _ts: "2026-07-15T12:00:00.002Z",
      } as WebSocketEvent,
      {
        type: "REASONING_MESSAGE_END",
        messageId: "r1",
        _ts: "2026-07-15T12:00:00.003Z",
      } as WebSocketEvent,
    ];
    const reasonOnce = fold(reason);
    const reasonTwice = fold([...reason, ...reason]);
    expect(reasonOnce[0]!.content).toBe("think hard");
    expect(reasonTwice[0]!.content).toBe("think hard");
    expect(reasonTwice[0]!.reasoning).toBe("think hard");
  });

  it("hydrates authoritative tool start/end time and terminal status", () => {
    const messages = fold([
      {
        type: "TOOL_CALL_START",
        toolCallId: "timed",
        toolCallName: "bash",
        _ts: "2026-07-15T12:00:00.000Z",
      } as WebSocketEvent,
      {
        type: "TOOL_CALL_END",
        toolCallId: "timed",
        status: "interrupted",
        durationMs: 4_100,
        _ts: "2026-07-15T12:00:04.200Z",
      } as WebSocketEvent,
    ]);
    expect(messages[0]).toMatchObject({
      createdAt: "2026-07-15T12:00:00.000Z",
      completedAt: "2026-07-15T12:00:04.200Z",
      durationMs: 4_100,
      toolStatus: "interrupted",
      streaming: false,
    });
  });
});

describe("interrupt system_message hydrate idempotency (#330)", () => {
  const interruptMsg = "⏹️ 用户已中断当前任务，信箱已清空，正在等候进一步指示。";
  const stableId = "interrupt:sess-1:run_abc";

  function interruptEvent(id: string, ts = "2026-07-15T12:05:00.000Z"): WebSocketEvent {
    return {
      type: "system_message",
      id,
      message: interruptMsg,
      level: "info",
      agent: "principal",
      recoverable: true,
      _ts: ts,
    } as WebSocketEvent;
  }

  it("keeps a single bubble when history and SSE replay the same interrupt id", () => {
    // Live path folds once; reload path folds history then SSE ring buffer of the
    // same persisted event — must not stack two interruption status cards.
    const history = [
      ...textTriad("asst_partial", ["partial "], { end: false }),
      {
        type: "TEXT_MESSAGE_END",
        messageId: "asst_partial",
        agentName: "principal",
        _ts: "2026-07-15T12:04:59.000Z",
      } as WebSocketEvent,
      interruptEvent(stableId),
    ];
    const once = fold(history);
    const interruptRows = once.filter((m) => m.kind === "system_message" && m.content.includes("中断"));
    expect(interruptRows).toHaveLength(1);
    expect(interruptRows[0]!.id).toBe(stableId);

    // Same stream again (history + SSE replay).
    const twice = fold([...history, ...history]);
    const interruptTwice = twice.filter(
      (m) => m.kind === "system_message" && m.content.includes("中断"),
    );
    expect(interruptTwice).toHaveLength(1);
    expect(interruptTwice[0]!.id).toBe(stableId);
    // Partial assistant content preserved once.
    expect(twice.filter((m) => m.id === "asst_partial")).toHaveLength(1);
    expect(twice.find((m) => m.id === "asst_partial")!.content).toBe("partial ");
  });

  it("without a stable id, identical interrupt payloads still append (legacy)", () => {
    // Documents why runtime must emit id — random client ids would double.
    const bare = {
      type: "system_message",
      message: interruptMsg,
      level: "info",
      agent: "principal",
    } as WebSocketEvent;
    const once = fold([bare]);
    const twice = fold([bare, bare]);
    expect(once.filter((m) => m.kind === "system_message")).toHaveLength(1);
    expect(twice.filter((m) => m.kind === "system_message").length).toBeGreaterThan(1);
  });
});
