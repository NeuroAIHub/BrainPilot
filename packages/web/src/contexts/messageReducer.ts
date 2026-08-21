import { AgUiMessage, ChatMessage, WebSocketEvent } from "../contracts/backend";
import {
  askUserToChatMessage,
  autoRetryToChatMessage,
  isAutoRetryStatus,
  systemMessageToChatMessage,
} from "./newUiEvents";
import {
  hasDelegatedFailureSinceLastUser,
  isDelegatedFailure,
  markLatestPrincipalAnswerPartial,
} from "./errorRecovery";

/**
 * AG-UI event → message-list reducer, extracted from SessionContext so both the
 * live session and the demo replay player fold the same way. Keeping a single
 * implementation guarantees the replayed conversation is byte-identical to live.
 */

export function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function createAssistantMessage(agent?: string): ChatMessage {
  return {
    id: generateUUID(),
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
    agent: agent || "principal",
    streaming: true,
    kind: "text",
  };
}

export function appendAssistantChunk(messages: ChatMessage[], text: string, agent?: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.streaming && last.kind === "text") {
    return [...messages.slice(0, -1), { ...last, content: last.content + text, agent: agent || last.agent }];
  }
  return [...messages, { ...createAssistantMessage(agent), content: text }];
}

export function finalizeAssistant(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.streaming) {
    return [...messages.slice(0, -1), { ...last, streaming: false }];
  }
  return messages;
}

export function eventSessionId(event: WebSocketEvent): string | undefined {
  // AG-UI events carry sessionId / threadId at the top level (flat shape).
  return event.sessionId || event.threadId;
}

/**
 * Clear `streaming` on any message still marked in-progress for a finished run.
 * A START with no matching END (interrupt, mid-run error, dropped END) would
 * otherwise leave a message stuck at streaming:true, and the activity group
 * shows "智能体思考中" forever. RUN_FINISHED / RUN_ERROR are the authoritative
 * terminators: once a run ends, nothing under that agent can still be streaming.
 * Scoped to `agentName` so a finishing sub-agent never clears another agent's
 * still-live spinner in a multi-agent run (undefined sweeps all, as a fallback).
 */
function sweepStreaming(messages: ChatMessage[], agentName?: string): ChatMessage[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.streaming && (!agentName || m.agent === agentName)) {
      changed = true;
      return finalizeStreamMessage(m);
    }
    return m;
  });
  return changed ? next : messages;
}

/** Remove ephemeral retry activity for one agent once retrying has ended. */
function clearAutoRetry(messages: ChatMessage[], agentName?: string): ChatMessage[] {
  const next = messages.filter(
    (message) => message.kind !== "auto_retry" || (agentName && message.agent !== agentName),
  );
  return next.length === messages.length ? messages : next;
}

/**
 * Convert an AG-UI message (from MESSAGES_SNAPSHOT) into a UI ChatMessage.
 */
export function agUiMessageToChatMessage(msg: AgUiMessage): ChatMessage {
  const role = msg.role === "user" || msg.role === "system" || msg.role === "tool" ? msg.role : "assistant";
  let kind: ChatMessage["kind"] = "text";
  if (msg.role === "reasoning") kind = "thinking";
  if (msg.role === "tool") kind = "tool";
  if (msg.error && msg.role === "system") kind = "error";
  if (msg.kind === "hook" || (msg.hookFamily && msg.role === "system")) kind = "hook";
  return {
    id: msg.id,
    role: role === "tool" ? "assistant" : role,
    content: msg.content ?? "",
    createdAt: new Date().toISOString(),
    agent: role === "user" ? "user" : msg.agentName,
    streaming: !!msg.unfinished,
    kind,
    toolResult: msg.role === "tool" ? msg.content : undefined,
    toolCallId: msg.toolCallId,
    reasoning: msg.role === "reasoning" ? msg.content : undefined,
    hookFamily: msg.hookFamily,
    hookPhase: msg.hookPhase,
    hookLevel: msg.hookLevel,
    hookData: msg.hookData,
  };
}

