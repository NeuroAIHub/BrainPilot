import { describe, it, expect } from "vitest";
import {
  buildRenderItems,
  isInternalToolName,
  stripInternalToolMessages,
} from "../contexts/messageGroups";
import type { ChatMessage } from "../contracts/backend";

// #134 — record_trace (and the trace-agent graph tools) are internal plumbing.
// Their tool call AND result must be hidden from the chat stream, while the
// model still receives them. These cover the pure presentation filter.

function toolCall(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: over.id ?? "call-1",
    role: "assistant",
    content: "Tool: record_trace",
    createdAt: "2026-06-21T00:00:00.000Z",
    agent: "principal",
    kind: "tool",
    toolName: "record_trace",
    ...over,
  };
}

function toolResult(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: over.id ?? "res-1",
    role: "assistant",
    content: "Tool result",
    createdAt: "2026-06-21T00:00:00.000Z",
    agent: "principal",
    kind: "tool",
    toolResult: "trace event dispatched",
    toolCallId: "call-1",
    ...over,
  };
}

function assistantText(content: string): ChatMessage {
  return {
    id: `t-${content}`,
    role: "assistant",
    content,
    createdAt: "2026-06-21T00:00:00.000Z",
    agent: "principal",
    kind: "text",
  };
}

describe("isInternalToolName", () => {
  it("matches bare internal tool names", () => {
    expect(isInternalToolName("record_trace")).toBe(true);
    expect(isInternalToolName("create_trace_node")).toBe(true);
    expect(isInternalToolName("get_trace_graph")).toBe(true);
  });

  it("matches mcp-namespaced internal tool names", () => {
    expect(isInternalToolName("mcp__brainpilot__record_trace")).toBe(true);
  });

  it("does not match user-facing tools", () => {
    expect(isInternalToolName("send_message")).toBe(false);
    expect(isInternalToolName("skill_search")).toBe(false);
    expect(isInternalToolName(undefined)).toBe(false);
  });
});

describe("stripInternalToolMessages (#134)", () => {
  it("drops the record_trace call and its linked result", () => {
    const out = stripInternalToolMessages([
      assistantText("before"),
      toolCall(),
      toolResult(),
      assistantText("after"),
    ]);
    expect(out.map((m) => m.id)).toEqual(["t-before", "t-after"]);
  });

  it("keeps user-facing tool calls and results", () => {
    const sendCall = toolCall({ id: "s1", toolName: "send_message", content: "Tool: send_message" });
    const sendResult = toolResult({ id: "s2", toolCallId: "s1", toolResult: "ok" });
    const out = stripInternalToolMessages([sendCall, sendResult]);
    expect(out.map((m) => m.id)).toEqual(["s1", "s2"]);
  });

  it("returns the same reference when there is nothing internal", () => {
    const msgs = [assistantText("a"), assistantText("b")];
    expect(stripInternalToolMessages(msgs)).toBe(msgs);
  });

  it("buildRenderItems hides an isolated internal tool block entirely", () => {
    // A lone record_trace call+result would otherwise fold into one activity
    // block; after stripping there is nothing to render.
    const items = buildRenderItems([toolCall(), toolResult()]);
    expect(items).toEqual([]);
  });

  it("buildRenderItems keeps surrounding conversation intact", () => {
    const items = buildRenderItems([
      assistantText("question?"),
      toolCall(),
      toolResult(),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "single" });
  });
});
