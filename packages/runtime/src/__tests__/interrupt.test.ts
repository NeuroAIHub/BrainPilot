/**
 * #90: whole-session Stop must really interrupt + clear mailboxes + notify PI.
 *
 * The frontend Stop button calls POST /sessions/:id/interrupt with no agent,
 * meaning "interrupt the whole session". Beyond aborting every agent, that must:
 *   - clear ALL mailboxes so a queued message can't re-wake a stopped agent;
 *   - immediately prompt the principal one run with an interrupt notice so PI
 *     knows the user interrupted and should await further instructions.
 *
 * A targeted interrupt(id, agent) keeps its narrow contract: abort just that
 * agent, leave mailboxes and the principal alone.
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, SystemTool } from "../types.js";

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

describe("whole-session interrupt (#90)", () => {
  it("clears all mailboxes so a queued message can't re-wake a stopped agent", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = scriptedFactory(
      {
        principal: {
          onPrompt: (t) =>
            t.includes("DELEGATE")
              ? { tool: "send_message", args: { to: "librarian", content: "work" } }
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
    await waitFor(() => m.mailboxCount(s.id, "librarian") === 1);

    // Stop the whole session.
    await m.interrupt(s.id);

    // The queued message is gone — it will not re-wake librarian.
    expect(m.mailboxCount(s.id, "librarian")).toBe(0);
  });

  it("prompts the principal with an interrupt notice after stopping", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = scriptedFactory({ principal: {}, librarian: {} }, observe);
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "hello");
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal"));
    const before = observe.prompts.filter((p) => p.agent === "principal").length;

    await m.interrupt(s.id);

    // Principal is prompted again, and the prompt carries an interrupt notice
    // telling it the user interrupted and to await further instructions.
    await waitFor(() => observe.prompts.filter((p) => p.agent === "principal").length > before);
    const notice = observe.prompts.filter((p) => p.agent === "principal").at(-1)!;
    expect(notice.text).toContain("interrupt");
  });

  it("targeted interrupt(agent) does not prompt the principal with a notice", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = scriptedFactory(
      {
        principal: {
          onPrompt: (t) =>
            t.includes("DELEGATE")
              ? { tool: "send_message", args: { to: "librarian", content: "work" } }
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

    // A targeted interrupt is narrow: it must NOT re-prompt the principal with
    // an interrupt notice (that is the whole-session Stop behavior only).
    await new Promise((r) => setTimeout(r, 20));
    expect(observe.prompts.filter((p) => p.agent === "principal").length).toBe(principalBefore);
  });
});
