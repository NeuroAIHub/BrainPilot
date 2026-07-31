/**
 * Trace Agent — verifies that record_trace dispatches to a real spawned trace
 * agent (legacy parity), so the Agents panel sees its idle/running transitions
 * instead of a permanently-dormant placeholder.
 *
 * What this pins down (host-side, mock factory):
 *   - calling `record_trace` ensures a `trace` agent is in the session's agent
 *     list (status idle by default; visible to the panel via `listAgents`);
 *   - a trace event is delivered through the internal durable queue,
 *     formatted as `[Trace Event]\nDescription: …\nContext: …\n\nArtifacts:`;
 *   - `agent_status_update` events with name="trace" reach the bus once the
 *     trace agent runs (running → idle), proving the panel will "light up";
 *   - the trace agent's run does NOT flip the session's derived run-active
 *     flag — `deriveRunActive` excludes the trace role on purpose.
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type {
  AgUiEvent,
  AgentSessionFactory,
  IAgentSession,
  PiAgentEvent,
  SystemTool,
} from "../types.js";

interface Script {
  onPrompt?: (
    text: string,
    turn: number,
  ) => { tool: string; args: Record<string, unknown> } | undefined;
}

function scriptedFactory(scripts: Record<string, Script>): AgentSessionFactory {
  return async ({ sessionId, agentName, systemTools }) => {
    const toolMap = new Map<string, SystemTool>(systemTools.map((t) => [t.name, t]));
    const listeners = new Set<(e: PiAgentEvent) => void>();
    let turn = 0;
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
        turn += 1;
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
        emit({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: `ok ${agentName}` }] },
        });
        const call = scripts[agentName]?.onPrompt?.(text, turn);
        if (call) {
          const tool = toolMap.get(call.tool);
          const toolCallId = `tc_${call.tool}_${turn}`;
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

describe("Trace Agent — record_trace dispatches to a spawned trace agent", () => {
  it("ensures a trace agent appears in listAgents after record_trace", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (_text, turn) =>
          turn === 1
            ? { tool: "record_trace", args: { description: "first decision" } }
            : undefined,
      },
      // No script for trace: it just needs to exist; we're checking spawn.
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "go");
    await waitFor(() => m.listAgents(s.id).some((a) => a.name === "trace"));

    const names = m.listAgents(s.id).map((a) => a.name);
    expect(names).toContain("principal");
    expect(names).toContain("trace");
  });

  it("delivers a [Trace Event] envelope to the trace agent", async () => {
    let captured: string | undefined;
    const factory = scriptedFactory({
      principal: {
        onPrompt: (_text, turn) =>
          turn === 1
            ? {
                tool: "record_trace",
                args: {
                  description: "designed an experiment",
                  context: "after reviewing prior art",
                  artifacts: ["plan.md", "diagram.png"],
                },
              }
            : undefined,
      },
      trace: {
        onPrompt: (text) => {
          captured = text;
          return undefined;
        },
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "go");
    await waitFor(() => captured !== undefined && captured.includes("[Trace Event]"));

    expect(captured!).toContain("[Trace Event]");
    expect(captured!).toContain("Description: designed an experiment");
    expect(captured!).toContain("Context: after reviewing prior art");
    expect(captured!).toContain("- plan.md");
    expect(captured!).toContain("- diagram.png");
  });

  it("emits agent_status_update events for the trace agent (running → idle)", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (_text, turn) =>
          turn === 1
            ? { tool: "record_trace", args: { description: "a decision" } }
            : undefined,
      },
      trace: {
        // Trace consumes the envelope and writes a node — exercises a real run.
        onPrompt: (text) =>
          text.includes("[Trace Event]")
            ? { tool: "create_trace_node", args: { title: "a decision" } }
            : undefined,
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const traceStatusUpdates: string[] = [];
    m.subscribe(s.id, (e: AgUiEvent) => {
      const ev = e as { type: string; name?: string; status?: string };
      if (ev.type === "agent_status_update" && ev.name === "trace") {
        traceStatusUpdates.push(String(ev.status));
      }
    });

    await m.sendMessage(s.id, "go");
    await waitFor(() => traceStatusUpdates.includes("running") && traceStatusUpdates.includes("idle"));

    // Order matters: must run, then settle back to idle.
    const firstRunningIdx = traceStatusUpdates.indexOf("running");
    const firstIdleAfterRunning = traceStatusUpdates.indexOf("idle", firstRunningIdx + 1);
    expect(firstRunningIdx).toBeGreaterThanOrEqual(0);
    expect(firstIdleAfterRunning).toBeGreaterThan(firstRunningIdx);
  });

  it("trace agent's run does NOT flip the session's derived run-active flag", async () => {
    // Per session-manager.ts: the trace agent is excluded from
    // deriveRunActive — its self-recording shouldn't read as "the user's
    // task is still running". Once the principal's run finishes, runState
    // settles to inactive even if the trace agent is still consuming
    // its internal task-event queue.
    const factory = scriptedFactory({
      principal: {
        onPrompt: (_text, turn) =>
          turn === 1
            ? { tool: "record_trace", args: { description: "a decision" } }
            : undefined,
      },
      trace: {
        onPrompt: (text) =>
          text.includes("[Trace Event]")
            ? { tool: "create_trace_node", args: { title: "a decision" } }
            : undefined,
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "go");
    await waitFor(() => m.getTrace(s.id)!.nodes.length >= 1);
    // After the trace agent has produced a node, give the manager a tick to
    // emit the post-run session_state and then assert.
    await new Promise((r) => setTimeout(r, 20));
    const state = m.getSessionState(s.id);
    expect(state).toBeDefined();
    expect(state!.runState.active).toBe(false);
  });
});
