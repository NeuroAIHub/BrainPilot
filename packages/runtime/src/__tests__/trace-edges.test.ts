/**
 * Graph of Trace — structural guarantees driven through the real SessionManager.
 *
 * After the legacy-parity rewrite, `record_trace` does NOT mutate the graph
 * directly. It dispatches a `[Trace Event]` envelope into the trace agent's
 * internal event queue; the trace agent (a real Pi AgentSession) is the editor that calls
 * `create_trace_node` / `update_trace_node`. These tests
 * pin down the host-side plumbing — independent of the Pi-native reminder hooks
 * which only load under the real factory (verified separately per design §7/T2):
 *   - the principal calling `record_trace` causes a trace agent to be spawned
 *     and a trace event to reach its durable queue;
 *   - chronology alone does not create causal lineage;
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
  it("keeps consecutive records as sibling branches under Session Start", async () => {
    let principalTurn = 0;
    let traceTurn = 0;
    const factory = scriptedFactory({
      principal: {
        onPrompt: () => {
          principalTurn += 1;
          return {
            tool: "record_trace",
            args: { description: `decision ${principalTurn}` },
          };
        },
      },
      trace: {
        onPrompt: (text) => {
          // No parent candidate means a sibling branch under Session Start.
          if (!text.includes("[Trace Event]")) return undefined;
          traceTurn += 1;
          return {
            tool: "create_trace_node",
            args: {
              title: `decision ${traceTurn}`,
              type: "trace",
              confidence: "medium",
              confidence_reason: "The source record is available.",
            },
          };
        },
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "first");
    await waitFor(() => m.getTrace(s.id)!.nodes.some((node) => node.title === "decision 1"));
    await m.sendMessage(s.id, "second");
    await waitFor(() => m.getTrace(s.id)!.nodes.some((node) => node.title === "decision 2"));

    const trace = m.getTrace(s.id)!;
    const nodes = trace.nodes;
    const first = nodes.find((n) => n.title === "decision 1")!;
    const second = nodes.find((n) => n.title === "decision 2")!;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first.parentIds).toEqual([trace.meta.rootNodeId]);
    expect(second.parentIds).toEqual([trace.meta.rootNodeId]);
    expect(first.records).toEqual([
      expect.objectContaining({ sourceAgent: "principal", description: "decision 1" }),
    ]);
    expect(second.records).toEqual([
      expect.objectContaining({ sourceAgent: "principal", description: "decision 2" }),
    ]);
  });

  it("pushes every trace mutation to the SSE stream as CUSTOM:trace_node", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (text) =>
          text.includes("TRACE")
            ? { tool: "record_trace", args: { description: "a decision" } }
            : undefined,
      },
      trace: {
        onPrompt: (text) =>
          text.includes("[Trace Event]")
            ? {
                tool: "create_trace_node",
                args: {
                  title: "a decision",
                  type: "trace",
                  confidence: "medium",
                  confidence_reason: "The source record is available.",
                },
              }
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
