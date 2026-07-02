/**
 * Concurrent send: a user message that arrives while the agent is still
 * streaming must NOT hit the SDK's "Agent is already processing" guard. The
 * runtime queues it as a follow-up onto the in-flight run (streamingBehavior:
 * "followUp") — no new runId, no thrown error. See SessionManager.sendMessage
 * + MasAgent.followUp.
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, PromptOptions, SystemTool } from "../types.js";

interface Observed {
  prompts: string[];
  followUps: string[];
}

/**
 * A factory whose session stays "streaming" (isStreaming=true) until released,
 * so a second sendMessage lands during the streaming window. It records plain
 * prompts vs follow-up queues so the test can assert routing. A plain prompt
 * received while already streaming throws — mirroring the real SDK guard — so a
 * regression (missing followUp routing) would surface as a run error.
 */
function gatedFactory(observe: Observed): AgentSessionFactory {
  return async ({ sessionId }: { sessionId: string; agentName: string; systemTools: SystemTool[] }) => {
    const listeners = new Set<(e: PiAgentEvent) => void>();
    let streaming = false;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
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
      get isStreaming() {
        return streaming;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string, opts?: PromptOptions) {
        if (streaming) {
          // Follow-up path: SDK accepts it while streaming when a behavior is set.
          if (opts?.streamingBehavior) {
            observe.followUps.push(text);
            return;
          }
          // Plain prompt during streaming → mirror the real SDK guard.
          throw new Error(
            "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
          );
        }
        observe.prompts.push(text);
        streaming = true;
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
        // Block inside the turn so a concurrent send arrives mid-stream.
        await gate;
        emit({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
        });
        emit({ type: "turn_end" });
        emit({ type: "agent_end", messages: [], willRetry: false });
        streaming = false;
      },
      async abort() {
        streaming = false;
        release();
      },
      dispose() {},
    };
    // Expose release via a side channel keyed on the session for the test.
    releases.set(sessionId, release);
    return session;
  };
}

// session id → release fn, so the test can unblock the in-flight turn.
const releases = new Map<string, () => void>();

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("concurrent send → follow-up queue", () => {
  it("queues a second message as a follow-up instead of throwing", async () => {
    const observe: Observed = { prompts: [], followUps: [] };
    const m = new SessionManager({ persist: false, agentFactory: gatedFactory(observe) });
    const s = await m.createSession();

    // First message starts a run that blocks mid-turn (streaming stays true).
    const first = await m.sendMessage(s.id, "first");
    expect(first).toMatchObject({ accepted: true });
    expect(first.queued).toBeFalsy();
    await waitFor(() => observe.prompts.length === 1);

    // Second message arrives while streaming → must be queued as a follow-up.
    const second = await m.sendMessage(s.id, "second");
    expect(second).toMatchObject({ accepted: true, queued: true });
    // Same run id as the in-flight run (no new run opened).
    expect(second.runId).toBe(first.runId);
    await waitFor(() => observe.followUps.length === 1);
    expect(observe.followUps).toEqual(["second"]);
    // The second message never went through the plain-prompt path.
    expect(observe.prompts).toEqual(["first"]);

    // Release the gate so the run drains cleanly (no lingering timers).
    releases.get(s.id)?.();
  });

  it("an idle send takes the normal prompt path (no queued flag)", async () => {
    const observe: Observed = { prompts: [], followUps: [] };
    const m = new SessionManager({ persist: false, agentFactory: gatedFactory(observe) });
    const s = await m.createSession();

    const res = await m.sendMessage(s.id, "hello");
    expect(res).toMatchObject({ accepted: true });
    expect(res.queued).toBeFalsy();
    await waitFor(() => observe.prompts.length === 1);
    expect(observe.prompts).toEqual(["hello"]);
    expect(observe.followUps).toEqual([]);
    releases.get(s.id)?.();
  });
});
