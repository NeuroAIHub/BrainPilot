import type { ChatMessage, SystemMessageView } from "../contracts/backend";

export type ProviderFailureCategory =
  | "auth"
  | "model"
  | "rateLimit"
  | "timeout"
  | "network"
  | "unknown";

function failureText(view: SystemMessageView): string {
  return `${view.message}\n${view.details ?? ""}`.toLowerCase();
}

/** Classify terminal provider/run failures into product-level recovery paths. */
export function classifyProviderFailure(view: SystemMessageView): ProviderFailureCategory {
  const text = failureText(view);
  if (
    /\b(401|403)\b|invalid api key|api key.*(?:missing|invalid)|no api key|no provider|unauthor|forbidden|authentication|permission denied/.test(text)
  ) return "auth";
  if (
    /unknown model|model[^\n]*(?:not found|does not exist|unavailable|unsupported|invalid|disabled)|(?:not found|unavailable)[^\n]*model|\b404\b[^\n]*model/.test(text)
  ) return "model";
  if (/\b429\b|rate.?limit|too many requests|quota exceeded/.test(text)) return "rateLimit";
  if (/\b408\b|timeout|timed out|etimedout|deadline exceeded/.test(text)) return "timeout";
  if (
    /\b5\d{2}\b|network|fetch failed|econnreset|econnrefused|enotfound|socket hang up|connection reset|service unavailable|temporarily unavailable|overload/.test(text)
  ) return "network";
  return "unknown";
}

export function providerFailureMessageKey(category: ProviderFailureCategory):
  | "chat.errorRecovery.auth"
  | "chat.errorRecovery.model"
  | "chat.errorRecovery.rateLimit"
  | "chat.errorRecovery.timeout"
  | "chat.errorRecovery.network"
  | "chat.errorRecovery.unknown" {
  return `chat.errorRecovery.${category}`;
}

/** The latest user prompt before an error card is the retry/edit source. */
export function findFailedPrompt(messages: readonly ChatMessage[], errorId: string): string | undefined {
  const errorIndex = messages.findIndex((message) => message.id === errorId);
  for (let index = (errorIndex >= 0 ? errorIndex : messages.length) - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user" && message.content.trim()) return message.content;
  }
  return undefined;
}

export function isDelegatedFailure(message: ChatMessage): boolean {
  const view = message.systemMessage;
  return message.kind === "system_message"
    && Boolean(view)
    && (view!.level === "error" || view!.level === "fatal")
    && Boolean(view!.agent)
    && view!.agent !== "principal";
}

/** A Principal answer after a specialist failure must be labelled partial. */
export function hasDelegatedFailureSinceLastUser(messages: readonly ChatMessage[]): boolean {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return messages.slice(lastUserIndex + 1).some(isDelegatedFailure);
}

/** Mark an already-streaming Principal answer when the failure arrives later. */
export function markLatestPrincipalAnswerPartial(messages: ChatMessage[]): ChatMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "user") break;
    if (
      message.role === "assistant"
      && (message.agent ?? "principal") === "principal"
      && message.kind !== "tool"
      && message.kind !== "thinking"
    ) {
      if (message.partial) return messages;
      const next = [...messages];
      next[index] = { ...message, partial: true };
      return next;
    }
  }
  return messages;
}
