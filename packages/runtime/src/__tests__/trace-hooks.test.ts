/**
 * #79 — deterministic post-turn trace capture.
 *
 * The Graph of Trace must stay reliable even when the model never calls
 * `record_trace`. These tests drive scripted agent turns through the real
 * SessionManager and assert:
 *   - a principal that delegates without record_trace still gets an auto node;
 *   - an expert that delivers a result without record_trace gets an auto node;
 *   - a turn that DOES call record_trace produces no duplicate auto node;
 *   - every trace mutation is pushed to the SSE stream as CUSTOM:trace_node.
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, SystemTool } from "../types.js";

interface Script {
  onPrompt?: (text: string) => { tool: string; args: Record<string, unknown> } | undefined;
}

function scriptedFactory(scripts: Record<string, Script>): AgentSessionFactory {
  return async ({ sessionId, agentName, systemTools }) => {
    const toolMap = new Map<string, SystemTool>(systemTools.map((t) => [t.name, t]));
    const listeners = new Set<(e: PiAgentEvent) => void>();
    const emit = (e: PiAgentEvent) => {
      for (const l of listeners) {
        try {
          l(e);
        } catch {
          /* isolate */
        }
      }
    };
    const session: IAgentSession = {
      sessionId,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string) {
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
        emit({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: `ok ${agentName}` }] },
        });
        const call = scripts[agentName]?.onPrompt?.(text);
        if (call) {
          const tool = toolMap.get(call.tool);
          const toolCallId = `tc_${call.tool}`;
          emit({ type: "tool_execution_start", toolCallId, toolName: call.tool, args: call.args });
          let result = "";
          let isError = false;
          if (tool) {
            const res = await tool.execute(call.args);
            result = res.content.map((c) => c.text).join("");
            isError = res.isError ?? false;
          } else {
            result = `tool ${call.tool} not available`;
            isError = true;
          }
          emit({ type: "tool_execution_end", toolCallId, toolName: call.tool, result, isError });
        }
        emit({ type: "turn_end" });
        emit({ type: "agent_end", messages: [], willRetry: false });
      },
      async abort() {},
      dispose() {},
    };
    return session;
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("deterministic trace capture (#79)", () => {
  it("auto-captures a milestone when principal delegates without record_trace", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (text) =>
          text.includes("DELEGATE")
            ? { tool: "create_agent", args: { agent_type: "librarian", task: "survey" } }
            : undefined,
      },
      librarian: {},
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "please DELEGATE this");
    await waitFor(() => m.getTrace(s.id)!.nodes.length > 0);

    const nodes = m.getTrace(s.id)!.nodes;
    const auto = nodes.find((n) => n.metadata?.auto);
    expect(auto).toBeDefined();
    expect(auto!.title).toBe("Delegated to librarian");
    expect(auto!.agent).toBe("principal");
    expect(auto!.metadata?.hook).toBe("principal_trace");
  });

  it("auto-captures an expert delivery without record_trace", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (text) =>
          text.includes("DELEGATE")
            ? { tool: "send_message", args: { to: "librarian", content: "do work" } }
            : undefined,
      },
      librarian: {
        onPrompt: (text) =>
          text.includes("do work")
            ? { tool: "send_message", args: { to: "principal", content: "findings ready" } }
            : undefined,
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "please DELEGATE this");
    await waitFor(() =>
      m.getTrace(s.id)!.nodes.some((n) => n.agent === "librarian" && n.metadata?.auto),
    );

    const lib = m.getTrace(s.id)!.nodes.find((n) => n.agent === "librarian" && n.metadata?.auto)!;
    expect(lib.title).toBe("librarian delivered result");
    expect(lib.metadata?.hook).toBe("expert_reply");
  });

  it("does NOT add an auto node when the model already called record_trace", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (text) =>
          text.includes("TRACE")
            ? { tool: "record_trace", args: { description: "explicit decision" } }
            : undefined,
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "please TRACE this");
    await waitFor(() => m.getTrace(s.id)!.nodes.length > 0);
    // settle: let the turn_end hook run
    await new Promise((r) => setTimeout(r, 20));

    const nodes = m.getTrace(s.id)!.nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.metadata?.auto).toBeUndefined();
    expect(nodes[0]!.title).toBe("explicit decision");
  });

  it("pushes every trace mutation to the SSE stream as CUSTOM:trace_node", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (text) =>
          text.includes("TRACE")
            ? { tool: "record_trace", args: { description: "a decision" } }
            : undefined,
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const traceEvents: Array<{ op: string; nodeId: string }> = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "CUSTOM" && (e as { name?: string }).name === "trace_node") {
        const v = (e as { value?: { op: string; node: { id: string } } }).value!;
        traceEvents.push({ op: v.op, nodeId: v.node.id });
      }
    });

    await m.sendMessage(s.id, "please TRACE this");
    await waitFor(() => traceEvents.length > 0);
    expect(traceEvents[0]!.op).toBe("created");
    expect(traceEvents[0]!.nodeId).toBeTruthy();
  });
});
