// ---------------------------------------------------------------------------
// Protocol is the single source of truth for wire/domain types.
//
// `@brainpilot/protocol` owns the canonical domain models (camelCase,
// post-normalize shape) and the AG-UI wire event union (snake_case). We import
// the domain types here and re-export them so the rest of `src/` keeps importing
// from "../contracts/backend" unchanged. This file is now a thin adapter: it
// keeps the `normalize*`/`serialize*` functions, the UI-only types the protocol
// does not model (Sandbox*, ChatMessage, raw API shapes, message filters), and
// the *post-normalize camelCase* AG-UI event/message shapes the components rely
// on (protocol models the snake_case wire shape, which differs — see below).
// ---------------------------------------------------------------------------
import type {
  Session,
  DomainResources,
  ThinkingLevel,
  AgentStatus,
  SubagentStatus,
  SessionStateSnapshot,
  SessionTokenUsage,
  TokenUsage,
  SettingsData,
  McpServerEntry,
  McpByokInfo,
  ModelHealth,
  ProviderProfile,
  ProviderApi,
  ProviderAdapter,
  ProviderContextWindow,
  FileEntry,
  FileContent,
  TraceNode,
  TraceNodeStatus,
  TraceParent,
  TraceArtifact,
  TraceTimestamp,
  TraceGraph,
  TraceDependency,
  TraceEpisode,
  TraceArtifactV2,
  TraceDeltaV2,
  TraceCheckpointRef,
  TraceCheckpointDetail,
  TraceCheckpointFileChange,
  TraceCheckpointSkippedFile,
  TraceRestorePreview,
  TraceRestoreResult,
  TraceCausalRollbackPreview,
  TraceCausalRollbackResult,
  TraceChange,
  TraceNodeRecord,
  TraceCausalParent,
  AuditReport,
} from "@brainpilot/protocol";

// Re-export the canonical protocol domain types under their existing names so
// all `import { … } from "../contracts/backend"` sites continue to resolve.
export type {
  Session,
  DomainResources,
  ThinkingLevel,
  AgentStatus,
  SubagentStatus,
  SessionStateSnapshot,
  SessionTokenUsage,
  TokenUsage,
  SettingsData,
  McpServerEntry,
  McpByokInfo,
  ModelHealth,
  ProviderProfile,
  ProviderApi,
  ProviderAdapter,
  ProviderContextWindow,
  FileEntry,
  FileContent,
  TraceNode,
  TraceNodeStatus,
  TraceParent,
  TraceArtifact,
  TraceTimestamp,
  TraceGraph,
  TraceDependency,
  TraceEpisode,
  TraceArtifactV2,
  TraceDeltaV2,
  TraceCheckpointRef,
  TraceCheckpointDetail,
  TraceCheckpointFileChange,
  TraceCheckpointSkippedFile,
  TraceRestorePreview,
  TraceRestoreResult,
  TraceCausalRollbackPreview,
  TraceCausalRollbackResult,
  TraceChange,
  TraceNodeRecord,
  TraceCausalParent,
  AuditReport,
};

/**
 * Per-tool on/off overrides for the three user-controllable Pi-native
 * SystemTools. Mirrors `packages/backend-core/src/config.ts:ToolToggles` and
 * `packages/runtime/src/tool-toggles.ts:ToolToggles` — kept in triplicate
 * because the frontend must not import from either non-published package.
 *
 * All fields optional; missing / non-boolean → runtime treats as enabled.
 */
export interface ToolToggles {
  skill_search?: boolean;
  get_domain_knowledge_local?: boolean;
  search_papers_local?: boolean;
}

/** The exhaustive list of toggleable tool names, in display order. */
export const TOGGLEABLE_TOOL_NAMES = [
  "skill_search",
  "get_domain_knowledge_local",
  "search_papers_local",
] as const;

export type ToggleableToolName = (typeof TOGGLEABLE_TOOL_NAMES)[number];

export type SandboxStatus =
  | "creating"
  | "running"
  | "stopped"
  | "error"
  | "quota_exceeded"
  | string;

export interface User {
  id: string;
  username: string;
  createdAt: string;
}

export interface AuthToken {
  accessToken: string;
  tokenType: string;
  user: User;
}

export interface Sandbox {
  id: string;
  name: string;
  status: SandboxStatus;
  port: number | null;
  userId: string;
  createdAt: string;
  containerName?: string;
  hostApiUrl?: string;
}

export interface SandboxStats {
  sandboxId: string;
  sandboxName: string;
  status: SandboxStatus;
  memory: {
    usedBytes: number;
    limitBytes: number;
    percent: number;
  };
  cpu: {
    usedPercent: number;
    quotaPercent: number;
    onlineCpus: number;
  };
  pids: {
    current: number;
    limit: number | null;
  };
  disk: {
    // Plain workspace usage. Meaningful in every deployment (single-user and
    // hosted) — the SandboxStatus disk meter reads this.
    workspaceUsedBytes: number;
    // HOSTED-ONLY HOOK (see #262). `quotaBytes` / `percentOfQuota` are supplied
    // only by a managed/multi-tenant hosting layer that fills `/stats`. In a
    // self-hosted single-user run backend-core serves no quota fields, so both
    // normalize to `0` (numberValue fallback) and the disk-quota dialogs
    // (components/quota/*) stay intentionally inert — the `>= 90` / `>= 100`
    // gates never fire. Do NOT remove these: the hosting layer consumes
    // @brainpilot/web as an unpatched npm artifact, so these fields + the quota
    // components are the only way a managed deployment can surface quota inside
    // /app. Same pattern as auth stripping (R-11) and subpath hosting (R-9):
    // open-source ships the front, the hosted layer drives it.
    quotaBytes: number;
    percentOfQuota: number;
  };
  gpu?: {
    name?: string;
    memoryUsedBytes?: number;
    memoryTotalBytes?: number;
    utilizationPercent?: number;
  } | null;
}

