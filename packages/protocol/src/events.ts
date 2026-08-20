/**
 * AG-UI event union — the wire contract between Runtime and clients.
 *
 * This file is the single source of truth for the 23-event AG-UI v1 set:
 *   - 19 existing AG-UI canonical events (UPPERCASE names, emitted by the
 *     legacy runtime `events/ag_ui.py`), and
 *   - 4 BrainPilot events (snake_case names): `system_message`,
 *     `user_input_request`, `user_input_response`, `user_input_cancelled`.
 *
 * Naming policy: we preserve each event's *wire* `type` string verbatim so the
 * bytes flowing over SSE are unchanged. The existing events keep their
 * AG-UI-canonical UPPERCASE `type` values (TEXT_MESSAGE_START, …) exactly as
 * `legacy/agent_runtime/events/ag_ui.py` emits them; BrainPilot extensions use
 * snake_case `type` values.
 *
 * Field naming: the wire is snake_case (`session_id`, `agent_name`,
 * `tool_call_id`, …). backend.ts camelizes on receipt. This SSOT models the
 * WIRE shape (snake_case) since that is what crosses the Runtime HTTP
 * boundary; the web package's `normalizeAgUiEvent` is responsible for the
 * camelCase view. See backend.ts `AgUiEvent`/`AgUiMessage` for the camel view.
 */
import { z } from "zod";
import { AgentRetryStateSchema } from "./domain.js";

/* ------------------------------------------------------------------ *
 * Shared building blocks
 * ------------------------------------------------------------------ */

/**
 * AG-UI message shape inside MESSAGES_SNAPSHOT. Wire form is snake_case
 * (`agent_name`); backend.ts camelizes to `agentName`.
 * NOTE: doc/backend.ts call the camel field `agentName`; the wire field is
 * `agent_name` (per legacy fold.py). We model the wire here.
 */
export const AgUiMessageSchema = z
  .object({
    id: z.string(),
    role: z.string(),
    content: z.string().optional(),
    tool_calls: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          arguments: z.string(),
        }),
      )
      .optional(),
    tool_call_id: z.string().optional(),
    error: z.boolean().optional(),
    agent_name: z.string().optional(),
    unfinished: z.boolean().optional(),
    kind: z.string().optional(),
    hook_family: z.string().optional(),
    hook_phase: z.string().optional(),
    hook_level: z.string().optional(),
    hook_data: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type AgUiMessage = z.infer<typeof AgUiMessageSchema>;

/**
 * Common envelope every existing AG-UI event carries (see `_envelope` in
 * legacy ag_ui.py). All fields optional except `type` so tolerant parsing of
 * partial/legacy payloads still succeeds.
 */
const envelope = {
  session_id: z.string().optional(),
  run_id: z.string().optional(),
  thread_id: z.string().optional(),
  agent_name: z.string().optional(),
  /** Stable identity for persistence + SSE replay deduplication. */
  _event_id: z.string().optional(),
  /** ISO8601 emit timestamp (legacy `_ts`). */
  _ts: z.string().optional(),
};

/* ------------------------------------------------------------------ *
 * TEXT_MESSAGE_*  (assistant text streaming)
 * ------------------------------------------------------------------ */

export const TextMessageStartEventSchema = z
  .object({
    type: z.literal("TEXT_MESSAGE_START"),
    message_id: z.string(),
    role: z.string().default("assistant"),
    ...envelope,
  })
  .passthrough();
export type TextMessageStartEvent = z.infer<typeof TextMessageStartEventSchema>;

export const TextMessageContentEventSchema = z
  .object({
    type: z.literal("TEXT_MESSAGE_CONTENT"),
    message_id: z.string(),
    delta: z.string(),
    ...envelope,
  })
  .passthrough();
export type TextMessageContentEvent = z.infer<typeof TextMessageContentEventSchema>;

export const TextMessageEndEventSchema = z
  .object({
    type: z.literal("TEXT_MESSAGE_END"),
    message_id: z.string(),
    ...envelope,
  })
  .passthrough();
export type TextMessageEndEvent = z.infer<typeof TextMessageEndEventSchema>;

export const TextMessageChunkEventSchema = z
  .object({
    type: z.literal("TEXT_MESSAGE_CHUNK"),
    message_id: z.string(),
    role: z.string().default("assistant"),
    delta: z.string(),
    ...envelope,
  })
  .passthrough();
