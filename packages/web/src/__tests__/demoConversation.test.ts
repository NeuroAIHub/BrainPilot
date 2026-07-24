import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../contracts/backend";
import { isDemoConversational } from "../components/demo/DemoView";

function msg(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? "m1",
    role: overrides.role ?? "assistant",
    content: overrides.content ?? "",
    createdAt: "2026-06-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("isDemoConversational (#98 multi-agent transcript)", () => {
  it("keeps non-empty user prompts", () => {
    expect(isDemoConversational(msg({ role: "user", content: "hello" }))).toBe(true);
    expect(isDemoConversational(msg({ role: "user", content: "  " }))).toBe(false);
  });

  it("keeps the principal's substantive text replies", () => {
    expect(
      isDemoConversational(msg({ role: "assistant", agent: "principal", kind: "text", content: "done" })),
    ).toBe(true);
  });

  it("keeps EXPERT agent text replies (the core #98 regression)", () => {
    // librarian / engineer / experimentalist replies must survive — the live
    // Chat shows them, so the demo must too.
    expect(
      isDemoConversational(msg({ role: "assistant", agent: "librarian", kind: "text", content: "searching…" })),
    ).toBe(true);
    expect(
      isDemoConversational(msg({ role: "assistant", agent: "engineer", kind: undefined, content: "built it" })),
    ).toBe(true);
  });

  it("treats a missing agent as conversational (older bundles)", () => {
    expect(isDemoConversational(msg({ role: "assistant", kind: "text", content: "hi" }))).toBe(true);
  });

  it("keeps error bubbles with content", () => {
    expect(isDemoConversational(msg({ role: "system", kind: "error", content: "librarian failed" }))).toBe(true);
    expect(isDemoConversational(msg({ role: "system", kind: "error", content: "" }))).toBe(false);
  });

  it("keeps system_message bubbles that carry a payload", () => {
    expect(
      isDemoConversational(
        msg({
          role: "system",
          kind: "system_message",
          content: "",
          systemMessage: { level: "error", message: "librarian error", recoverable: true },
        }),
      ),
    ).toBe(true);
    // No payload → nothing to render.
    expect(isDemoConversational(msg({ role: "system", kind: "system_message", content: "" }))).toBe(false);
  });

  it("drops reasoning, tool calls/results, hooks and auto_retry cards", () => {
    expect(isDemoConversational(msg({ kind: "thinking", content: "let me think" }))).toBe(false);
    expect(isDemoConversational(msg({ kind: "tool", content: "Tool: read" }))).toBe(false);
    expect(isDemoConversational(msg({ role: "system", kind: "hook", content: "reset" }))).toBe(false);
    expect(isDemoConversational(msg({ kind: "auto_retry", content: "retrying" }))).toBe(false);
  });

  it("keeps an answered ask_user card but drops an unanswered prompt (#132)", () => {
    // Answered: question + user answer are a user-facing decision point, kept as
    // a read-only Q&A step in the replay.
    expect(
      isDemoConversational(
        msg({
          kind: "ask_user",
          content: "pick one",
          askUser: { requestId: "req_1", agent: "principal", question: "pick one", answer: "A" },
        }),
      ),
    ).toBe(true);
    // Unanswered prompt has no meaning in a read-only replay.
    expect(
      isDemoConversational(
        msg({
          kind: "ask_user",
          content: "pick one",
          askUser: { requestId: "req_1", agent: "principal", question: "pick one" },
        }),
      ),
    ).toBe(false);

    // Cancelled questions remain as read-only lifecycle records but cannot
    // behave like live prompts in the demo.
    expect(
      isDemoConversational(
        msg({
          kind: "ask_user",
          content: "pick one",
          askUser: {
            requestId: "req_2",
            agent: "principal",
            question: "pick one",
            status: "cancelled",
            cancellationReason: "restored",
          },
        }),
      ),
    ).toBe(true);
  });

  it("drops empty text placeholders", () => {
    expect(isDemoConversational(msg({ role: "assistant", kind: "text", content: "   " }))).toBe(false);
  });
});