// FileEntry, FileContent, Session — now imported from @brainpilot/protocol (see top).

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  agent?: string;
  streaming?: boolean;
  kind?: "text" | "thinking" | "tool" | "error" | "status" | "hook" | "system_message" | "ask_user" | "auto_retry";
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  reasoning?: string;
  toolCallId?: string;
  /** Authoritative tool lifecycle timestamps/status, persisted by runtime. */
  completedAt?: string;
  durationMs?: number;
  toolStatus?: "completed" | "failed" | "interrupted";
  /** Reducer-internal precedence marker; wire END outranks snapshot fallback. */
  toolTerminalSource?: "event" | "snapshot";
  // Hook diagnostic event metadata — set when kind === "hook"
  hookFamily?: string;   // "expert_reply" | "principal_trace"
  hookPhase?: string;    // "reset_clean" | "reset_dirty" | "flag_set" | "reminder" | "fallback"
  hookLevel?: string;    // "debug" | "info" | "warning" | "error"
  hookData?: Record<string, unknown>;
  // ── 修正6 new-UI payloads (post-normalize, camelCase view shape) ──
  // kind === "system_message": 4-level styled bubble (doc §6)
  systemMessage?: SystemMessageView;
  // kind === "ask_user": interactive user_input_request card (doc §6)
  askUser?: AskUserView;
  // kind === "auto_retry": auto-retry countdown + cancel indicator (doc §6)
  autoRetry?: AutoRetryView;
  /** Principal output produced after a delegated agent failure. */
  partial?: boolean;
  /**
   * Reducer-internal: stable keys of stream-append events already applied to
   * this message (`TEXT_MESSAGE_CONTENT` / `REASONING_MESSAGE_CONTENT` /
   * `TOOL_CALL_ARGS`). Used so history rehydrate + SSE ring-buffer replay do
   * not concatenate the same delta twice (#314). Not rendered.
   */
  appliedStreamKeys?: string[];
}

/** View-model for a `system_message` AG-UI event (post-normalize). */
export interface WorkspaceRestoreView {
  mode: "checkpoint" | "causal";
  checkpointId?: string;
  nodeId?: string;
  changeId?: string;
  restoredAt?: string;
  files: string[];
  fileCount: number;
  affectedNodeCount?: number;
}

export interface SystemMessageView {
  level: "info" | "warning" | "error" | "fatal";
  message: string;
  details?: string;
  agent?: string;
  /** fatal events are non-recoverable; drives the emphasized red styling. */
  recoverable: boolean;
  /** RUN_ERROR promoted this diagnostic into the visible terminal recovery card. */
  terminal?: boolean;
  timestamp?: string;
  code?: string;
  workspaceRestore?: WorkspaceRestoreView;
}

/** View-model for a `user_input_request` AG-UI event (ask_user, post-normalize). */
export interface AskUserView {
  requestId: string;
  agent: string;
  question: string;
  options?: string[];
  allowFreeText?: boolean;
  timeoutSec?: number;
  /** Explicit lifecycle state; old replay data defaults to pending. */
  status?: "pending" | "submitting" | "answered" | "cancelled";
  /** Set once the user has answered, so the card renders as resolved. */
  answer?: string;
  /** Why a request became unavailable without an answer. */
  cancellationReason?: "interrupted" | "evicted" | "restored" | "expired" | "agent_destroyed" | "stale";
}

/** View-model for an auto-retry indicator, surfaced from Pi `auto_retry_start`. */
export interface AutoRetryView {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason?: string;
  /** Set once cancelled / superseded, so the countdown stops. */
  cancelled?: boolean;
}

/** A predicate that decides whether a message should be hidden from display. */
export interface MessageFilterRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  /** Returns true if the message should be HIDDEN. */
  test: (msg: ChatMessage, allMessages: ChatMessage[]) => boolean;
}

/** Serializable filter configuration (for persistence / settings). */
export interface MessageFilterConfig {
  id: string;
  enabled: boolean;
}

// TraceParent, TraceArtifact, TraceTimestamp, AgentStatus, SessionStateSnapshot,
// SettingsData, McpServerEntry, ModelHealth, ProviderProfile — now imported from
// @brainpilot/protocol (see top).

export interface ProviderCreate {
  name: string;
  baseUrl: string;
  api?: ProviderApi;
  adapter?: ProviderAdapter;
  apiKey: string;
  models?: string[];
  contextWindow?: ProviderContextWindow;
  reasoningModels?: string[];
  icon?: string;
  iconColor?: string;
  notes?: string;
}

export interface ProviderUpdate {
  name?: string;
  baseUrl?: string;
  api?: ProviderApi;
  adapter?: ProviderAdapter;
  apiKey?: string;
  models?: string[];
  /** null clears an explicit preset and restores automatic resolution. */
  contextWindow?: ProviderContextWindow | null;
  reasoningModels?: string[];
  icon?: string;
  iconColor?: string;
  notes?: string;
}

// TraceNodeStatus, TraceNode, TraceGraph — now imported from @brainpilot/protocol (see top).

export type SessionMessagePart =
  | string
  | { type?: "text"; text?: string }
  | { type?: "thinking"; thinking?: string }
  | { type?: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type?: "tool_result"; tool_use_id?: string; content?: unknown; is_error?: boolean };

export interface SessionMessageEntry {
  type: string;
  timestamp?: string;
  uuid?: string;
  isMeta?: boolean;
  sourceToolUseID?: string;
  message?: {
    role?: string;
    content?: string | SessionMessagePart[];
    agent?: string;
  };
}

