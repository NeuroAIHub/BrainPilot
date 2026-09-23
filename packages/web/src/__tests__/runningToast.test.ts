import { describe, it, expect } from "vitest";
import { runningToastLabel, runningToastState } from "../contexts/runningToast";

describe("running toast execution ownership", () => {
  it("keeps Stop available after PI has acknowledged a still-running workflow", () => {
    // Workflow Pi sessions are intentionally absent from the agents panel.
    expect(runningToastState({ workActive: { active: true }, hasAgentActivity: false,
      waitingForUser: false, hasActiveScripts: false })).toEqual({ visible: true, showStop: true });
  });

  it("clears stale streaming UI after the host settles Stop", () => {
    expect(runningToastState({ workActive: { active: false }, hasAgentActivity: true,
      waitingForUser: false, hasActiveScripts: false })).toEqual({ visible: false, showStop: false });
  });

  it("does not offer a second Stop while waiting for an answer or while a script panel owns it", () => {
    expect(runningToastState({ workActive: { active: true }, hasAgentActivity: true,
      waitingForUser: true, hasActiveScripts: false })).toEqual({ visible: false, showStop: false });
    expect(runningToastState({ workActive: { active: true }, hasAgentActivity: false,
      waitingForUser: false, hasActiveScripts: true })).toEqual({ visible: true, showStop: false });
  });

  it("retains the streaming fallback before an authoritative work-state arrives", () => {
    expect(runningToastState({ workActive: null, hasAgentActivity: true,
      waitingForUser: false, hasActiveScripts: false })).toEqual({ visible: true, showStop: true });
  });
});

describe("runningToastLabel (#76)", () => {
  it("names a single working agent", () => {
    expect(runningToastLabel(["librarian"])).toEqual({
      key: "chat.agentWorking",
      vars: { name: "librarian" },
    });
  });

  it("joins multiple working agents", () => {
    expect(runningToastLabel(["principal", "trace"])).toEqual({
      key: "chat.agentsWorking",
      vars: { names: "principal、trace" },
    });
  });

  it("uses a custom separator when provided", () => {
    expect(runningToastLabel(["a", "b"], ", ")).toEqual({
      key: "chat.agentsWorking",
      vars: { names: "a, b" },
    });
  });

  it("falls back to the generic label when no named agent is running", () => {
    expect(runningToastLabel([])).toEqual({ key: "chat.agentThinking" });
  });

  it("shows retry progress in the existing working toast", () => {
    expect(
      runningToastLabel(["principal"], "、", {
        name: "principal",
        attempt: 2,
        maxAttempts: 5,
        delayMs: 4_001,
      }),
    ).toEqual({
      key: "chat.agentRetrying",
      vars: { name: "principal", attempt: 2, max: 5, sec: 5 },
    });
  });

  it("keeps other running agent names visible while one agent retries", () => {
    expect(
      runningToastLabel(["principal", "trace"], "、", {
        name: "principal",
        attempt: 2,
        maxAttempts: 5,
        delayMs: 4_001,
      }),
    ).toEqual({
      key: "chat.agentsWorkingRetrying",
      vars: { names: "trace", name: "principal", attempt: 2, max: 5, sec: 5 },
    });
  });
});
