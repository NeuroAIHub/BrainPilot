/**
 * Graph of Trace — structural guarantees driven through the real SessionManager.
 *
 * The behavioural "reminder" hooks (nudge the agent to record_trace / report
 * back) now live in the Pi-native `trace-reminder` extension, which only loads
 * under the real Pi factory; per design §7 / T2 they are verified in real mode,
 * not here. What these tests still pin down is the host-side trace plumbing that
 * is independent of any prompt-compliance hook:
 *   - consecutive `record_trace` calls chain into a connected DAG (visible edges,
 *     not orphan dots);
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

describe("Graph of Trace structural plumbing", () => {
  it("chains consecutive record_trace nodes so the graph has edges (not orphans)", async () => {
    // Regression: record_trace used to create orphan nodes (no parents), so the
    // Graph of Trace rendered as disconnected dots with no visible edges.
    let turn = 0;
    const factory = scriptedFactory({
      principal: {
        onPrompt: () => {
          turn += 1;
          return { tool: "record_trace", args: { description: `decision ${turn}` } };
        },
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "first");
    await waitFor(() => m.getTrace(s.id)!.nodes.length >= 1);
    await m.sendMessage(s.id, "second");
    await waitFor(() => m.getTrace(s.id)!.nodes.length >= 2);

    const nodes = m.getTrace(s.id)!.nodes;
    const first = nodes.find((n) => n.title === "decision 1")!;
    const second = nodes.find((n) => n.title === "decision 2")!;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    // The second trace is linked to the first → at least one edge exists.
    expect(second.parentIds).toContain(first.id);
    expect(second.parents[0]!.relation).toBe("follows");
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
