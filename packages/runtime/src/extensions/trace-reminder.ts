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
  messages?: Array<{
    role?: string;
    stopReason?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  }>;
}

function messageText(message: NonNullable<AgentEndLike["messages"]>[number]): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/** A direct user prohibition wins over the automatic trace reminder. */
export function explicitlyDeclinesTrace(messages: AgentEndLike["messages"]): boolean {
  if (!Array.isArray(messages)) return false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = messageText(message);
    return /\b(?:do not|don't|never)\s+(?:call|use|invoke)\s+[`'"]?record_trace\b|(?:不要|请勿|不再|无需)(?:调用|使用|执行)?\s*[`'"]?record_trace\b/i.test(text);
  }
  return false;
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
    "Record the milestone before finishing. This is an internal follow-up: do not repeat or revise " +
    "the user-facing answer. End with exactly <!--NO-RENDER-->trace reminder handled<!--/NO-RENDER--> " +
    "and no text outside that wrapper.",
);
const REPLY_REMINDER = SYS(
  "reply",
  "Act on the pending assigned task: complete_task with its exact ID, or dispatch_task if another agent must contribute. " +
    "If the work produced a substantive artifact or decision, record it first with record_trace. " +
    "Do not repeat the user-facing answer; end with exactly <!--NO-RENDER-->task reminder handled<!--/NO-RENDER-->.",
);
const MERGED_REMINDER = SYS(
  "merged",
  "Before finishing, record the substantive milestone with record_trace and complete the pending task " +
    "with complete_task using its exact ID. Do not repeat the user-facing answer; end with exactly " +
    "<!--NO-RENDER-->coordination reminder handled<!--/NO-RENDER-->.",
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

      const needTrace = state.traceWorthy && !state.traced && !explicitlyDeclinesTrace(e.messages);
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
