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
    async fireAsync(ev: string, e?: unknown) {
      for (const fn of handlers[ev] || []) await fn(e);
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
    hasPendingTasks: deps?.hasPendingTasks ?? (() => role === "expert"),
    claimTaskReminder: deps?.claimTaskReminder,
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
  it.each([
    "read",
    "grep",
    "glob",
    "ls",
    "find",
    "skill_search",
    "get_trace_graph",
    "get_trace_node",
    "get_trace_neighborhood",
    "get_trace_diff",
  ])(
    "read-only/lookup tool %s does not arm a trace reminder",
    (tool) => expect(runOnce("principal", [tool]).kinds).toEqual([]),
  );

  it("substantive PI work only needs a trace reminder", () => {
    expect(runOnce("principal", ["bash"]).kinds).toEqual(["trace"]);
  });

  it("recorded substantive PI work needs no reminder", () => {
    expect(runOnce("principal", ["write", "record_trace"]).kinds).toEqual([]);
  });

  it("creating an agent does not suppress the trace reminder", () => {
    expect(runOnce("principal", ["bash", "create_agent"]).kinds).toEqual(["trace"]);
  });

  it("sending a task counts as delegation", () => {
    expect(runOnce("principal", [
      "bash",
      { name: "dispatch_task", args: { to: "engineer" } },
    ]).kinds).toEqual(["trace"]);
  });

  it("tool-name case does not matter", () => {
    expect(runOnce("principal", ["READ"]).kinds).toEqual([]);
    expect(runOnce("principal", ["WRITE", "record_trace"]).kinds).toEqual([]);
  });
});

describe("trace-reminder: flat task activity", () => {
  const pendingEngineerTask = {
    name: "engineer",
    hasPendingTasks: () => true,
  };

  it("read-only expert work asks for a reply but not a trace", () => {
    expect(runOnce("expert", ["read"], pendingEngineerTask).kinds).toEqual(["reply"]);
  });

  it("dispatching a peer task counts as progress", () => {
    expect(runOnce("expert", [
      { name: "dispatch_task", args: { to: "writer" } },
    ], pendingEngineerTask).kinds).toEqual(["trace"]);
  });

  it("substantive work before a peer request still requires trace, not reply", () => {
    expect(runOnce("expert", [
      "write",
      { name: "dispatch_task", args: { to: "writer" } },
    ], pendingEngineerTask).kinds).toEqual(["trace"]);
  });

  it("completing one task still reminds when another assignment remains pending", () => {
    expect(runOnce("expert", [
      { name: "complete_task", args: { task_id: "task_000001" } },
    ], pendingEngineerTask).kinds).toEqual(["merged"]);
  });

  it("completing the final task only needs trace", () => {
    expect(runOnce("expert", [
      { name: "complete_task", args: { task_id: "task_000001" } },
    ], { ...pendingEngineerTask, hasPendingTasks: () => false }).kinds).toEqual(["trace"]);
  });

  it("a traced completion needs no reminder", () => {
    expect(runOnce("expert", [
      "record_trace",
      { name: "complete_task", args: { task_id: "task_000001" } },
    ], { ...pendingEngineerTask, hasPendingTasks: () => false }).kinds).toEqual([]);
  });

  it("trace agent is never nudged", () => {
    expect(runOnce("trace", ["write"]).kinds).toEqual([]);
  });
});

describe("trace-reminder: one follow-up maximum", () => {
  it("awaits the durable reminder claim before sending the follow-up", async () => {
    const pi = fakePi();
    let release!: (claimed: boolean) => void;
    const claimed = new Promise<boolean>((resolve) => { release = resolve; });
    makeTraceReminderExt({
      role: "expert",
      name: "engineer",
      hasPendingTasks: () => true,
      claimTaskReminder: () => claimed,
      onUnreplied: () => {},
    })(pi as never);
    pi.fire("agent_start");
    const ending = pi.fireAsync("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(pi.sent).toEqual([]);
    release(true);
    await ending;
    expect(kindsOf(pi.sent)).toEqual(["reply"]);
  });

  it("keeps state across the follow-up and does not inject a second reminder", () => {
    const fallback = vi.fn();
    const pi = fakePi();
    makeTraceReminderExt({
      role: "expert",
      name: "engineer",
      onUnreplied: fallback,
      hasPendingTasks: () => true,
    })(pi as never);

    pi.fire("agent_start");
    pi.fire("tool_execution_start", { toolCallId: "w", toolName: "write", args: {} });
    pi.fire("tool_execution_end", { toolCallId: "w", toolName: "write", isError: false });
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(kindsOf(pi.sent)).toEqual(["merged"]);

    // The internally-triggered follow-up still fails to reply. It falls back to
    // the task creator without injecting a second model message.
    pi.fire("agent_start");
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(kindsOf(pi.sent)).toEqual(["merged"]);
    expect(fallback).toHaveBeenCalledOnce();
  });

  it("a reply during the follow-up satisfies the chain without another reminder", () => {
    const fallback = vi.fn();
    const pi = fakePi();
    let hasPending = true;
    makeTraceReminderExt({
      role: "expert",
      name: "engineer",
      onUnreplied: fallback,
      hasPendingTasks: () => hasPending,
    })(pi as never);

    pi.fire("agent_start");
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
    expect(kindsOf(pi.sent)).toEqual(["reply"]);

    pi.fire("agent_start");
    pi.fire("tool_execution_start", {
      toolCallId: "s",
      toolName: "complete_task",
      args: { task_id: "task_000001" },
    });
    hasPending = false;
    pi.fire("tool_execution_end", { toolCallId: "s", toolName: "complete_task", isError: false });
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

  it("a length-limited run leaves recovery to MasAgent", () => {
    const pi = fakePi();
    makeTraceReminderExt({
      role: "expert",
      name: "engineer",
      hasPendingTasks: () => true,
      onUnreplied: () => {},
    })(pi as never);
    pi.fire("agent_start");
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "length" }] });
    expect(pi.sent).toEqual([]);
  });

  it("every reminder is wrapped in a strip-able system-message marker", () => {
    const { sent } = runOnce("expert", ["read"], { hasPendingTasks: () => true });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.deliverAs).toBe("followUp");
    expect(sent[0]!.content).toMatch(
      /^\[SYSTEM-MESSAGE:reply\] [\s\S]+ \[\/SYSTEM-MESSAGE\]$/,
    );
  });
});
