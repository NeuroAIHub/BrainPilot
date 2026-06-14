import { ChatMessage, MessageFilterRule } from "../contracts/backend";

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
