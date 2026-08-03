/**
 * Domain object schemas + types. Ported from
 * `packages/web/src/contracts/backend.ts`. These model the camelCase
 * application shape (post-normalization), which is what backend.ts exposes to
 * consumers. The wire is snake_case; normalization lives in the web package.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Example model string (#207)
 * ------------------------------------------------------------------ */

/**
 * #207: the single canonical example model string. UI form defaults, the
 * provider-form placeholder, and the scaffold's `providers.json` example all
 * reference this so they can never drift apart again. It is *only* a
 * placeholder — many gateways (e.g. non-Anthropic ones) won't accept it, so
 * callers should treat it as "replace me with a model your gateway supports",
 * not a working default.
 */
export const EXAMPLE_MODEL = "claude-sonnet-4-6";

/* ------------------------------------------------------------------ *
 * Session
 * ------------------------------------------------------------------ */

/** Per-session domain-resource ablation mode. Defaults to full in the runtime. */
export const DomainResourcesSchema = z.enum(["full", "base"]);
export type DomainResources = z.infer<typeof DomainResourcesSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Optional for compatibility with older runtimes; new runtimes always emit it. */
  domainResources: DomainResourcesSchema.optional(),
});
export type Session = z.infer<typeof SessionSchema>;

/* ------------------------------------------------------------------ *
 * Agent status / state
 * ------------------------------------------------------------------ */

/** §10 state authority enum. */
export const AgentStatusEnumSchema = z.enum(["idle", "running", "error", "stopped"]);
export type AgentStatusEnum = z.infer<typeof AgentStatusEnumSchema>;

/** Live provider retry state for an agent run. */
export const AgentRetryStateSchema = z.object({
  attempt: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  delayMs: z.number().nonnegative(),
});
export type AgentRetryState = z.infer<typeof AgentRetryStateSchema>;

/** Authoritative metadata for one tool call that is still executing. */
export const ActiveToolExecutionSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  runId: z.string().optional(),
  startedAt: z.string(),
  cancellable: z.boolean(),
  status: z.enum(["running", "stopping"]),
});
export type ActiveToolExecution = z.infer<typeof ActiveToolExecutionSchema>;

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
  retry: AgentRetryStateSchema.optional(),
  /** Rich replacement for the legacy id-only activeToolExecutions field. */
  activeTools: z.array(ActiveToolExecutionSchema).optional(),
  /** Kept for older clients that only consume tool-call ids. */
  activeToolExecutions: z.array(z.string()).optional(),
});
export type AgentStatus = z.infer<typeof AgentStatusSchema>;

export const SubagentRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
  "interrupted",
]);
export type SubagentRunStatus = z.infer<typeof SubagentRunStatusSchema>;

/** A short-lived, context-isolated child session owned by a persistent expert. */
export const SubagentStatusSchema = z.object({
  id: z.string(),
  parentAgent: z.string(),
  rootRunId: z.string().nullable(),
  profile: z.string(),
  label: z.string(),
  task: z.string(),
  status: SubagentRunStatusSchema,
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  resultSummary: z.string().optional(),
  artifacts: z.array(z.string()).optional(),
  error: z.string().optional(),
});
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;

/**
 * §10 `AgentState` — the Runtime-internal authoritative state shape (camelCase).
 */
