/**
 * Domain object schemas + types. Ported from
 * `packages/web/src/contracts/backend.ts`. These model the camelCase
 * application shape (post-normalization), which is what backend.ts exposes to
 * consumers. The wire is snake_case; normalization lives in the web package.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Session = z.infer<typeof SessionSchema>;

/* ------------------------------------------------------------------ *
 * Agent status / state
 * ------------------------------------------------------------------ */

/** §10 state authority enum. */
export const AgentStatusEnumSchema = z.enum(["idle", "running", "error", "stopped"]);
export type AgentStatusEnum = z.infer<typeof AgentStatusEnumSchema>;

/**
 * AgentStatus as exposed in SessionStateSnapshot.agents (backend.ts). `status`
 * is kept open (string) for forward-compat with runtime values beyond the
 * enum, but the canonical set is AgentStatusEnum.
 */
export const AgentStatusSchema = z.object({
  name: z.string(),
  status: z.string(),
  task: z.string(),
  updatedAt: z.string().optional(),
  alive: z.boolean().optional(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

/**
 * §10 `AgentState` — the Runtime-internal authoritative state shape (camelCase).
 */
export const AgentStateSchema = z.object({
  name: z.string(),
  status: AgentStatusEnumSchema,
  activeRunId: z.string().optional(),
  activeToolExecutions: z.array(z.string()).optional(),
  lastError: z
    .object({
      message: z.string(),
      timestamp: z.string(),
      consecutiveCount: z.number(),
    })
    .optional(),
});
export type AgentState = z.infer<typeof AgentStateSchema>;

/**
 * Authoritative live session state. Identical shape across SSE first frame
 * (`CUSTOM:session_state`), push events, and `GET /sessions/:id/state`.
 */
export const SessionStateSnapshotSchema = z.object({
  runState: z.object({
    active: z.boolean(),
    runId: z.string().nullable(),
  }),
  agents: z.array(AgentStatusSchema),
  lastActivityTs: z.string(),
});
export type SessionStateSnapshot = z.infer<typeof SessionStateSnapshotSchema>;

/* ------------------------------------------------------------------ *
 * Trace graph
 * ------------------------------------------------------------------ */

export const TraceNodeStatusSchema = z.union([
  z.enum(["pending", "running", "completed", "error"]),
  z.string(),
]);
export type TraceNodeStatus = z.infer<typeof TraceNodeStatusSchema>;

export const TraceParentSchema = z.object({
  id: z.string(),
  relation: z.string().optional(),
  explanation: z.string().optional(),
  edgeType: z.string().optional(),
});
export type TraceParent = z.infer<typeof TraceParentSchema>;

export const TraceArtifactSchema = z.object({
  path: z.string(),
  type: z.string().optional(),
});
export type TraceArtifact = z.infer<typeof TraceArtifactSchema>;

export const TraceTimestampSchema = z.object({
  createdAt: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type TraceTimestamp = z.infer<typeof TraceTimestampSchema>;

export const TraceNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  nodeType: z.string().optional(),
  status: TraceNodeStatusSchema,
  agent: z.string().optional(),
  description: z.string().optional(),
  summary: z.string().optional(),
  content: z.string().optional(),
  reason: z.string().optional(),
  context: z.string().optional(),
  parents: z.array(TraceParentSchema),
  artifacts: z.array(TraceArtifactSchema),
  parentIds: z.array(z.string()),
  childIds: z.array(z.string()),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  timestamp: TraceTimestampSchema.optional(),
  durationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  toolCalls: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type TraceNode = z.infer<typeof TraceNodeSchema>;

export const TraceGraphSchema = z.object({
  meta: z
    .object({
      sessionId: z.string(),
      userId: z.string().optional(),
      projectName: z.string().optional(),
      currentFocus: z.string().optional(),
      createdAt: z.string().optional(),
    })
    .passthrough(),
  nodes: z.array(TraceNodeSchema),
});
export type TraceGraph = z.infer<typeof TraceGraphSchema>;

/* ------------------------------------------------------------------ *
 * Settings / MCP / Provider
 * ------------------------------------------------------------------ */

export const SettingsDataSchema = z.object({
  model: z.string(),
  apiKey: z.string(),
  baseUrl: z.string(),
});
export type SettingsData = z.infer<typeof SettingsDataSchema>;

export const McpServerEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["stdio", "http", "sse"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
});
export type McpServerEntry = z.infer<typeof McpServerEntrySchema>;

export const HealthStatusSchema = z.enum(["healthy", "degraded", "unavailable", "unknown"]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

export const ModelHealthSchema = z.object({
  model: z.string(),
  status: HealthStatusSchema,
  latencyMs: z.number().optional(),
  checkedAt: z.number().optional(),
  error: z.string().optional(),
});
export type ModelHealth = z.infer<typeof ModelHealthSchema>;

export const ProviderProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  models: z.array(z.string()),
  icon: z.string(),
  iconColor: z.string(),
  notes: z.string(),
  isActive: z.boolean(),
  apiKeyMasked: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  healthStatus: HealthStatusSchema,
  healthCheckedAt: z.number().optional(),
  modelHealth: z.array(ModelHealthSchema),
});
export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

export const FileEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["file", "folder", "symlink"]),
  size: z.number(),
  modified: z.number(),
  permissions: z.string(),
});
export type FileEntry = z.infer<typeof FileEntrySchema>;

export const FileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
});
export type FileContent = z.infer<typeof FileContentSchema>;

/* ------------------------------------------------------------------ *
 * Roles (§16.2 / R-8: role field into protocol)
 * ------------------------------------------------------------------ */

export const UserRoleSchema = z.enum(["admin", "user"]);
export type UserRole = z.infer<typeof UserRoleSchema>;
