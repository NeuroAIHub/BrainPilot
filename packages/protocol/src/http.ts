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
import { AgentStatusSchema, SessionSchema, SessionStateSnapshotSchema } from "./domain.js";

export type HttpMethod = "GET" | "POST" | "DELETE";

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
});
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>;

/* ------------------------------------------------------------------ *
 * POST /sessions  (create)
 * ------------------------------------------------------------------ */

export const CreateSessionRequestSchema = z.object({
  /** Optional caller-supplied title; runtime derives a default otherwise. */
  title: z.string().optional(),
  /** Optional caller-supplied id; runtime generates a UUID otherwise. */
  id: z.string().optional(),
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
 * POST /sessions/:id/messages  (inject user message)
 * ------------------------------------------------------------------ */

export const SendMessageRequestSchema = z.object({
  content: z.string(),
  /** Target agent; defaults to principal. */
  agent: z.string().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const SendMessageResponseSchema = z.object({
  accepted: z.boolean(),
  /** Run id started/queued for this message, if synchronously known. */
  runId: z.string().optional(),
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
});
export type InterruptResponse = z.infer<typeof InterruptResponseSchema>;

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
  createSession: { method: "POST", path: "/sessions" },
  listSessions: { method: "GET", path: "/sessions" },
  getSession: { method: "GET", path: "/sessions/:id" },
  deleteSession: { method: "DELETE", path: "/sessions/:id" },
  getSessionState: { method: "GET", path: "/sessions/:id/state" },
  sendMessage: { method: "POST", path: "/sessions/:id/messages" },
  /** Canonical AG-UI event stream (§15.4). */
  sessionEvents: { method: "GET", path: "/sse/:id" },
  /** Alias path some callers use; same AgUiEvent payload as `sessionEvents`. */
  sessionEventsAlias: { method: "GET", path: "/sessions/:id/events" },
  interrupt: { method: "POST", path: "/sessions/:id/interrupt" },
  listAgents: { method: "GET", path: "/sessions/:id/agents" },
  evictSession: { method: "POST", path: "/sessions/:id/evict" },
  /** Workspace files (`workspaces/:id/`). `?path=` is relative to the workspace root. */
  listFiles: { method: "GET", path: "/sessions/:id/files" },
  readFile: { method: "GET", path: "/sessions/:id/files/content" },
  readRawFile: { method: "GET", path: "/sessions/:id/files/raw" },
  deleteFile: { method: "DELETE", path: "/sessions/:id/files" },
} as const satisfies Record<string, RouteDef>;

export type RuntimeRouteName = keyof typeof RUNTIME_ROUTES;