export type TextMessageChunkEvent = z.infer<typeof TextMessageChunkEventSchema>;

/* ------------------------------------------------------------------ *
 * TOOL_CALL_*
 * ------------------------------------------------------------------ */

export const ToolCallStartEventSchema = z
  .object({
    type: z.literal("TOOL_CALL_START"),
    tool_call_id: z.string(),
    tool_call_name: z.string(),
    parent_message_id: z.string().optional(),
    ...envelope,
  })
  .passthrough();
export type ToolCallStartEvent = z.infer<typeof ToolCallStartEventSchema>;

export const ToolCallArgsEventSchema = z
  .object({
    type: z.literal("TOOL_CALL_ARGS"),
    tool_call_id: z.string(),
    delta: z.string(),
    ...envelope,
  })
  .passthrough();
export type ToolCallArgsEvent = z.infer<typeof ToolCallArgsEventSchema>;

export const ToolCallEndEventSchema = z
  .object({
    type: z.literal("TOOL_CALL_END"),
    tool_call_id: z.string(),
    status: z.enum(["completed", "failed", "interrupted"]).optional(),
    duration_ms: z.number().nonnegative().optional(),
    reason: z.enum(["user_requested", "task_interrupted", "agent_interrupted"]).optional(),
    ...envelope,
  })
  .passthrough();
export type ToolCallEndEvent = z.infer<typeof ToolCallEndEventSchema>;

export const ToolCallResultEventSchema = z
  .object({
    type: z.literal("TOOL_CALL_RESULT"),
    tool_call_id: z.string(),
    message_id: z.string().optional(),
    content: z.string().optional(),
    is_error: z.boolean().optional(),
    ...envelope,
  })
  .passthrough();
export type ToolCallResultEvent = z.infer<typeof ToolCallResultEventSchema>;

/* ------------------------------------------------------------------ *
 * REASONING / thinking
 * ------------------------------------------------------------------ */

export const ReasoningStartEventSchema = z
  .object({
    type: z.literal("REASONING_START"),
    ...envelope,
  })
  .passthrough();
export type ReasoningStartEvent = z.infer<typeof ReasoningStartEventSchema>;

export const ReasoningEndEventSchema = z
  .object({
    type: z.literal("REASONING_END"),
    ...envelope,
  })
  .passthrough();
export type ReasoningEndEvent = z.infer<typeof ReasoningEndEventSchema>;

export const ReasoningMessageStartEventSchema = z
  .object({
    type: z.literal("REASONING_MESSAGE_START"),
    message_id: z.string(),
    ...envelope,
  })
  .passthrough();
export type ReasoningMessageStartEvent = z.infer<typeof ReasoningMessageStartEventSchema>;

export const ReasoningMessageContentEventSchema = z
  .object({
    type: z.literal("REASONING_MESSAGE_CONTENT"),
    message_id: z.string(),
    delta: z.string(),
    ...envelope,
  })
  .passthrough();
export type ReasoningMessageContentEvent = z.infer<typeof ReasoningMessageContentEventSchema>;

export const ReasoningMessageEndEventSchema = z
  .object({
    type: z.literal("REASONING_MESSAGE_END"),
    message_id: z.string(),
    ...envelope,
  })
  .passthrough();
export type ReasoningMessageEndEvent = z.infer<typeof ReasoningMessageEndEventSchema>;

/* ------------------------------------------------------------------ *
 * RUN_*  (lifecycle of one agent run)
 * ------------------------------------------------------------------ */

export const RunStartedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("RUN_STARTED"),
    run_id: z.string(),
    parent_run_id: z.string().optional(),
  })
  .passthrough();
export type RunStartedEvent = z.infer<typeof RunStartedEventSchema>;

export const RunFinishedEventSchema = z
  .object({
    ...envelope,
    type: z.literal("RUN_FINISHED"),
    run_id: z.string(),
    result: z.unknown().optional(),
  })
  .passthrough();
export type RunFinishedEvent = z.infer<typeof RunFinishedEventSchema>;

export const RunErrorEventSchema = z
  .object({
    ...envelope,
    type: z.literal("RUN_ERROR"),
    message: z.string(),
    code: z.string().default("RUNTIME_ERROR"),
    run_id: z.string().optional(),
  })
  .passthrough();
export type RunErrorEvent = z.infer<typeof RunErrorEventSchema>;

/* ------------------------------------------------------------------ *
 * Snapshots & CUSTOM extension channel
 * ------------------------------------------------------------------ */

