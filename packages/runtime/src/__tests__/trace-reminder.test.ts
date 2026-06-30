/**
 * trace-reminder extension — unit tests driving the extension directly with a
 * fake Pi ExtensionAPI (no SessionManager, no provider). The SessionManager
 * tests deliberately use a scripted factory that does NOT load this extension,
 * so the reminder logic was previously unasserted — which let #211 (the
 * read-only exemption being dead due to a tool-name case mismatch) ship in #210.
 * These tests pin the exact followUp messages emitted per role/tool sequence.
 *
 * Pi emits builtin tool names LOWERCASE (BUILTIN_TOOL_CONFIG in
 * tools/system-tools.ts: principal = read/write/edit/bash/grep/find/glob/ls), so
 * the scenarios use those real names.
 */
import { describe, it, expect } from "vitest";
import { makeTraceReminderExt, type TraceReminderDeps } from "../extensions/trace-reminder.js";
import type { AgentRole } from "../types.js";

interface SentMessage {
  content: string;
  deliverAs?: string;
}

/** A minimal fake of the slice of Pi's ExtensionAPI the extension uses. */
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

/** The kind sub-tag of each emitted [SYSTEM-MESSAGE:kind] followUp, in order. */
function kindsOf(sent: SentMessage[]): string[] {
  return sent.map((s) => (s.content.match(/\[SYSTEM-MESSAGE:(\w+)\]/) || [])[1]);
}

/**
 * Run ONE agent loop: agent_start → successful tool calls → a clean agent_end,
 * and return the kinds of followUp reminders the extension emitted.
 */
function runOnce(
  role: AgentRole,
  tools: string[],
  deps?: Partial<TraceReminderDeps>,
): { kinds: string[]; sent: SentMessage[] } {
  const pi = fakePi();
  makeTraceReminderExt({ role, name: deps?.name ?? role, onUnreplied: deps?.onUnreplied ?? (() => {}) })(
    pi as never,
  );
  pi.fire("agent_start");
  for (const t of tools) pi.fire("tool_execution_end", { toolName: t, isError: false });
  pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "end_turn" }] });
  return { kinds: kindsOf(pi.sent), sent: pi.sent };
}

describe("trace-reminder: principal delegate reminder (意图三, #211)", () => {
  // A read-only principal turn that DID record a trace must not be nudged at all:
  // trace dimension is satisfied and read-only work is exempt from delegate.
  it.each(["read", "grep", "glob", "ls", "find"])(
    "read-only tool %s + record_trace → no reminder (exempt)",
    (tool) => {
      expect(runOnce("principal", [tool, "record_trace"]).kinds).toEqual([]);
    },
  );

  it("substantive tool (bash) + record_trace → delegate reminder", () => {
    expect(runOnce("principal", ["bash", "record_trace"]).kinds).toEqual(["delegate"]);
  });

  it("write/edit are substantive → delegate reminder", () => {
    expect(runOnce("principal", ["write", "record_trace"]).kinds).toEqual(["delegate"]);
    expect(runOnce("principal", ["edit", "record_trace"]).kinds).toEqual(["delegate"]);
  });

  it("external/domain (unknown) tool is substantive → delegate reminder", () => {
    expect(runOnce("principal", ["mcp__foo__do_thing", "record_trace"]).kinds).toEqual(["delegate"]);
  });

  it("management tools (create_agent) are exempt → no delegate reminder", () => {
    expect(runOnce("principal", ["create_agent", "record_trace"]).kinds).toEqual([]);
  });

  it("tool-name case does not matter (Read == read)", () => {
    expect(runOnce("principal", ["Read", "record_trace"]).kinds).toEqual([]);
    expect(runOnce("principal", ["READ", "record_trace"]).kinds).toEqual([]);
  });

  it("a principal that delegated (create_agent) is never told to delegate, even after substantive work", () => {
    // create_agent sets `delegated` → delegate branch is suppressed; only the
    // trace lapse (no record_trace here) remains.
    expect(runOnce("principal", ["bash", "create_agent"]).kinds).toEqual(["trace"]);
  });
});

describe("trace-reminder: trace + reply (意图一/二) still work", () => {
  it("principal with no record_trace → trace reminder", () => {
    expect(runOnce("principal", ["read"]).kinds).toEqual(["trace"]);
  });

  it("expert that neither traced nor replied → single merged reminder", () => {
    expect(runOnce("expert", ["read"]).kinds).toEqual(["merged"]);
  });

  it("expert that traced but did not reply → reply reminder", () => {
    expect(runOnce("expert", ["read", "record_trace"]).kinds).toEqual(["reply"]);
  });

  it("expert that replied but did not trace → trace reminder", () => {
    expect(runOnce("expert", ["read", "send_message"]).kinds).toEqual(["trace"]);
  });

  it("expert that both traced and replied → no reminder", () => {
    expect(runOnce("expert", ["record_trace", "send_message"]).kinds).toEqual([]);
  });

  it("trace agent is never nudged", () => {
    expect(runOnce("trace", ["read"]).kinds).toEqual([]);
  });
});

describe("trace-reminder: error short-circuit (#97)", () => {
  it("a run that ended in error emits no reminder", () => {
    const pi = fakePi();
    makeTraceReminderExt({ role: "expert", name: "expert", onUnreplied: () => {} })(pi as never);
    pi.fire("agent_start");
    pi.fire("tool_execution_end", { toolName: "read", isError: false });
    pi.fire("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] });
    expect(kindsOf(pi.sent)).toEqual([]);
  });
});

describe("trace-reminder: every injected message is wrapped (问题④)", () => {
  it("followUp content is wrapped in a strip-able [SYSTEM-MESSAGE:kind] … [/SYSTEM-MESSAGE] marker", () => {
    const { sent } = runOnce("expert", ["read"]); // merged reminder
    expect(sent).toHaveLength(1);
    expect(sent[0].deliverAs).toBe("followUp");
    expect(sent[0].content).toMatch(/^\[SYSTEM-MESSAGE:merged\] [\s\S]+ \[\/SYSTEM-MESSAGE\]$/);
  });
});
