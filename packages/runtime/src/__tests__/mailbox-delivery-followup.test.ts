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
  principalProcessedFollowUps: string[];
  principalInitialSettled: boolean;
  principalAbortCount: number;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function mailboxRaceFactory(
  observed: Observed,
  principalGate: Promise<void>,
): AgentSessionFactory {
  return async ({ sessionId, agentName, systemTools }) => {
    const tools = new Map<string, SystemTool>(systemTools.map((tool) => [tool.name, tool]));
    const listeners = new Set<(event: PiAgentEvent) => void>();
    const queuedFollowUps: string[] = [];
    let streaming = false;

    const emit = (event: PiAgentEvent) => {
      for (const listener of listeners) listener(event);
    };

    const sendMessage = async (to: string, content: string): Promise<void> => {
      const tool = tools.get("send_message");
      if (!tool) throw new Error("send_message tool unavailable");
      const toolCallId = `${agentName}_send_message`;
      const args = { to, content };
      emit({ type: "tool_execution_start", toolCallId, toolName: "send_message", args });
      const result = await tool.execute(args);
      emit({
        type: "tool_execution_end",
        toolCallId,
        toolName: "send_message",
        result: result.content[0]?.text,
        isError: result.isError ?? false,
      });
    };

    const session: IAgentSession = {
      sessionId,
      get isStreaming() {
        return streaming;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string, options?: PromptOptions) {
        if (streaming) {
          if (options?.streamingBehavior === "followUp") {
            if (agentName === "principal") observed.principalFollowUps.push(text);
            queuedFollowUps.push(text);
            return;
          }
          throw new Error(
            "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
          );
        }

        streaming = true;
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
        try {
          if (agentName === "principal") {
            observed.principalPrompts.push(text);
            if (text === "START") {
              await sendMessage("auditor", "review the draft");
              await principalGate;
              observed.principalInitialSettled = true;
            }
          } else if (agentName === "auditor" && text.includes("review the draft")) {
            await sendMessage("principal", "audit complete");
          } else if (agentName === "auditor" && text === "REPORT_WHILE_IDLE") {
            await sendMessage("principal", "idle audit complete");
          }

          emit({
            type: "message_end",
            message: { role: "assistant", content: [{ type: "text", text: `ok ${agentName}` }] },
          });
          emit({ type: "turn_end" });

          for (const followUp of queuedFollowUps.splice(0)) {
            if (agentName === "principal") {
              observed.principalProcessedFollowUps.push(followUp);
            }
          }
          emit({ type: "agent_end", messages: [], willRetry: false });
        } finally {
          streaming = false;
        }
      },
      async abort() {
        if (agentName === "principal") observed.principalAbortCount++;
        streaming = false;
      },
      dispose() {},
    };
    return session;
  };
}

function newObserved(): Observed {
  return {
    principalPrompts: [],
    principalFollowUps: [],
    principalProcessedFollowUps: [],
    principalInitialSettled: false,
    principalAbortCount: 0,
  };
}

describe("mailbox delivery to a busy agent", () => {
  it("queues the mailbox message until the active response completes", async () => {
    let releasePrincipal!: () => void;
    const principalGate = new Promise<void>((resolve) => {
      releasePrincipal = resolve;
    });
    const observed = newObserved();
    const manager = new SessionManager({
      persist: false,
      agentFactory: mailboxRaceFactory(observed, principalGate),
    });
    const session = await manager.createSession();
    const runErrors: string[] = [];
    manager.subscribe(session.id, (event) => {
      if (event.type === "RUN_ERROR") {
        runErrors.push(String((event as { message?: unknown }).message ?? ""));
      }
    });

    try {
      await manager.sendMessage(session.id, "START");
      await waitFor(() => observed.principalFollowUps.length === 1 || runErrors.length > 0);

      expect(runErrors).toEqual([]);
      expect(observed.principalPrompts).toEqual(["START"]);
      expect(observed.principalFollowUps).toHaveLength(1);
      expect(observed.principalFollowUps[0]).toContain("audit complete");
      expect(observed.principalInitialSettled).toBe(false);
      expect(observed.principalAbortCount).toBe(0);

      releasePrincipal();
      await waitFor(() => observed.principalProcessedFollowUps.length === 1);
      await waitFor(() => manager.getSessionState(session.id)?.runState.active === false);

      expect(observed.principalProcessedFollowUps).toEqual(observed.principalFollowUps);
      expect(observed.principalPrompts).toEqual(["START"]);
      expect(runErrors).toEqual([]);
    } finally {
      releasePrincipal();
    }
  });

  it("starts a normal prompt immediately when the mailbox target is idle", async () => {
    const observed = newObserved();
    const manager = new SessionManager({
      persist: false,
      agentFactory: mailboxRaceFactory(observed, Promise.resolve()),
    });
    const session = await manager.createSession();
    const runErrors: unknown[] = [];
    manager.subscribe(session.id, (event) => {
      if (event.type === "RUN_ERROR") runErrors.push(event);
    });

    await manager.sendMessage(session.id, "REPORT_WHILE_IDLE", "auditor");
    await waitFor(() => observed.principalPrompts.length === 1);
    await waitFor(() => manager.getSessionState(session.id)?.runState.active === false);

    expect(observed.principalPrompts[0]).toContain("idle audit complete");
    expect(observed.principalFollowUps).toEqual([]);
    expect(runErrors).toEqual([]);
  });
});