export const MessagesSnapshotEventSchema = z
  .object({
    type: z.literal("MESSAGES_SNAPSHOT"),
    messages: z.array(AgUiMessageSchema),
    ...envelope,
  })
  .passthrough();
export type MessagesSnapshotEvent = z.infer<typeof MessagesSnapshotEventSchema>;

/**
 * AG-UI CUSTOM event — project-specific extension channel. Carries a `name`
 * discriminator + arbitrary `value`. Used by the runtime for `session_state`,
 * `session_heartbeat`, and `agent_status` (see legacy ag_ui.py make_custom /
 * make_session_state / make_session_heartbeat).
 * NOTE: §10 names a dedicated `agent_status_update` event; in the existing
 * wire that travels as CUSTOM{ name:"agent_status" | "session_state" }. We
 * model both: the CUSTOM channel here, and a standalone agent_status_update
 * schema below for the §10 contract. Consumers should accept either.
 */
export const CustomEventSchema = z
  .object({
    type: z.literal("CUSTOM"),
    name: z.string(),
    value: z.unknown(),
    ...envelope,
  })
  .passthrough();
export type CustomEvent = z.infer<typeof CustomEventSchema>;

/**
 * CUSTOM `name` discriminators emitted by the runtime. Shared so producer
 * (runtime) and consumers (web) reference one string, never a literal.
 * - `session_state` — authoritative live agent/run snapshot (#70).
 * - `session_title` — title update.
 * - `session_heartbeat` — liveness timestamp.
 * - `trace_node` — transitional V1 Graph-of-Trace node projection; `value` is
 *   `{ op: "created" | "updated", node: TraceNode }`.
 * - `trace_delta` — derived TraceGraphV2 API-view revision update.
 * - `task_state` — flat task-ledger snapshot or one created/replied/cancelled edge.
 * - `compaction` — Pi SDK auto/manual context compaction lifecycle. `value` is
 *   `CompactionStartValue | CompactionEndValue`. Emitted verbatim from the
 *   Pi `compaction_start` / `compaction_end` events (mas-agent.ts) so clients
 *   can render compaction transparently instead of a mid-run context reset.
 * - `domain_resource_usage` — content-free domain tool / skill usage edge.
 */
export const CUSTOM_EVENT = {
  SESSION_STATE: "session_state",
  SESSION_TITLE: "session_title",
  SESSION_HEARTBEAT: "session_heartbeat",
  TRACE_NODE: "trace_node",
  TRACE_DELTA: "trace_delta",
  TASK_STATE: "task_state",
  COMPACTION: "compaction",
  /** Auditable, content-free domain tool / skill usage edge. */
  DOMAIN_RESOURCE_USAGE: "domain_resource_usage",
  /** Lifecycle snapshot for one context-isolated child session. */
  SUBAGENT_STATE: "subagent_state",
  /** Lifecycle update for one session-scoped background monitor. */
  MONITOR_STATE: "monitor_state",
} as const;

export const TaskStatusSchema = z.enum(["pending", "replied", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskRecordSchema = z.object({
  id: z.string(),
  seq: z.number().int().positive(),
  created_by: z.string(),
  assigned_to: z.string(),
  content: z.string(),
  status: TaskStatusSchema,
  reply: z.string().optional(),
  created_at: z.number().nonnegative(),
  completed_at: z.number().nonnegative().optional(),
}).strict();
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const TaskStateValueSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("snapshot"), tasks: z.array(TaskRecordSchema) }).strict(),
  z.object({ op: z.enum(["created", "replied", "cancelled"]), task: TaskRecordSchema }).strict(),
]);
export type TaskStateValue = z.infer<typeof TaskStateValueSchema>;

/**
 * Normalized resource-use event. Queries, skill bodies, tool results, and
 * credentials are deliberately absent; the AG-UI envelope carries session,
 * run, agent, and timestamp identity.
 */
export const DomainResourceUsageValueSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("domain_tool_call"),
    toolName: z.enum(["get_domain_knowledge_local", "search_papers_local"]),
    source: z.literal("system_tool"),
  }).strict(),
  z.object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("skill_search"),
    toolName: z.literal("skill_search"),
    source: z.literal("router"),
  }).strict(),
  z.object({
    schemaVersion: z.literal("1.0"),
    kind: z.literal("skill_load"),
    skillName: z.string().min(1).max(128),
    source: z.enum(["router", "builtin_read"]),
  }).strict(),
]);
export type DomainResourceUsageValue = z.infer<typeof DomainResourceUsageValueSchema>;

