/**
 * #101 / #327: interrupt must cancel the active run and NOT start a follow-up
 * provider run to acknowledge the stop.
 *
 * #101: abort waits for the in-flight prompt to settle so we never hit Pi's
 * "Agent is already processing a prompt" guard.
 *
 * #327: whole-session Stop must not prompt the principal solely to say it
 * stopped — that burned tokens and left Stop/running indicators active.
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
    // in-flight throws the same error the real SDK does.
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
          if (gated) {
            // The long, interruptible run: block until aborted.
            await gate;
            if (aborted) {
              // Simulate the real provider stream taking a tick to tear down after
              // abort — the window in which a raced second prompt would hit activeRun.
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

/**
 * A Pi-shaped session paused in auto-retry backoff. abort() releases the sleep
 * and emits the exact terminal event Pi uses for a user-cancelled retry.
 */
function retryBackoffFactory(observe: {
  prompts: Array<{ agent: string; text: string }>;
}): AgentSessionFactory {
  return async ({ sessionId, agentName }) => {
    const listeners = new Set<(e: PiAgentEvent) => void>();
    let releaseBackoff: (() => void) | undefined;
    let aborted = false;
    let streaming = false;
    const emit = (e: PiAgentEvent) => {
      for (const listener of listeners) listener(e);
    };
    return {
      sessionId,
      get isStreaming() {
        return streaming;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string) {
        streaming = true;
        aborted = false;
        observe.prompts.push({ agent: agentName, text });
        try {
          emit({ type: "agent_start" });
          emit({ type: "message_start", message: { role: "assistant", content: [] } });
          emit({
            type: "message_end",
            message: {
              role: "assistant",
              content: [],
              stopReason: "error",
              errorMessage: "503 service unavailable",
            },
          });
          emit({
            type: "auto_retry_start",
            attempt: 1,
            maxAttempts: 5,
            delayMs: 2_000,
            errorMessage: "503 service unavailable",
          });
          await new Promise<void>((resolve) => {
            releaseBackoff = resolve;
          });
          if (aborted) {
            emit({
              type: "auto_retry_end",
              success: false,
              attempt: 1,
              finalError: "Retry cancelled",
            });
          }
          emit({ type: "agent_end", messages: [], willRetry: false });
        } finally {
          streaming = false;
          releaseBackoff = undefined;
        }
      },
      async abort() {
        aborted = true;
        releaseBackoff?.();
      },
      dispose() {},
    };
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function delegateToExpert(m: SessionManager, sid: string, expert: string): Promise<void> {
  const entry = (
    m as unknown as {
      sessions: Map<string, { taskLedger: { dispatch: (from: string, to: string, content: string) => Promise<unknown> } }>;
    }
  ).sessions.get(sid)!;
  await entry.taskLedger.dispatch("principal", expert, "survey X");
  (m as unknown as { wakeAgent: (sessionId: string, name: string) => void }).wakeAgent(
    sid,
    expert,
  );
}

describe("interrupt cancels the active run without a follow-up notice run (#101 / #327)", () => {
  it("does not emit RUN_ERROR or start a second principal prompt after interrupt", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const m = new SessionManager({ persist: false, agentFactory: gatedPrincipalFactory(observe) });
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (e) => events.push(e));

    // Start the long run; principal blocks inside prompt().
    await m.sendMessage(s.id, "write a very long report");
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal"));
    const principalBefore = observe.prompts.filter((p) => p.agent === "principal").length;

    await m.interrupt(s.id);
    await new Promise((r) => setTimeout(r, 40));

    // #327: no interrupt-notice prompt / second principal run.
    expect(observe.prompts.filter((p) => p.agent === "principal").length).toBe(principalBefore);
    expect(observe.prompts.some((p) => /interrupt|system_notice/i.test(p.text))).toBe(false);

    // No run ended in error, and the SDK "already processing" guard never fired.
    const runErrors = events.filter((e) => e.type === "RUN_ERROR");
    expect(runErrors).toHaveLength(0);
    const alreadyProcessing = events.filter(
      (e) =>
        (e.type === "system_message" || e.type === "RUN_ERROR") &&
        JSON.stringify(e).includes("already processing"),
    );
    expect(alreadyProcessing).toHaveLength(0);

    // The principal settled to a non-error status; turn is no longer active.
    const principal = m.getSessionState(s.id)?.agents.find((a) => a.name === "principal");
    expect(principal?.status).not.toBe("error");
    expect(m.getSessionState(s.id)?.runState?.active).toBe(false);
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

  it("treats Stop during principal retry backoff as aborted, not a provider error", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const m = new SessionManager({ persist: false, agentFactory: retryBackoffFactory(observe) });
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (event) => events.push(event));

    await m.sendMessage(s.id, "retry me");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "agent_status_update" &&
          (event as unknown as { retry?: { attempt: number } }).retry?.attempt === 1,
      ),
    );
    await m.interrupt(s.id);

    const errors = events.filter(
      (event) =>
        (event.type === "system_message" &&
          (event as unknown as { level?: string }).level === "error") ||
        event.type === "RUN_ERROR",
    );
    expect(errors).toHaveLength(0);
    expect(JSON.stringify(events)).not.toContain("Retry cancelled");
    expect(observe.prompts.filter((prompt) => prompt.agent === "principal")).toHaveLength(1);
    expect(m.getSessionState(s.id)?.agents.find((agent) => agent.name === "principal")).toMatchObject({
      status: "idle",
      retry: undefined,
    });
    expect(m.getSessionState(s.id)?.runState.active).toBe(false);
    expect(m.getSessionStats(s.id)?.byRun.at(-1)?.status).toBe("aborted");
  });

  it("does not re-run or escalate a delegated expert stopped during retry backoff", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const m = new SessionManager({ persist: false, agentFactory: retryBackoffFactory(observe) });
    const s = await m.createSession();
    const events: AgUiEvent[] = [];
    m.subscribe(s.id, (event) => events.push(event));

    await m.ensureAgent(s.id, "librarian");
    await delegateToExpert(m, s.id, "librarian");
    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "agent_status_update" &&
          (event as unknown as { name?: string; retry?: { attempt: number } }).name === "librarian" &&
          (event as unknown as { retry?: { attempt: number } }).retry?.attempt === 1,
      ),
    );
    await m.interrupt(s.id);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(observe.prompts.filter((prompt) => prompt.agent === "librarian")).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === "system_message" &&
          /正在自动重试|已上报|Retry cancelled/.test(
            String((event as unknown as { message?: string }).message),
          ),
      ),
    ).toBe(false);
    expect(m.getSessionState(s.id)?.agents.find((agent) => agent.name === "librarian")).toMatchObject({
      status: "idle",
      retry: undefined,
    });
    expect(m.getSessionState(s.id)?.runState.active).toBe(false);
    expect(
      m.getSessionStats(s.id)?.byRun.find((run) => run.agentName === "librarian")?.status,
    ).toBe("aborted");
  });
});
