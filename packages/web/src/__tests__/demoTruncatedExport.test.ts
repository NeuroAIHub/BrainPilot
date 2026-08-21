import { describe, expect, it } from "vitest";
import { reduceMessagesForEvent } from "../contexts/messageReducer";
import { normalizeAgUiEvent } from "../contracts/backend";
import type { ChatMessage, WebSocketEvent } from "../contracts/backend";

/**
 * Regression coverage for demo bundles built from a *tail-sliced* history.
 *
 * When a long session was exported with a positive `limit`, the history
 * endpoint returns only the tail of events.jsonl — the leading
 * TEXT_MESSAGE_START of the earliest messages is gone, leaving orphaned
 * CONTENT/END. The replay then dropped those opening replies silently
 * ("开始的消息被截断"). The export now requests the full log (`limit: 0`), and
 * the reducer additionally recovers gracefully if an orphan still slips
 * through.
 */
describe("demo replay tolerates truncated/orphaned events", () => {
  it("renders orphaned TEXT_MESSAGE_CONTENT whose START was sliced off", () => {
    // Simulate a tail-sliced stream: CONTENT/END with no preceding START.
    let msgs: ChatMessage[] = [];
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "orphan-1",
      delta: "Librarian → methodology grounding",
      agentName: "principal",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "orphan-1",
      delta: " against the paper",
      agentName: "principal",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_END",
      messageId: "orphan-1",
    } as WebSocketEvent);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("orphan-1");
    expect(msgs[0].content).toBe("Librarian → methodology grounding against the paper");
    expect(msgs[0].agent).toBe("principal");
    expect(msgs[0].streaming).toBe(false); // END finalized it
  });

  it("still folds a normal START→CONTENT→END triad into one message", () => {
    let msgs: ChatMessage[] = [];
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_START",
      messageId: "m1",
      role: "assistant",
      agentName: "principal",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m1",
      delta: "hello",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "m1",
      delta: " world",
    } as WebSocketEvent);
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_END",
      messageId: "m1",
    } as WebSocketEvent);

    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hello world");
  });

  it("strips NO-RENDER wrappers even on orphaned content", () => {
    let msgs: ChatMessage[] = [];
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "orphan-2",
      delta: "<!--NO-RENDER-->internal<!--/NO-RENDER-->",
    } as WebSocketEvent);
    // Entire delta was a NO-RENDER wrapper → nothing to render, no message created.
    expect(msgs).toHaveLength(0);
  });

  it("never renders a NO-RENDER wrapper split across model stream chunks", () => {
    let msgs: ChatMessage[] = [];
    const deltas = ["<!--NO", "-RENDER", "-->trace", " reminder handled", "<!--/", "NO", "-RENDER", "-->"];
    for (const delta of deltas) {
      msgs = reduceMessagesForEvent(msgs, {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "split-internal",
        delta,
        agentName: "principal",
      } as WebSocketEvent);
      expect(msgs.every((message) => message.content === "")).toBe(true);
    }
    msgs = reduceMessagesForEvent(msgs, {
      type: "TEXT_MESSAGE_END",
      messageId: "split-internal",
    } as WebSocketEvent);
    expect(msgs).toHaveLength(0);
  });

  it("drops an atomic NO-RENDER chat chunk", () => {
    const msgs = reduceMessagesForEvent([], {
      type: "TEXT_MESSAGE_CHUNK",
      messageId: "atomic-internal",
      role: "assistant",
      delta: "<!--NO-RENDER-->workflow reminder handled<!--/NO-RENDER-->",
    } as WebSocketEvent);
    expect(msgs).toHaveLength(0);
  });
});

describe("normalizeAgUiEvent preserves transport metadata keys", () => {
  it("keeps transport metadata instead of mangling leading underscores", () => {
    const raw = {
      type: "TEXT_MESSAGE_CONTENT",
      _ts: "2026-06-22T08:43:24.619Z",
      _seq: 42,
      _event_id: "event-42",
      agent_name: "principal",
      message_id: "m1",
      delta: "hi",
    };
    const norm = normalizeAgUiEvent(raw) as Record<string, unknown>;
    // The timestamp the demo timeline sorts on must survive normalization.
    expect(norm._ts).toBe("2026-06-22T08:43:24.619Z");
    expect(norm._seq).toBe(42);
    expect(norm._eventId).toBe("event-42");
    expect(norm).not.toHaveProperty("Ts");
    expect(norm).not.toHaveProperty("Seq");
    // Internal snake_case still camelizes.
    expect(norm.agentName).toBe("principal");
    expect(norm.messageId).toBe("m1");
  });
});