/**
 * `CUSTOM.value` shape for `name: "compaction"` — mirrors Pi SDK's
 * `compaction_start` / `compaction_end` fields, plus an `op` discriminator so
 * one channel carries both edges. Kept passthrough-friendly (all optional past
 * the required core) because Pi may add fields.
 */
export const CompactionReasonSchema = z.enum(["manual", "threshold", "overflow"]);
export type CompactionReason = z.infer<typeof CompactionReasonSchema>;

export const CompactionStartValueSchema = z
  .object({
    op: z.literal("start"),
    reason: CompactionReasonSchema,
  })
  .passthrough();
export type CompactionStartValue = z.infer<typeof CompactionStartValueSchema>;

export const CompactionEndValueSchema = z
  .object({
    op: z.literal("end"),
    reason: CompactionReasonSchema,
    aborted: z.boolean(),
    willRetry: z.boolean(),
    errorMessage: z.string().optional(),
    /** Provider-reported tokens before compaction (present on success). */
    tokensBefore: z.number().optional(),
    /** Estimated tokens after compaction (present on success). */
    estimatedTokensAfter: z.number().optional(),
    /** ID of the first entry kept after the compaction boundary (debug/UX). */
    firstKeptEntryId: z.string().optional(),
  })
  .passthrough();
export type CompactionEndValue = z.infer<typeof CompactionEndValueSchema>;

export const CompactionCustomValueSchema = z.discriminatedUnion("op", [
  CompactionStartValueSchema,
  CompactionEndValueSchema,
]);
export type CompactionCustomValue = z.infer<typeof CompactionCustomValueSchema>;

/* ------------------------------------------------------------------ *
 * agent_status_update  (§10 state authority)
 * ------------------------------------------------------------------ */