export const AgentStateSchema = z.object({
  name: z.string(),
  status: AgentStatusEnumSchema,
  activeRunId: z.string().optional(),
  activeToolExecutions: z.array(z.string()).optional(),
  activeTools: z.array(ActiveToolExecutionSchema).optional(),
  retry: AgentRetryStateSchema.optional(),
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
 * Real token usage counters for one accounting unit (a whole session, or a
 * single agent). Sourced from the provider's reported usage (Pi's
 * `AssistantMessage.usage`), accumulated over every assistant turn — NOT a
 * char-count estimate. `total` is the running sum the provider charges against
 * the context window (`input + output + cacheRead + cacheWrite`); we keep it
 * explicit rather than re-deriving so a consumer never has to know the formula.
 */
export const TokenUsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  total: z.number(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

/**
 * Per-session token accounting: the whole-session `total` plus a per-agent
 * breakdown keyed by agent name (`principal`, expert names, `trace`).
 */
export const SessionTokenUsageSchema = z.object({
  total: TokenUsageSchema,
  byAgent: z.record(z.string(), TokenUsageSchema),
});
export type SessionTokenUsage = z.infer<typeof SessionTokenUsageSchema>;

/* ------------------------------------------------------------------ *
 * Per-run usage stats (tools + skills + token deltas)
 *
 * Purpose: **behavioural research** — answer "which tools/skills did each
 * agent use, per run, over the life of this session". Sibling to
 * SessionTokenUsage above; kept in its own persisted file (`stats.json`) so
 * we can write on every RUN_FINISHED without churning `usage.json`.
 *
 * Coverage (see `docs/superpowers/specs/…usage-stats-design.md`):
 *   - Tools: ~99% (every Pi tool execution goes through one core-loop path
 *     that emits `tool_execution_start`/`end`). Only known gap is hard-abort
 *     mid-preparation, which is rare.
 *   - Skills: only the `skill_search` custom tool is counted. `/skill:<name>`
 *     slash-command expansions and implicit `<available_skills>` loads are
 *     not observable from the current event surface and are OUT OF SCOPE
 *     (upgradable later via a Pi extension without touching this schema).
 * ------------------------------------------------------------------ */

/**
 * Per-agent per-tool invocation counter. Key is the tool name (`"read"`,
 * `"bash"`, `"skill_search"`, external-MCP-bridged names, …). Value is the
 * number of times the runtime observed a `tool_execution_start` for that
 * tool. Aborted mid-run tools still count — we count *invocations*, not
 * *successful completions*; see `errors` on `AgentStatsSchema` for the
 * failure counter.
 */
export const ToolCallCountsSchema = z.record(z.string(), z.number().int().nonnegative());
export type ToolCallCounts = z.infer<typeof ToolCallCountsSchema>;

/**
 * Per-skill invocation counter. Split by the three `skill_search` sub-modes
 * (see packages/runtime/src/tools/skill-search.ts):
 *   - `queries` — `mode="query"` with `keywords` (exploration; no body read)
 *   - `loads`   — `mode="query"` with `skill_name` (returns full SKILL.md)
 *   - `browses` — `mode="browse"` (directory/file browse under a skill)
 *
 * A special key `"__search__"` collects `queries` where the args carried no
 * `skill_name` (pure keyword search — the agent looked around but did not
 * commit to a named skill). Args that fail to parse are also charged to
 * `__search__.queries` so counters are never dropped silently.
 */
export const SkillCounterSchema = z.object({
  queries: z.number().int().nonnegative(),
  loads: z.number().int().nonnegative(),
  browses: z.number().int().nonnegative(),
});
export type SkillCounter = z.infer<typeof SkillCounterSchema>;
export const SkillCountsSchema = z.record(z.string(), SkillCounterSchema);
export type SkillCounts = z.infer<typeof SkillCountsSchema>;

/**
 * All countable stats for one agent, in one accounting unit (session
 * cumulative, or a single RUN_STATS delta).
 *
 * `errors` counts `tool_execution_end.isError === true` per tool name; it is
 * additive to `tools` — `tools[name]` is "attempted N times", `errors[name]`
 * is "of those, M failed". We do not subtract.
 */
export const AgentStatsSchema = z.object({
  tokens: TokenUsageSchema,
  tools: ToolCallCountsSchema,
  skills: SkillCountsSchema,
  errors: ToolCallCountsSchema,
});
export type AgentStats = z.infer<typeof AgentStatsSchema>;

/** Status stamped onto a `RunStats` entry when it is finalized. */
export const RunStatsStatusSchema = z.enum(["ok", "error", "aborted"]);
export type RunStatsStatus = z.infer<typeof RunStatsStatusSchema>;

/**
 * One completed run's contribution, computed as `cumulative_after -
 * cumulative_before`. Appended to `SessionStats.byRun` when the run reaches
 * a terminal event (`RUN_FINISHED` / `RUN_ERROR`) or is aborted.
 */
export const RunStatsSchema = z.object({
  runId: z.string(),
  agentName: z.string(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative(),
  status: RunStatsStatusSchema,
  delta: AgentStatsSchema,
});
export type RunStats = z.infer<typeof RunStatsSchema>;

/**
 * Full stats snapshot for one session:
 *   - `total`   — everything summed across agents and runs.
 *   - `byAgent` — per-agent cumulative (mirrors `SessionTokenUsage.byAgent`).
 *   - `byRun`   — time-ordered per-run deltas. Append-only; never truncated
 *                 (`events.jsonl` is the ultimate SSOT and is uncapped, so
 *                 this stays bounded by the same envelope).
 */
export const SessionStatsSchema = z.object({
  sessionId: z.string(),
  total: AgentStatsSchema,
  byAgent: z.record(z.string(), AgentStatsSchema),
  byRun: z.array(RunStatsSchema),
});
export type SessionStats = z.infer<typeof SessionStatsSchema>;

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
  /** Optional for compatibility with runtimes predating isolated subagents. */
  subagents: z.array(SubagentStatusSchema).optional(),
  lastActivityTs: z.string(),
  /** Frozen when the session is created and persisted across restore. */
  domainResources: DomainResourcesSchema.optional(),
  /**
   * Cumulative real token usage for this session (total + per-agent). Optional
   * for forward/backward compat: a frame from an older runtime, or before the
   * first assistant turn completes, simply omits it.
   */
  tokenUsage: SessionTokenUsageSchema.optional(),
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

/**
 * #377: BYOK annotation on a *preset* MCP server. Hosted deployments inject
 * presets (e.g. `tavily`) that are metered by an API key: the platform ships a
 * shared fallback key, and users are encouraged to register their own so usage
 * bills to them. `kind` is the credential identity the hosted BYOK endpoints are
 * keyed by (`PUT /api/mcp-servers/byok/:kind`); `keyParam` / `keyHeader` name
 * the single field the user's key is injected into — exactly one of the two, so
 * the annotation can never widen into "edit the whole transport".
 *
 * Self-hosted builds have no BYOK endpoint and simply ignore the field.
 */
export const McpByokInfoSchema = z
  .object({
    kind: z.string().trim().min(1),
    keyParam: z.string().trim().min(1).optional(),
    keyHeader: z.string().trim().min(1).optional(),
  })
  .refine((v) => !(v.keyParam && v.keyHeader), {
    message: "byok: keyParam and keyHeader are mutually exclusive",
  });
export type McpByokInfo = z.infer<typeof McpByokInfoSchema>;

export const McpServerEntrySchema = z.object({
  name: z.string(),
  type: z.enum(["stdio", "http", "sse"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().optional(),
  /**
   * #377: platform-managed entry — the UI must not offer Edit / Delete and must
   * not surface the raw URL (a hosted preset URL can carry the platform's shared
   * key). Orthogonal to `byok`: a preset can be read-only without being metered.
   */
  readOnly: z.boolean().optional(),
  byok: McpByokInfoSchema.optional(),
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
/** #203: true when the string parses as a WHATWG URL. */
function isParseableUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
/**
 * #203: a syntactically valid http(s) URL. Bare-non-empty (`nonEmpty`) let typos
 * like `"not a url"` save successfully and only fail later at provider test /
 * runtime / tool-call time. This trims, requires a parseable URL, and restricts
 * the scheme to http/https — which still admits the local-dev cases the issue
 * calls out (`http://localhost`, `http://127.0.0.1`). The custom message keeps
 * the field-level Zod issue readable once the UI surfaces `details` (#206).
 */
const httpUrl = z
  .string()
  .trim()
  .refine((u) => /^https?:\/\//i.test(u) && isParseableUrl(u), {
    message: "must be a valid http(s) URL (e.g. https://host/path)",
  });
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
    url: httpUrl,
    headers: z.record(z.string(), z.string()).optional(),
    timeout: z.number().optional(),
  }),
  z.object({
    type: z.literal("sse"),
    url: httpUrl,
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

/**
 * #75: single source of truth for adapter→api derivation, shared by the backend
 * (so create/echo never persist a default that contradicts the adapter) and the
 * runtime (so the wire value it writes matches). `anthropic`→anthropic-messages,
 * `openai`→openai-completions; `auto`/undefined → undefined (caller falls back
 * to its own default). Keeping this in protocol prevents the two layers from
 * drifting (the footgun #75 surfaced: backend defaulting api to
 * anthropic-messages short-circuited the runtime's adapter fallback).
 */
export function deriveProviderApi(adapter?: ProviderAdapter): ProviderApi | undefined {
  switch (adapter) {
    case "anthropic":
      return "anthropic-messages";
    case "openai":
      return "openai-completions";
    default:
      return undefined;
  }
}

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

/**
 * #203: provider base URL — optional, but when a non-empty value is present it
 * must be a valid http(s) URL. Empty string / omitted stays allowed (the base
 * URL is optional and defaults downstream), so only a real typo like
 * `"not a url"` 400s. `localhost`/`127.0.0.1` pass (see `httpUrl`).
 */
const optionalHttpUrl = z
  .string()
  .trim()
  .refine((u) => u === "" || (/^https?:\/\//i.test(u) && isParseableUrl(u)), {
    message: "base_url must be a valid URL (e.g. https://host) or empty",
  })
  .optional();

export const ProviderProfileCreateSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  base_url: optionalHttpUrl,
  baseUrl: optionalHttpUrl,
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
