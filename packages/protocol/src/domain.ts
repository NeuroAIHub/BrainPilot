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

/**
 * #49: validation SSOT for an MCP server *config* (the on-disk spec, without the
 * `name` key). A discriminated union by `type` enforces the cross-field rules
 * the flat `McpServerEntrySchema` above can't: http/sse require a non-empty
 * `url`; stdio requires a non-empty `command`; any other `type` is rejected.
 * The CRUD routes safeParse against this before persisting, so invalid configs
 * 400 and never reach disk.
 */
const nonEmpty = z.string().trim().min(1);
export const McpServerConfigSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: nonEmpty,
    args: z.array(z.string()).optional(),
    env: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
  }),
  z.object({
    type: z.literal("http"),
    url: nonEmpty,
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
  }),
  z.object({
    type: z.literal("sse"),
    url: nonEmpty,
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
  }),
]);
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

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

/**
 * #63: the wire protocol BrainPilot speaks to a provider's gateway. These map
 * 1:1 to Pi's models.json `providers.<id>.api` values; the runtime writes the
 * selected value into the per-session models.json instead of hardcoding
 * `anthropic-messages`. Azure needs only this + the Azure base URL (Pi derives
 * api-version/deployment), so all four configure identically from the UI.
 */
export const ProviderApiSchema = z.enum([
  "anthropic-messages",
  "openai-completions",
  "openai-responses",
  "azure-openai-responses",
]);
export type ProviderApi = z.infer<typeof ProviderApiSchema>;

/**
 * #68 (R-10): coarse provider family the UI/hosted layer declares — "which kind
 * of endpoint is this base URL". This is the user-facing intent; `api` (above)
 * is the precise Pi wire value the runtime executes. `auto` means "infer"
 * (the runtime derives `api` from the base URL / falls back to the default).
 * Optional so single-user / open-source deploys can omit it (defaults to
 * `auto` semantically). When `api` is unset, the runtime derives it from
 * `adapter`: anthropic→anthropic-messages, openai→openai-completions,
 * auto→default.
 */
export const ProviderAdapterSchema = z.enum(["auto", "openai", "anthropic"]);
export type ProviderAdapter = z.infer<typeof ProviderAdapterSchema>;

export const ProviderProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  api: ProviderApiSchema,
  // #68 (R-10): coarse family + hosted-layer sharing flag. `adapter` optional
  // (defaults to "auto" semantically); `isShared` is always false in
  // single-user/open-source mode, true for globally-shared hosted profiles.
  adapter: ProviderAdapterSchema.optional(),
  isShared: z.boolean(),
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
/**
 * #50 / #61: validation SSOT for the provider-profile create/update *wire body*
 * (the snake_case shape the SPA POSTs/PUTs). The backend safeParses against
 * these before persisting, so malformed input 400s instead of silently
 * producing an unusable active profile (empty name, `models:"m"` coerced to
 * `[]`, or — #61 — an empty `models: []` that becomes the active provider with
 * no selectable model).
 *
 * `models` must be a non-empty array of non-empty strings: a non-array value
 * (e.g. the string "m") is a hard error, and an empty list `[]` is rejected
 * too. On *create* the field is required — a fresh install's first profile is
 * auto-selected as active, so it must carry at least one usable model. On
 * *update* (the `.partial()` schema) the field may be omitted to leave models
 * unchanged, but when present it still must be non-empty.
 */
const modelsField = z
  .array(z.string().trim().min(1), {
    message: "models must be an array of non-empty strings",
  })
  .min(1, "models must not be empty");

export const ProviderProfileCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  base_url: z.string().optional(),
  baseUrl: z.string().optional(),
  // #63: provider wire protocol. Optional on create (defaults to
  // anthropic-messages downstream); on update, omit to leave unchanged.
  api: ProviderApiSchema.optional(),
  // #68: coarse adapter family (auto/openai/anthropic). Optional; when set
  // without an explicit `api`, the runtime derives the precise wire value.
  adapter: ProviderAdapterSchema.optional(),
  api_key: z.string().optional(),
  apiKey: z.string().optional(),
  models: modelsField,
  icon: z.string().optional(),
  icon_color: z.string().optional(),
  iconColor: z.string().optional(),
  notes: z.string().optional(),
});
export type ProviderProfileCreate = z.infer<typeof ProviderProfileCreateSchema>;

/**
 * Update is a partial patch: every field optional (omitting `models` leaves it
 * unchanged), but each field keeps its create-time rule when present — so a
 * supplied `models` must still be a non-empty array (#61).
 */
export const ProviderProfileUpdateSchema = ProviderProfileCreateSchema.partial();
export type ProviderProfileUpdate = z.infer<typeof ProviderProfileUpdateSchema>;

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
