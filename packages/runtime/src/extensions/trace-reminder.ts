/**
 * trace-reminder — the one Pi-native extension (replaces #79 captureMilestone).
 *
 * Philosophy (vs. #79): the host no longer writes trace nodes on the agent's
 * behalf. Instead we REMIND the agent at the right moment and let it decide:
 *  - 意图一 (work leaves a trace): if a run ended without record_trace, nudge.
 *    Applies to BOTH principal and expert (every non-trace role), not just PI.
 *  - 意图二 (expert results flow back): if an expert run produced work but never
 *    send_message'd the principal, nudge; if it still won't, the host writes a
 *    fallback note into the principal's mailbox so the PI never dead-waits.
 *  - 意图三 (PI keeps to delegation): if the principal does substantive work
 *    directly without delegating, append a soft reminder to the tool result.
 *  - 意图四 (resource awareness): on a tool error, append a soft hint that the
 *    knowledge tools / record_trace exist. (Static identity lives in personas.)
 *
 * 意图一 and 意图二 are ORTHOGONAL checks (B): an expert can owe both a trace
 * and a reply. They limit independently (A — separate counters), but when BOTH
 * lapse at the same run end they collapse into ONE merged reminder rather than
 * two separate followUps (fewer round-trips).
 *
 * Mechanism (Pi SDK v0.79, verified against installed d.ts + real provider):
 *  - Registered per-AgentSession via DefaultResourceLoader.extensionFactories.
 *    Closure state is therefore naturally isolated per agent.
 *  - One prompt() == one agent loop (agent_start…agent_end) spanning MANY turns.
 *    "Did the work" flags are RUN-scoped (reset on agent_start, accumulated
 *    across turns) — resetting them on turn_start was the false-report bug.
 *  - `agent_end` / `turn_*` are pure notifications (no return value, cannot
 *    block). The ONLY "force continue" lever is `pi.sendUserMessage(text,
 *    {deliverAs:"followUp"})` inside `agent_end`: it releases the current stop
 *    and starts a NEW agent loop (a fresh agent_start) — which is why the
 *    anti-loop counters must NOT reset on agent_start.
 *  - `tool_result` MAY return `{content}` to rewrite the result text — used for
 *    the soft reminders (意图三/四).
 */
import type { AgentRole } from "../types.js";

