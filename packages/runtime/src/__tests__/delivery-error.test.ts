/**
 * #97 error path — a delegated expert run that ends in error must NOT leave the
 * principal dead-waiting (and must not be mislabeled as "silence").
 *
 * Policy under test (runDeliveryLoop + handleDeliveryError):
 *   - a `retryable` error (rate limit / 5xx / network) self-retries the SAME
 *     expert up to MAX_DELIVERY_RETRIES (3), emitting a `warning` each time and
 *     re-waking it via a neutral note in its own inbox;
 *   - the 3rd consecutive failure escalates: a neutral, error-flavored `system`
 *     task event is queued for the exact creator (waking it) and an `error`
 *     system_message is surfaced;
 *   - a `fatal` error (auth/401) escalates on the FIRST failure, no retry;
 *   - a run that later succeeds resets the streak.
 *
 * These drive the path through a scripted factory whose expert can emit an
 * errored message_end (the shape Pi uses for provider failures — it does NOT
 * throw, so MasAgent stays error-isolated).
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type { AgentSessionFactory, IAgentSession, PiAgentEvent } from "../types.js";

interface SystemMsg {
  level: string;
  text: string;
  agent?: string;
  terminal?: boolean;
}

interface RunError {
  agent?: string;
  terminal?: boolean;
}

/** Per-agent script: decide each prompt's outcome (ok / error with a raw blob). */
interface ExpertPlan {
  /** Called with the prompt count (1-based); return an error blob to fail, or null to succeed. */
  outcome: (promptCount: number, text: string) => string | null;
}

function factoryWith(
  expertPlans: Record<string, ExpertPlan>,
  observe: { prompts: Array<{ agent: string; text: string }> },
): AgentSessionFactory {
  const counts = new Map<string, number>();
  return async ({ sessionId, agentName, systemTools }) => {
    void systemTools;
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
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string) {
        observe.prompts.push({ agent: agentName, text });
        emit({ type: "agent_start" });
        emit({ type: "turn_start" });
        emit({ type: "message_start", message: { role: "assistant", content: [] } });

        const plan = expertPlans[agentName];
        const n = (counts.get(agentName) ?? 0) + 1;
        counts.set(agentName, n);
        const errBlob = plan?.outcome(n, text) ?? null;

        if (errBlob) {
          // Pi encodes a provider failure as a finalized assistant message with
          // stopReason "error" (it does not throw). MasAgent routes this to
          // error status + lastErrorKind.
          emit({
            type: "message_end",
            message: { role: "assistant", content: [], stopReason: "error", errorMessage: errBlob },
          });
          emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "error" }] });
          return;
        }

        emit({
          type: "message_end",
          message: { role: "assistant", content: [{ type: "text", text: `ok ${agentName}` }] },
        });
        emit({ type: "turn_end" });
        emit({ type: "agent_end", messages: [{ role: "assistant", stopReason: "stop" }] });
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

/**
 * Enqueue a task into the durable ledger and wake the delivery loop.
 * the test focused on the loop's error policy without scripting a full principal
 * delegation turn.
 */
async function delegateToExpert(
  m: SessionManager,
  sid: string,
  expert: string,
  from = "principal",
): Promise<void> {
  const entry = (m as unknown as { sessions: Map<string, { taskLedger: { dispatch: (from: string, to: string, content: string) => Promise<unknown> } }> }).sessions.get(sid)!;
  await entry.taskLedger.dispatch(from, expert, "survey X");
  (m as unknown as { wakeAgent: (sid: string, name: string) => void }).wakeAgent(sid, expert);
}

