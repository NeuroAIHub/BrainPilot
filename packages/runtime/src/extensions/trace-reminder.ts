/** Event-driven reminders for trace capture and expert task replies. */
import type { AgentRole } from "../types.js";

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
  on(event: "agent_end", handler: (e: AgentEndLike) => void | Promise<void>): void;
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
  onUnreplied: (agentName: string) => void | Promise<void>;
  hasPendingTasks?: () => boolean;
  claimTaskReminder?: (agentName: string) => Promise<boolean>;
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
  "get_trace_node",
  "get_trace_neighborhood",
  "get_trace_diff",
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
  "Act on the pending assigned task: complete_task with its exact ID, or dispatch_task if another agent must contribute. " +
    "If the work produced a substantive artifact or decision, record it first with record_trace.",
);
const MERGED_REMINDER = SYS(
  "merged",
  "Before finishing, record the substantive milestone with record_trace and complete the pending task " +
    "with complete_task using its exact ID.",
);
interface RunState {
  traced: boolean;
  traceWorthy: boolean;
  dispatched: boolean;
  reminded: boolean;
}

function freshState(): RunState {
  return {
    traced: false,
    traceWorthy: false,
    dispatched: false,
    reminded: false,
  };
}

/**
 * A reminder starts one internal follow-up agent loop. State survives that one
 * loop so a satisfied reply/trace is observed and no second reminder
 * is injected. The next external run starts clean.
 */
export function makeTraceReminderExt(deps: TraceReminderDeps): (pi: PiExtensionApi) => void {
  return (pi) => {
    let state = freshState();
    let continuingFollowUp = false;
    const pending = new Map<string, ToolStartLike>();

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
      void start;
      if (tool === "record_trace" || tool.startsWith("create_trace")) {
        state.traced = true;
        return;
      }

      if (tool === "complete_task") {
        state.traceWorthy = true;
        return;
      }

      if (tool === "dispatch_task") {
        state.dispatched = true;
        state.traceWorthy = true;
        return;
      }

      if (!NON_TRACE_TOOLS.has(tool)) {
        state.traceWorthy = true;
      }
    });

    pi.on("agent_end", async (e) => {
      if (deps.role === "trace") return;
      if (endedInError(e)) {
        state = freshState();
        continuingFollowUp = false;
        return;
      }

      const needTrace = state.traceWorthy && !state.traced;
      const needReply =
        (deps.hasPendingTasks?.() ?? false) &&
        !state.dispatched;
      const sendReminder = (reminder: string): void => {
        state.reminded = true;
        continuingFollowUp = true;
        pi.sendUserMessage(reminder, { deliverAs: "followUp" });
      };

      if (!state.reminded && (needTrace || needReply)) {
        let reminder: string;
        if (needReply && needTrace) reminder = MERGED_REMINDER;
        else if (needReply) reminder = REPLY_REMINDER;
        else reminder = TRACE_REMINDER;

        if (needReply && deps.claimTaskReminder) {
          const claimed = await deps.claimTaskReminder(deps.name);
          if (claimed) sendReminder(reminder);
          else await deps.onUnreplied(deps.name);
        } else {
          sendReminder(reminder);
        }
        return;
      }

      // One reminder is the hard limit. If an expert still did not return its
      // task, notify its creator through the host fallback.
      if (state.reminded && needReply) await deps.onUnreplied(deps.name);
      state = freshState();
      continuingFollowUp = false;
    });
  };
}
