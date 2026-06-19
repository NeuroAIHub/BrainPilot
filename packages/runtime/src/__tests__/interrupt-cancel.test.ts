/**
 * #101: interrupt must cancel the active run and NOT race a second one.
 *
 * Before the fix, interrupt() aborted the agent (signal only, no wait) and
 * immediately prompted the principal with the interrupt notice. The original
 * prompt()'s run was still in-flight, so the notice prompt hit Pi's "Agent is
 * already processing a prompt" guard, surfaced a RUN_ERROR, and left the agent
 * stuck in `error` — while the original provider stream kept emitting text.
 *
 * The fix makes MasAgent.abort() await the in-flight prompt's settlement, and
 * interrupt() awaits every abort before notifying the principal. So after an
 * interrupt: no "already processing" error, no RUN_ERROR from the notice run,
 * the agent settles cleanly, and no further old-run content is appended.
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent } from "../types.js";
import type { AgUiEvent } from "@brainpilot/protocol";

/**
 * A factory whose principal blocks inside prompt() (simulating a long provider
 * stream) until aborted. After abort it unwinds normally, emitting a couple of
 * post-gate text chunks ONLY if it was not aborted — so the test can assert no
 * content leaks past a stop.
 */
function gatedPrincipalFactory(observe: {
  prompts: Array<{ agent: string; text: string }>;
}): AgentSessionFactory {
  return async ({ sessionId, agentName }) => {
    const listeners = new Set<(e: PiAgentEvent) => void>();
    let aborted = false;
    // Mirror Pi's single-active-run guard: a second prompt() while one is still
    // in-flight throws the same error the real SDK does. This is what made the
    // pre-fix interrupt path surface "Agent is already processing a prompt".
    let activeRun = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const gated = agentName === "principal";
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
        if (activeRun) {
          throw new Error(
            "Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
          );
        }
        activeRun = true;
        observe.prompts.push({ agent: agentName, text });
        try {
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
        if (gated && !text.includes("interrupt")) {
          // The long, interruptible run: block until aborted.
          await gate;
          if (aborted) {
            // Simulate the real provider stream taking a tick to tear down after
            // abort — the window in which the pre-fix interrupt path raced a
            // second prompt while this run's activeRun guard was still set.
            await new Promise((r) => setTimeout(r, 15));
            emit({ type: "turn_end" });
            emit({ type: "agent_end", messages: [], willRetry: false });
            return;
          }
        }
        emit({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: `ok ${agentName}` }] },
        });
        emit({ type: "turn_end" });
        emit({ type: "agent_end", messages: [], willRetry: false });
        } finally {
          activeRun = false;
        }
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

describe("interrupt cancels the active run without racing a second (#101)", () => {
  it("does not emit RUN_ERROR or an 'already processing' error after interrupt", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const m = new SessionManager({ persist: false, agentFactory: gatedPrincipalFactory(observe) });
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    // Start the long run; principal blocks inside prompt().
    await m.sendMessage(s.id, "write a very long report");
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal"));

    // Stop the whole session. With the fix this awaits the old run's settlement
    // before prompting the principal with the interrupt notice.
    await m.interrupt(s.id);

    // The interrupt-notice run should have fired AND completed.
    await waitFor(() => observe.prompts.filter((p) => p.text.includes("interrupt")).length > 0);
    await new Promise((r) => setTimeout(r, 30));

    // No run ended in error, and the SDK "already processing" guard never fired.
    const runErrors = events.filter((e) => e.type === "RUN_ERROR");
    expect(runErrors).toHaveLength(0);
    const alreadyProcessing = events.filter(
      (e) =>
        (e.type === "system_message" || e.type === "RUN_ERROR") &&
        JSON.stringify(e).includes("already processing"),
    );
    expect(alreadyProcessing).toHaveLength(0);

    // The principal settled to a non-error status.
    const principal = m.getSessionState(s.id)?.agents.find((a) => a.name === "principal");
    expect(principal?.status).not.toBe("error");
  });

  it("abort() resolves only after the interrupted run has settled (RUN_FINISHED emitted)", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const m = new SessionManager({ persist: false, agentFactory: gatedPrincipalFactory(observe) });
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    await m.sendMessage(s.id, "write a very long report");
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal"));

    // A targeted interrupt of just the principal: when it resolves, the original
    // run must already have emitted its terminal RUN_FINISHED.
    const runFinishedBefore = events.filter((e) => e.type === "RUN_FINISHED").length;
    await m.interrupt(s.id, "principal");
    const runFinishedAfter = events.filter((e) => e.type === "RUN_FINISHED").length;
    expect(runFinishedAfter).toBeGreaterThan(runFinishedBefore);
  });
});
