import { ChatMessage, MessageFilterRule } from "../contracts/backend";

/**
 * The stable id of the "fold agent errors" default rule. Exported so
 * SessionContext (counting hidden errors for the sidebar badge) and the agent
 * detail toggle both key off the same string without redefining it.
 */
export const HIDE_NON_FATAL_AGENT_ERRORS = "hide-non-fatal-agent-errors";

/**
 * Predicate for the "hide non-fatal agent errors" rule. Kept as a standalone
 * function so SessionContext can reuse it to count hidden errors without
 * duplicating the level checks. Matches `system_message` events at level
 * "error" or "warning"; fatal events are left visible on purpose (a fatal
 * event means the run died and the user MUST see it).
 */
export function isNonFatalAgentErrorMessage(msg: ChatMessage): boolean {
  if (msg.kind !== "system_message") return false;
  if (!msg.systemMessage) return false;
  const level = msg.systemMessage.level;
  return level === "error" || level === "warning";
}

export const defaultFilterRules: MessageFilterRule[] = [
  {
    id: "spurious-dot",
    name: "Hide spurious single-dot messages",
    description:
      "Hides assistant text messages that contain only a single '.' character. " +
      "These often appear when the model enters defensive thinking mode and emits minimal text before a tool call.",
    enabled: true,
    test: (msg: ChatMessage, _all: ChatMessage[]) => {
      if (msg.role !== "assistant") return false;
      if (msg.kind !== "text") return false;
      if (msg.streaming) return false;
      return msg.content.trim() === ".";
    },
  },
  {
    // Issue #278 — most `error` / `warning` system_messages surfaced by an
    // agent are self-healing (retryable failures the agent's own retry loop
    // already consumed). Rendering them in the main chat stream drowns out
    // the actual conversation. Fold them by default, count them per-session,
    // and surface a red dot on the Agents tab so the user knows something
    // happened. Fatal messages are NOT folded — the run died, the user needs
    // to see it inline.
    id: HIDE_NON_FATAL_AGENT_ERRORS,
    name: "Fold non-fatal agent errors",
    description:
      "Hides system_message events at level 'error' or 'warning'. These are usually " +
      "self-healing agent failures (e.g. retryable tool errors the agent already recovered from). " +
      "Fatal-level messages are always shown. Disable this rule to see every error inline.",
    enabled: true,
    test: (msg: ChatMessage, _all: ChatMessage[]) => isNonFatalAgentErrorMessage(msg),
  },
];

export function applyMessageFilters(
  messages: ChatMessage[],
  rules: MessageFilterRule[]
): ChatMessage[] {
  const activeRules = rules.filter((r) => r.enabled);
  if (activeRules.length === 0) return messages;
  return messages.filter((msg) => {
    return !activeRules.some((rule) => rule.test(msg, messages));
  });
}
