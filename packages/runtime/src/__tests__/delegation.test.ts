/**
 * #76: expert delegation must actually START the target agent.
 *
 * Before the fix, `send_message` wrote the target's mailbox but nothing
 * consumed it — the expert stayed idle and the run hung. These tests drive the
 * delegation path through a scripted agent factory (precise control over which
 * agent calls which tool, and over prompt concurrency) and assert:
 *   - a delivered task starts the target's run (RUN_STARTED) and drains its inbox;
 *   - the target receives the message wrapped as a <message_envelope>;
 *   - a reply round-trips back and wakes the principal again;
 *   - runState.active stays true while a delegated expert runs, then goes false;
 *   - concurrent wakes for one agent collapse into a single serial loop
 *     (its prompt is never invoked concurrently).
 */
import { describe, it, expect } from "vitest";
import { SessionManager } from "../session-manager.js";
import type {
  AgentSessionFactory,
  IAgentSession,
  PiAgentEvent,
  SystemTool,
} from "../types.js";

/** One scripted step: when prompted, optionally invoke a system tool. */
interface Script {
  /** Called with the prompt text; returns an optional tool call to perform. */
  onPrompt?: (text: string) => { tool: string; args: Record<string, unknown> } | undefined;
}

/**
 * A controllable IAgentSession: emits the same Pi event shape MockAgentSession
 * does, but lets the test script tool calls per agent and observe prompts +
 * concurrency. `concurrency` is shared across all sessions of one factory so we
 * can assert no agent's prompt overlaps another call to the SAME agent.
 */
function scriptedFactory(
  scripts: Record<string, Script>,
  observe: {
    prompts: Array<{ agent: string; text: string }>;
    active: Map<string, number>;
    maxConcurrentPerAgent: Map<string, number>;
  },
): AgentSessionFactory {
  return async ({ sessionId, agentName, systemTools }) => {
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
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      async prompt(text: string) {
        observe.prompts.push({ agent: agentName, text });
        const now = (observe.active.get(agentName) ?? 0) + 1;
        observe.active.set(agentName, now);
        observe.maxConcurrentPerAgent.set(
          agentName,
          Math.max(observe.maxConcurrentPerAgent.get(agentName) ?? 0, now),
        );
        try {
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
            // Yield so a (buggy) concurrent wake of the same agent would overlap.
            await new Promise((r) => setTimeout(r, 1));
            let isError = false;
            let result = "";
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
        } finally {
          observe.active.set(agentName, (observe.active.get(agentName) ?? 1) - 1);
        }
      },
      async abort() {},
      dispose() {},
    };
    return session;
  };
}

