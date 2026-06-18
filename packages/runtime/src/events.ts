/**
 * AG-UI event constructors. Every outgoing event is built here so the wire
 * shape (snake_case fields, UPPERCASE/snake_case `type`) matches
 * `@brainpilot/protocol` exactly. We validate via `parseEvent` in tests.
 *
 * The protocol event envelope carries `session_id`, optional `run_id`,
 * `thread_id`, `agent_name`, and `_ts`. We always inject `session_id` and
 * `agent_name` + `_ts`; `run_id` when known.
 */
import { randomUUID } from "node:crypto";
import type { AgUiEvent } from "@brainpilot/protocol";

function ts(): string {
  return new Date().toISOString();
}

interface Ctx {
  sessionId: string;
  agentName?: string;
  runId?: string;
  threadId?: string;
}

function envelope(ctx: Ctx): {
  session_id: string;
  agent_name?: string;
  run_id?: string;
  thread_id?: string;
  _ts: string;
} {
  const e: ReturnType<typeof envelope> = { session_id: ctx.sessionId, _ts: ts() };
  if (ctx.agentName !== undefined) e.agent_name = ctx.agentName;
  if (ctx.runId !== undefined) e.run_id = ctx.runId;
  if (ctx.threadId !== undefined) e.thread_id = ctx.threadId;
  return e;
}

export function newMessageId(): string {
  return `msg_${randomUUID()}`;
}
export function newRunId(): string {
  return `run_${randomUUID()}`;
}

export const ev = {
  runStarted(ctx: Ctx, parentRunId?: string): AgUiEvent {
    return { type: "RUN_STARTED", ...envelope(ctx), parent_run_id: parentRunId } as AgUiEvent;
  },
  runFinished(ctx: Ctx, result?: unknown): AgUiEvent {
    return { type: "RUN_FINISHED", ...envelope(ctx), result } as AgUiEvent;
  },
  runError(ctx: Ctx, message: string, code = "RUNTIME_ERROR"): AgUiEvent {
    return { type: "RUN_ERROR", ...envelope(ctx), message, code } as AgUiEvent;
  },
  textMessageStart(ctx: Ctx, messageId: string, role = "assistant"): AgUiEvent {
    return { type: "TEXT_MESSAGE_START", ...envelope(ctx), message_id: messageId, role } as AgUiEvent;
  },
  textMessageContent(ctx: Ctx, messageId: string, delta: string): AgUiEvent {
    return { type: "TEXT_MESSAGE_CONTENT", ...envelope(ctx), message_id: messageId, delta } as AgUiEvent;
  },
  textMessageEnd(ctx: Ctx, messageId: string): AgUiEvent {
    return { type: "TEXT_MESSAGE_END", ...envelope(ctx), message_id: messageId } as AgUiEvent;
  },
  /**
   * Atomic text message (issue #42). CHUNK is the AG-UI shorthand for the
   * START→CONTENT→END triad; the client transformer/reducer expands it. We use
   * it with role:"user" to persist + replay the user's own prompt as a bubble
   * in the event stream. AG-UI's canonical carrier for user input is
   * `RunAgentInput.messages`/`MESSAGES_SNAPSHOT`, but BrainPilot's whole
   * history/replay path is the events.jsonl stream, and the spec explicitly
   * permits a single role:"user" CHUNK to echo a user bubble into the output
   * stream — which is exactly this case.
   */
  textMessageChunk(ctx: Ctx, messageId: string, delta: string, role = "assistant"): AgUiEvent {
    return { type: "TEXT_MESSAGE_CHUNK", ...envelope(ctx), message_id: messageId, role, delta } as AgUiEvent;
  },
  reasoningMessageStart(ctx: Ctx, messageId: string): AgUiEvent {
    return { type: "REASONING_MESSAGE_START", ...envelope(ctx), message_id: messageId } as AgUiEvent;
  },
  reasoningMessageContent(ctx: Ctx, messageId: string, delta: string): AgUiEvent {
    return { type: "REASONING_MESSAGE_CONTENT", ...envelope(ctx), message_id: messageId, delta } as AgUiEvent;
  },
  reasoningMessageEnd(ctx: Ctx, messageId: string): AgUiEvent {
    return { type: "REASONING_MESSAGE_END", ...envelope(ctx), message_id: messageId } as AgUiEvent;
  },
  toolCallStart(ctx: Ctx, toolCallId: string, toolName: string, parentMessageId?: string): AgUiEvent {
    return {
      type: "TOOL_CALL_START",
      ...envelope(ctx),
      tool_call_id: toolCallId,
      tool_call_name: toolName,
      parent_message_id: parentMessageId,
    } as AgUiEvent;
  },
  toolCallArgs(ctx: Ctx, toolCallId: string, delta: string): AgUiEvent {
    return { type: "TOOL_CALL_ARGS", ...envelope(ctx), tool_call_id: toolCallId, delta } as AgUiEvent;
  },
  toolCallEnd(ctx: Ctx, toolCallId: string): AgUiEvent {
    return { type: "TOOL_CALL_END", ...envelope(ctx), tool_call_id: toolCallId } as AgUiEvent;
  },
  toolCallResult(ctx: Ctx, toolCallId: string, content: string, isError = false, messageId?: string): AgUiEvent {
    return {
      type: "TOOL_CALL_RESULT",
      ...envelope(ctx),
      tool_call_id: toolCallId,
      message_id: messageId ?? newMessageId(),
      content,
      is_error: isError,
    } as AgUiEvent;
  },
  agentStatusUpdate(
    ctx: Ctx,
    name: string,
    status: "idle" | "running" | "error" | "stopped",
    extra?: {
      activeRunId?: string;
      activeToolExecutions?: string[];
      lastError?: { message: string; timestamp: string; consecutiveCount: number };
    },
  ): AgUiEvent {
    const e: Record<string, unknown> = {
      type: "agent_status_update",
      ...envelope({ ...ctx, agentName: name }),
      name,
      status,
    };
    if (extra?.activeRunId !== undefined) e.active_run_id = extra.activeRunId;
    if (extra?.activeToolExecutions && extra.activeToolExecutions.length)
      e.active_tool_executions = extra.activeToolExecutions;
    if (extra?.lastError) {
      e.last_error = {
        message: extra.lastError.message,
        timestamp: extra.lastError.timestamp,
        consecutive_count: extra.lastError.consecutiveCount,
      };
    }
    return e as AgUiEvent;
  },
  userInputRequest(
    ctx: Ctx,
    req: { request_id: string; agent: string; question: string; options?: string[]; allow_free_text?: boolean },
  ): AgUiEvent {
    return {
      type: "user_input_request",
      ...envelope(ctx),
      request_id: req.request_id,
      agent: req.agent,
      question: req.question,
      options: req.options,
      allow_free_text: req.allow_free_text,
    } as AgUiEvent;
  },
  systemMessage(
    sessionId: string,
    level: "info" | "warning" | "error" | "fatal",
    message: string,
    opts?: { agent?: string; details?: string; recoverable?: boolean },
  ): AgUiEvent {
    return {
      type: "system_message",
      session_id: sessionId,
      agent: opts?.agent,
      level,
      message,
      details: opts?.details,
      timestamp: ts(),
      recoverable: opts?.recoverable ?? true,
    } as AgUiEvent;
  },
  custom(ctx: Ctx, name: string, value: unknown): AgUiEvent {
    return { type: "CUSTOM", ...envelope(ctx), name, value } as AgUiEvent;
  },
};