// TODO(dead-code): SessionEventsResponse / SessionEventEntry / normalizeSessionEvent
// are leftovers from the pre-AG-UI polling protocol (removed in 2026-05-18).
// Kept commented out for now; will be fully deleted once issue-4 fallback removal lands.
// export interface SessionEventsResponse {
//   events: SessionEventEntry[];
//   nextOffset: number;
//   hasMore: boolean;
// }
//
// export interface SessionEventEntry {
//   seq: number;
//   timestamp: string;
//   type: string;
//   sessionId?: string;
//   data: Record<string, unknown>;
// }

/**
 * AG-UI message shape (as it appears in MESSAGES_SNAPSHOT.messages).
 * Mirrors `Message` in /root/ag-ui/sdks/typescript/packages/core/src/types.ts.
 */
export interface AgUiMessage {
  id: string;
  role: string;
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  toolCallId?: string;
  error?: boolean;
  // MAS extension: source agent for this message. Populated by `fold.py` for
  // MESSAGES_SNAPSHOT so refreshes preserve Expert attribution. Camelized
  // automatically from the wire's `agent_name` by `normalizeAgUiEvent`.
  agentName?: string;
  // MAS extension: true iff fold.py saw `*_START` but no matching `*_END`
  // (and no `RUN_FINISHED/RUN_ERROR` terminator). Used by the snapshot path to
  // resume the streaming indicator on the in-progress message after refresh.
  unfinished?: boolean;
  // MAS extension: message kind for snapshot path parity with live path.
  kind?: string;
  hookFamily?: string;
  hookPhase?: string;
  hookLevel?: string;
  hookData?: Record<string, unknown>;
}

/**
 * AG-UI canonical event. Flat shape — no `data` wrapper. Field set varies by
 * `type`; consumers should narrow before accessing event-specific fields.
 *
 * The full AG-UI EventType enum is defined upstream
 * (`/root/ag-ui/sdks/typescript/packages/core/src/events.ts`); we only model
 * the subset we emit.
 */
export interface AgUiEvent {
  type: string;
  runId?: string;
  threadId?: string;
  sessionId?: string;
  agentName?: string;

  // Text/reasoning messages
  messageId?: string;
  role?: string;
  delta?: string;

  // Tool calls
  toolCallId?: string;
  toolCallName?: string;
  parentMessageId?: string;
  content?: string;       // TOOL_CALL_RESULT
  isError?: boolean;

  // RUN_*
  message?: string;       // RUN_ERROR
  code?: string;          // RUN_ERROR
  terminal?: boolean;     // RUN_ERROR: false while an outer retry loop owns recovery
  result?: unknown;       // RUN_FINISHED
  parentRunId?: string;

  // MESSAGES_SNAPSHOT
  messages?: AgUiMessage[];

  // CUSTOM
  name?: string;
  value?: unknown;

  // Forward-compatible extras
  [extra: string]: unknown;
}

/**
 * Back-compat alias — components historically import `WebSocketEvent`. We keep
 * the name as an alias of `AgUiEvent` so the rest of the codebase compiles
 * without a sweeping rename.
 */
export type WebSocketEvent = AgUiEvent;

interface RawUser {
  id?: string;
  username?: string;
  created_at?: string;
  createdAt?: string;
}

interface RawToken {
  access_token?: string;
  accessToken?: string;
  token_type?: string;
  tokenType?: string;
  user?: RawUser;
}

interface RawSandbox {
  id?: string;
  name?: string;
  sandbox_name?: string;
  status?: string;
  port?: number | null;
  user_id?: string;
  userId?: string;
  created_at?: string;
  createdAt?: string;
  container_name?: string;
  containerName?: string;
  host_api_url?: string;
  hostApiUrl?: string;
}

interface RawSession {
  id?: string;
  title?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  domain_resources?: unknown;
  domainResources?: unknown;
  thinking_level?: unknown;
  thinkingLevel?: unknown;
  reasoning_supported?: unknown;
  reasoningSupported?: unknown;
  provider_id?: unknown;
  providerId?: unknown;
  model_id?: unknown;
  modelId?: unknown;
}

interface RawFileEntry {
  name?: string;
  type?: string;
  size?: number;
  modified?: number | string;
  permissions?: string;
}

interface RawSettingsData {
  model?: string;
  api_key?: string;
  apiKey?: string;
  base_url?: string;
  baseUrl?: string;
}

interface RawModelHealth {
  model?: string;
  status?: string;
  latency_ms?: number;
  latencyMs?: number;
  checked_at?: number;
  checkedAt?: number;
  error?: string;
}

interface RawProviderProfile {
  id?: string;
  name?: string;
  base_url?: string;
  baseUrl?: string;
  api?: string;
  adapter?: string;
  models?: string[];
  context_window?: number;
  contextWindow?: number;
  reasoning_models?: string[];
  reasoningModels?: string[];
  icon?: string;
  icon_color?: string;
  iconColor?: string;
  notes?: string;
  is_active?: boolean;
  isActive?: boolean;
  is_shared?: boolean;
  isShared?: boolean;
  api_key_masked?: string;
  apiKeyMasked?: string;
  created_at?: number;
  createdAt?: number;
  updated_at?: number;
  updatedAt?: number;
  health_status?: string;
  healthStatus?: string;
  health_checked_at?: number;
  healthCheckedAt?: number;
  model_health?: RawModelHealth[];
  modelHealth?: RawModelHealth[];
}

type Dict = Record<string, unknown>;

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isoValue(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : new Date().toISOString();
}

function asDict(value: unknown): Dict {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {};
}

function asOptionalUnknownRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asOptionalRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function camelizeKey(key: string): string {
  // Preserve a leading-underscore prefix: `_ts` / `_seq` / `_event_id` are
  // AG-UI transport metadata whose underscore is significant. Without this guard the regex
  // turns `_ts` into `Ts`, so `normalizeAgUiEvent` strips the timestamp and the
  // demo replay's timeline collapses (every event lands at ms=0). Only internal
  // snake_case boundaries (e.g. `agent_name` → `agentName`) are camelized.
  const lead = key.match(/^_+/)?.[0] ?? "";
  const rest = key.slice(lead.length);
  return lead + rest.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
}

function camelizeObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(camelizeObject);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Dict).map(([key, nested]) => [camelizeKey(key), camelizeObject(nested)]),
  );
}

export function normalizeUser(raw: RawUser): User {
  const username = stringValue(raw.username, "user");
  return {
    id: stringValue(raw.id, username),
    username,
    createdAt: isoValue(raw.createdAt ?? raw.created_at),
  };
}

export function normalizeToken(raw: RawToken): AuthToken {
  return {
    accessToken: stringValue(raw.accessToken ?? raw.access_token),
    tokenType: stringValue(raw.tokenType ?? raw.token_type, "bearer"),
    user: normalizeUser(raw.user ?? {}),
  };
}

export function normalizeSandbox(raw: RawSandbox): Sandbox {
  return {
    id: stringValue(raw.id),
    name: stringValue(raw.name ?? raw.sandbox_name, "default"),
    status: stringValue(raw.status, "stopped"),
    port: typeof raw.port === "number" ? raw.port : null,
    userId: stringValue(raw.userId ?? raw.user_id),
    createdAt: isoValue(raw.createdAt ?? raw.created_at),
    containerName: optionalString(raw.containerName ?? raw.container_name),
    hostApiUrl: optionalString(raw.hostApiUrl ?? raw.host_api_url),
  };
}

export function normalizeSandboxStats(rawValue: unknown): SandboxStats {
  const raw = asDict(rawValue);
  const memory = asDict(raw.memory);
  const cpu = asDict(raw.cpu);
  const pids = asDict(raw.pids);
  const disk = asDict(raw.disk);
  const gpu = raw.gpu === null || raw.gpu === undefined ? null : asDict(raw.gpu);

  return {
    sandboxId: stringValue(raw.sandboxId ?? raw.sandbox_id),
    sandboxName: stringValue(raw.sandboxName ?? raw.sandbox_name, "default"),
    status: stringValue(raw.status, "stopped"),
    memory: {
      usedBytes: numberValue(memory.usedBytes ?? memory.used_bytes),
      limitBytes: numberValue(memory.limitBytes ?? memory.limit_bytes),
      percent: numberValue(memory.percent),
    },
    cpu: {
      usedPercent: numberValue(cpu.usedPercent ?? cpu.used_percent),
      quotaPercent: numberValue(cpu.quotaPercent ?? cpu.quota_percent),
      onlineCpus: numberValue(cpu.onlineCpus ?? cpu.online_cpus),
    },
    pids: {
      current: numberValue(pids.current),
      limit: typeof pids.limit === "number" ? pids.limit : null,
    },
    disk: {
      workspaceUsedBytes: numberValue(disk.workspaceUsedBytes ?? disk.workspace_used_bytes),
      quotaBytes: numberValue(disk.quotaBytes ?? disk.quota_bytes),
      percentOfQuota: numberValue(disk.percentOfQuota ?? disk.percent_of_quota),
    },
    gpu: gpu
      ? {
          name: optionalString(gpu.name),
          memoryUsedBytes: numberValue(gpu.memoryUsedBytes ?? gpu.memory_used_bytes),
          memoryTotalBytes: numberValue(gpu.memoryTotalBytes ?? gpu.memory_total_bytes),
          utilizationPercent: numberValue(gpu.utilizationPercent ?? gpu.utilization_percent),
        }
      : null,
  };
}

export function normalizeFileEntry(raw: RawFileEntry): FileEntry {
  const modified = typeof raw.modified === "string" ? Number(raw.modified) : raw.modified;
  return {
    name: stringValue(raw.name),
    type: raw.type === "folder" || raw.type === "symlink" ? raw.type : "file",
    size: numberValue(raw.size),
    modified: numberValue(modified),
    permissions: stringValue(raw.permissions, ""),
  };
}

export function normalizeFileContent(rawValue: unknown): FileContent {
  const raw = asDict(rawValue);
  return {
    path: stringValue(raw.path),
    content: stringValue(raw.content),
    size: numberValue(raw.size),
  };
}

export function normalizeSession(raw: RawSession): Session {
  const id = stringValue(raw.id);
  return {
    id,
    title: stringValue(raw.title, id ? `Session ${id.slice(0, 8)}` : "Untitled session"),
    createdAt: isoValue(raw.createdAt ?? raw.created_at),
    updatedAt: isoValue(raw.updatedAt ?? raw.updated_at ?? raw.createdAt ?? raw.created_at),
    domainResources:
      (raw.domainResources ?? raw.domain_resources) === "base" ? "base" : "full",
    thinkingLevel: ["off", "low", "medium", "high"].includes(String(raw.thinkingLevel ?? raw.thinking_level))
      ? (raw.thinkingLevel ?? raw.thinking_level) as Session["thinkingLevel"]
      : "medium",
    reasoningSupported: typeof (raw.reasoningSupported ?? raw.reasoning_supported) === "boolean"
      ? (raw.reasoningSupported ?? raw.reasoning_supported) as boolean
      : undefined,
    providerId: optionalString(raw.providerId ?? raw.provider_id),
    modelId: optionalString(raw.modelId ?? raw.model_id),
  };
}

