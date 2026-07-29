import { describe, it, expect, vi } from "vitest";
import { makeTraceReminderExt, type TraceReminderDeps } from "../extensions/trace-reminder.js";
import type { AgentRole } from "../types.js";

interface SentMessage {
  content: string;
  deliverAs?: string;
}

interface ToolCall {
  name: string;
  args?: Record<string, unknown>;
}

function fakePi() {
  const handlers: Record<string, Array<(e: unknown) => unknown>> = {};
  const sent: SentMessage[] = [];
  return {
    on(ev: string, fn: (e: unknown) => unknown) {
      (handlers[ev] ||= []).push(fn);
    },
    sendUserMessage(content: string, opts?: { deliverAs?: string }) {
      sent.push({ content, deliverAs: opts?.deliverAs });
    },
    fire(ev: string, e?: unknown) {
      for (const fn of handlers[ev] || []) fn(e);
    },
    sent,
  };
}

function kindsOf(sent: SentMessage[]): string[] {
  return sent.map((s) => (s.content.match(/\[SYSTEM-MESSAGE:(\w+)\]/) || [])[1]);
}

function runOnce(
  role: AgentRole,
  calls: Array<string | ToolCall>,
  deps?: Partial<TraceReminderDeps>,
): { kinds: string[]; sent: SentMessage[] } {
  const pi = fakePi();
  makeTraceReminderExt({
    role,
    name: deps?.name ?? role,
    onUnreplied: deps?.onUnreplied ?? (() => {}),
    getDelegator: deps?.getDelegator ?? (() => "principal"),
  })(pi as never);
  pi.fire("agent_start");
  calls.forEach((call, index) => {
    const spec = typeof call === "string" ? { name: call, args: {} } : call;
    const event = { toolCallId: `t${index}`, toolName: spec.name, args: spec.args ?? {} };
    pi.fire("tool_execution_start", event);
    pi.fire("tool_execution_end", { ...event, isError: false });
  });
  pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
  return { kinds: kindsOf(pi.sent), sent: pi.sent };
}

describe("trace-reminder: event-driven trace gating", () => {
  it.each(["read", "grep", "glob", "ls", "find", "skill_search"])(
    "read-only/lookup tool %s does not arm a trace reminder",
    (tool) => expect(runOnce("principal", [tool]).kinds).toEqual([]),
  );

  it("substantive PI work needs trace and delegation in one reminder", () => {
    expect(runOnce("principal", ["bash"]).kinds).toEqual(["merged"]);
  });

  it("recorded substantive PI work only needs delegation", () => {
    expect(runOnce("principal", ["write", "record_trace"]).kinds).toEqual(["delegate"]);
  });

  it("creating an agent is not itself a delegation", () => {
    expect(runOnce("principal", ["bash", "create_agent"]).kinds).toEqual(["merged"]);
  });

  it("sending a task counts as delegation", () => {
    expect(runOnce("principal", [
      "bash",
      { name: "send_message", args: { to: "engineer" } },
    ]).kinds).toEqual(["trace"]);
  });

  it("tool-name case does not matter", () => {
    expect(runOnce("principal", ["READ"]).kinds).toEqual([]);
    expect(runOnce("principal", ["WRITE", "record_trace"]).kinds).toEqual(["delegate"]);
  });
});

describe("trace-reminder: replies follow the real delegator", () => {
  const delegatedByExperimentalist = {
    name: "engineer",
    getDelegator: () => "experimentalist",
  };

  it("read-only expert work asks for a reply but not a trace", () => {
    expect(runOnce("expert", ["read"], delegatedByExperimentalist).kinds).toEqual(["reply"]);
  });

  it("a message to a peer enters a legitimate waiting state", () => {
    expect(runOnce("expert", [
      { name: "send_message", args: { to: "writer" } },
    ], delegatedByExperimentalist).kinds).toEqual([]);
  });

  it("substantive work before a peer request still requires trace, not reply", () => {
    expect(runOnce("expert", [
      "write",
      { name: "send_message", args: { to: "writer" } },
    ], delegatedByExperimentalist).kinds).toEqual(["trace"]);
  });

  it("a result to the delegator satisfies reply but still needs trace", () => {
    expect(runOnce("expert", [
      { name: "send_message", args: { to: "experimentalist" } },
    ], delegatedByExperimentalist).kinds).toEqual(["trace"]);
  });

  it("a traced result to the delegator needs no reminder", () => {
    expect(runOnce("expert", [
      "record_trace",
      { name: "send_message", args: { to: "experimentalist" } },
    ], delegatedByExperimentalist).kinds).toEqual([]);
  });

  it("trace agent is never nudged", () => {
    expect(runOnce("trace", ["write"]).kinds).toEqual([]);
  });
});

describe("trace-reminder: one follow-up maximum", () => {
  it("keeps state across the follow-up and does not inject a second reminder", () => {
    const fallback = vi.fn();
    const pi = fakePi();
    makeTraceReminderExt({
      role: "expert",
      name: "engineer",
      getDelegator: () => "experimentalist",
      onUnreplied: fallback,
    })(pi as never);

    pi.fire("agent_start");
    pi.fire("tool_execution_start", { toolCallId: "w", toolName: "write", args: {} });
    pi.fire("tool_execution_end", { toolCallId: "w", toolName: "write", isError: false });
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(kindsOf(pi.sent)).toEqual(["merged"]);

    // The internally-triggered follow-up still fails to reply. It falls back to
    // the delegator without injecting a second model message.
    pi.fire("agent_start");
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(kindsOf(pi.sent)).toEqual(["merged"]);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("a reply during the follow-up satisfies the chain without another reminder", () => {
    const fallback = vi.fn();
    const pi = fakePi();
    makeTraceReminderExt({
      role: "expert",
      name: "engineer",
      getDelegator: () => "experimentalist",
      onUnreplied: fallback,
    })(pi as never);

    pi.fire("agent_start");
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(kindsOf(pi.sent)).toEqual(["reply"]);

    pi.fire("agent_start");
    pi.fire("tool_execution_start", {
      toolCallId: "s",
      toolName: "send_message",
      args: { to: "experimentalist" },
    });
    pi.fire("tool_execution_end", { toolCallId: "s", toolName: "send_message", isError: false });
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(kindsOf(pi.sent)).toEqual(["reply"]);
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe("trace-reminder: failures and message envelope", () => {
  it("a failed tool does not arm trace", () => {
    const pi = fakePi();
    makeTraceReminderExt({ role: "principal", name: "principal", onUnreplied: () => {} })(pi as never);
    pi.fire("agent_start");
    pi.fire("tool_execution_start", { toolCallId: "x", toolName: "bash", args: {} });
    pi.fire("tool_execution_end", { toolCallId: "x", toolName: "bash", isError: true });
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(pi.sent).toEqual([]);
  });

  it("an errored run emits no reminder", () => {
    const pi = fakePi();
    makeTraceReminderExt({ role: "expert", name: "expert", onUnreplied: () => {} })(pi as never);
    pi.fire("agent_start");
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] });
    expect(pi.sent).toEqual([]);
  });

  it("every reminder is wrapped in a strip-able system-message marker", () => {
    const { sent } = runOnce("expert", ["read"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.deliverAs).toBe("followUp");
    expect(sent[0]!.content).toMatch(
      /^\[SYSTEM-MESSAGE:reply\] [\s\S]+ \[\/SYSTEM-MESSAGE\]$/,
    );
  });
});