export const AgentRunStatusSchema = z.enum(["idle", "running", "error", "stopped"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatusSchema>;

/**
 * §10 "状态权威：沙盒进程内" — emitted whenever an agent transitions
 * idle/running/error/stopped. Field shape mirrors §10 `AgentState`.
 */
export const AgentStatusUpdateEventSchema = z
  .object({
    type: z.literal("agent_status_update"),
    name: z.string(),
    status: AgentRunStatusSchema,
    active_run_id: z.string().optional(),
    active_tool_executions: z.array(z.string()).optional(),
    retry: AgentRetryStateSchema.optional(),
    last_error: z
      .object({
        message: z.string(),
        timestamp: z.string(),
        consecutive_count: z.number(),
      })
      .optional(),
    ...envelope,
  })
  .passthrough();
export type AgentStatusUpdateEvent = z.infer<typeof AgentStatusUpdateEventSchema>;

/* ------------------------------------------------------------------ *
 * NEW event 1: system_message  (doc §6)
 * ------------------------------------------------------------------ */

export const SystemMessageLevelSchema = z.enum(["info", "warning", "error", "fatal"]);
export type SystemMessageLevel = z.infer<typeof SystemMessageLevelSchema>;

export const SystemMessageEventSchema = z
  .object({
    type: z.literal("system_message"),
    session_id: z.string(),
    /** Empty/absent = session-level system message. */
    agent: z.string().optional(),
    level: SystemMessageLevelSchema,
    /** Plain, user-friendly text. */
    message: z.string(),
    /** Technical detail revealed on expand (debug mode). */
    details: z.string().optional(),
    /** ISO8601. */
    timestamp: z.string(),
    /** fatal = red flashing background; affects frontend styling. */
    recoverable: z.boolean(),
    /** Terminal run failure; the frontend must keep this recovery card visible. */
    terminal: z.boolean().optional(),
  })
  .passthrough();
export type SystemMessageEvent = z.infer<typeof SystemMessageEventSchema>;

/* ------------------------------------------------------------------ *
 * NEW event 2: user_input_request  (doc §6 — ask_user)
 * ------------------------------------------------------------------ */

export const UserInputRequestEventSchema = z
  .object({
    type: z.literal("user_input_request"),
    session_id: z.string(),
    request_id: z.string(),
    agent: z.string(),
    question: z.string(),
    options: z.array(z.string()).optional(),
    allow_free_text: z.boolean().optional(),
    timeout_sec: z.number().optional(),
  })
  .passthrough();
export type UserInputRequestEvent = z.infer<typeof UserInputRequestEventSchema>;

/* ------------------------------------------------------------------ *
 * NEW event 3: user_input_response  (doc §6 — ask_user)
 * ------------------------------------------------------------------ */

export const UserInputResponseEventSchema = z
  .object({
    type: z.literal("user_input_response"),
    session_id: z.string(),
    request_id: z.string(),
    answer: z.string(),
  })
  .passthrough();
export type UserInputResponseEvent = z.infer<typeof UserInputResponseEventSchema>;

/* ------------------------------------------------------------------ *
 * NEW event 4: user_input_cancelled  (ask_user terminal state)
 * ------------------------------------------------------------------ */

export const UserInputCancellationReasonSchema = z.enum([
  "interrupted",
  "evicted",
  "restored",
  "expired",
  "agent_destroyed",
]);
export type UserInputCancellationReason = z.infer<typeof UserInputCancellationReasonSchema>;

export const UserInputCancelledEventSchema = z
  .object({
    type: z.literal("user_input_cancelled"),
    session_id: z.string(),
    request_id: z.string(),
    reason: UserInputCancellationReasonSchema,
  })
  .passthrough();
export type UserInputCancelledEvent = z.infer<typeof UserInputCancelledEventSchema>;

/* ------------------------------------------------------------------ *
 * Discriminated union
 * ------------------------------------------------------------------ */

/**
 * The full AG-UI v1 event union (23 events).
 *
 * Existing (20): TEXT_MESSAGE_START/CONTENT/END/CHUNK,
 * TOOL_CALL_START/ARGS/END/RESULT, REASONING_START/END,
 * REASONING_MESSAGE_START/CONTENT/END, RUN_STARTED/FINISHED/ERROR,
 * MESSAGES_SNAPSHOT, CUSTOM, agent_status_update.
 * New (4): system_message, user_input_request, user_input_response,
 * user_input_cancelled.
 */
export const AgUiEventSchema = z.discriminatedUnion("type", [
  // text
  TextMessageStartEventSchema,
  TextMessageContentEventSchema,
  TextMessageEndEventSchema,
  TextMessageChunkEventSchema,
  // tools
  ToolCallStartEventSchema,
  ToolCallArgsEventSchema,
  ToolCallEndEventSchema,
  ToolCallResultEventSchema,
  // reasoning
  ReasoningStartEventSchema,
  ReasoningEndEventSchema,
  ReasoningMessageStartEventSchema,
  ReasoningMessageContentEventSchema,
  ReasoningMessageEndEventSchema,
  // run lifecycle
  RunStartedEventSchema,
  RunFinishedEventSchema,
  RunErrorEventSchema,
  // snapshots / custom / status
  MessagesSnapshotEventSchema,
  CustomEventSchema,
  AgentStatusUpdateEventSchema,
  // new
  SystemMessageEventSchema,
  UserInputRequestEventSchema,
  UserInputResponseEventSchema,
  UserInputCancelledEventSchema,
]);
export type AgUiEvent = z.infer<typeof AgUiEventSchema>;

/** All AG-UI event `type` discriminator strings, for runtime checks/tests. */
export const AG_UI_EVENT_TYPES = [
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TEXT_MESSAGE_CHUNK",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "REASONING_START",
  "REASONING_END",
  "REASONING_MESSAGE_START",
  "REASONING_MESSAGE_CONTENT",
  "REASONING_MESSAGE_END",
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "MESSAGES_SNAPSHOT",
  "CUSTOM",
  "agent_status_update",
  "system_message",
  "user_input_request",
  "user_input_response",
  "user_input_cancelled",
] as const;
export type AgUiEventType = (typeof AG_UI_EVENT_TYPES)[number];

/* ------------------------------------------------------------------ *
 * Validation helpers (tolerant, zod-backed — spirit of normalizeAgUiEvent)
 * ------------------------------------------------------------------ */

/** Parse + validate a raw event; throws a ZodError on invalid input. */
export function parseEvent(raw: unknown): AgUiEvent {
  return AgUiEventSchema.parse(raw);
}

/** Non-throwing variant returning zod's SafeParseReturnType. */
export function safeParseEvent(raw: unknown) {
  return AgUiEventSchema.safeParse(raw);
}

/** True iff `raw` validates as some AG-UI event. */
export function isAgUiEvent(raw: unknown): raw is AgUiEvent {
  return AgUiEventSchema.safeParse(raw).success;
}