/**
 * Stable identity for a stream-append event so history rehydrate + SSE ring
 * buffer replay can merge idempotently (#314, #463). New runtime events carry
 * `_eventId`, which remains unique even when identical deltas are emitted in
 * the same millisecond. Legacy events fall back to the old timestamp key;
 * events without either identity return null and always apply while streaming.
 *
 * The transport ID is persisted in events.jsonl and replayed unchanged over
 * SSE, so the same event dedupes while distinct repeated deltas survive.
 */
function streamAppendKey(event: WebSocketEvent, streamId: string, delta: string): string | null {
  const raw = event as Record<string, unknown>;
  const eventId = raw._eventId;
  if (typeof eventId === "string" && eventId) {
    return `${event.type}\0${streamId}\0event:${eventId}`;
  }
  const ts = raw._ts;
  if (typeof ts !== "string" || !ts) return null;
  return `${event.type}\0${streamId}\0legacy:${ts}\0${delta}`;
}

function withAppliedStreamKey(msg: ChatMessage, key: string | null): ChatMessage {
  if (!key) return msg;
  const prev = msg.appliedStreamKeys;
  if (prev?.includes(key)) return msg;
  return { ...msg, appliedStreamKeys: prev ? [...prev, key] : [key] };
}

function finalizeStreamMessage(msg: ChatMessage): ChatMessage {
  // Drop reducer-internal keys once the stream is closed — further CONTENT is
  // rejected via streaming:false, so the fingerprint set is no longer needed.
  if (!msg.streaming && !msg.appliedStreamKeys) return msg;
  const { appliedStreamKeys: _drop, ...rest } = msg;
  return { ...rest, streaming: false };
}

function eventTimestamp(event: WebSocketEvent): string {
  const raw = (event as Record<string, unknown>)._ts;
  if (typeof raw === "string" && Number.isFinite(Date.parse(raw))) return raw;
  return new Date().toISOString();
}

/**
 * Apply an AG-UI canonical event to the running messages array. Events are
 * keyed by `messageId` / `toolCallId`; START emits a placeholder, CONTENT
 * appends delta, END marks completion. MESSAGES_SNAPSHOT replaces state
 * wholesale.
 *
 * Stream-append events (CONTENT / REASONING_CONTENT / TOOL_CALL_ARGS) are
 * idempotent under replay (#314): a finalized message (`streaming:false`)
 * ignores further appends, and events carrying a stable `_ts` identity are
 * applied at most once per message even while still streaming.
 */
