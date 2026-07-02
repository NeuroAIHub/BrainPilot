/**
 * #167: per-session provider concurrency cap. A wide delegation fan-out must
 * not fire more than `maxConcurrentAgents` provider calls at once (excess calls
 * queue, they don't fail), so a multi-agent turn can't self-inflict 429s.
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent, PromptOptions, SystemTool } from "../types.js";

/**
 * A factory whose sessions block inside prompt() on a shared gate, and record
 * the peak number of simultaneously-in-flight prompts. `release()` lets them
 * all finish. Each expert also emits a delegation on its first (principal) turn
 * so the test can fan out to N experts from one user message.
 */
function trackingFactory(peak: { current: number; max: number }, gate: { release?: () => void }) {
  const inflight = { n: 0 };
  const factory: AgentSessionFactory = async ({ sessionId, agentName, systemTools }) => {
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
      get isStreaming() {
        return false;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string, _opts?: PromptOptions) {
        inflight.n++;
        peak.current = inflight.n;
        peak.max = Math.max(peak.max, inflight.n);
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });
        try {
          // The principal delegates to 5 experts, then all block on the gate.
          if (agentName === "principal" && text.includes("GO")) {
            for (const name of ["a1", "a2", "a3", "a4", "a5"]) {
              const tool = toolMap.get("send_message");
              if (tool) {
                await tool.execute({ to: name, content: "work" });
              }
            }
          } else {
            // Expert turns block so their provider calls overlap in time.
            await new Promise<void>((r) => {
              gate.release = () => {
                inflight.n = Math.max(0, inflight.n - 1);
                r();
              };
            });
          }
        } finally {
          emit({
            type: "message_end",
            message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
          });
          emit({ type: "turn_end" });
          emit({ type: "agent_end", messages: [], willRetry: false });
          if (agentName === "principal") inflight.n = Math.max(0, inflight.n - 1);
        }
      },
      async abort() {
        gate.release?.();
      },
      dispose() {},
    };
    return session;
  };
  return factory;
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("#167 per-session provider concurrency cap", () => {
  it("never runs more than maxConcurrentAgents prompts at once", async () => {
    const peak = { current: 0, max: 0 };
    const gate: { release?: () => void } = {};
    const m = new SessionManager({
      persist: false,
      agentFactory: trackingFactory(peak, gate),
      maxConcurrentAgents: 2,
    });
    const s = await m.createSession();

    // One user message that fans out to 5 experts.
    await m.sendMessage(s.id, "GO delegate to everyone");

    // Let the experts pile up against the gate; peak must stay ≤ 2.
    await waitFor(() => peak.max >= 2, 3000).catch(() => {});
    // Give any (incorrectly) unthrottled calls a chance to overshoot.
    await new Promise((r) => setTimeout(r, 100));
    expect(peak.max).toBeLessThanOrEqual(2);

    // Drain: release gated experts a few times so the run can settle.
    for (let i = 0; i < 8; i++) {
      gate.release?.();
      await new Promise((r) => setTimeout(r, 10));
    }
  });

  it("disables throttling when maxConcurrentAgents <= 0", async () => {
    const peak = { current: 0, max: 0 };
    const gate: { release?: () => void } = {};
    const m = new SessionManager({
      persist: false,
      agentFactory: trackingFactory(peak, gate),
      maxConcurrentAgents: 0,
    });
    const s = await m.createSession();
    await m.sendMessage(s.id, "GO delegate to everyone");
    // With no cap, more than 2 experts should overlap.
    await waitFor(() => peak.max > 2, 3000).catch(() => {});
    expect(peak.max).toBeGreaterThan(2);
    for (let i = 0; i < 8; i++) {
      gate.release?.();
      await new Promise((r) => setTimeout(r, 10));
    }
  });
});
