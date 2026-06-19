/**
 * trace-reminder — the one Pi-native extension (replaces #79 captureMilestone).
 *
 * Philosophy (vs. #79): the host no longer writes trace nodes on the agent's
 * behalf. Instead we REMIND the agent at the right moment and let it decide:
 *  - 意图一 (PI work leaves a trace): if a principal turn made a decision but
 *    never called record_trace, nudge it once to record (D).
 *  - 意图二 (expert results flow back): if an expert turn produced work but never
 *    send_message'd the principal, nudge once; if it still won't, the host writes
 *    a fallback note into the principal's mailbox so the PI never dead-waits.
 *  - 意图三 (PI keeps to delegation): if the principal does substantive work
 *    directly without delegating, append a soft reminder to the tool result.
 *  - 意图四 (resource awareness): on a tool error, append a soft hint that the
 *    knowledge tools / record_trace exist. (Static identity lives in personas.)
 *
 * Mechanism (Pi SDK v0.79, verified against installed d.ts):
 *  - Registered per-AgentSession via DefaultResourceLoader.extensionFactories.
 *    Closure state is therefore naturally isolated per agent.
 *  - `agent_end` / `turn_*` are pure notifications (no return value, cannot
 *    block). The ONLY "force continue" lever is `pi.sendUserMessage(text,
 *    {deliverAs:"followUp"})` inside `agent_end`: it releases the current stop
 *    and injects a message that triggers a NEW turn.
 *  - `tool_result` MAY return `{content}` to rewrite the result text — used for
 *    the soft reminders (意图三/四).
 */
import type { AgentRole } from "../types.js";

/** Minimal structural surface of Pi's ExtensionAPI we depend on. */
interface PiExtensionApi {
  on(event: "turn_start", handler: () => void): void;
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

const PRINCIPAL_TRACE_REMINDER =
  "你本轮做了实质决策但尚未调用 record_trace。如果这步值得留痕，请调用 record_trace 记录后再结束。";
const EXPERT_REPLY_REMINDER =
  "你尚未通过 send_message(to=\"principal\", ...) 把结果回交给 Principal。请回交结果，否则 Principal 收不到你的产出。";
const DELEGATE_REMINDER = "[提醒：作为 Principal，实质工作应委派给专家，而不是自己埋头执行。]";
const TOOL_FAILURE_REMINDER =
  "[提醒：该工具调用失败。可用 record_trace 记录这次失败，或借助知识库/检索工具寻找替代方案。]";

/**
 * Build the extension factory for one agent. The returned function is what Pi
 * calls with the per-session `ExtensionAPI`.
 */
export function makeTraceReminderExt(deps: TraceReminderDeps): (pi: PiExtensionApi) => void {
  return (pi) => {
    // Per-turn flags — reset on turn_start.
    let traced = false;
    let replied = false;
    let delegated = false;
    let delegateRemindCount = 0;

    // ⚠️ Cross-run counter — MUST NOT reset on turn_start / at the top of
    // agent_end. sendUserMessage(followUp) triggers a NEW run whose end re-enters
    // agent_end; if this were cleared we would re-remind forever. It is reset
    // ONLY at the two terminal exits below (goal met, or already reminded once).
    let remindCount = 0;

    pi.on("turn_start", () => {
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

      if (deps.role === "principal") {
        if (traced) {
          remindCount = 0; // goal met — safe to reset.
          return;
        }
        if (remindCount < 1) {
          remindCount++;
          pi.sendUserMessage(PRINCIPAL_TRACE_REMINDER, { deliverAs: "followUp" });
          return;
        }
        // Already reminded once — let it go. PI is the top coordinator: no
        // host-side fallback. ⚠️ reset only here (already-reminded exit).
        remindCount = 0;
        return;
      }

      // expert branch (everything that isn't principal/trace).
      if (replied) {
        remindCount = 0; // goal met — safe to reset.
        return;
      }
      if (remindCount < 1) {
        remindCount++;
        pi.sendUserMessage(EXPERT_REPLY_REMINDER, { deliverAs: "followUp" });
        return;
      }
      // Reminded once and still no reply → host fallback so the PI never
      // dead-waits. ⚠️ reset only here (already-reminded exit).
      deps.onUnreplied(deps.name);
      remindCount = 0;
    });
  };
}