export function reduceMessagesForEvent(existing: ChatMessage[], event: WebSocketEvent): ChatMessage[] {
  const agent = event.agentName;
  switch (event.type) {
    case "MESSAGES_SNAPSHOT": {
      const messages = Array.isArray(event.messages) ? event.messages : [];
      const toolNames = new Map<string, string>();
      for (const message of messages) {
        for (const toolCall of message.toolCalls ?? []) {
          if (toolCall.id && toolCall.name) toolNames.set(toolCall.id, toolCall.name);
        }
      }
      // Each AG-UI message may carry `tool_calls[]` nested on an assistant
      // message (fold.py groups them so `last_assistant_message`'s tool_calls
      // list grows). Flatten them out as standalone `kind: "tool"` ChatMessages
      // so views that scan tool calls (Agent network, filters) see them on
      // refresh, mirroring how live TOOL_CALL_START events would have created
      // standalone entries.
      const out: ChatMessage[] = [];
      for (const m of messages) {
        const chatMessage = agUiMessageToChatMessage(m);
        if (m.role === "tool" && m.toolCallId) {
          chatMessage.toolName = toolNames.get(m.toolCallId);
        }
        out.push(chatMessage);
        if (Array.isArray(m.toolCalls)) {
          for (const tc of m.toolCalls) {
            out.push({
              id: tc.id,
              role: "assistant",
              content: `Tool: ${tc.name ?? "unknown"}`,
              createdAt: new Date().toISOString(),
              agent: m.agentName,
              streaming: false,
              kind: "tool",
              toolName: tc.name,
              toolInput: tc.arguments ?? "",
            });
          }
        }
      }
      return out;
    }

    case "TEXT_MESSAGE_START": {
      const id = event.messageId;
      if (!id || existing.some((m) => m.id === id)) {
        return existing;
      }
      const role = event.role === "user" || event.role === "system" ? event.role : "assistant";
      const partial =
        role === "assistant"
        && (agent ?? "principal") === "principal"
        && hasDelegatedFailureSinceLastUser(existing);
      return [
        ...existing,
        {
          id,
          runId: event.runId,
          role,
          content: "",
          createdAt: eventTimestamp(event),
          agent,
          streaming: true,
          kind: "text",
          ...(partial ? { partial: true } : {}),
        },
      ];
    }

    case "TEXT_MESSAGE_CONTENT": {
      const id = event.messageId;
      let delta = typeof event.delta === "string" ? event.delta : "";
      if (!id || !delta) return existing;
      // Strip NO-RENDER wrapper used by record_trace "Message Complete" hint
      delta = delta.replace(/<!--NO-RENDER-->[\s\S]*?<!--\/NO-RENDER-->/g, "");
      if (!delta) return existing;
      const key = streamAppendKey(event, id, delta);
      // Orphaned CONTENT (no matching START) — recover gracefully instead of
      // dropping it. This happens when a demo bundle was exported from a
      // tail-sliced history: the leading START of the earliest messages is gone,
      // and a plain `.map` here would no-op, silently swallowing the opening
      // replies. Synthesize the message so the content still renders.
      if (!existing.some((m) => m.id === id)) {
        return [
          ...existing,
          withAppliedStreamKey(
            {
              id,
              runId: event.runId,
              role: "assistant",
              content: delta,
              createdAt: eventTimestamp(event),
              agent,
              streaming: true,
              kind: "text",
            },
            key,
          ),
        ];
      }
      return existing.map((m) => {
        if (m.id !== id) return m;
        // Finalized message: history/SSE replay must not re-append (#314).
        if (m.streaming === false) return m;
        if (key && m.appliedStreamKeys?.includes(key)) return m;
        return withAppliedStreamKey({ ...m, content: (m.content ?? "") + delta }, key);
      });
    }

    case "TEXT_MESSAGE_END": {
      const id = event.messageId;
      if (!id) return existing;
      // Drop messages whose entire content was a NO-RENDER wrapper
      return existing
        .filter((m) => !(m.id === id && (m.content ?? "").trim() === ""))
        .map((m) => (m.id === id ? finalizeStreamMessage(m) : m));
    }

    case "TEXT_MESSAGE_CHUNK": {
      // Atomic message — created and completed in one step.
      const id = event.messageId;
      if (!id) {
        return existing;
      }
      if (existing.some((m) => m.id === id)) {
        // The composer inserts an optimistic user row before the Runtime echoes
        // the durable CHUNK with the same UUID. Merge authoritative run/time
        // metadata into that row so turn timing can bind and persist correctly.
        return existing.map((message) => message.id === id
          ? {
              ...message,
              runId: message.runId ?? event.runId,
              createdAt: eventTimestamp(event),
            }
          : message);
      }
      const role = event.role === "assistant" || event.role === "system" ? event.role : "user";
      return [
        ...existing,
        {
          id,
          runId: event.runId,
          role,
          content: typeof event.delta === "string" ? event.delta : "",
          createdAt: eventTimestamp(event),
          agent: role === "user" ? "user" : agent,
          streaming: false,
          kind: "text",
        },
      ];
    }

    case "TOOL_CALL_START": {
      const id = event.toolCallId;
      if (!id || existing.some((m) => m.id === id)) {
        return existing;
      }
      return [
        ...existing,
        {
          id,
          role: "assistant",
          content: `Tool: ${event.toolCallName ?? "unknown"}`,
          createdAt: eventTimestamp(event),
          agent,
          streaming: true,
          kind: "tool",
          toolName: event.toolCallName,
          toolInput: "",
        },
      ];
    }

    case "TOOL_CALL_ARGS": {
      const id = event.toolCallId;
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!id || !delta) return existing;
      const key = streamAppendKey(event, id, delta);
      return existing.map((m) => {
        if (m.id !== id) return m;
        if (m.streaming === false) return m;
        if (key && m.appliedStreamKeys?.includes(key)) return m;
        return withAppliedStreamKey(
          { ...m, toolInput: ((m.toolInput as string) ?? "") + delta },
          key,
        );
      });
    }

    case "TOOL_CALL_END": {
      const id = event.toolCallId;
      if (!id) return existing;
      const raw = event as Record<string, unknown>;
      const completedAt = eventTimestamp(event);
      return existing.map((m) => {
        if (m.id !== id) return m;
        if (
          m.toolTerminalSource === "event"
          && m.completedAt
          && Number.isFinite(Date.parse(m.completedAt))
          && Date.parse(completedAt) <= Date.parse(m.completedAt)
        ) {
          return finalizeStreamMessage(m);
        }
        const explicit = typeof raw.durationMs === "number"
          ? raw.durationMs
          : typeof raw.duration_ms === "number"
            ? raw.duration_ms
            : undefined;
        const derived = Date.parse(completedAt) - Date.parse(m.createdAt);
        const durationMs = Math.max(0, Number.isFinite(explicit) ? explicit! : Number.isFinite(derived) ? derived : 0);
        const status = raw.status;
        return finalizeStreamMessage({
          ...m,
          completedAt,
          durationMs,
          toolTerminalSource: "event",
          ...(status === "completed" || status === "failed" || status === "interrupted"
            ? { toolStatus: status }
            : {}),
        });
      });
    }

    case "TOOL_CALL_RESULT": {
      const id = event.messageId;
      const content = typeof event.content === "string" ? event.content : "";
      if (!id || existing.some((m) => m.id === id)) {
        return existing;
      }
      const call = existing.find((message) =>
        message.kind === "tool" && message.id === event.toolCallId,
      );
      return [
        ...existing,
        {
          id,
          role: "assistant",
          content: "Tool result",
          createdAt: new Date().toISOString(),
          agent,
          kind: "tool",
          toolName: call?.toolName,
          toolResult: content,
          // #134 — keep the link back to the originating TOOL_CALL_START so the
          // UI can suppress results of internal tools (record_trace) whose name
          // only rode on the call event, not on this result.
          toolCallId: event.toolCallId,
        },
      ];
    }

    case "REASONING_MESSAGE_START": {
      const id = event.messageId;
      if (!id || existing.some((m) => m.id === id)) return existing;
      return [
        ...existing,
        {
          id,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          agent,
          streaming: true,
          kind: "thinking",
          reasoning: "",
        },
      ];
    }

    case "REASONING_MESSAGE_CONTENT": {
      const id = event.messageId;
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (!id || !delta) return existing;
      const key = streamAppendKey(event, id, delta);
      return existing.map((m) => {
        if (m.id !== id) return m;
        if (m.streaming === false) return m;
        if (key && m.appliedStreamKeys?.includes(key)) return m;
        return withAppliedStreamKey(
          {
            ...m,
            content: (m.content ?? "") + delta,
            reasoning: (m.reasoning ?? "") + delta,
          },
          key,
        );
      });
    }

    case "REASONING_MESSAGE_END": {
      const id = event.messageId;
      if (!id) return existing;
      return existing.map((m) => (m.id === id ? finalizeStreamMessage(m) : m));
    }

    case "RUN_ERROR": {
      const message = event.message ?? "Run error";
      // Run is over → clear transient retry UI and sweep dangling streams.
      const swept = sweepStreaming(clearAutoRetry(existing, event.agentName), event.agentName);
      // Delegated delivery attempts have their own RUN_ERROR lifecycle, but an
      // outer loop may still retry them. SessionManager emits the actionable
      // terminal system_message only when that recovery path is exhausted.
      if (event.terminal === false) return swept;
      const terminalAgent = event.agentName ?? "principal";
      // MasAgent emits a rich system_message (raw provider detail folded) just
      // before RUN_ERROR. Promote that existing row instead of appending a
      // second raw red error, so the user gets exactly one recovery card.
      let diagnosticIndex = -1;
      let currentTurnStart = -1;
      for (let index = swept.length - 1; index >= 0; index -= 1) {
        if (swept[index]!.role === "user") {
          currentTurnStart = index;
          break;
        }
      }
      for (let index = swept.length - 1; index > currentTurnStart; index -= 1) {
        const candidate = swept[index]!;
        if (
          candidate.kind === "system_message"
          && candidate.systemMessage
          && (candidate.systemMessage.level === "error" || candidate.systemMessage.level === "fatal")
          && (candidate.agent ?? "principal") === terminalAgent
        ) {
          diagnosticIndex = index;
          break;
        }
      }
      if (diagnosticIndex >= 0) {
        const next = [...swept];
        const diagnostic = next[diagnosticIndex]!;
        next[diagnosticIndex] = {
          ...diagnostic,
          systemMessage: { ...diagnostic.systemMessage!, terminal: true },
        };
        return next;
      }
      const terminal: ChatMessage = {
        id: typeof (event as Record<string, unknown>)._eventId === "string"
          ? (event as Record<string, unknown>)._eventId as string
          : generateUUID(),
        role: "system",
        content: String(message),
        createdAt: new Date().toISOString(),
        agent: terminalAgent,
        streaming: false,
        kind: "system_message",
        systemMessage: {
          level: "error",
          message: String(message),
          details: event.code ? `Code: ${event.code}` : undefined,
          agent: terminalAgent,
          recoverable: true,
          terminal: true,
        },
      };
      const next = [...swept, terminal];
      return isDelegatedFailure(terminal) ? markLatestPrincipalAnswerPartial(next) : next;
    }

    // 修正6 — system_message: 4-level styled bubble in the conversation stream.
    case "system_message": {
      const msg = systemMessageToChatMessage(event);
      // #167: coalesce by stable id — a repeated system_message carrying an id
      // that already exists (e.g. an agent's retry warning ticking n/N) updates
      // the existing bubble in place instead of stacking a new one. Messages
      // without a stable id (random-id path) always append, as before.
      const e = event as Record<string, unknown>;
      const hasStableId = typeof (e.id ?? e.messageId ?? e._eventId ?? e._event_id) === "string";
      // Older persisted terminal errors predate stable ids. History hydration
      // and SSE replay can still deliver the same row twice; coalesce it by the
      // terminal semantic identity rather than showing duplicate recovery UI.
      if (msg.systemMessage?.terminal) {
        let currentTurnStart = -1;
        for (let index = existing.length - 1; index >= 0; index -= 1) {
          if (existing[index]!.role === "user") {
            currentTurnStart = index;
            break;
          }
        }
        const duplicateIndex = existing.findIndex((candidate, index) =>
          index > currentTurnStart
          && candidate.systemMessage?.terminal
          && (candidate.agent ?? "principal") === (msg.agent ?? "principal")
          && candidate.systemMessage.message === msg.systemMessage!.message,
        );
        if (duplicateIndex >= 0) {
          return existing.map((candidate, index) => index === duplicateIndex
            ? { ...msg, id: candidate.id }
            : candidate);
        }
      }
      const next = hasStableId && existing.some((m) => m.id === msg.id)
        ? existing.map((m) => (m.id === msg.id ? msg : m))
        : [...existing, msg];
      return isDelegatedFailure(msg) ? markLatestPrincipalAnswerPartial(next) : next;
    }

    // 修正6 — user_input_request (ask_user): interactive card. Keyed by
    // requestId so a duplicate re-emit doesn't stack a second card.
    case "user_input_request": {
      const msg = askUserToChatMessage(event);
      if (existing.some((m) => m.id === msg.id)) return existing;
      return [...existing, msg];
    }

    // 修正6 — user_input_response: echo of the submitted answer. Resolve the
    // matching ask_user card (renders as answered) rather than adding a row.
    case "user_input_response": {
      const e = event as Record<string, unknown>;
      const requestId = String(e.requestId ?? e.request_id ?? "");
      const answer = String(e.answer ?? "");
      if (!requestId) return existing;
      return existing.map((m) =>
        m.kind === "ask_user" && m.askUser?.requestId === requestId
          && m.askUser.status !== "cancelled"
          ? { ...m, askUser: { ...m.askUser, answer, status: "answered" } }
          : m,
      );
    }

    // A cancellation is a persisted terminal state, not a transient error.
    // It keeps the transcript card read-only and prevents composer takeover.
    case "user_input_cancelled": {
      const e = event as Record<string, unknown>;
      const requestId = String(e.requestId ?? e.request_id ?? "");
      const rawReason = String(e.reason ?? "expired");
      const reason = (
        rawReason === "interrupted"
          || rawReason === "evicted"
          || rawReason === "restored"
          || rawReason === "agent_destroyed"
          ? rawReason
          : "expired"
      ) as "interrupted" | "evicted" | "restored" | "expired" | "agent_destroyed";
      if (!requestId) return existing;
      return existing.map((m) =>
        m.kind === "ask_user" && m.askUser?.requestId === requestId
          && m.askUser.status !== "answered"
          ? {
              ...m,
              askUser: {
                ...m.askUser,
                answer: undefined,
                status: "cancelled",
                cancellationReason: reason,
              },
            }
          : m,
      );
    }

    // 修正6 — auto-retry: Pi auto_retry_start surfaces as an
    // agent_status_update (status retrying) carrying attempt/maxAttempts/delayMs.
    case "agent_status_update": {
      if (isAutoRetryStatus(event)) {
        // One live card per agent: a later retry attempt replaces the earlier
        // countdown instead of stacking another permanent history item.
        return [...clearAutoRetry(existing, event.agentName), autoRetryToChatMessage(event)];
      }
      // Runtime emits a normal status snapshot as soon as retry sleep ends.
      return clearAutoRetry(existing, event.agentName);
    }

    // RUN_FINISHED is the authoritative end of a run: sweep any message left
    // streaming because its END never arrived (interrupt / dropped END), so the
    // "thinking" spinner reliably clears.
    case "RUN_FINISHED":
      return sweepStreaming(clearAutoRetry(existing, event.agentName), event.agentName);

    // Lifecycle / brackets / extensions — no message-list change
    case "RUN_STARTED":
    case "REASONING_START":
    case "REASONING_END":
      return existing;
    case "CUSTOM": {
      const name = (event as any).name;
      // Hook diagnostic — surface as a small system entry in the message
      // stream so users can see tracker resets, flag flips, reminders, and
      // fallback fires alongside conversation events.
      if (name === "hook_event") {
        const value = ((event as any).value ?? {}) as {
          hook?: string;
          phase?: string;
          level?: string;
          message?: string;
          agent_name?: string;
          data?: Record<string, unknown>;
        };
        const id = `hook-${(event as any).timestamp ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        return [
          ...existing,
          {
            id,
            role: "system",
            content: value.message ?? "(hook event)",
            createdAt: new Date().toISOString(),
            agent: value.agent_name,
            streaming: false,
            kind: "hook",
            hookFamily: value.hook,
            hookPhase: value.phase,
            hookLevel: value.level,
            hookData: value.data,
          },
        ];
      }
      return existing;
    }
    case "PING":
    default:
      return existing;
  }
}