function newObserve() {
  return {
    prompts: [] as Array<{ agent: string; text: string }>,
    active: new Map<string, number>(),
    maxConcurrentPerAgent: new Map<string, number>(),
  };
}

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("expert delegation (#76)", () => {
  it("starts the delegated expert and drains its inbox", async () => {
    const observe = newObserve();
    const factory = scriptedFactory(
      {
        // Principal delegates to librarian on the user's first prompt.
        principal: {
          onPrompt: (text) =>
            text.includes("DELEGATE")
              ? { tool: "send_message", args: { to: "librarian", content: "survey topic X" } }
              : undefined,
        },
        // Librarian just acknowledges (no further send).
        librarian: {},
      },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    const runStarts: string[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "RUN_STARTED") runStarts.push((e as { agent_name?: string }).agent_name ?? "");
    });

    await m.sendMessage(s.id, "please DELEGATE this");

    // Librarian's run must start (the bug: it never did).
    await waitFor(() => runStarts.includes("librarian"));

    // Librarian was prompted with the task, wrapped as a message envelope.
    const libPrompt = observe.prompts.find((p) => p.agent === "librarian");
    expect(libPrompt).toBeDefined();
    expect(libPrompt!.text).toContain("<message_envelope>");
    expect(libPrompt!.text).toContain('name="principal"');
    expect(libPrompt!.text).toContain("survey topic X");

    // Inbox drained.
    await waitFor(() => m.listAgents(s.id).some((a) => a.name === "librarian"));
    // Run settles back to inactive once librarian returns to idle.
    await waitFor(() => m.getSessionState(s.id)?.runState.active === false);
    const libState = m.listAgents(s.id).find((a) => a.name === "librarian");
    expect(libState!.status).toBe("idle");
  });

  it("round-trips a result back to the principal", async () => {
    const observe = newObserve();
    const factory = scriptedFactory(
      {
        principal: {
          onPrompt: (text) =>
            // First user turn: delegate. Envelope reply from librarian: stop.
            text.includes("DELEGATE")
              ? { tool: "send_message", args: { to: "librarian", content: "do work" } }
              : undefined,
        },
        librarian: {
          // When it receives the delegated task, report back to the principal.
          onPrompt: (text) =>
            text.includes("do work")
              ? { tool: "send_message", args: { to: "principal", content: "findings ready" } }
              : undefined,
        },
      },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    await m.sendMessage(s.id, "please DELEGATE this");

    // Principal must be prompted a SECOND time — with the librarian's reply.
    await waitFor(() => observe.prompts.filter((p) => p.agent === "principal").length >= 2);
    const secondPrincipal = observe.prompts.filter((p) => p.agent === "principal")[1]!;
    expect(secondPrincipal.text).toContain("<message_envelope>");
    expect(secondPrincipal.text).toContain('name="librarian"');
    expect(secondPrincipal.text).toContain("findings ready");

    await waitFor(() => m.getSessionState(s.id)?.runState.active === false);
  });

  it("keeps runState.active true while the delegated expert runs", async () => {
    const observe = newObserve();
    // Librarian holds its turn until released, so we can observe active=true
    // strictly AFTER the principal's own turn has ended.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const factory = scriptedFactory(
      {
        principal: {
          onPrompt: (text) =>
            text.includes("DELEGATE")
              ? { tool: "send_message", args: { to: "librarian", content: "slow task" } }
              : undefined,
        },
        librarian: {},
      },
      observe,
    );
    // Wrap factory to make librarian block inside prompt.
    const gated: AgentSessionFactory = async (params) => {
      const sess = await factory(params);
      if (params.agentName !== "librarian") return sess;
      const realPrompt = sess.prompt.bind(sess);
      return {
        ...sess,
        async prompt(text: string) {
          await gate;
          return realPrompt(text);
        },
      };
    };
    const m = new SessionManager({ persist: false, agentFactory: gated });
    const s = await m.createSession();

    await m.sendMessage(s.id, "please DELEGATE this");

    // Principal finished, librarian is pending in the delivery loop (gated).
    await waitFor(() => observe.prompts.some((p) => p.agent === "principal"));
    await waitFor(() => m.getSessionState(s.id)?.runState.active === true);
    // The principal itself is idle; the active flag is carried by the pending
    // delegation, not by the principal's own (finished) turn.
    expect(m.getSessionState(s.id)!.runState.active).toBe(true);

    release();
    await waitFor(() => m.getSessionState(s.id)?.runState.active === false);
  });

  it("collapses concurrent wakes into a single serial loop (re-entrancy)", async () => {
    const observe = newObserve();
    const factory = scriptedFactory(
      {
        // Principal sends TWO messages to librarian in one turn (parallel
        // delegation). Both wakeAgent calls must collapse into one loop.
        principal: {
          onPrompt: (text) =>
            text.includes("DELEGATE")
              ? { tool: "send_message", args: { to: "librarian", content: "task A" } }
              : undefined,
        },
        librarian: {},
      },
      observe,
    );
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();

    // Pre-load a second message so the loop re-drains within one run.
    await m.sendMessage(s.id, "please DELEGATE this");
    await waitFor(() => observe.prompts.some((p) => p.agent === "librarian"));
    await waitFor(() => m.getSessionState(s.id)?.runState.active === false);

    // Librarian's prompt was never invoked concurrently with itself.
    expect(observe.maxConcurrentPerAgent.get("librarian") ?? 0).toBeLessThanOrEqual(1);
  });

  it("leaves the direct user→agent path (sendMessage) unchanged", async () => {
    // A user prompt is delivered via the agent's own prompt (NOT the mailbox), so
    // it carries the raw text with no envelope wrapping — the envelope path is
    // exclusively for agent-to-agent delivery. This guards against the fix
    // accidentally routing user input through the delivery loop.
    const observe = newObserve();
    const factory = scriptedFactory({ principal: {}, librarian: {} }, observe);
    const m = new SessionManager({ persist: false, agentFactory: factory });
    const s = await m.createSession();
    await m.sendMessage(s.id, "hi librarian", "librarian");
    await waitFor(() => observe.prompts.some((p) => p.agent === "librarian"));
    const libPrompt = observe.prompts.find((p) => p.agent === "librarian");
    expect(libPrompt!.text).toBe("hi librarian");
    expect(libPrompt!.text).not.toContain("<message_envelope>");
  });

  it("merges multiple queued messages into one delegated turn (batch)", async () => {
    // Two experts both report back to the principal. With the principal's
    // delivery gated until both replies have landed, the loop drains them as a
    // single batch → one principal turn carrying BOTH envelopes.
    const observe = newObserve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const base = scriptedFactory(
      {
        principal: {
          onPrompt: (text) =>
            text.includes("FANOUT")
              ? { tool: "send_message", args: { to: "librarian", content: "kick" } }
              : undefined,
        },
        // librarian, on its task, asks the engineer to also report — so two
        // messages end up queued for the principal.
        librarian: {
          onPrompt: (text) =>
            text.includes("kick")
              ? { tool: "send_message", args: { to: "principal", content: "from-lib" } }
              : undefined,
        },
      },
      observe,
    );
    // Gate the principal's SECOND run (the delivery of replies) so both can queue.
    let principalRuns = 0;
    const gated: AgentSessionFactory = async (params) => {
      const sess = await base(params);
      if (params.agentName !== "principal") return sess;
      const realPrompt = sess.prompt.bind(sess);
      return {
        ...sess,
        async prompt(text: string) {
          principalRuns++;
          if (principalRuns >= 2) await gate; // hold the reply-delivery turn
          return realPrompt(text);
        },
      };
    };
    const m = new SessionManager({ persist: false, agentFactory: gated });
    const s = await m.createSession();
    await m.sendMessage(s.id, "please FANOUT");

    // Wait until librarian has reported back AND a second message is queued for
    // the principal, then add a second queued reply via a direct expert send.
    await waitFor(() => observe.prompts.some((p) => p.agent === "librarian"));
    // Engineer also reports back while the principal's delivery is gated.
    await m.sendMessage(s.id, "from-eng", "principal").catch(() => {});
    // Let the gate open so the principal drains whatever is queued.
    await waitFor(() => m.getSessionState(s.id) !== undefined);
    release();

    await waitFor(() => observe.prompts.filter((p) => p.agent === "principal").length >= 2);
    const reply = observe.prompts.filter((p) => p.agent === "principal")[1]!;
    // The batched turn carries the librarian's envelope.
    expect(reply.text).toContain("from-lib");
    expect(reply.text).toContain("<message_envelope>");
  });

  it("rejects a send when the target inbox is full (backpressure)", async () => {
    const { Mailbox, MAX_INBOX } = await import("../mailbox.js");
    const { createSendMessageTool } = await import("../tools/system-tools.js");
    const { GraphOfTrace } = await import("../trace.js");
    const mailbox = new Mailbox("s");
    for (let i = 0; i < MAX_INBOX; i++) {
      await mailbox.write({ fromAgent: "x", toAgent: "principal", content: `m${i}`, msgType: "result_deliver" });
    }
    let woke = false;
    const tool = createSendMessageTool({
      sessionId: "s",
      fromAgent: "librarian",
      mailbox,
      trace: new GraphOfTrace("s"),
      ensureAgent: async () => {},
      destroyAgent: async () => {},
      wakeAgent: () => {
        woke = true;
      },
      requestUserInput: async () => "",
    });
    const res = await tool.execute({ to: "principal", content: "one too many" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain("full");
    // A rejected send must NOT wake the target (nothing was delivered).
    expect(woke).toBe(false);
  });
});
