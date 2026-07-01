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
 *  - 意图三 (PI keeps to delegation): if the principal did substantive work
 *    directly (a write/run/external tool, not a read or coordination call)
 *    without delegating, nudge it at run end via a followUp (same channel as
 *    意图一/二) — the tool result itself is left untouched.
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
 *  - Host-injected text (every followUp this file sends) is wrapped in a paired
 *    `[SYSTEM-MESSAGE:kind] … [/SYSTEM-MESSAGE]` marker via the `SYS()` helper, so
 *    a consumer can strip it with one regex and the wrapping has a single source.
 */
import type { AgentRole } from "../types.js";

/** Minimal structural surface of Pi's ExtensionAPI we depend on. */
interface PiExtensionApi {
  on(event: "agent_start", handler: () => void): void;
  on(event: "tool_execution_start", handler: (e: { toolName: string; args?: unknown }) => void): void;
  on(event: "tool_execution_end", handler: (e: { toolName: string; isError: boolean }) => void): void;
  on(event: "agent_end", handler: (e: AgentEndLike) => void): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

/**
 * Structural slice of Pi's `AgentEndEvent` we read: the run's message list, used
 * only to detect whether the run ENDED IN AN ERROR (last assistant message's
 * `stopReason`). A provider failure (401, retry exhausted, mid-stream error) is
 * encoded by Pi as a final AssistantMessage with `stopReason: "error" |
 * "aborted"` — it does NOT throw. When that's the case the host owns recovery
 * (#97 self-retry / escalation), so this extension must NOT also nudge/followUp.
 */
interface AgentEndLike {
  messages?: Array<{ role?: string; stopReason?: string }>;
}

/** True when the run's last assistant message ended in an error/abort. */
function endedInError(e: AgentEndLike): boolean {
  const msgs = e.messages;
  if (!Array.isArray(msgs)) return false;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === "assistant") {
      return m.stopReason === "error" || m.stopReason === "aborted";
    }
  }
  return false;
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
 * Tools a principal may call directly WITHOUT it counting as "doing the work
 * itself" (意图三 exemption): information-gathering / read-only tools plus the
 * management/coordination tools. Anything NOT in this set — a write/edit/run, or
 * any external MCP tool (domain work a principal should delegate) — counts as
 * substantive work and arms the delegate reminder.
 */
const PI_ALLOWED_TOOLS = new Set([
  // information-gathering / read-only
  "read",
  "grep",
  "glob",
  "lS",
  "webfetch",
  "websearch",
  "find",
  // management / coordination
  "create_agent",
  "destroy_agent",
  "record_trace",
  "send_message",
  "ask_user",
  "get_trace_graph",
]);

/**
 * Paired marker wrapping EVERY host-injected message, so a consumer can strip it
 * with a single regex (`\[SYSTEM-MESSAGE.*?\][\s\S]*?\[/SYSTEM-MESSAGE\]`) and the
 * wrapping style has one source of truth. `kind` sub-tags the message for
 * filtering/metrics; the namespace is intentionally generic (not "REMINDER") so
 * future host injections of any sort reuse the same envelope.
 */
const SYS = (kind: string, body: string): string => `[SYSTEM-MESSAGE:${kind}] ${body} [/SYSTEM-MESSAGE]`;

const TRACE_REMINDER = SYS(
  "trace",
  "You did substantive work this run but have not called record_trace. " +
    "If this step is worth recording, call record_trace before finishing.",
);
const EXPERT_REPLY_REMINDER = SYS(
  "reply",
  'You have not returned your result to the Principal via send_message(to="principal", ...). ' +
    "Please report back, otherwise the Principal will not receive your output.",
);
const MERGED_REMINDER = SYS(
  "merged",
  "Before finishing this run: " +
    '(1) return your result via send_message(to="principal", ...); ' +
    "(2) record the key decision via record_trace.",
);
const DELEGATE_REMINDER = SYS(
  "delegate",
  "As the Principal, substantive work should be delegated to an expert rather than done directly.",
);

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
    // 意图三: did the principal do substantive (non-read, non-coordination) work
    // directly this run? Set in tool_execution_end, read in agent_end.
    let didSubstantiveWork = false;

    // ⚠️ Cross-run-CHAIN counters — MUST NOT reset on agent_start/turn_start nor
    // at the top of agent_end. sendUserMessage(followUp) starts a NEW agent loop
    // (verified: a followUp fires a fresh agent_start) whose end re-enters
    // agent_end; if these were cleared we would re-remind forever. They are reset
    // ONLY at the terminal exits below (dimension satisfied, or already reminded
    // once → fallback/let-go). Decoupled per dimension (A) so a trace reminder,
    // a reply reminder, and a delegate reminder limit independently. delegate
    // moved here (from a run-scoped flag) because it now fires via followUp too.
    let traceRemindCount = 0;
    let replyRemindCount = 0;
    let delegateRemindCount = 0;

    pi.on("agent_start", () => {
      traced = false;
      replied = false;
      delegated = false;
      didSubstantiveWork = false;
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
      // 意图三: any successful call NOT in the allow-set (a write/run, or an
      // external MCP/domain tool) is the principal doing the work itself. Match
      // case-insensitively — Pi emits builtins lowercase, but normalizing here
      // keeps the exemption working if a tool ever surfaces in another case.
      if (deps.role === "principal" && !PI_ALLOWED_TOOLS.has(t.toLowerCase())) didSubstantiveWork = true;
    });

    pi.on("agent_end", (e) => {
      if (deps.role === "trace") return; // the recorder itself — never nudge.

      // #97: if THIS run ended in an error (provider 401 / retry exhausted /
      // mid-stream failure), bail entirely. A followUp here would just re-hit the
      // broken provider, and onUnreplied would mislabel an error as silence. The
      // host's delivery-loop error path owns recovery (self-retry / escalation).
      if (endedInError(e)) return;

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

      // 意图三 (PI delegation): the principal did substantive work itself this run
      // without delegating. Nudge once via followUp (NOT merged with trace —
      // separate limiter, worst case one extra round-trip). Cross-run-chain
      // limited like the others. Only reachable for a principal once its trace
      // dimension is settled (a principal has no reply dimension).
      if (deps.role === "principal" && didSubstantiveWork && !delegated && delegateRemindCount < 1) {
        delegateRemindCount++;
        pi.sendUserMessage(DELEGATE_REMINDER, { deliverAs: "followUp" });
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