export function normalizeSettings(raw: RawSettingsData): SettingsData {
  return {
    model: stringValue(raw.model),
    apiKey: stringValue(raw.apiKey ?? raw.api_key),
    baseUrl: stringValue(raw.baseUrl ?? raw.base_url),
  };
}
export function serializeSettings(data: Partial<SettingsData>): Record<string, string> {
  return {
    ...(data.model !== undefined ? { model: data.model } : {}),
    ...(data.apiKey !== undefined ? { api_key: data.apiKey } : {}),
    ...(data.baseUrl !== undefined ? { base_url: data.baseUrl } : {}),
  };
}


/**
 * #377: BYOK annotation on a preset entry. Dropped when malformed — a preset whose
 * `byok.kind` is missing has nothing to key the hosted endpoints by, so it should
 * render as a plain read-only preset rather than a BYOK card wired to `undefined`.
 */
function normalizeMcpByok(rawValue: unknown): McpByokInfo | undefined {
  if (!rawValue || typeof rawValue !== "object") return undefined;
  const raw = asDict(rawValue);
  const kind = stringValue(raw.kind).trim();
  if (!kind) return undefined;
  const keyParam = optionalString(raw.keyParam ?? raw.key_param)?.trim() || undefined;
  const keyHeader = optionalString(raw.keyHeader ?? raw.key_header)?.trim() || undefined;
  // Mirror McpByokInfoSchema: accepting both would hide a hosted contract bug by
  // silently guessing which injection point should win.
  if (keyParam && keyHeader) return undefined;
  return {
    kind,
    ...(keyParam ? { keyParam } : {}),
    ...(keyHeader ? { keyHeader } : {}),
  };
}

export function normalizeMcpServer(rawValue: unknown): McpServerEntry {
  const raw = asDict(rawValue);
  return {
    name: stringValue(raw.name),
    type: raw.type === "stdio" || raw.type === "sse" ? raw.type : "http",
    command: optionalString(raw.command),
    args: Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : undefined,
    env: asOptionalRecord(raw.env),
    url: optionalString(raw.url),
    headers: asOptionalRecord(raw.headers),
    timeout: optionalNumber(raw.timeout),
    readOnly: raw.readOnly === true || raw.read_only === true ? true : undefined,
    byok: normalizeMcpByok(raw.byok),
  };
}

/** #377: one row of `GET /api/mcp-servers/byok` (hosted deployments only). */
export interface McpByokStatus {
  kind: string;
  presetName: string;
  configured: boolean;
}

export function normalizeMcpByokStatus(rawValue: unknown): McpByokStatus {
  const raw = asDict(rawValue);
  return {
    // Trimmed to match `normalizeMcpByok`'s handling of `byok.kind` — the two are
    // compared to decide whether a preset gets a card, so a stray space on either
    // side would silently fail the match and drop the card.
    kind: stringValue(raw.kind).trim(),
    presetName: stringValue(raw.presetName ?? raw.preset_name),
    configured: Boolean(raw.configured),
  };
}

export function serializeMcpConfig(config: Omit<McpServerEntry, "name">): Record<string, unknown> {
  // #377: `readOnly` / `byok` are platform-injected annotations, never client
  // input — the backend strips them anyway, but don't pretend to send them.
  const { readOnly: _readOnly, byok: _byok, ...transport } = config;
  return Object.fromEntries(Object.entries(transport).filter(([, value]) => value !== undefined && value !== ""));
}

function normalizeModelHealth(raw: RawModelHealth | undefined): ModelHealth {
  if (!raw || typeof raw !== "object") {
    return { model: "", status: "unknown" };
  }
  return {
    model: stringValue(raw.model),
    status: (raw.status as ModelHealth["status"]) || "unknown",
    latencyMs: optionalNumber(raw.latencyMs ?? raw.latency_ms),
    checkedAt: optionalNumber(raw.checkedAt ?? raw.checked_at),
    error: optionalString(raw.error),
  };
}

export function normalizeProviderProfile(raw: RawProviderProfile): ProviderProfile {
  const modelHealthRaw = Array.isArray(raw.modelHealth)
    ? raw.modelHealth
    : Array.isArray(raw.model_health)
      ? raw.model_health
      : [];
  return {
    id: stringValue(raw.id),
    name: stringValue(raw.name),
    baseUrl: stringValue(raw.baseUrl ?? raw.base_url),
    api: (raw.api ?? "anthropic-messages") as ProviderApi,
    adapter: (raw.adapter ?? "auto") as ProviderAdapter,
    isShared: Boolean(raw.isShared ?? raw.is_shared),
    models: Array.isArray(raw.models) ? raw.models : [],
    contextWindow: (raw.contextWindow ?? raw.context_window) as ProviderContextWindow | undefined,
    reasoningModels: Array.isArray(raw.reasoningModels)
      ? raw.reasoningModels
      : Array.isArray(raw.reasoning_models) ? raw.reasoning_models : (Array.isArray(raw.models) ? raw.models : []),
    icon: stringValue(raw.icon, "circle"),
    iconColor: stringValue(raw.iconColor ?? raw.icon_color, "#111111"),
    notes: stringValue(raw.notes),
    isActive: Boolean(raw.isActive ?? raw.is_active),
    apiKeyMasked: stringValue(raw.apiKeyMasked ?? raw.api_key_masked),
    createdAt: numberValue(raw.createdAt ?? raw.created_at),
    updatedAt: numberValue(raw.updatedAt ?? raw.updated_at),
    healthStatus: (raw.healthStatus ?? raw.health_status ?? "unknown") as ProviderProfile["healthStatus"],
    healthCheckedAt: optionalNumber(raw.healthCheckedAt ?? raw.health_checked_at),
    modelHealth: modelHealthRaw.map(normalizeModelHealth),
  };
}

