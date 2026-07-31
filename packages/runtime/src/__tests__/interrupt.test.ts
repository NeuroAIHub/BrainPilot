/**
 * #90 / #327: whole-session Stop must interrupt + pause task notifications without a
 * follow-up model run solely to acknowledge the stop.
 *
 * The frontend Stop button calls POST /sessions/:id/interrupt with no agent,
 * meaning "interrupt the whole session". That must:
 *   - retain but pause task notifications so queued work cannot re-wake a stopped agent;
 *   - emit one deterministic system_message acknowledgement;
 *   - settle runActive so the UI can clear Stop immediately;
 *   - NOT prompt the principal (no extra provider tokens for "I stopped").
 *
 * A targeted interrupt(id, agent) keeps its narrow contract: abort just that
 * agent, leave durable task state and the principal alone.
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, SystemTool } from "../types.js";
import type { AgUiEvent } from "@brainpilot/protocol";

interface Script {
  onPrompt?: (text: string) => { tool: string; args: Record<string, unknown> } | undefined;
}

function scriptedFactory(
  scripts: Record<string, Script>,
  observe: { prompts: Array<{ agent: string; text: string }> },
): AgentSessionFactory {
  return async ({ sessionId, agentName, systemTools }) => {
    const toolMap = new Map<string, SystemTool>(systemTools.map((t) => [t.name, t]));
    const listeners = new Set<(e: PiAgentEvent) => void>();
    let aborted = false;
    // A per-agent gate: librarian blocks inside prompt until released or aborted,
    // so a second message can queue behind its in-flight turn.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const gated = agentName === "librarian";
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
        observe.prompts.push({ agent: agentName, text });
        if (gated) {
          await gate;
          if (aborted) return; // aborted mid-turn: do not run
        }
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
      async abort() {
        aborted = true;
        if (gated) release();
      },
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

describe("whole-session interrupt (#90 / #327)", () => {
  it("pauses without deleting task notifications and resumes on the next user turn", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = scriptedFactory(
      {
        principal: {
          onPrompt: (t) =>
            t.includes("DELEGATE")
              ? { tool: "dispatch_task", args: { to: "librarian", content: "work" } }
              : undefined,
        },
        librarian: {},
      },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    // First delegation: librarian drains "work" and blocks inside its turn.
    await m.sendMessage(s.id, "please DELEGATE");
    await waitFor(() => observe.prompts.some((p) => p.agent === "librarian"));

    // Second delegation while librarian is busy: this message QUEUES (wakeAgent
    // bails because the delivery loop is already running).
    await m.sendMessage(s.id, "please DELEGATE again");
    await waitFor(() => m.taskNotificationCount(s.id, "librarian") === 2);
    const beforeStop = m.taskNotificationCount(s.id, "librarian");

    // Stop the whole session.
    await m.interrupt(s.id);

    // The event remains durable but cannot re-wake librarian while paused.
    expect(m.taskNotificationCount(s.id, "librarian")).toBe(beforeStop);
    const beforeResume = observe.prompts.filter((prompt) => prompt.agent === "librarian").length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(observe.prompts.filter((prompt) => prompt.agent === "librarian")).toHaveLength(beforeResume);

    await m.sendMessage(s.id, "resume");
    await waitFor(() => observe.prompts.filter((prompt) => prompt.agent === "librarian").length > beforeResume);
  });

  it("does not prompt the principal after stop; emits one system acknowledgement (#327)", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = scriptedFactory({ principal: {}, librarian: {} }, observe);
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    await m.sendMessage(s.id, "hello");
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal"));
    const principalBefore = observe.prompts.filter((p) => p.agent === "principal").length;

    await m.interrupt(s.id);
    // Allow any accidental async follow-up prompt to surface.
    await new Promise((r) => setTimeout(r, 40));

    // No follow-up model run solely to acknowledge the interruption.
    expect(observe.prompts.filter((p) => p.agent === "principal").length).toBe(principalBefore);
    expect(observe.prompts.some((p) => /interrupt|system_notice/i.test(p.text))).toBe(false);

    // One deterministic system acknowledgement (not model-generated).
    const sysAcks = events.filter(
      (e) =>
        e.type === "system_message" &&
        typeof (e as { message?: string }).message === "string" &&
        String((e as { message?: string }).message).includes("中断"),
    );
    expect(sysAcks.length).toBe(1);
    // #330 — stable id for history + SSE hydrate dedupe.
    const ackId = (sysAcks[0] as { id?: string }).id;
    expect(typeof ackId).toBe("string");
    expect(ackId).toMatch(new RegExp(`^interrupt:${s.id}:`));

    // Run state settled so the UI can clear Stop immediately.
    const state = m.getSessionState(s.id);
    expect(state?.runState?.active).toBe(false);
  });

  it("targeted interrupt(agent) does not prompt the principal with a notice", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = scriptedFactory(
      {
        principal: {
          onPrompt: (t) =>
            t.includes("DELEGATE")
              ? { tool: "dispatch_task", args: { to: "librarian", content: "work" } }
              : undefined,
        },
        librarian: {},
      },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    // Delegate so librarian is mid-turn (gated/blocked), then interrupt ONLY it.
    await m.sendMessage(s.id, "please DELEGATE");
    await waitFor(() => observe.prompts.some((p) => p.agent === "librarian"));
    const principalBefore = observe.prompts.filter((p) => p.agent === "principal").length;

    await m.interrupt(s.id, "librarian");

    await new Promise((r) => setTimeout(r, 20));
    expect(observe.prompts.filter((p) => p.agent === "principal").length).toBe(principalBefore);
  });
});
