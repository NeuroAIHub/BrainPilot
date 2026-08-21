import { describe, it, expect } from "vitest";
import {
  applyMessageFilters,
  defaultFilterRules,
  isNonFatalAgentErrorMessage,
  HIDE_NON_FATAL_AGENT_ERRORS,
} from "../contexts/messageFilters";
import type { ChatMessage, MessageFilterRule, SystemMessageView } from "../contracts/backend";

// Test fixtures — keep them small; the reducer path is exercised by
// newUiEvents.test.ts. Here we're only exercising the filter predicates.

function baseMsg(over: Partial<ChatMessage>): ChatMessage {
  return {
    id: over.id ?? "m1",
    role: over.role ?? "assistant",
    content: over.content ?? "",
    createdAt: "2026-07-12T00:00:00Z",
    ...over,
  };
}

function sysMsg(id: string, level: SystemMessageView["level"]): ChatMessage {
  return baseMsg({
    id,
    role: "system",
    kind: "system_message",
    content: `msg ${id}`,
    systemMessage: {
      level,
      message: `msg ${id}`,
      recoverable: level !== "fatal",
    },
  });
}

describe("hide-non-fatal-agent-errors filter (issue #278)", () => {
  it("ships enabled by default in defaultFilterRules", () => {
    const rule = defaultFilterRules.find((r) => r.id === HIDE_NON_FATAL_AGENT_ERRORS);
    expect(rule).toBeDefined();
    expect(rule!.enabled).toBe(true);
  });

  it("isNonFatalAgentErrorMessage matches error and warning, not fatal/info", () => {
    expect(isNonFatalAgentErrorMessage(sysMsg("e", "error"))).toBe(true);
    expect(isNonFatalAgentErrorMessage(sysMsg("w", "warning"))).toBe(true);
    expect(isNonFatalAgentErrorMessage(sysMsg("f", "fatal"))).toBe(false);
    expect(isNonFatalAgentErrorMessage(sysMsg("i", "info"))).toBe(false);
    const terminal = sysMsg("terminal", "error");
    terminal.systemMessage = { ...terminal.systemMessage!, terminal: true };
    expect(isNonFatalAgentErrorMessage(terminal)).toBe(false);
  });

  it("does not match non-system_message shapes", () => {
    const legacyError = baseMsg({ id: "x", role: "system", kind: "error", content: "boom" });
    expect(isNonFatalAgentErrorMessage(legacyError)).toBe(false);

    const askUser = baseMsg({ id: "a", kind: "ask_user", content: "?" });
    expect(isNonFatalAgentErrorMessage(askUser)).toBe(false);

    const plain = baseMsg({ id: "t", kind: "text", content: "hi" });
    expect(isNonFatalAgentErrorMessage(plain)).toBe(false);
  });

  it("applyMessageFilters with defaults hides error/warning but keeps fatal/info", () => {
    const msgs: ChatMessage[] = [
      sysMsg("info-1", "info"),
      sysMsg("warn-1", "warning"),
      sysMsg("err-1", "error"),
      sysMsg("fatal-1", "fatal"),
      baseMsg({ id: "text-1", kind: "text", content: "hello" }),
    ];
    const visible = applyMessageFilters(msgs, defaultFilterRules);
    const ids = visible.map((m) => m.id);
    expect(ids).toEqual(["info-1", "fatal-1", "text-1"]);
  });

  it("when the rule is disabled, error and warning are visible again", () => {
    const rules: MessageFilterRule[] = defaultFilterRules.map((r) =>
      r.id === HIDE_NON_FATAL_AGENT_ERRORS ? { ...r, enabled: false } : r,
    );
    const msgs = [sysMsg("e", "error"), sysMsg("w", "warning"), sysMsg("f", "fatal")];
    const visible = applyMessageFilters(msgs, rules);
    expect(visible.map((m) => m.id)).toEqual(["e", "w", "f"]);
  });

  it("spurious-dot rule still works alongside the new rule", () => {
    // The spurious-dot rule fires on assistant text === "." — this smoke check
    // guards against a regression where adding the new rule broke the old one.
    const dot = baseMsg({ id: "d", role: "assistant", kind: "text", content: "." });
    const real = baseMsg({ id: "r", role: "assistant", kind: "text", content: "hello" });
    const visible = applyMessageFilters([dot, real], defaultFilterRules);
    expect(visible.map((m) => m.id)).toEqual(["r"]);
  });
});