describe("delivery error path (#97)", () => {
  it("preserves a completed child result when its creator has a fatal delivery error", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = factoryWith(
      { librarian: { outcome: (n) => (n === 1 ? "401 invalid api key" : null) } },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();
    const entry = (m as unknown as {
      sessions: Map<string, { taskLedger: {
        dispatch: (from: string, to: string, content: string) => Promise<{ id: string }>;
        complete: (id: string, assignee: string, reply: string) => Promise<unknown>;
      } }>;
      wakeAgent: (sid: string, name: string) => void;
    });
    const live = entry.sessions.get(s.id)!;
    const child = await live.taskLedger.dispatch("librarian", "writer", "research child");
    await live.taskLedger.complete(child.id, "writer", "child result at docs/report.md");

    await m.ensureAgent(s.id, "librarian");
    entry.wakeAgent(s.id, "librarian");
    await waitFor(() => observe.prompts.some((prompt) => prompt.agent === "librarian"));
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(m.taskNotificationCount(s.id, "librarian")).toBe(1);
    expect(observe.prompts.filter((prompt) => prompt.agent === "librarian")).toHaveLength(1);

    await m.sendMessage(s.id, "resume delivery");
    await waitFor(() => observe.prompts.filter((prompt) => prompt.agent === "librarian").length === 2);
    await waitFor(() => m.taskNotificationCount(s.id, "librarian") === 0);
    expect(observe.prompts.filter((prompt) => prompt.agent === "librarian")[1]!.text)
      .toContain("child result at docs/report.md");
  });

  it("bounds principal notification failures, preserves the event, and resumes on user input", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = factoryWith(
      { principal: { outcome: (n) => (n === 1 ? "401 invalid api key" : null) } },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();
    await delegateToExpert(m, s.id, "principal", "engineer");

    await waitFor(() => observe.prompts.filter((prompt) => prompt.agent === "principal").length === 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(observe.prompts.filter((prompt) => prompt.agent === "principal")).toHaveLength(1);
    expect(m.taskNotificationCount(s.id, "principal")).toBe(1);

    await m.sendMessage(s.id, "resume delivery");
    await waitFor(() => observe.prompts.filter((prompt) => prompt.agent === "principal").length >= 3);
    await waitFor(() => m.taskNotificationCount(s.id, "principal") === 0);
  });

  it("escalates to the principal after 3 consecutive retryable failures", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    // librarian fails every time with a retryable (429) error.
    const factory = factoryWith(
      { librarian: { outcome: () => "429 too many requests" } },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const sys: SystemMsg[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "system_message") {
        const v = e as { level?: string; message?: string; agent?: string; terminal?: boolean };
        sys.push({ level: v.level ?? "", text: v.message ?? "", agent: v.agent, terminal: v.terminal });
      }
    });

    // Kick the librarian through the task ledger so the delivery loop
    // owns the run.
    await delegateToExpert(m, s.id, "librarian");

    // It should retry twice (warning 1/3, 2/3) then escalate (error) on the 3rd.
    // (MasAgent also emits its own raw-provider-error bubble per attempt — the
    // #97-A behavior; we match OUR lifecycle messages specifically.)
    await waitFor(() => sys.some((x) => x.level === "error" && x.text.includes("已通知任务派遣者")));

    const warnings = sys.filter((x) => x.level === "warning" && x.text.includes("正在自动重试"));
    expect(warnings.length).toBe(2); // 1/3 and 2/3
    expect(warnings[0]!.text).toContain("(1/3)");
    expect(warnings[1]!.text).toContain("(2/3)");

    const error = sys.find((x) => x.level === "error" && x.text.includes("已通知任务派遣者"));
    expect(error!.text).toContain("连续");
    expect(error!.text).toContain("librarian");
    expect(error!.terminal).toBe(true);

    // librarian was prompted 3 times (initial + 2 self-retries).
    const libPrompts = observe.prompts.filter((p) => p.agent === "librarian");
    expect(libPrompts.length).toBe(3);
    // The same durable assignment is replayed until a clean run consumes it.
    expect(libPrompts[1]!.text).toContain("task_000001");

    // The principal received an error-flavored note in its inbox (escalation).
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal" && p.text.includes("failed while task")));
    const escalation = observe.prompts.find(
      (p) => p.agent === "principal" && p.text.includes("failed while task"),
    );
    expect(escalation!.text).toContain("librarian");
  });

  it("escalates a fatal (auth) error on the first failure, no retry", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = factoryWith(
      { librarian: { outcome: () => '401 {"error":{"message":"invalid api key"}}' } },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const sys: SystemMsg[] = [];
    const runErrors: RunError[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "system_message") {
        const v = e as { level?: string; message?: string; agent?: string; terminal?: boolean };
        sys.push({ level: v.level ?? "", text: v.message ?? "", agent: v.agent, terminal: v.terminal });
      } else if (e.type === "RUN_ERROR") {
        const v = e as { agent_name?: string; terminal?: boolean };
        runErrors.push({ agent: v.agent_name, terminal: v.terminal });
      }
    });

    await delegateToExpert(m, s.id, "librarian");

    await waitFor(() => sys.some((x) => x.level === "error" && x.text.includes("已通知任务派遣者")));

    // No retry warnings — fatal escalates immediately.
    expect(sys.filter((x) => x.level === "warning" && x.text.includes("正在自动重试")).length).toBe(0);
    const error = sys.find((x) => x.level === "error" && x.text.includes("已通知任务派遣者"));
    expect(error!.text).toContain("无法自动恢复");
    expect(error!.terminal).toBe(true);
    expect(runErrors).toEqual([{ agent: "librarian", terminal: false }]);

    // librarian prompted exactly once (no self-retry).
    expect(observe.prompts.filter((p) => p.agent === "librarian").length).toBe(1);
    // Principal got the escalation note.
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal" && p.text.includes("failed while task")));
  });

  it("escalates to the exact task creator, not the principal, in a chain", async () => {
    // auditor created the engineer task; a fatal error must route by task identity.
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = factoryWith(
      { engineer: { outcome: () => "401 invalid api key" } },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const sys: SystemMsg[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "system_message") {
        const v = e as { level?: string; message?: string };
        sys.push({ level: v.level ?? "", text: v.message ?? "" });
      }
    });

    // Keep the creator live so its notification is consumed during this test.
    await m.ensureAgent(s.id, "auditor");
    await delegateToExpert(m, s.id, "engineer", "auditor");

    await waitFor(() => sys.some((x) => x.level === "error" && x.text.includes("已通知任务派遣者")));

    // The user-facing escalation is creator-oriented rather than using mutable routing state.
    const error = sys.find((x) => x.level === "error" && x.text.includes("已通知任务派遣者"));
    expect(error!.text).toContain("任务派遣者");

    // The auditor (not the principal) received the error note.
    await waitFor(() => observe.prompts.some((p) => p.agent === "auditor" && p.text.includes("failed while task")));
    expect(observe.prompts.some((p) => p.agent === "principal")).toBe(false);
  });

  it("retains the task creator identity even when the creator is not live", async () => {
    // engineer was delegated by a transient auditor that no longer exists; the
    // escalation must fall back to the principal rather than resurrect it.
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    const factory = factoryWith(
      { engineer: { outcome: () => "401 invalid api key" } },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const sys: SystemMsg[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "system_message") {
        const v = e as { level?: string; message?: string };
        sys.push({ level: v.level ?? "", text: v.message ?? "" });
      }
    });

    // Note: "ghost" is never created as a live agent.
    await delegateToExpert(m, s.id, "engineer", "ghost");

    await waitFor(() => sys.some((x) => x.level === "error" && x.text.includes("已通知任务派遣者")));
    await waitFor(() => observe.prompts.some((p) => p.agent === "ghost" && p.text.includes("failed while task")));
    expect(observe.prompts.some((p) => p.agent === "principal")).toBe(false);
  });

  it("recovers and does NOT escalate when a retry succeeds", async () => {
    const observe = { prompts: [] as Array<{ agent: string; text: string }> };
    // Fail once (retryable), then succeed on the self-retry.
    const factory = factoryWith(
      { librarian: { outcome: (n) => (n === 1 ? "503 service unavailable" : null) } },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const sys: SystemMsg[] = [];
    const runErrors: RunError[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "system_message") {
        const v = e as { level?: string; message?: string; agent?: string; terminal?: boolean };
        sys.push({ level: v.level ?? "", text: v.message ?? "", agent: v.agent, terminal: v.terminal });
      } else if (e.type === "RUN_ERROR") {
        const v = e as { agent_name?: string; terminal?: boolean };
        runErrors.push({ agent: v.agent_name, terminal: v.terminal });
      }
    });

    await delegateToExpert(m, s.id, "librarian");

    // One retry warning, then it succeeds — no error escalation ever.
    await waitFor(() => observe.prompts.filter((p) => p.agent === "librarian").length >= 2);
    await waitFor(() => m.getSessionState(s.id)?.runState.active === false);

    expect(sys.filter((x) => x.level === "warning" && x.text.includes("正在自动重试")).length).toBe(1);
    // No escalation lifecycle error (MasAgent's own per-attempt raw bubble may
    // exist, but OUR "已上报主管" escalation must not).
    expect(sys.some((x) => x.level === "error" && x.text.includes("已通知任务派遣者"))).toBe(false);
    expect(sys.some((x) => x.agent === "librarian" && x.terminal === true)).toBe(false);
    expect(runErrors).toEqual([{ agent: "librarian", terminal: false }]);
    // No escalation note to the principal.
    expect(observe.prompts.some((p) => p.agent === "principal" && p.text.includes("failed while task"))).toBe(false);
  });
});