export function serializeProviderCreate(data: ProviderCreate): Record<string, unknown> {
  return {
    name: data.name,
    base_url: data.baseUrl,
    api: data.api,
    adapter: data.adapter,
    api_key: data.apiKey,
    models: data.models,
    context_window: data.contextWindow,
    reasoning_models: data.reasoningModels,
    icon: data.icon,
    icon_color: data.iconColor,
    notes: data.notes,
  };
}

export function serializeProviderUpdate(data: ProviderUpdate): Record<string, unknown> {
  return {
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.baseUrl !== undefined ? { base_url: data.baseUrl } : {}),
    ...(data.api !== undefined ? { api: data.api } : {}),
    ...(data.adapter !== undefined ? { adapter: data.adapter } : {}),
    ...(data.apiKey !== undefined ? { api_key: data.apiKey } : {}),
    ...(data.models !== undefined ? { models: data.models } : {}),
    ...(data.contextWindow !== undefined ? { context_window: data.contextWindow } : {}),
    ...(data.reasoningModels !== undefined ? { reasoning_models: data.reasoningModels } : {}),
    ...(data.icon !== undefined ? { icon: data.icon } : {}),
    ...(data.iconColor !== undefined ? { icon_color: data.iconColor } : {}),
    ...(data.notes !== undefined ? { notes: data.notes } : {}),
  };
}

export function normalizeTraceNode(rawValue: unknown): TraceNode {
  const raw = asDict(rawValue);
  // Materialized GET responses expose confirmed parents through `parents` for
  // V1 consumers and the complete V2 review state through `causalParents`.
  // Prefer the canonical collection when present so refresh does not discard
  // candidate, uncertain, or rejected edges that live deltas can still show.
  const canonicalParents = raw.causalParents ?? raw.causal_parents;
  const parentValues = Array.isArray(canonicalParents) ? canonicalParents : raw.parents;
  const parents = Array.isArray(parentValues)
    ? parentValues.map((parent) => {
        const item = asDict(parent);
        const canonicalId = stringValue(item.nodeId ?? item.node_id);
        const conclusion = optionalString(item.conclusion);
        return {
          id: stringValue(item.id, canonicalId),
          relation: optionalString(item.relation) ?? (canonicalId ? "depends_on" : undefined),
          explanation: optionalString(item.explanation ?? item.reason),
          edgeType: optionalString(item.edgeType ?? item.edge_type) ?? conclusion,
        };
      }).filter((parent) => parent.id)
    : [];
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map((artifact) => {
        const item = asDict(artifact);
        return {
          path: stringValue(item.path),
          type: optionalString(item.type),
        };
      }).filter((artifact) => artifact.path)
    : [];
  const description = optionalString(raw.description);
  const timestamp = asDict(raw.timestamp);
  const parentIds = normalizeStringArray(raw.parentIds ?? raw.parent_ids);
  const checkpoints = Array.isArray(raw.checkpoints)
    ? raw.checkpoints.map((value) => {
        const item = asDict(value);
        const stats = asDict(item.stats);
        return {
          id: stringValue(item.id),
          commitId: optionalString(item.commitId ?? item.commit_id),
          status: stringValue(item.status, "failed") as TraceCheckpointRef["status"],
          capturedAt: stringValue(item.capturedAt ?? item.captured_at),
          sourceAgent: optionalString(item.sourceAgent ?? item.source_agent),
          baseCheckpointId: optionalString(item.baseCheckpointId ?? item.base_checkpoint_id),
          stats: Object.keys(stats).length > 0 ? {
            files: optionalNumber(stats.files) ?? 0,
            added: optionalNumber(stats.added) ?? 0,
            modified: optionalNumber(stats.modified) ?? 0,
            deleted: optionalNumber(stats.deleted) ?? 0,
            renamed: optionalNumber(stats.renamed) ?? 0,
          } : undefined,
          skippedCount: optionalNumber(item.skippedCount ?? item.skipped_count) ?? 0,
          error: optionalString(item.error),
        };
      }).filter((item) => item.id)
    : undefined;
  return {
    id: stringValue(raw.id ?? raw.node_id),
    title: stringValue(raw.title, stringValue(raw.id ?? raw.node_id, "Trace node")),
    type: stringValue(raw.type ?? raw.node_type, "step"),
    nodeType: optionalString(raw.nodeType ?? raw.node_type),
    status: stringValue(raw.status, "done"),
    agent: optionalString(raw.agent ?? raw.agent_name),
    description,
    summary: optionalString(raw.summary) ?? description,
    content: optionalString(raw.content) ?? description,
    reason: optionalString(raw.reason),
    context: optionalString(raw.context),
    parents,
    artifacts,
    parentIds: parentIds.length ? parentIds : parents.map((parent) => parent.id),
    childIds: normalizeStringArray(raw.childIds ?? raw.child_ids),
    createdAt: optionalString(raw.createdAt ?? raw.created_at),
    updatedAt: optionalString(raw.updatedAt ?? raw.updated_at),
    timestamp: {
      createdAt: optionalString(timestamp.createdAt ?? timestamp.created_at),
      startedAt: optionalString(timestamp.startedAt ?? timestamp.started_at),
      completedAt: optionalString(timestamp.completedAt ?? timestamp.completed_at),
    },
    durationMs: optionalNumber(raw.durationMs ?? raw.duration_ms),
    errorMessage: optionalString(raw.errorMessage ?? raw.error_message),
    toolCalls: normalizeStringArray(raw.toolCalls ?? raw.tool_calls),
    checkpoints,
    artifactIds: normalizeStringArray(raw.artifactIds ?? raw.artifact_ids),
    primaryEpisodeId: optionalString(raw.primaryEpisodeId ?? raw.primary_episode_id),
    episodeTags: normalizeStringArray(raw.episodeTags ?? raw.episode_tags),
    metadata: asOptionalUnknownRecord(raw.metadata),
    records: Array.isArray(raw.records) ? camelizeObject(raw.records) as TraceNodeRecord[] : undefined,
    causalParents: Array.isArray(raw.causalParents ?? raw.causal_parents)
      ? camelizeObject(raw.causalParents ?? raw.causal_parents) as TraceCausalParent[]
      : undefined,
    executionResult: raw.executionResult === "failed" || raw.execution_result === "failed" ? "failed" : "completed",
    revoked: raw.revoked === true,
    confidence: raw.confidence === "low" || raw.confidence === "medium" || raw.confidence === "high"
      ? raw.confidence
      : undefined,
    confidenceReason: optionalString(raw.confidenceReason ?? raw.confidence_reason),
    reviewConclusion: typeof (raw.reviewConclusion ?? raw.review_conclusion) === "string"
      ? (raw.reviewConclusion ?? raw.review_conclusion) as TraceNode["reviewConclusion"]
      : "unreviewed",
    reviewReason: optionalString(raw.reviewReason ?? raw.review_reason),
  };
}

