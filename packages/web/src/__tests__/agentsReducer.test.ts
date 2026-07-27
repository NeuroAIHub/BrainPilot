import { describe, it, expect } from "vitest";
import { reduceAgentsForEvent } from "../contexts/agentsReducer";
import type { AgentStatus, WebSocketEvent } from "../contracts/backend";

// #70: events arrive post-normalizeAgUiEvent (camelCase). agent_status_update's
// authoritative agent key is the top-level `name` field; status is one of
// idle|running|error|stopped (retrying normalized to running).

const ev = (name: string, status: string): WebSocketEvent =>
  ({ type: "agent_status_update", name, status } as WebSocketEvent);

describe("reduceAgentsForEvent (#70)", () => {
  it("appends an unknown agent with empty task", () => {
    const out = reduceAgentsForEvent([], ev("librarian", "running"));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "librarian", status: "running", task: "", alive: true });
  });

  it("updates a known agent's status but preserves its task", () => {
    const prev: AgentStatus[] = [
      { name: "librarian", status: "idle", task: "读文档", updatedAt: "t0", alive: true },
    ];
    const out = reduceAgentsForEvent(prev, ev("librarian", "running"));
    expect(out[0]!.status).toBe("running");
    expect(out[0]!.task).toBe("读文档"); // task preserved
    expect(out).not.toBe(prev); // new reference on change
  });

  it("returns the same reference on a no-op status", () => {
    const prev: AgentStatus[] = [
      { name: "principal", status: "running", task: "", updatedAt: "t0", alive: true },
    ];
    expect(reduceAgentsForEvent(prev, ev("principal", "running"))).toBe(prev);
  });

  it("returns the same reference when repeated activeTools content is unchanged", () => {
    const activeTools = [{
      toolCallId: "t1",
      toolName: "bash",
      startedAt: "2026-07-27T00:00:00.000Z",
      cancellable: true,
      status: "running" as const,
    }];
    const prev: AgentStatus[] = [{
      name: "principal",
      status: "running",
      task: "",
      activeTools,
      activeToolExecutions: ["t1"],
    }];
    const event = {
      type: "agent_status_update",
      name: "principal",
      status: "running",
      activeTools: activeTools.map((tool) => ({ ...tool })),
      activeToolExecutions: ["t1"],
    } as unknown as WebSocketEvent;
    expect(reduceAgentsForEvent(prev, event)).toBe(prev);
  });

  it("ignores non agent_status_update events (same reference)", () => {
    const prev: AgentStatus[] = [
      { name: "principal", status: "idle", task: "", updatedAt: "t0", alive: true },
    ];
    expect(reduceAgentsForEvent(prev, { type: "RUN_STARTED" } as WebSocketEvent)).toBe(prev);
  });

  it("ignores events with an empty name", () => {
    const prev: AgentStatus[] = [];
    expect(reduceAgentsForEvent(prev, ev("", "running"))).toBe(prev);
  });

  it("marks a stopped agent as not alive", () => {
    const out = reduceAgentsForEvent([], ev("librarian", "stopped"));
    expect(out[0]).toMatchObject({ status: "stopped", alive: false });
  });

  it("normalizes retrying to running for the panel", () => {
    const out = reduceAgentsForEvent([], ev("principal", "retrying"));
    expect(out[0]!.status).toBe("running");
  });

  it("stores retry progress and clears it on the next ordinary status update", () => {
    const retrying = reduceAgentsForEvent(
      [],
      {
        type: "agent_status_update",
        name: "principal",
        status: "running",
        retry: { attempt: 2, maxAttempts: 5, delayMs: 4_000 },
      } as unknown as WebSocketEvent,
    );
    expect(retrying[0]!.retry).toEqual({ attempt: 2, maxAttempts: 5, delayMs: 4_000 });

    const cleared = reduceAgentsForEvent(retrying, ev("principal", "running"));
    expect(cleared[0]!.retry).toBeUndefined();
  });

  it("merges multiple agents independently", () => {
    let agents: AgentStatus[] = [];
    agents = reduceAgentsForEvent(agents, ev("principal", "running"));
    agents = reduceAgentsForEvent(agents, ev("librarian", "running"));
    agents = reduceAgentsForEvent(agents, ev("principal", "idle"));
    expect(agents).toHaveLength(2);
    expect(agents.find((a) => a.name === "principal")!.status).toBe("idle");
    expect(agents.find((a) => a.name === "librarian")!.status).toBe("running");
  });
});
