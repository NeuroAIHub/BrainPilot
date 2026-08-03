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
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../session-manager.js";
import type { GraphOfTrace } from "../trace.js";
import type { TaskLedger } from "../task-ledger.js";
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
            ? { tool: "create_trace_node", args: { title: "a decision", confidence: "medium", confidence_reason: "Source record is available." } }
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
            ? { tool: "create_trace_node", args: { title: "a decision", confidence: "medium", confidence_reason: "Source record is available." } }
            : undefined,
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "go");
    await waitFor(() => m.getTrace(s.id)!.nodes.some((node) => node.title === "a decision"));
    // After the trace agent has produced a node, give the manager a tick to
    // emit the post-run session_state and then assert.
    await new Promise((r) => setTimeout(r, 20));
    const state = m.getSessionState(s.id);
    expect(state).toBeDefined();
    expect(state!.runState.active).toBe(false);
  });

  it("dispatches an independent Auditor review after a Trace mutation", async () => {
    const factory = scriptedFactory({
      principal: {
        onPrompt: (_text, turn) => turn === 1
          ? { tool: "record_trace", args: { description: "a conclusion" } }
          : undefined,
      },
      trace: {
        onPrompt: (text) => text.includes("[Trace Event]")
          ? { tool: "create_trace_node", args: { title: "Conclusion", confidence: "medium", confidence_reason: "One result file supports it." } }
          : undefined,
      },
      auditor: {
        onPrompt: (text) => text.includes("GoT")
          ? { tool: "edit_trace_review", args: { conclusion: "approve", reason: "The bound record supports this node." } }
          : undefined,
      },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "go");
    await waitFor(() => m.getTrace(s.id)?.nodes.some((node) => node.title === "Conclusion" && node.reviewConclusion === "approved") ?? false);
    expect(m.listAgents(s.id).map((agent) => agent.name)).toContain("auditor");
  });

  it("keeps an Auditor notification durable when no conclusion is submitted", async () => {
    let auditorTurns = 0;
    const factory = scriptedFactory({
      principal: {
        onPrompt: (_text, turn) => turn === 1
          ? { tool: "record_trace", args: { description: "an unreviewed conclusion" } }
          : undefined,
      },
      trace: {
        onPrompt: (text) => text.includes("[Trace Event]")
          ? { tool: "create_trace_node", args: { title: "Unreviewed", confidence: "medium", confidence_reason: "One source record." } }
          : undefined,
      },
      auditor: { onPrompt: () => { auditorTurns += 1; return undefined; } },
    });
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();
    const internal = m as unknown as { sessions: Map<string, { taskLedger: TaskLedger }> };

    await m.sendMessage(s.id, "go");
    await waitFor(() => auditorTurns === 1 && internal.sessions.get(s.id)!.taskLedger.isPaused("auditor"));
    expect(m.taskNotificationCount(s.id, "auditor")).toBe(1);
    expect(m.getTrace(s.id)?.nodes.find((node) => node.title === "Unreviewed")?.reviewConclusion).toBe("unreviewed");

    await m.sendMessage(s.id, "resume");
    await waitFor(() => auditorTurns === 2 && internal.sessions.get(s.id)!.taskLedger.isPaused("auditor"));
    expect(m.taskNotificationCount(s.id, "auditor")).toBe(1);
  });

  it("re-queues a stale Auditor target once with its latest fingerprint", async () => {
    let auditorTurns = 0;
    let m!: SessionManager;
    const factory = scriptedFactory({
      principal: {
        onPrompt: (_text, turn) => turn === 1
          ? { tool: "record_trace", args: { description: "a changing conclusion" } }
          : undefined,
      },
      trace: {
        onPrompt: (text) => text.includes("[Trace Event]")
          ? { tool: "create_trace_node", args: { title: "Changing", confidence: "medium", confidence_reason: "Initial record." } }
          : undefined,
      },
      auditor: {
        onPrompt: () => {
          auditorTurns += 1;
          if (auditorTurns === 1) {
            const internal = m as unknown as { sessions: Map<string, { trace: GraphOfTrace }> };
            const trace = [...internal.sessions.values()][0]!.trace;
            const node = trace.getGraphV2().nodes.find((item) => item.title === "Changing")!;
            trace.updateNode(node.id, {
              description: "Evidence changed during review.",
              confidence: "medium",
              confidenceReason: "Updated record.",
            }, { type: "agent", name: "trace" });
          }
          return { tool: "edit_trace_review", args: { conclusion: "approve", reason: "Current evidence supports the node." } };
        },
      },
    });
    m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "go");
    await waitFor(() => m.getTrace(s.id)?.nodes.some((node) => node.title === "Changing" && node.reviewConclusion === "approved") ?? false);
    expect(auditorTurns).toBe(2);
    expect(m.taskNotificationCount(s.id, "auditor")).toBe(0);
  });

  it("rebuilds Auditor deduplication from durable notifications on restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-trace-audit-restore-"));
    try {
      const id = "audit-restore";
      const m1 = new SessionManager({ dataRoot, persist: true, agentFactory: scriptedFactory({}) });
      await m1.createSession({ id });
      const internal1 = m1 as unknown as {
        sessions: Map<string, { trace: GraphOfTrace; taskLedger: TaskLedger }>;
      };
      const entry1 = internal1.sessions.get(id)!;
      const node = entry1.trace.createNode({ title: "Persisted pending review" });
      const target = entry1.trace.listPendingAuditTargets([node.id])[0]!;
      await entry1.taskLedger.enqueueSystem(
        "auditor",
        `[Background GoT audit] review ${node.id}\nTrace-Audit-Target: ${JSON.stringify(target)}`,
      );
      await m1.emergencySaveAll();

      let auditorTurns = 0;
      const m2 = new SessionManager({
        dataRoot,
        persist: true,
        agentFactory: scriptedFactory({
          auditor: { onPrompt: () => { auditorTurns += 1; return undefined; } },
        }),
      });
      await m2.restoreFromDisk();
      const internal2 = m2 as unknown as {
        sessions: Map<string, { trace: GraphOfTrace; taskLedger: TaskLedger; traceAuditQueued: Set<string> }>;
        enqueuePendingTraceAudits(entry: unknown): Promise<void>;
      };
      const entry2 = internal2.sessions.get(id)!;
      await waitFor(() => auditorTurns === 1 && entry2.taskLedger.isPaused("auditor"));
      expect(entry2.traceAuditQueued.has(node.id)).toBe(true);
      await internal2.enqueuePendingTraceAudits(entry2);
      expect(m2.taskNotificationCount(id, "auditor")).toBe(1);
    } finally {
      await rm(dataRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  });
});
