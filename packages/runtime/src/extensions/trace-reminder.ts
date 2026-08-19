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

function endedUnsuccessfully(e: AgentEndLike): boolean {
  const messages = e.messages;
  if (!Array.isArray(messages)) return false;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "assistant") {
      return message.stopReason === "error" ||
        message.stopReason === "aborted" ||
        message.stopReason === "length";
    }
  }
  return false;
}

export interface TraceReminderDeps {
  role: AgentRole;
  name: string;
  onUnreplied: (agentName: string) => void | Promise<void>;
  hasPendingTasks?: () => boolean;
  /** True while a started background job can still wake this agent. */
  hasBackgroundContinuation?: () => boolean;
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

const READ_ONLY_SHELL_COMMANDS = new Set([
  "cat",
  "file",
  "find",
  "grep",
  "head",
  "ls",
  "pwd",
  "rg",
  "stat",
  "tail",
  "wc",
]);

/** True only for a conservative chain of inspection-only shell commands. */
export function isReadOnlyShellCommand(command: unknown): boolean {
  if (typeof command !== "string" || !command.trim()) return false;
  // Redirections, substitutions, and line breaks make a command too ambiguous
  // to classify as inspection-only. Keep the default trace-worthy behavior.
  if (/[>\n\r]|\$\(|\x60/.test(command)) return false;
  const segments = command.split(/&&|\|\||[;|]/).map((part) => part.trim()).filter(Boolean);
  if (segments.length === 0) return false;
  return segments.every((segment) => {
    const words = segment.split(/\s+/);
    while (words[0] && /^[A-Z_][A-Z0-9_]*=/.test(words[0])) words.shift();
    const executable = words[0]?.replace(/^.*\//, "").toLowerCase();
    if (!executable) return false;
    if (executable === "find") {
      return !words.some((word) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(word));
    }
    if (executable === "git") {
      return ["diff", "log", "show", "status", "ls-files"].includes(words[1]?.toLowerCase() ?? "");
    }
    return READ_ONLY_SHELL_COMMANDS.has(executable);
  });
}

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
  continuation: "none" | "delegated" | "background";
  reminded: boolean;
}

function freshState(): RunState {
  return {
    traced: false,
    traceWorthy: false,
    continuation: "none",
    reminded: false,
  };
}

type ReminderKind = "trace" | "reply" | "merged";

function resolveReminder(
  state: RunState,
  hasPendingTasks: boolean,
  hasBackgroundContinuation: boolean,
): { kind: ReminderKind | null; needReply: boolean } {
  // A successful run_in_background call transfers continuation ownership to
  // the runtime, which will wake this agent on terminal completion. Injecting
  // a follow-up here contradicts that contract and can force a premature
  // terminal complete_task reply.
  if (state.continuation === "background" && hasBackgroundContinuation) {
    return { kind: null, needReply: false };
  }

  const needTrace = state.traceWorthy && !state.traced;
  const needReply = hasPendingTasks && state.continuation !== "delegated";
  const kind = needReply && needTrace
    ? "merged"
    : needReply
      ? "reply"
      : needTrace
        ? "trace"
        : null;
  return { kind, needReply };
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

      if (tool === "run_in_background") {
        state.continuation = "background";
        return;
      }

      if (tool === "dispatch_task") {
        // Background continuation dominates delegation when both occur in one
        // run: the terminal job event is the next reliable wake-up boundary.
        if (state.continuation !== "background") state.continuation = "delegated";
        state.traceWorthy = true;
        return;
      }

      if (tool === "bash" && isReadOnlyShellCommand(start?.args?.command)) {
        return;
      }

      if (!NON_TRACE_TOOLS.has(tool)) {
        state.traceWorthy = true;
      }
    });

    pi.on("agent_end", async (e) => {
      if (deps.role === "trace") return;
      if (endedUnsuccessfully(e)) {
        state = freshState();
        continuingFollowUp = false;
        return;
      }

      const backgroundCanWake = state.continuation === "background"
        && (deps.hasBackgroundContinuation?.() ?? true);
      const decision = resolveReminder(
        state,
        deps.hasPendingTasks?.() ?? false,
        backgroundCanWake,
      );
      const sendReminder = (reminder: string): void => {
        state.reminded = true;
        continuingFollowUp = true;
        pi.sendUserMessage(reminder, { deliverAs: "followUp" });
      };

      if (!state.reminded && decision.kind) {
        const reminder = decision.kind === "merged"
          ? MERGED_REMINDER
          : decision.kind === "reply"
            ? REPLY_REMINDER
            : TRACE_REMINDER;

        if (decision.needReply && deps.claimTaskReminder) {
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
      if (state.reminded && decision.needReply) await deps.onUnreplied(deps.name);
      state = freshState();
      continuingFollowUp = false;
    });
  };
}