/**
 * Normalize a wire SessionState (snake_case) into the camelCase frontend
 * shape. Used by `api.sessions.state()` and by the `CUSTOM:session_state`
 * SSE event consumer.
 */
export function normalizeSessionState(rawValue: unknown): SessionStateSnapshot {
  const raw = asDict(rawValue);
  const camelized = camelizeObject(raw) as Record<string, unknown>;
  const rs = (camelized.runState ?? {}) as Record<string, unknown>;
  const ws = (camelized.workState ?? {}) as Record<string, unknown>;
  const agentsRaw = Array.isArray(camelized.agents) ? camelized.agents : [];
  const agents: AgentStatus[] = agentsRaw.map((entry) => {
    const a = asDict(entry);
    const retry = asDict(a.retry);
    const attempt = optionalNumber(retry.attempt);
    const maxAttempts = optionalNumber(retry.maxAttempts);
    const delayMs = optionalNumber(retry.delayMs);
    const normalized: AgentStatus = {
      name: stringValue(a.name),
      status: stringValue(a.status, "idle"),
      task: stringValue(a.task, ""),
      updatedAt: optionalString(a.updatedAt),
      alive: typeof a.alive === "boolean" ? a.alive : undefined,
      activeToolExecutions: Array.isArray(a.activeToolExecutions)
        ? a.activeToolExecutions.filter((id): id is string => typeof id === "string")
        : undefined,
      activeTools: Array.isArray(a.activeTools)
        ? a.activeTools.flatMap((value) => {
            const tool = asDict(value);
            const toolCallId = optionalString(tool.toolCallId);
            const toolName = optionalString(tool.toolName);
            const startedAt = optionalString(tool.startedAt);
            if (!toolCallId || !toolName || !startedAt) return [];
            return [{
              toolCallId,
              toolName,
              runId: optionalString(tool.runId),
              startedAt,
              cancellable: tool.cancellable === true,
              status: tool.status === "stopping" ? "stopping" as const : "running" as const,
            }];
          })
        : undefined,
    };
    if (attempt !== undefined && maxAttempts !== undefined && delayMs !== undefined) {
      normalized.retry = { attempt, maxAttempts, delayMs };
    }
    return normalized;
  });
  const subagentsRaw = Array.isArray(camelized.subagents) ? camelized.subagents : [];
  const subagents: SubagentStatus[] = subagentsRaw.map((entry) => {
    const child = asDict(entry);
    return {
      id: stringValue(child.id),
      parentAgent: stringValue(child.parentAgent),
      rootRunId: optionalString(child.rootRunId) ?? null,
      profile: stringValue(child.profile),
      label: stringValue(child.label),
      task: stringValue(child.task),
      status: stringValue(child.status, "interrupted") as SubagentStatus["status"],
      startedAt: optionalString(child.startedAt),
      finishedAt: optionalString(child.finishedAt),
      durationMs: optionalNumber(child.durationMs),
      resultSummary: optionalString(child.resultSummary),
      artifacts: normalizeStringArray(child.artifacts),
      error: optionalString(child.error),
    };
  });
  const out: SessionStateSnapshot = {
    runState: {
      active: rs.active === true,
      runId: optionalString(rs.runId) ?? null,
    },
    workState: {
      // Compatibility fallback for runtimes where runState was aggregate.
      active: typeof ws.active === "boolean" ? ws.active : rs.active === true,
    },
    agents,
    subagents,
    lastActivityTs: stringValue(camelized.lastActivityTs, ""),
    domainResources: camelized.domainResources === "base" ? "base" : "full",
  };
  const tokenUsage = normalizeSessionTokenUsage(camelized.tokenUsage);
  if (tokenUsage) out.tokenUsage = tokenUsage;
  return out;
}

/** Coerce one wire token-usage record into the numeric TokenUsage shape. */
function normalizeTokenUsage(rawValue: unknown): TokenUsage {
  const u = asDict(rawValue);
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    input: num(u.input),
    output: num(u.output),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    total: num(u.total),
  };
}

/** Parse the optional per-session token usage (total + per-agent breakdown). */
function normalizeSessionTokenUsage(rawValue: unknown): SessionTokenUsage | undefined {
  if (rawValue == null) return undefined;
  const raw = asDict(rawValue);
  const byAgentRaw = asDict(raw.byAgent);
  const byAgent: Record<string, TokenUsage> = {};
  for (const [name, value] of Object.entries(byAgentRaw)) {
    byAgent[name] = normalizeTokenUsage(value);
  }
  return { total: normalizeTokenUsage(raw.total), byAgent };
}


