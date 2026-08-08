import { describe, expect, it } from "vitest";
import { SessionManager } from "../session-manager.js";
import type {
  AgentSessionFactory,
  IAgentSession,
  PiAgentEvent,
  PromptOptions,
  SystemTool,
} from "../types.js";

interface Observed {
  principalPrompts: string[];
  principalFollowUps: string[];
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function busyPrincipalFactory(
  observed: Observed,
  principalGate: Promise<void>,
): AgentSessionFactory {
  return async ({ sessionId, agentName, systemTools }) => {
    const tools = new Map<string, SystemTool>(systemTools.map((tool) => [tool.name, tool]));
    const listeners = new Set<(event: PiAgentEvent) => void>();
    const queuedFollowUps: string[] = [];
    let streaming = false;
    const emit = (event: PiAgentEvent) => listeners.forEach((listener) => listener(event));

    const runTool = async (tool: string, args: Record<string, unknown>): Promise<void> => {
      const id = `${agentName}_${tool}`;
      emit({ type: "tool_execution_start", toolCallId: id, toolName: tool, args });
      const result = await tools.get(tool)!.execute(args);
      emit({
        type: "tool_execution_end",
        toolCallId: id,
        toolName: tool,
        result: result.content[0]?.text,
        isError: result.isError ?? false,
      });
    };

    const session: IAgentSession = {
      sessionId,
      get isStreaming() { return streaming; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async prompt(text: string, options?: PromptOptions) {
        if (streaming) {
          if (options?.streamingBehavior === "followUp") {
            if (agentName === "principal") observed.principalFollowUps.push(text);
            queuedFollowUps.push(text);
            return;
          }
          throw new Error("Agent is already processing a prompt");
        }

        streaming = true;
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        if (agentName === "principal") {
          observed.principalPrompts.push(text);
          if (text === "START") {
            await runTool("dispatch_task", { to: "librarian", content: "return one result" });
            // Keep PI inside its current run while the expert completes.
            await principalGate;
          }
        } else if (agentName === "librarian") {
          const taskId = text.match(/task_id="(task_\d+)"/)?.[1];
          if (taskId) {
            await runTool("complete_task", { task_id: taskId, reply: "expert result" });
          }
        }

        // Mirror Pi consuming queued follow-ups before agent_end.
        for (const followUp of queuedFollowUps.splice(0)) {
          const message = { role: "user" as const, content: [{ type: "text" as const, text: followUp }] };
          emit({ type: "message_start", message });
          emit({ type: "message_end", message });
        }
        emit({ type: "turn_end" });
        emit({ type: "agent_end", messages: [], willRetry: false });
        streaming = false;
      },
      async abort() { streaming = false; },
      dispose() {},
    };
    return session;
  };
}

describe("task completion delivery while the creator is running", () => {
  it("injects the durable notification as a follow-up instead of starting another prompt", async () => {
    let releasePrincipal!: () => void;
    const principalGate = new Promise<void>((resolve) => { releasePrincipal = resolve; });
    const observed: Observed = { principalPrompts: [], principalFollowUps: [] };
    const manager = new SessionManager({
      persist: false,
      agentFactory: busyPrincipalFactory(observed, principalGate),
    });
    const session = await manager.createSession();
    const runErrors: unknown[] = [];
    manager.subscribe(session.id, (event) => {
      if (event.type === "RUN_ERROR") runErrors.push(event);
    });

    await manager.sendMessage(session.id, "START");
    await waitFor(() => observed.principalFollowUps.length === 1);

    expect(observed.principalPrompts).toEqual(["START"]);
    expect(observed.principalFollowUps[0]).toContain(
      '<task_event kind="completed" task_id="task_000001" from="librarian">',
    );
    expect(runErrors).toEqual([]);

    releasePrincipal();
    const internal = manager as unknown as {
      sessions: Map<string, { taskLedger: { count(agent: string): number } }>;
    };
    await waitFor(() => internal.sessions.get(session.id)?.taskLedger.count("principal") === 0);
    await waitFor(() => manager.getSessionState(session.id)?.runState.active === false);

    // The injected batch is acknowledged exactly once; no idle re-wake occurs.
    expect(observed.principalPrompts).toEqual(["START"]);
    expect(observed.principalFollowUps).toHaveLength(1);
    expect(runErrors).toEqual([]);
  });
});