/** Minimal structural surface of Pi's ExtensionAPI we depend on. */
interface PiExtensionApi {
  on(event: "agent_start", handler: () => void): void;
  on(event: "tool_execution_start", handler: (e: { toolName: string; args?: unknown }) => void): void;
  on(event: "tool_execution_end", handler: (e: { toolName: string; isError: boolean }) => void): void;
  on(
    event: "tool_result",
    handler: (e: {
      toolName: string;
      isError: boolean;
      content: Array<{ type: string; text?: string }>;
    }) => { content: Array<{ type: "text"; text: string }> } | void,
  ): void;
  on(event: "agent_end", handler: () => void): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

export interface TraceReminderDeps {
  role: AgentRole;
  name: string;
  /**
   * 意图二 fallback: invoked when an expert was reminded once and STILL did not
   * report back. The host writes a note into the principal's mailbox.
   */
  onUnreplied: (agentName: string) => void;
}

/**
 * Management/coordination tools that are legitimate for a principal to call
 * directly — they don't count as "doing the work itself" (意图三 exemption).
 */
const MGMT_TOOLS = new Set([
  "create_agent",
  "destroy_agent",
  "record_trace",
  "send_message",
  "ask_user",
  "get_trace_graph",
]);

const TRACE_REMINDER =
  "你本轮做了实质工作但尚未调用 record_trace。如果这步值得留痕，请调用 record_trace 记录后再结束。";
const EXPERT_REPLY_REMINDER =
  "你尚未通过 send_message(to=\"principal\", ...) 把结果回交给 Principal。请回交结果，否则 Principal 收不到你的产出。";
const MERGED_REMINDER =
  "你本轮尚未回交结果，也未记录关键决策。结束前请：" +
  "① 用 send_message(to=\"principal\", ...) 回交结果；" +
  "② 用 record_trace 记录关键决策。";
const DELEGATE_REMINDER = "[提醒：作为 Principal，实质工作应委派给专家，而不是自己埋头执行。]";
const TOOL_FAILURE_REMINDER =
  "[提醒：该工具调用失败。可用 record_trace 记录这次失败，或借助知识库/检索工具寻找替代方案。]";

/**
 * Build the extension factory for one agent. The returned function is what Pi
 * calls with the per-session `ExtensionAPI`.
 */
export function makeTraceReminderExt(deps: TraceReminderDeps): (pi: PiExtensionApi) => void {
  return (pi) => {
    // Per-RUN flags — reset on agent_start (NOT turn_start). A single prompt()
    // is one agent loop (agent_start…agent_end) spanning MANY turns, and a model
    // naturally calls a tool in one turn then writes its closing sentence in the
    // NEXT (tool-less) turn. Resetting on turn_start wiped the earlier turn's
    // success, so agent_end only ever saw the last turn and falsely reported the
    // work as undone. Keyed to the run, these accumulate across all its turns.
    let traced = false;
    let replied = false;
    let delegated = false;
    let delegateRemindCount = 0;

    // ⚠️ Cross-run-CHAIN counters — MUST NOT reset on agent_start/turn_start nor
    // at the top of agent_end. sendUserMessage(followUp) starts a NEW agent loop
    // (verified: a followUp fires a fresh agent_start) whose end re-enters
    // agent_end; if these were cleared we would re-remind forever. They are reset
    // ONLY at the terminal exits below (dimension satisfied, or already reminded
    // once → fallback/let-go). Decoupled per dimension (A) so a trace reminder
    // and a reply reminder limit independently.
    let traceRemindCount = 0;
    let replyRemindCount = 0;

    pi.on("agent_start", () => {
      traced = false;
      replied = false;
      delegated = false;
      delegateRemindCount = 0;
    });

    // tool_execution_start: nothing required for accounting (we key off
    // tool_execution_end which carries success/failure). Kept as a no-op anchor
    // so the wiring is obvious if richer arg capture is needed later.

    pi.on("tool_execution_end", (e) => {
      if (e.isError) return; // only successful calls count toward "did the work"
      const t = e.toolName;
      if (t === "record_trace" || t.startsWith("create_trace")) traced = true;
      if (t === "send_message") replied = true;
      if (t === "create_agent") delegated = true;
    });

    pi.on("tool_result", (e) => {
      // 意图四 (failure hint) takes precedence; 意图三 (over-step) can stack.
      let suffix = "";
      if (e.isError) {
        suffix += `\n${TOOL_FAILURE_REMINDER}`;
      }
      if (
        deps.role === "principal" &&
        !delegated &&
        !MGMT_TOOLS.has(e.toolName) &&
        delegateRemindCount < 1
      ) {
        delegateRemindCount++;
        suffix += `\n${DELEGATE_REMINDER}`;
      }
      if (!suffix) return; // no rewrite — leave the result untouched

      // Rewrite by appending to the existing text content; the tool still ran.
      const text = e.content.map((c) => (c.type === "text" ? c.text ?? "" : "")).join("");
      return { content: [{ type: "text", text: `${text}${suffix}` }] };
    });

    pi.on("agent_end", () => {
      if (deps.role === "trace") return; // the recorder itself — never nudge.

      // Two ORTHOGONAL checks (B). Both can be true for one expert (it produced
      // work worth tracing AND owes the principal a reply).
      //  - 留痕 (trace): every non-trace role is nudged unconditionally when it
      //    ends a run without a record_trace.
      //  - 回交 (reply): only an expert has a principal to report back to.
      const needTrace = !traced;
      const needReply = deps.role !== "principal" && !replied;

      // A satisfied dimension resets its own counter (so a later real lapse is
      // nudged afresh).
      if (!needTrace) traceRemindCount = 0;
      if (!needReply) replyRemindCount = 0;

      const canTrace = needTrace && traceRemindCount < 1;
      const canReply = needReply && replyRemindCount < 1;

      // Both lapsed and both still nudge-able → ONE merged reminder, not two.
      if (canTrace && canReply) {
        traceRemindCount++;
        replyRemindCount++;
        pi.sendUserMessage(MERGED_REMINDER, { deliverAs: "followUp" });
        return;
      }
      if (canReply) {
        replyRemindCount++;
        pi.sendUserMessage(EXPERT_REPLY_REMINDER, { deliverAs: "followUp" });
        return;
      }
      if (canTrace) {
        traceRemindCount++;
        pi.sendUserMessage(TRACE_REMINDER, { deliverAs: "followUp" });
        return;
      }

      // Nothing left to nudge (each lapsed dimension was already reminded once).
      // Terminal handling per dimension:
      //  - reply has a host fallback so the principal never dead-waits;
      //  - trace has none (PI/expert self-decides) — just let it go.
      // ⚠️ counters reset only here (the already-reminded terminal exit).
      if (needReply) {
        deps.onUnreplied(deps.name);
        replyRemindCount = 0;
      }
      if (needTrace) {
        traceRemindCount = 0;
      }
    });
  };
}