export function normalizeTraceGraph(rawValue: unknown): TraceGraph {
  const raw = asDict(rawValue);
  const meta = asDict(raw.meta);
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  const isCanonicalV2 = raw.schemaVersion === "2.0" && Array.isArray(raw.dependencies);
  const registry = new Map(
    (Array.isArray(raw.artifacts) ? raw.artifacts : []).map(asDict)
      .filter((artifact) => typeof artifact.id === "string")
      .map((artifact) => [artifact.id as string, artifact]),
  );
  const nodes = isCanonicalV2
    ? rawNodes.map((value) => {
        const node = asDict(value);
        const id = stringValue(node.id);
        // A materialized V2 compatibility response may already carry parents.
        if (Array.isArray(node.parents)) return normalizeTraceNode(node);
        const report = asDict(node.report);
        const artifactIds = normalizeStringArray(node.artifactIds ?? node.artifact_ids);
        const artifacts = artifactIds
          .map((artifactId) => registry.get(artifactId))
          .filter((artifact): artifact is Dict => Boolean(artifact))
          .map((artifact) => ({ path: artifact.path, type: artifact.type ?? artifact.kind }));
        const parents = [
          ...(Array.isArray(raw.dependencies) ? raw.dependencies : []).flatMap((edgeValue) => {
            const edge = asDict(edgeValue);
            const dependentId = stringValue(edge.dependentId ?? edge.dependent_id);
            const prerequisiteId = stringValue(edge.prerequisiteId ?? edge.prerequisite_id);
            if (dependentId !== id || !prerequisiteId || edge.state === "rejected") return [];
            return [{ id: prerequisiteId, relation: "depends_on", explanation: edge.reason, edgeType: edge.state }];
          }),
        ];
        return normalizeTraceNode({
          ...node,
          summary: report.summary,
          content: report.content,
          artifacts,
          parents,
        });
      })
    : rawNodes.map(normalizeTraceNode);
  const childIdsByParent = new Map<string, Set<string>>();
  for (const node of nodes) {
    for (const parentId of node.parentIds) {
      const children = childIdsByParent.get(parentId) ?? new Set<string>();
      children.add(node.id);
      childIdsByParent.set(parentId, children);
    }
  }
  const dependencies = Array.isArray(raw.dependencies)
    ? camelizeObject(raw.dependencies) as TraceDependency[]
    : undefined;
  const episodes = Array.isArray(raw.episodes)
    ? camelizeObject(raw.episodes) as TraceEpisode[]
    : undefined;
  const traceArtifacts = Array.isArray(raw.artifacts)
    ? camelizeObject(raw.artifacts) as TraceArtifactV2[]
    : undefined;
  return {
    ...(raw.schemaVersion === "2.0" ? { schemaVersion: "2.0" as const } : {}),
    ...(typeof raw.revision === "number" && Number.isFinite(raw.revision) ? { revision: Math.max(0, Math.trunc(raw.revision)) } : {}),
    meta: {
      ...(camelizeObject(meta) as Record<string, unknown>),
      sessionId: stringValue(meta.sessionId ?? meta.session_id),
      userId: optionalString(meta.userId ?? meta.user_id),
      projectName: optionalString(meta.projectName ?? meta.project_name),
      currentFocus: optionalString(meta.currentFocus ?? meta.current_focus),
      createdAt: optionalString(meta.createdAt ?? meta.created_at),
    },
    nodes: nodes.map((node) => ({
      ...node,
      childIds: node.childIds.length ? node.childIds : Array.from(childIdsByParent.get(node.id) ?? []),
    })),
    ...(dependencies ? { dependencies } : {}),
    ...(episodes ? { episodes } : {}),
    ...(traceArtifacts ? { artifacts: traceArtifacts } : {}),
  };
}

// TODO(dead-code): normalizeSessionEvent is a leftover from the pre-AG-UI polling protocol.
// Kept commented out for now; will be fully deleted once issue-4 fallback removal lands.
// export function normalizeSessionEvent(rawValue: unknown): SessionEventEntry {
//   const raw = asDict(rawValue);
//   const seq = numberValue(raw._seq ?? raw.seq, -1);
//   const timestamp = stringValue(raw._ts ?? raw.timestamp, new Date().toISOString());
//   const type = stringValue(raw.type, "unknown");
//   const sessionId = optionalString(raw.session_id ?? raw.sessionId);
//   const data = { ...raw };
//   delete data._seq;
//   delete data.seq;
//   delete data._ts;
//   delete data.timestamp;
//   delete data.type;
//   delete data.session_id;
//   delete data.sessionId;
//
//   return {
//     seq,
//     timestamp,
//     type,
//     sessionId,
//     data: camelizeObject(data) as Dict,
//   };
// }

/**
 * Normalize a raw AG-UI event JSON from the wire (snake_case) to the
 * camelCase TypeScript shape. Fields are passed through 1:1, including
 * leading-underscore transport metadata (`_ts`, `_seq`, `_eventId`).
 */
export function normalizeAgUiEvent(rawValue: unknown): AgUiEvent {
  const raw = asDict(rawValue);
  // The whole payload is flat — camelize every key, including nested messages.
  const camelized = camelizeObject(raw) as Record<string, unknown>;
  return camelized as AgUiEvent;
}

/** Back-compat alias for callers still using the old name. */
export const normalizeWebSocketEvent = normalizeAgUiEvent;

// TODO(dead-code): makeUserMessage is unused; remove once confirmed safe.
// export function makeUserMessage(content: string, sessionId: string): ChatMessage {
//   return {
//     id: crypto.randomUUID(),
//     role: "user",
//     content,
//     createdAt: new Date().toISOString(),
//     agent: "user",
//   };
// }
