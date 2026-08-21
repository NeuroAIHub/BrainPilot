import { describe, expect, it } from "vitest";

import type { ChatMessage, SystemMessageView } from "../contracts/backend";
import {
  classifyProviderFailure,
  findFailedPrompt,
  hasDelegatedFailureSinceLastUser,
  markLatestPrincipalAnswerPartial,
  writeRecoveryDraft,
} from "../contexts/errorRecovery";

function view(message: string, details?: string): SystemMessageView {
  return { level: "error", message, details, agent: "principal", recoverable: true, terminal: true };
}

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: overrides.id ?? "m",
    role: overrides.role ?? "assistant",
    content: overrides.content ?? "",
    createdAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("provider failure classification (#485)", () => {
  it.each([
    [view("provider rejected", '401 {"error":{"message":"invalid API key","request_id":"req-1"}}'), "auth"],
    [view("provider rejected", '404 {"error":{"message":"model gpt-missing does not exist"}}'), "model"],
    [view("provider rejected", '429 {"error":{"message":"rate limit exceeded"}}'), "rateLimit"],
    [view("provider request timed out after 30s"), "timeout"],
    [view("fetch failed: ECONNRESET"), "network"],
    [view("⚠️ Agent principal encountered an error: Connection error."), "network"],
    [view("mock API error"), "unknown"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(classifyProviderFailure(input)).toBe(expected);
  });
});

describe("failed prompt recovery", () => {
  it("finds the nearest user prompt before the terminal card", () => {
    const messages = [
      message({ id: "u1", role: "user", content: "older" }),
      message({ id: "a1", content: "answer" }),
      message({ id: "u2", role: "user", content: "retry this" }),
      message({ id: "err", role: "system", kind: "system_message" }),
    ];
    expect(findFailedPrompt(messages, "err")).toBe("retry this");
  });

  it("does not overwrite a different draft when replacement is declined", () => {
    const drafts = new Map([["__draft__", "keep this draft"]]);
    const store = {
      get: (id: string) => drafts.get(id) ?? "",
      set: (id: string, value: string) => drafts.set(id, value),
    };

    expect(writeRecoveryDraft(store, "__draft__", "failed prompt", () => false)).toBe(false);
    expect(drafts.get("__draft__")).toBe("keep this draft");
  });

  it("writes the recovery prompt when no different draft would be lost", () => {
    const drafts = new Map<string, string>();
    let confirmations = 0;
    const store = {
      get: (id: string) => drafts.get(id) ?? "",
      set: (id: string, value: string) => drafts.set(id, value),
    };

    expect(writeRecoveryDraft(store, "__draft__", "failed prompt", () => {
      confirmations += 1;
      return false;
    })).toBe(true);
    expect(drafts.get("__draft__")).toBe("failed prompt");
    expect(confirmations).toBe(0);
  });
});

describe("partial result labelling", () => {
  const delegatedError = message({
    id: "expert-error",
    role: "system",
    kind: "system_message",
    agent: "analyst",
    systemMessage: {
      level: "error",
      message: "failed",
      agent: "analyst",
      recoverable: true,
      terminal: true,
    },
  });

  it("detects delegated failure only in the current user turn", () => {
    expect(hasDelegatedFailureSinceLastUser([
      message({ role: "user", content: "run" }),
      delegatedError,
    ])).toBe(true);
    expect(hasDelegatedFailureSinceLastUser([
      delegatedError,
      message({ role: "user", content: "new turn" }),
    ])).toBe(false);
  });

  it("does not treat a retryable delegated attempt as a final failure", () => {
    expect(hasDelegatedFailureSinceLastUser([
      message({ role: "user", content: "run" }),
      message({
        ...delegatedError,
        systemMessage: { ...delegatedError.systemMessage!, terminal: false },
      }),
    ])).toBe(false);
  });

  it("marks the latest Principal answer without touching expert output", () => {
    const principal = message({ id: "principal", agent: "principal", content: "best effort" });
    const out = markLatestPrincipalAnswerPartial([
      message({ role: "user", content: "run" }),
      principal,
      delegatedError,
    ]);
    expect(out.find((item) => item.id === "principal")?.partial).toBe(true);
  });
});
