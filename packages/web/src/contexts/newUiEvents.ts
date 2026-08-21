import type {
  AskUserView,
  AutoRetryView,
  ChatMessage,
  SystemMessageView,
  WebSocketEvent,
} from "../contracts/backend";
import { generateUUID } from "./messageReducer";

/**
 * 修正6 — event → view-model mapping for the three new UI features
 * (system_message bubble, ask_user card, auto-retry countdown).
 *
 * Kept as pure functions (no React, no DOM) so the mapping is unit-testable in
 * isolation. The reducer in messageReducer.ts calls these to fold the new
 * AG-UI events into the ChatMessage stream, consistently with the existing
 * event handling.
 *
 * Events arrive post-`normalizeAgUiEvent`, which camelizes every wire key. So a
 * wire `request_id` is read here as `requestId`, `allow_free_text` as
 * `allowFreeText`, etc. We still tolerate the snake_case originals as a
 * fallback in case an event bypassed normalization.
 */

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optStr(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Map a `system_message` event to its view-model. */
export function toSystemMessageView(event: WebSocketEvent): SystemMessageView {
  const e = event as Record<string, unknown>;
  const rawLevel = str(e.level, "info");
  const level: SystemMessageView["level"] =
    rawLevel === "warning" || rawLevel === "error" || rawLevel === "fatal" ? rawLevel : "info";
  // `recoverable` defaults to false for fatal, true otherwise, when the wire
  // omits it.
  const recoverable =
    typeof e.recoverable === "boolean" ? e.recoverable : level !== "fatal";
  const metadata = e.metadata && typeof e.metadata === "object"
    ? e.metadata as Record<string, unknown>
    : undefined;
  const mode: "checkpoint" | "causal" = metadata?.mode === "causal" ? "causal" : "checkpoint";
  const files = Array.isArray(metadata?.files)
    ? metadata.files.filter((file): file is string => typeof file === "string")
    : [];
  const workspaceRestore: SystemMessageView["workspaceRestore"] = e.code === "workspace_restored"
    ? {
        mode,
        checkpointId: optStr(metadata?.checkpointId),
        nodeId: optStr(metadata?.nodeId),
        changeId: optStr(metadata?.changeId),
        restoredAt: optStr(metadata?.restoredAt),
        files,
        fileCount: num(metadata?.fileCount, files.length),
        affectedNodeCount: typeof metadata?.affectedNodeCount === "number"
          ? metadata.affectedNodeCount
          : undefined,
      }
    : undefined;
  return {
    level,
    message: str(e.message),
    details: optStr(e.details),
    agent: optStr(e.agent) ?? optStr(e.agentName),
    recoverable,
    terminal: e.terminal === true,
    timestamp: optStr(e.timestamp),
    code: optStr(e.code),
    workspaceRestore,
  };
}

/** Map a `user_input_request` event to the ask_user card view-model. */
export function toAskUserView(event: WebSocketEvent): AskUserView {
  const e = event as Record<string, unknown>;
  const options = Array.isArray(e.options)
    ? (e.options as unknown[]).filter((o): o is string => typeof o === "string")
    : undefined;
  return {
    requestId: str(e.requestId ?? e.request_id),
    agent: str(e.agent ?? e.agentName, "principal"),
    question: str(e.question),
    options: options && options.length > 0 ? options : undefined,
    allowFreeText:
      typeof (e.allowFreeText ?? e.allow_free_text) === "boolean"
        ? (e.allowFreeText ?? e.allow_free_text) as boolean
        : undefined,
    timeoutSec: typeof (e.timeoutSec ?? e.timeout_sec) === "number"
      ? (e.timeoutSec ?? e.timeout_sec) as number
      : undefined,
    status: "pending",
  };
}

/**
 * Map an auto-retry indicator to its view-model. Pi's `auto_retry_start`
 * surfaces as an `agent_status_update` (status `retrying`) carrying
 * attempt/maxAttempts/delayMs, mirrored by a `system_message`. We read whichever
 * fields are present, tolerating camel/snake casing.
 */
export function toAutoRetryView(event: WebSocketEvent): AutoRetryView {
  const e = event as Record<string, unknown>;
  // Runtime's canonical agent_status_update carries retry details under
  // `retry`. Older/demo feeds may use data/value/autoRetry or top-level fields.
  const nested =
    (e.retry as Record<string, unknown> | undefined) ??
    (e.autoRetry as Record<string, unknown> | undefined) ??
    (e.data as Record<string, unknown> | undefined) ??
    (e.value as Record<string, unknown> | undefined) ??
    e;
  return {
    attempt: num(nested.attempt, 1),
    maxAttempts: num(nested.maxAttempts ?? nested.max_attempts, 1),
    delayMs: num(nested.delayMs ?? nested.delay_ms, 0),
    reason: optStr(nested.reason) ?? optStr(e.message),
  };
}

/** True iff this `agent_status_update` represents an auto-retry start. */
export function isAutoRetryStatus(event: WebSocketEvent): boolean {
  const e = event as Record<string, unknown>;
  if (e.type !== "agent_status_update") return false;
  const status = str(e.status ?? (e as { runStatus?: string }).runStatus).toLowerCase();
  // Pi auto_retry_start may surface with a retrying status marker, while the
  // Runtime's canonical event keeps status="running" and attaches `retry`.
  if (status === "retrying" || status === "auto_retry" || status === "auto_retry_start") {
    return true;
  }
  return Boolean(e.retry ?? e.autoRetry ?? e.auto_retry);
}

/** Build the `system_message` ChatMessage. */
export function systemMessageToChatMessage(event: WebSocketEvent): ChatMessage {
  const view = toSystemMessageView(event);
  const e = event as Record<string, unknown>;
  return {
    id: str(e.id ?? e.messageId ?? e._eventId ?? e._event_id)
      || `sysmsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    runId: optStr(e.runId ?? e.run_id),
    role: "system",
    content: view.message,
    createdAt: view.timestamp ?? new Date().toISOString(),
    agent: view.agent,
    streaming: false,
    kind: "system_message",
    systemMessage: view,
  };
}

/** Build the `ask_user` ChatMessage. Keyed by requestId so it can be resolved. */
export function askUserToChatMessage(event: WebSocketEvent): ChatMessage {
  const view = toAskUserView(event);
  return {
    id: view.requestId ? `ask-${view.requestId}` : generateUUID(),
    role: "system",
    content: view.question,
    createdAt: new Date().toISOString(),
    agent: view.agent,
    streaming: false,
    kind: "ask_user",
    askUser: view,
  };
}

/** Build the `auto_retry` ChatMessage from an auto-retry status update. */
export function autoRetryToChatMessage(event: WebSocketEvent): ChatMessage {
  const view = toAutoRetryView(event);
  const e = event as Record<string, unknown>;
  return {
    id: `retry-${str(e.agentName, "agent")}-${view.attempt}-${Date.now()}`,
    role: "system",
    content: view.reason ?? `Retrying (attempt ${view.attempt}/${view.maxAttempts})`,
    createdAt: new Date().toISOString(),
    agent: optStr(e.agentName),
    streaming: false,
    kind: "auto_retry",
    autoRetry: view,
  };
}

// ── Pure interaction helpers (shared by the components; testable w/o a DOM) ──

/**
 * Resolve an ask_user submission. Returns the `{ requestId, answer }` to send,
 * or `null` when the input is empty or the card is no longer accepting input
 * (already answered / timed out). The trimmed answer is what gets sent.
 */
export function resolveAskUserSubmission(
  view: AskUserView,
  rawAnswer: string,
  opts: { answered?: boolean; timedOut?: boolean } = {},
): { requestId: string; answer: string } | null {
  if (opts.answered || opts.timedOut || !isAskUserOpen(view)) return null;
  const answer = rawAnswer.trim();
  if (!answer || !view.requestId) return null;
  if (view.allowFreeText === false && !(view.options ?? []).includes(answer)) return null;
  return { requestId: view.requestId, answer };
}

/** Whether an ask_user card should still show interactive inputs. */
export function isAskUserOpen(
  view: AskUserView,
  opts: { timedOut?: boolean } = {},
): boolean {
  const status = view.status ?? (view.answer === undefined ? "pending" : "answered");
  return status === "pending" && view.answer === undefined && !opts.timedOut;
}

/** Initial countdown (whole seconds) for an auto-retry from its delayMs. */
export function autoRetryCountdownSeconds(view: AutoRetryView): number {
  return view.delayMs > 0 ? Math.ceil(view.delayMs / 1000) : 0;
}
