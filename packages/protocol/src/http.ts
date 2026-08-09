/**
 * Runtime "对外 HTTP 契约" — the HTTP surface every consumer (backend-core
 * proxy, gateway, CLI client) depends on. Source: TS_PI_REFACTOR_DESIGN.md
 * §6 (修正2), §10, §15.4.
 *
 * Each endpoint has zod request/response schemas + inferred types, plus a
 * `RUNTIME_ROUTES` catalog (method + path template) so backend/runtime/client
 * share one definition. Path params use `:id` style.
 *
 * §15.4 endpoint table:
 *   GET  /health
 *   GET  /metrics                         (修正2)
 *   GET/POST/DELETE /sessions*            (CRUD / list / state)
 *   POST /sessions/{id}/messages
 *   GET  /sse/{sessionId}                 (AG-UI event stream, byte passthrough)
 *   POST /sessions/{id}/interrupt
 *   GET  /sessions/{id}/agents            (§10 polling fallback)
 *   POST /sessions/{id}/evict             (修正2)
 *
 * NOTE: §15.4 names the stream `GET /sse/{sessionId}`; the task brief lists it
 * as `GET /sessions/:id/events`. We expose BOTH path templates in the catalog
 * (`sessionEvents` = canonical `/sse/:id` per the authoritative §15.4 table;
 * `sessionEventsAlias` = `/sessions/:id/events`) so callers can pick. The
 * event payload schema (AgUiEvent) is identical for both.
 */
import { z } from "zod";
import { AgUiEventSchema } from "./events.js";
import {
  AgentStatusSchema,
  SessionSchema,
  SessionStateSnapshotSchema,
  SessionStatsSchema,
  TraceDependencySchema,
} from "./domain.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RouteDef {
  readonly method: HttpMethod;
  /** Path template with `:param` placeholders. */
  readonly path: string;
}

/* ------------------------------------------------------------------ *
 * GET /health
 * ------------------------------------------------------------------ */

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded", "error"]).or(z.string()),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/* ------------------------------------------------------------------ *
 * GET /metrics  (修正2 — idle 回收依据)
 * ------------------------------------------------------------------ */

