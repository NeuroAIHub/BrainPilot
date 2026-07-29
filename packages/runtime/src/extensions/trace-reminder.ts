/** Event-driven reminders for trace capture, expert replies, and PI delegation. */
import type { AgentRole } from "../types.js";
import { deriveMsgType } from "../tools/system-tools.js";

interface ToolStartLike {
  toolCallId?: string;
  toolName: string;
  args?: Record<string, unknown>;
}

interface ToolEndLike {
  toolCallId?: string;
  toolName: string;
  isError: boolean;
}

interface PiExtensionApi {
  on(event: "agent_start", handler: () => void): void;
  on(event: "tool_execution_start", handler: (e: ToolStartLike) => void): void;
  on(event: "tool_execution_end", handler: (e: ToolEndLike) => void): void;
  on(event: "agent_end", handler: (e: AgentEndLike) => void): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void;
}

interface AgentEndLike {
  messages?: Array<{ role?: string; stopReason?: string }>;
}

function endedInError(e: AgentEndLike): boolean {
  const messages = e.messages;
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") {
      return message.stopReason === "error" || message.stopReason === "aborted";
    }
  }
  return false;
}

export interface TraceReminderDeps {
  role: AgentRole;
  name: string;
  onUnreplied: (agentName: string) => void;
  /** Dynamic because a live agent may receive tasks from different peers. */
  getDelegator?: () => string;
}

/** Successful calls in this set only inspect or coordinate; they do not arm trace. */
const NON_TRACE_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "find",
  "skill_search",
  "get_domain_knowledge_local",
  "search_papers_local",
  "ask_user",
  "create_agent",
  "destroy_agent",
  "get_trace_graph",
]);

const SYS = (kind: string, body: string): string =>
  `[SYSTEM-MESSAGE:${kind}] ${body} [/SYSTEM-MESSAGE]`;

const TRACE_REMINDER = SYS(
  "trace",
  "This run produced a substantive artifact, result, or handoff without record_trace. " +
    "Record the milestone before finishing.",
);
const REPLY_REMINDER = SYS(
  "reply",
  "Return the result to the current <reply_to> agent with send_message. " +
    "If the work produced a substantive artifact or decision, record it first with record_trace.",
);
const MERGED_REMINDER = SYS(
  "merged",
  "Before finishing, record the substantive milestone with record_trace and return the result " +
    "to the current <reply_to> agent with send_message.",
);
const DELEGATE_REMINDER = SYS(
  "delegate",
  "As the Principal, delegate substantive execution to an expert before finishing.",
);
const PI_MERGED_REMINDER = SYS(
  "merged",
  "As the Principal, record this substantive step with record_trace and delegate the execution " +
    "to an expert before finishing.",
);

interface RunState {
  traced: boolean;
  replied: boolean;
  delegated: boolean;
  traceWorthy: boolean;
  didSubstantiveWork: boolean;
  waitingOnPeer: boolean;
  reminded: boolean;
}

function freshState(): RunState {
  return {
    traced: false,
    replied: false,
    delegated: false,
    traceWorthy: false,
    didSubstantiveWork: false,
    waitingOnPeer: false,
    reminded: false,
  };
}

/**
 * A reminder starts one internal follow-up agent loop. State survives that one
 * loop so a satisfied reply/trace/delegation is observed and no second reminder
 * is injected. The next external run starts clean.
 */
export function makeTraceReminderExt(deps: TraceReminderDeps): (pi: PiExtensionApi) => void {
  return (pi) => {
    let state = freshState();
    let continuingFollowUp = false;
    const pending = new Map<string, ToolStartLike>();

    const delegator = (): string => deps.getDelegator?.() ?? "principal";
    const callKey = (e: { toolCallId?: string; toolName: string }): string =>
      e.toolCallId ?? e.toolName;

    pi.on("agent_start", () => {
      pending.clear();
      if (continuingFollowUp) {
        continuingFollowUp = false;
      } else {
        state = freshState();
      }
    });

    pi.on("tool_execution_start", (e) => {
      pending.set(callKey(e), e);
    });

    pi.on("tool_execution_end", (e) => {
      const start = pending.get(callKey(e));
      pending.delete(callKey(e));
      if (e.isError) return;

      const tool = e.toolName.toLowerCase();
      const args = start?.args ?? {};
      if (tool === "record_trace" || tool.startsWith("create_trace")) {
        state.traced = true;
        return;
      }

      if (tool === "send_message") {
        const currentDelegator = delegator();
        const to = String(args.to ?? currentDelegator);
        const msgType = deriveMsgType(deps.name, to, currentDelegator);
        if (deps.role === "expert" && msgType === "result_deliver" && to === currentDelegator) {
          state.replied = true;
        }
        if (deps.role === "expert" && to !== currentDelegator) {
          state.waitingOnPeer = true;
        }
        if (deps.role === "principal" && msgType === "task_delegate" && to !== deps.name) {
          state.delegated = true;
          state.traceWorthy = true;
        }
        if (msgType === "result_deliver" && to === currentDelegator) state.traceWorthy = true;
        return;
      }

      if (!NON_TRACE_TOOLS.has(tool)) {
        state.traceWorthy = true;
        if (deps.role === "principal") state.didSubstantiveWork = true;
      }
    });

    pi.on("agent_end", (e) => {
      if (deps.role === "trace") return;
      if (endedInError(e)) {
        state = freshState();
        continuingFollowUp = false;
        return;
      }

      const needTrace = state.traceWorthy && !state.traced;
      const needReply = deps.role === "expert" && !state.replied && !state.waitingOnPeer;
      const needDelegate =
        deps.role === "principal" && state.didSubstantiveWork && !state.delegated;

      if (!state.reminded && (needTrace || needReply || needDelegate)) {
        let reminder: string;
        if (needReply && needTrace) reminder = MERGED_REMINDER;
        else if (needReply) reminder = REPLY_REMINDER;
        else if (needTrace && needDelegate) reminder = PI_MERGED_REMINDER;
        else if (needDelegate) reminder = DELEGATE_REMINDER;
        else reminder = TRACE_REMINDER;

        state.reminded = true;
        continuingFollowUp = true;
        pi.sendUserMessage(reminder, { deliverAs: "followUp" });
        return;
      }

      // One reminder is the hard limit. If an expert still did not return its
      // result, notify the real delegator through the host fallback.
      if (state.reminded && needReply) deps.onUnreplied(deps.name);
      state = freshState();
      continuingFollowUp = false;
    });
  };
}
