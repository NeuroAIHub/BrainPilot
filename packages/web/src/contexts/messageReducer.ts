import { AgUiMessage, ChatMessage, WebSocketEvent } from "../contracts/backend";
import {
  askUserToChatMessage,
  autoRetryToChatMessage,
  isAutoRetryStatus,
  systemMessageToChatMessage,
} from "./newUiEvents";

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
      return { ...m, streaming: false };
    }
    return m;
  });
  return changed ? next : messages;
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
 * Apply an AG-UI canonical event to the running messages array. Events are
 * keyed by `messageId` / `toolCallId`; START emits a placeholder, CONTENT
 * appends delta, END marks completion. MESSAGES_SNAPSHOT replaces state
 * wholesale.
 */
export function reduceMessagesForEvent(existing: ChatMessage[], event: WebSocketEvent): ChatMessage[] {
  const agent = event.agentName;
  switch (event.type) {
    case "MESSAGES_SNAPSHOT": {
      const messages = Array.isArray(event.messages) ? event.messages : [];
      // Each AG-UI message may carry `tool_calls[]` nested on an assistant
      // message (fold.py groups them so `last_assistant_message`'s tool_calls
      // list grows). Flatten them out as standalone `kind: "tool"` ChatMessages
      // so views that scan tool calls (Agent network, filters) see them on
      // refresh, mirroring how live TOOL_CALL_START events would have created
      // standalone entries.
      const out: ChatMessage[] = [];
      for (const m of messages) {
        out.push(agUiMessageToChatMessage(m));
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
      return [
        ...existing,
        {
          id,
          role,
          content: "",
          createdAt: new Date().toISOString(),
          agent,
          streaming: true,
          kind: "text",
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
      return existing.map((m) =>
        m.id === id ? { ...m, content: (m.content ?? "") + delta } : m,
      );
    }

    case "TEXT_MESSAGE_END": {
      const id = event.messageId;
      if (!id) return existing;
      // Drop messages whose entire content was a NO-RENDER wrapper
      return existing
        .filter((m) => !(m.id === id && (m.content ?? "").trim() === ""))
        .map((m) => (m.id === id ? { ...m, streaming: false } : m));
    }

    case "TEXT_MESSAGE_CHUNK": {
      // Atomic message — created and completed in one step.
      const id = event.messageId;
      if (!id || existing.some((m) => m.id === id)) {
        return existing;
      }
      const role = event.role === "assistant" || event.role === "system" ? event.role : "user";
      return [
        ...existing,
        {
          id,
          role,
          content: typeof event.delta === "string" ? event.delta : "",
          createdAt: new Date().toISOString(),
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
          createdAt: new Date().toISOString(),
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
      return existing.map((m) =>
        m.id === id ? { ...m, toolInput: ((m.toolInput as string) ?? "") + delta } : m,
      );
    }

    case "TOOL_CALL_END": {
      const id = event.toolCallId;
      if (!id) return existing;
      return existing.map((m) => (m.id === id ? { ...m, streaming: false } : m));
    }

    case "TOOL_CALL_RESULT": {
      const id = event.messageId;
      const content = typeof event.content === "string" ? event.content : "";
      if (!id || existing.some((m) => m.id === id)) {
        return existing;
      }
      return [
        ...existing,
        {
          id,
          role: "assistant",
          content: "Tool result",
          createdAt: new Date().toISOString(),
          agent,
          kind: "tool",
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
      return existing.map((m) =>
        m.id === id
          ? { ...m, content: (m.content ?? "") + delta, reasoning: (m.reasoning ?? "") + delta }
          : m,
      );
    }

    case "REASONING_MESSAGE_END": {
      const id = event.messageId;
      if (!id) return existing;
      return existing.map((m) => (m.id === id ? { ...m, streaming: false } : m));
    }

    case "RUN_ERROR": {
      const message = event.message ?? "Run error";
      // Run is over → sweep any dangling streaming flag before appending error.
      const swept = sweepStreaming(existing, event.agentName);
      return [
        ...swept,
        {
          id: generateUUID(),
          role: "system",
          content: String(message),
          createdAt: new Date().toISOString(),
          kind: "error",
        },
      ];
    }

    // 修正6 — system_message: 4-level styled bubble in the conversation stream.
    case "system_message": {
      return [...existing, systemMessageToChatMessage(event)];
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
          ? { ...m, askUser: { ...m.askUser, answer } }
          : m,
      );
    }

    // 修正6 — auto-retry: Pi auto_retry_start surfaces as an
    // agent_status_update (status retrying) carrying attempt/maxAttempts/delayMs.
    case "agent_status_update": {
      if (isAutoRetryStatus(event)) {
        return [...existing, autoRetryToChatMessage(event)];
      }
      return existing;
    }

    // RUN_FINISHED is the authoritative end of a run: sweep any message left
    // streaming because its END never arrived (interrupt / dropped END), so the
    // "thinking" spinner reliably clears.
    case "RUN_FINISHED":
      return sweepStreaming(existing, event.agentName);

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
