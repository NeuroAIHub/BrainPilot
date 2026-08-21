import { describe, expect, it } from "vitest";
import type { AgentStatus, ChatMessage, TraceNode } from "../contracts/backend";
import {
  summarizeAgentSession,
  summarizeTraceSession,
} from "../components/session/progressiveDisclosure";

const message = (
  overrides: Partial<ChatMessage>,
): ChatMessage => ({
  id: overrides.id ?? "m1",
  role: overrides.role ?? "assistant",
  content: overrides.content ?? "ok",
  createdAt: overrides.createdAt ?? "2026-08-21T00:00:00.000Z",
  ...overrides,
});

const agent = (name: string, status = "idle"): AgentStatus => ({
  name,
  status,
  task: "",
} as AgentStatus);

const traceNode = (type: string): TraceNode => ({
  id: `node-${type}`,
  title: type,
  type,
  status: "completed",
  parents: [],
  artifacts: [],
  parentIds: [],
  childIds: [],
  toolCalls: [],
});

describe("progressive Agent disclosure (#488)", () => {
  it("keeps a direct Principal conversation compact and counts chat separately", () => {
    const summary = summarizeAgentSession(
      [agent("principal")],
      [message({ role: "user" }), message({ id: "m2", role: "assistant" })],
      0,
    );
    expect(summary).toMatchObject({
      simple: true,
      participantCount: 1,
      chatMessageCount: 2,
      crossAgentMessageCount: 0,
    });
  });

  it("does not promote the internal Trace agent to a participant", () => {
    expect(
      summarizeAgentSession([agent("principal"), agent("trace")], [], 0).simple,
    ).toBe(true);
  });

  it("opens the full workbench for a real delegation or subagent", () => {
    const delegated = message({
      kind: "tool",
      toolName: "dispatch_task",
      agent: "principal",
      toolInput: { to: "writer", content: "draft" },
    });
    expect(
      summarizeAgentSession([agent("principal")], [delegated], 0),
    ).toMatchObject({ simple: false, crossAgentMessageCount: 1 });
    expect(summarizeAgentSession([agent("principal")], [], 1).simple).toBe(false);
  });
});

describe("progressive Trace disclosure (#488)", () => {
  it("treats an empty graph or Session Start alone as compact", () => {
    expect(summarizeTraceSession([]).simple).toBe(true);
    expect(summarizeTraceSession([traceNode("session_start")])).toEqual({
      simple: true,
      meaningfulNodeCount: 0,
      totalNodeCount: 1,
    });
  });

  it("keeps the full workbench for a substantive node", () => {
    expect(
      summarizeTraceSession([
        traceNode("session_start"),
        traceNode("decision"),
      ]),
    ).toMatchObject({ simple: false, meaningfulNodeCount: 1 });
  });
});