export const MetricsResponseSchema = z.object({
  activeSessions: z.number(),
  runningAgents: z.number(),
  /** ISO8601 of last activity across all sessions; null if never active. */
  lastActivityAt: z.string().nullable(),
  /** Resident set size in bytes. */
  memRss: z.number(),
  /**
   * Container memory budget in bytes (BP_MEM_LIMIT_MB, §R-4). Null when the
   * opt-in budget is unset — i.e. single-user / no in-runtime throttle.
   */
  memLimitBytes: z.number().nullable(),
  /** memRss / memLimitBytes, or null when no budget is set. */
  memRatio: z.number().nullable(),
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

/* ------------------------------------------------------------------ *
 * PUT /runtime/capabilities  (backend-managed plugin capability sync)
 * ------------------------------------------------------------------ */

export const RuntimeCapabilitySchema = z.enum(["builtin.monitor", "builtin.backgroundJobs"]);
export type RuntimeCapability = z.infer<typeof RuntimeCapabilitySchema>;
export const RuntimeExtensionDescriptorSchema = z.object({
  pluginId: z.string().min(1), pluginVersion: z.string().min(1), entry: z.string().min(1),
  targets: z.array(z.string().min(1)).min(1),
  skillEntries: z.array(z.object({ entry: z.string().min(1), targets: z.array(z.string().min(1)).optional() }).strict()).optional(),
  permissions: z.array(z.enum(["read:workspace", "read:data", "compute:worker", "compute:container", "network", "process:background", "write:workspace", "execute:process", "workspace:checkpoint"])),
}).strict();
export type RuntimeExtensionDescriptor = z.infer<typeof RuntimeExtensionDescriptorSchema>;
export const SetRuntimeCapabilitiesRequestSchema = z.object({
  capabilities: z.array(RuntimeCapabilitySchema),
  runtimeExtensions: z.array(RuntimeExtensionDescriptorSchema).optional(),
});
export type SetRuntimeCapabilitiesRequest = z.infer<typeof SetRuntimeCapabilitiesRequestSchema>;

/* ------------------------------------------------------------------ *
 * POST /sessions  (create)
 * ------------------------------------------------------------------ */

export const CreateSessionRequestSchema = z.object({
  /** Optional caller-supplied title; runtime derives a default otherwise. */
  title: z.string().optional(),
  /** Optional caller-supplied id; runtime generates a UUID otherwise. */
  id: z.string().optional(),
  /** Optional provider profile id this session should use (providers.json). */
  providerId: z.string().optional(),
  /** Optional model id within that provider. */
  modelId: z.string().optional(),
  /** Per-session domain resources; omitted means full for backward compatibility. */
  domainResources: z.enum(["full", "base"]).optional(),
  /** Require Principal to delegate substantive work to an Expert in each user-work epoch. */
  workflowPolicy: z.enum(["direct", "expert_required"]).optional(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const CreateSessionResponseSchema = z.object({
  id: z.string(),
  session: SessionSchema.optional(),
});
export type CreateSessionResponse = z.infer<typeof CreateSessionResponseSchema>;

/* ------------------------------------------------------------------ *
 * GET /sessions  (list)  +  GET /sessions/:id  +  DELETE /sessions/:id
 * ------------------------------------------------------------------ */

export const ListSessionsResponseSchema = z.object({
  sessions: z.array(SessionSchema),
});
export type ListSessionsResponse = z.infer<typeof ListSessionsResponseSchema>;

export const GetSessionResponseSchema = SessionSchema;
export type GetSessionResponse = z.infer<typeof GetSessionResponseSchema>;

export const DeleteSessionResponseSchema = z.object({
  id: z.string(),
  deleted: z.boolean(),
});
export type DeleteSessionResponse = z.infer<typeof DeleteSessionResponseSchema>;

/* ------------------------------------------------------------------ *
 * GET /sessions/:id/state  (authoritative snapshot)
 * ------------------------------------------------------------------ */

export const GetSessionStateResponseSchema = SessionStateSnapshotSchema;
export type GetSessionStateResponse = z.infer<typeof GetSessionStateResponseSchema>;

/* ------------------------------------------------------------------ *
 * GET /sessions/:id/stats  (per-run + per-session usage stats)
 * ------------------------------------------------------------------ */

/**
 * Full stats snapshot: tokens (mirrors what `session_state` already ships)
 * plus per-agent tool/skill/error counters and a per-run delta timeline.
 * See `SessionStatsSchema` in domain.ts for the shape.
 */
export const GetSessionStatsResponseSchema = SessionStatsSchema;
export type GetSessionStatsResponse = z.infer<typeof GetSessionStatsResponseSchema>;

export const TraceDependencyDecisionRequestSchema = z.object({
  decision: z.enum(["accept", "reject"]),
  reason: z.string().optional(),
});
export type TraceDependencyDecisionRequest = z.infer<typeof TraceDependencyDecisionRequestSchema>;
export const TraceDependencyDecisionResponseSchema = TraceDependencySchema;
export type TraceDependencyDecisionResponse = z.infer<typeof TraceDependencyDecisionResponseSchema>;
export const TraceStateTokenRequestSchema = z.object({ stateToken: z.string().min(1) });
export type TraceStateTokenRequest = z.infer<typeof TraceStateTokenRequestSchema>;

/* ------------------------------------------------------------------ *
 * POST /sessions/:id/messages  (inject user message)
 * ------------------------------------------------------------------ */

/** A normal user message injected into the session. */
export const SendMessageContentSchema = z.object({
  content: z.string(),
  /** Target agent; defaults to principal. */
  agent: z.string().optional(),
  /**
   * Optional client-supplied metadata (issue #42). The web composer sends the
   * `uuid` it used for the optimistic user bubble so the runtime can persist a
   * matching `TEXT_MESSAGE_CHUNK` (role:"user") under the same id — on reload
   * the replayed event dedupes against the optimistic one by id rather than
   * duplicating it.
   */
  data: z
    .object({
      uuid: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .optional(),
});

/** A reply to an outstanding ask_user (user_input_request) — see events.ts. */
export const UserInputResponseBodySchema = z.object({
  type: z.literal("user_input_response"),
  session_id: z.string(),
  request_id: z.string(),
  answer: z.string().trim().min(1).max(10_000),
});

/**
 * POST /sessions/:id/messages accepts EITHER a normal message OR an ask_user
 * reply. The answer body is matched by its `type` literal; everything else is
 * treated as a content message.
 */
export const SendMessageRequestSchema = z.union([
  UserInputResponseBodySchema,
  SendMessageContentSchema,
]);
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;
export type UserInputResponseBody = z.infer<typeof UserInputResponseBodySchema>;

export const SendMessageResponseSchema = z.object({
  accepted: z.boolean(),
  /** Run id started/queued for this message, if synchronously known. */
  runId: z.string().optional(),
  /** True when Pi accepted the message into an in-flight follow-up queue. */
  queued: z.boolean().optional(),
});
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

/* ------------------------------------------------------------------ *
 * GET /sse/:id  (AG-UI event stream — each SSE `data:` is one AgUiEvent)
 * ------------------------------------------------------------------ */

/** Schema for a single decoded SSE frame payload. Byte-level proxies do not
 * use this; clients that parse events do. */
export const SseEventFrameSchema = AgUiEventSchema;
export type SseEventFrame = z.infer<typeof SseEventFrameSchema>;

/* ------------------------------------------------------------------ *
 * POST /sessions/:id/interrupt
 * ------------------------------------------------------------------ */

export const InterruptRequestSchema = z.object({
  /** Optional specific agent to interrupt; omit to interrupt the session. */
  agent: z.string().optional(),
});
export type InterruptRequest = z.infer<typeof InterruptRequestSchema>;

export const InterruptResponseSchema = z.object({
  interrupted: z.boolean(),
  scope: z.enum(["session", "agent", "tool"]).optional(),
  toolCallId: z.string().optional(),
  reason: z.enum(["already_idle", "already_finished", "not_cancellable", "timeout"]).optional(),
});
export type InterruptResponse = z.infer<typeof InterruptResponseSchema>;

export const InterruptToolResponseSchema = z.object({
  interrupted: z.boolean(),
  toolCallId: z.string(),
  reason: z.enum(["already_finished", "not_cancellable", "timeout"]).optional(),
});
export type InterruptToolResponse = z.infer<typeof InterruptToolResponseSchema>;

/* ------------------------------------------------------------------ *
 * POST /sessions/:id/files  (#47 — upload a file into the workspace)
 * ------------------------------------------------------------------ *
 * Two accepted request shapes, negotiated by `Content-Type` (#256):
 *   1. base64 JSON — `application/json` body `{ path, contentBase64 }`
 *      (this schema). Whole payload is buffered in memory; +33% wire
 *      inflation. Kept for backward compatibility / small files.
 *   2. raw stream — `application/octet-stream` body is the file bytes
 *      verbatim, with the workspace-relative path in the `?path=` query
 *      (e.g. `POST /sessions/:id/files?path=docs/foo.pdf`). Streamed to
 *      disk, symmetric with the `readRawFile` download. Preferred for
 *      large uploads.
 * Both return `WriteFileResponseSchema` and enforce the same traversal
 * guard + size cap (`BP_UPLOAD_MAX_BYTES`, default 1 GiB). */

/** #47: base64 JSON upload body. Content is base64 (binary-safe over the JSON byte chain). */
export const WriteFileRequestSchema = z.object({
  /** Workspace-relative path (a leading `/workspace` prefix is tolerated). */
  path: z.string().trim().min(1),
  /** File contents, base64-encoded. */
  contentBase64: z.string(),
});
export type WriteFileRequest = z.infer<typeof WriteFileRequestSchema>;

export const WriteFileResponseSchema = z.object({
  path: z.string(),
  size: z.number(),
});
export type WriteFileResponse = z.infer<typeof WriteFileResponseSchema>;

/* ------------------------------------------------------------------ *
 * GET /sessions/:id/agents  (§10 polling fallback)
 * ------------------------------------------------------------------ */

export const ListAgentsResponseSchema = z.object({
  agents: z.array(AgentStatusSchema),
});
export type ListAgentsResponse = z.infer<typeof ListAgentsResponseSchema>;

/* ------------------------------------------------------------------ *
 * POST /sessions/:id/evict  (修正2 — release idle session memory)
 * ------------------------------------------------------------------ */

export const EvictSessionResponseSchema = z.object({
  evicted: z.boolean(),
  /** Number of agent subprocesses killed. */
  agentsKilled: z.number().optional(),
});
export type EvictSessionResponse = z.infer<typeof EvictSessionResponseSchema>;

/* ------------------------------------------------------------------ *
 * Route catalog — shared method + path templates
 * ------------------------------------------------------------------ */

export const RUNTIME_ROUTES = {
  health: { method: "GET", path: "/health" },
  metrics: { method: "GET", path: "/metrics" },
  setRuntimeCapabilities: { method: "PUT", path: "/runtime/capabilities" },
  mcpStatus: { method: "GET", path: "/mcp/status" },
  createSession: { method: "POST", path: "/sessions" },
  listSessions: { method: "GET", path: "/sessions" },
  getSession: { method: "GET", path: "/sessions/:id" },
  /** Update session metadata (currently just `title`); persists to meta.json. */
  updateSession: { method: "PUT", path: "/sessions/:id" },
  deleteSession: { method: "DELETE", path: "/sessions/:id" },
  getSessionState: { method: "GET", path: "/sessions/:id/state" },
  /**
   * Per-run + per-session usage stats (tokens + tool/skill/error counters).
   * Payload: `SessionStatsSchema`. Persisted alongside the session at
   * `<dataRoot>/.bp/<sid>/stats.json`.
   */
  getSessionStats: { method: "GET", path: "/sessions/:id/stats" },
  /** Graph of Trace (reasoning DAG) for a session. */
  getTrace: { method: "GET", path: "/sessions/:id/trace" },
  getTraceChanges: { method: "GET", path: "/sessions/:id/trace/changes" },
  getAuditReports: { method: "GET", path: "/sessions/:id/audits" },
  decideTraceDependency: { method: "POST", path: "/sessions/:id/trace/dependencies/:dependencyId/decision" },
  getTraceNodeCheckpoints: { method: "GET", path: "/sessions/:id/trace/nodes/:nodeId/checkpoints" },
  getTraceCausalRollbackPreview: { method: "GET", path: "/sessions/:id/trace/nodes/:nodeId/rollback-preview" },
  rollbackTraceNode: { method: "POST", path: "/sessions/:id/trace/nodes/:nodeId/rollback" },
  getTraceCheckpointDiff: { method: "GET", path: "/sessions/:id/trace/checkpoints/:checkpointId/diff" },
  getTraceRestorePreview: { method: "GET", path: "/sessions/:id/trace/checkpoints/:checkpointId/restore-preview" },
  restoreTraceCheckpoint: { method: "POST", path: "/sessions/:id/trace/checkpoints/:checkpointId/restore" },
  sendMessage: { method: "POST", path: "/sessions/:id/messages" },
  /** Canonical AG-UI event stream (§15.4). */
  sessionEvents: { method: "GET", path: "/sse/:id" },
  /** Alias path some callers use; same AgUiEvent payload as `sessionEvents`. */
  sessionEventsAlias: { method: "GET", path: "/sessions/:id/events" },
  /**
   * Persisted AG-UI event history from `events.jsonl`. The SPA calls this on
   * session activation to rehydrate chat after a runtime restart (the SSE
   * stream only replays the in-memory ring buffer). Query: `?limit=N`
   * (default 1000, capped at 5000); returns the most recent N events when
   * the file is longer.
   */
  getSessionHistory: { method: "GET", path: "/sessions/:id/history" },
  interrupt: { method: "POST", path: "/sessions/:id/interrupt" },
  interruptTool: { method: "POST", path: "/sessions/:id/tools/:toolCallId/interrupt" },
  listAgents: { method: "GET", path: "/sessions/:id/agents" },
  evictSession: { method: "POST", path: "/sessions/:id/evict" },
  /**
   * Workspace files. `?path=` addresses one of several roots by prefix:
   *  - `/workspace[/...]` (or a bare relative path) → per-session workspace
   *    `workspaces/:id/` (the agent's cwd);
   *  - `/data[/...]` → the runtime's single-user persistent root `data/`,
   *    reusable across sessions (#257/#287);
   *  - `/shared[/...]` → the cross-user READ-ONLY shared root (#261), when the
   *    deployment configures one (`BP_SHARED_DIR`); writes/deletes are rejected.
   * Each root is traversal-guarded independently.
   */
  listFiles: { method: "GET", path: "/sessions/:id/files" },
  readFile: { method: "GET", path: "/sessions/:id/files/content" },
  readRawFile: { method: "GET", path: "/sessions/:id/files/raw" },
  deleteFile: { method: "DELETE", path: "/sessions/:id/files" },
  /**
   * #47/#256: upload a file into the workspace. Two shapes negotiated by
   * Content-Type: `application/json` body `{ path, contentBase64 }`, or
   * `application/octet-stream` raw bytes with `?path=` (streamed to disk).
   */
  writeFile: { method: "POST", path: "/sessions/:id/files" },
} as const satisfies Record<string, RouteDef>;

export type RuntimeRouteName = keyof typeof RUNTIME_ROUTES;
