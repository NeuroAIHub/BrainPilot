/**
 * SessionManager — orchestration core + STATE AUTHORITY (§10).
 *
 * Owns all sessions. Each session owns its agents, flat task ledger, trace
 * (GraphOfTrace), and EventBus. The manager is the sole authority for agent
 * status; it surfaces `GET /sessions/:id/agents`, `agent_status_update` SSE
 * events, and feeds `/metrics`.
 *
 * Persistence (§5): config/history/state live under `<dataRoot>/.bp/{sid}/`,
 * work files under `<dataRoot>/workspaces/{sid}/`.
 */
import { mkdir, open, readFile, writeFile, readdir, rm, stat, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import { join, resolve, sep, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CUSTOM_EVENT,
  type AgUiEvent,
  type AgentStats,
  type AgentStatus,
  type DomainResources,
  type FileContent,
  type FileEntry,
  type RunStats,
  type Session,
  type SessionStats,
  type SessionTokenUsage,
  type TokenUsage,
  type TraceGraph,
  type UserInputCancellationReason,
} from "@brainpilot/protocol";
import { EventBus } from "./event-bus.js";
import {
  TaskLedger,
  TASK_CONTEXT_MAX_CHARS,
  type TaskNotification,
  type TaskRecord,
} from "./task-ledger.js";
import { GraphOfTrace } from "./trace.js";
import { MasAgent, addUsage, emptyTokenUsage } from "./mas-agent.js";
import {
  addStatsDelta,
  cloneAgentStats,
  emptyAgentStats,
  emptySessionStats,
  recomputeSessionTotal,
} from "./usage-stats.js";
import { systemToolsForRole, builtinToolNamesForRole, type ToolDeps } from "./tools/system-tools.js";
import { ev } from "./events.js";
import { selectFactory, isMockMode } from "./agent-factory.js";
import {
  personaFor,
  withLanguageDirective,
  withCoreCoordinationProtocols,
  withPersistentRootDirective,
  withSharedRootDirective,
} from "./personas.js";
import { renderAgentStatusBlock, collectAgentStatusLines } from "./extensions/agent-status.js";
import { renderTaskListBlock } from "./extensions/task-context.js";
import { McpBridge, loadMcpServersConfig } from "./mcp-bridge.js";
import { loadToolToggles, isToolEnabled, type ToolToggles } from "./tool-toggles.js";
import { materializeSkills } from "./materialize-skills.js";
import { materializeKb } from "./materialize-kb.js";
import { resolveSessionProvider, type SessionProviderRef } from "./provider-config.js";
import { MemWatchdog, parseMemLimitMb } from "./mem-watchdog.js";
import { isWindows } from "./platform.js";
import {
  ensurePersistentLayout as initializePersistentLayout,
  resolveLegacyPersistentUserId,
} from "./persistent-layout.js";
import type { AgentRole, AgentSessionFactory, EventListener, SystemTool, SystemToolResult } from "./types.js";
import {
  toolTogglesForDomainResources,
  withoutDomainResourceInstructions,
  withoutRouterSkillInstructions,
  resolveDomainResources,
} from "./domain-resources.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

type UserInputPhase = "queued" | "activating" | "active" | "finishing";

interface UserInputEntry {
  requestId?: string;
  agent: string;
  runId?: string;
  question: string;
  options?: string[];
  allowFreeText: boolean;
  deferred: Deferred<string>;
  phase: UserInputPhase;
  activatedAt?: number;
  deadlineAt?: number;
  timer?: ReturnType<typeof setTimeout>;
}

interface UserInputArbiter {
  active?: UserInputEntry;
  queue: UserInputEntry[];
  /** Serializes every activation/answer/cancel transition across await points. */
  operations: Promise<void>;
}

export type UserInputAnswerResult = "ok" | "stale" | "invalid" | "persist_failed";

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** #167 default concurrent-provider-calls cap when nothing is configured. */
const DEFAULT_MAX_CONCURRENT_AGENTS = 4;
const DEFAULT_USER_INPUT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_OUTSTANDING_USER_INPUTS = 8;
const MAX_USER_INPUT_ANSWER_LENGTH = 10_000;

/**
 * #256 default upload size cap (1 GiB) when `BP_UPLOAD_MAX_BYTES` is unset.
 * Matches the common hosted default so local and cloud behave the same for
 * large PDFs / datasets; override down (or further up) via the env var.
 */
const DEFAULT_UPLOAD_MAX_BYTES = 1024 * 1024 * 1024;

/**
 * #256: resolve the max upload size in bytes. Precedence: explicit option →
 * `BP_UPLOAD_MAX_BYTES` env → 1 GiB default. A non-positive or unparseable
 * value falls back to the default (a 0 cap would reject everything). `0` is NOT
 * treated as "unlimited": set a finite cap explicitly; there is intentionally
 * no infinite setting.
 */
export function resolveUploadMaxBytes(opt?: number, env = process.env): number {
  if (typeof opt === "number" && Number.isFinite(opt) && opt > 0) {
    return Math.floor(opt);
  }
  const raw = env.BP_UPLOAD_MAX_BYTES?.trim();
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_UPLOAD_MAX_BYTES;
}

/**
 * Resolve the per-session provider concurrency cap: explicit option wins, else
 * `BP_MAX_CONCURRENT_AGENTS`, else the default. Non-integer / empty env falls
 * back to the default; 0 or negative is honored as "throttling disabled".
 */
function resolveMaxConcurrentAgents(opt?: number): number {
  if (typeof opt === "number" && Number.isFinite(opt)) return Math.trunc(opt);
  const env = process.env.BP_MAX_CONCURRENT_AGENTS?.trim();
  if (env !== undefined && env !== "") {
    const n = Number(env);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return DEFAULT_MAX_CONCURRENT_AGENTS;
}

/**
 * #287 (former #257 hook): the runtime is now single-user by contract, so
 * `BP_USER_ID` no longer influences the active on-disk root. A separate
 * migration helper may use its old value once to locate data/<legacyUserId>;
 * this warning tells hosted deployments that it can be removed after rollout.
 * `opt` is likewise retained only for API/migration compatibility.
 * Returns true when a warning was printed, purely so tests can assert on it.
 */
export function warnOnDeprecatedPersistentUserId(
  opt?: string,
  env: NodeJS.ProcessEnv = process.env,
  log: (msg: string) => void = (m) => console.warn(m),
): boolean {
  const envVal = (env.BP_USER_ID ?? "").trim();
  const optVal = (opt ?? "").trim();
  if (envVal === "" && optVal === "") return false;
  const source =
    optVal !== "" && envVal !== ""
      ? `persistentUserId option ("${optVal}") + BP_USER_ID env ("${envVal}")`
      : optVal !== ""
        ? `persistentUserId option ("${optVal}")`
        : `BP_USER_ID env ("${envVal}")`;
  log(
    `[persistent-data] ${source} no longer controls path resolution since #287; ` +
      `it is used only to locate a legacy directory during one-shot migration. ` +
      `The runtime stores its library flat under <dataRoot>/data/; multi-user ` +
      `isolation requires one dataRoot per user.`,
  );
  return true;
}

/**
 * Cross-user shared root (#261, legacy parity: `users/shared → /shared:ro`).
 * Unlike the per-user persistent root (`data/<userId>/`, #257), this directory
 * lives OUTSIDE any user's dataRoot and is shared READ-ONLY across ALL users —
 * a public library of datasets / reference material. Resolution: explicit
 * option wins, else `BP_SHARED_DIR`, else `undefined` (feature off — the
 * `/shared` prefix is then not recognized and the deployment behaves exactly as
 * before). A blank value counts as unset. Exported for tests.
 */
export function resolveSharedDir(opt?: string, env = process.env): string | undefined {
  const raw = (opt ?? env.BP_SHARED_DIR ?? "").trim();
  return raw === "" ? undefined : raw;
}

/**
 * A minimal FIFO counting semaphore. `acquire()` resolves with a `release` fn
 * once a slot is free; excess acquirers queue in order. Used per-session to
 * bound concurrent provider calls (#167). Not reentrant; callers must release
 * exactly once (we do so in a `finally`).
 */
class ProviderSemaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = Math.max(1, limit);
  }

  acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const grant = () => {
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          const next = this.waiters.shift();
          if (next) next();
          else this.available++;
        });
      };
      if (this.available > 0) {
        this.available--;
        grant();
      } else {
        // Queue: when a slot frees, this waiter is handed the slot directly
        // (available stays decremented — ownership transfers, no double count).
        this.waiters.push(grant);
      }
    });
  }
}

/** Shape of the persisted `.bp/<id>/meta.json` (all fields optional/defensive). */
interface SessionMeta {
  id?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  lastActivityAt?: number;
  domainResources?: DomainResources;
}

interface SessionEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: number;
  bus: EventBus;
  taskLedger: TaskLedger;
  trace: GraphOfTrace;
  agents: Map<string, MasAgent>;
  /**
   * #97 error path: per-agent count of CONSECUTIVE failed delivery runs. Bumped
   * when a delegated run ends in `error`, reset to 0 on any successful (non-error)
   * delivery run. Drives self-retry vs escalation in `runDeliveryLoop`.
   */
  deliveryErrors: Map<string, number>;
  runActive: boolean;
  activeRunId: string | null;
  /** One visible ask_user plus FIFO requests waiting behind it. */
  userInputs: UserInputArbiter;
  /** This session's chosen provider/model (resolved against providers.json). */
  providerRef: SessionProviderRef;
  /** Frozen per-session domain-resource mode; never read from global state. */
  domainResources: DomainResources;
  /**
   * Cumulative real token usage for this session: whole-session `total` plus a
   * per-agent breakdown (keyed by agent name). Fed by each MasAgent's `onUsage`
   * callback, surfaced in `session_state` frames, and persisted to usage.json.
   */
  tokenUsage: SessionTokenUsage;
  /**
   * Full per-run + per-session usage stats: mirrors `tokenUsage` but includes
   * tool/skill/error counters and a time-ordered `byRun` timeline. Persisted
   * to `.bp/<sid>/stats.json`. Written on each `RUN_FINISHED`/`RUN_ERROR` (via
   * a MasAgent `onRunStats` callback), never on individual tool calls — the
   * fan-in of a busy run would otherwise churn disk.
   */
  stats: SessionStats;
}

export interface SessionManagerOptions {
  /** Data root (default: BP_DATA_DIR or cwd/.bp-data). */
  dataRoot?: string;
  /** Override the agent session factory (default: env-selected). */
  agentFactory?: AgentSessionFactory;
  /** Persist events.jsonl / tasks.json / trace.json (default true). */
  persist?: boolean;
  /** Override the external MCP bridge (default: real stdio bridge). Tests inject a fake. */
  mcpBridge?: McpBridge;
  /**
   * Absolute path to the directory of user-editable skills loaded through Pi's
   * native skill pipeline (`additionalSkillPaths`). When omitted, defaults to
   * `<dataRoot>/bp_template/skills`. The built-in skill content is materialized
   * here on first use (see `materializeSkills`).
   */
  skillsDir?: string;
  /**
   * Absolute path to the directory backing the `skill_search` tool (the second
   * skill-loading path — long-tail domain library NOT exposed via Pi's
   * `<available_skills>`). When omitted, defaults to
   * `<dataRoot>/bp_template/skills-router`. Materialized alongside `skillsDir`.
   */
  routerSkillsDir?: string;
  /**
   * Memory budget in bytes (issue #20 / R-4). When set, an opt-in soft watchdog
   * refuses new work past ~85% of the budget. Defaults to `BP_MEM_LIMIT_MB`
   * (parsed to bytes); `null`/absent → feature disabled, no behavior change.
   * Tests inject this directly.
   */
  memLimitBytes?: number | null;
  /** Override the watchdog's RSS reader (tests inject; default reads real RSS). */
  readRss?: () => number;
  /**
   * Max estimated tokens per tool result before truncation (issue #80).
   * When a tool returns content exceeding this threshold, the result is
   * truncated, the full content is saved to the session workspace, and a
   * warning is surfaced in the chat. Default: 64000 (~224KB text).
   * Set to 0 to disable truncation entirely.
   * Env override: BP_MAX_TOOL_RESULT_TOKENS.
   */
  maxToolResultTokens?: number;
  /**
   * #167: max concurrent provider calls per session (throttle to avoid
   * self-inflicted 429s on a wide multi-agent fan-out). Default 4; env override
   * `BP_MAX_CONCURRENT_AGENTS` (intended range ~2–6). 0 or negative disables
   * throttling. Tests inject this directly.
   */
  maxConcurrentAgents?: number;
  /** ask_user display timeout; production default 5 minutes. Tests override. */
  userInputTimeoutMs?: number;
  /**
   * #256: max upload size in bytes for workspace file writes (both the base64
   * and raw-stream paths). Default 1 GiB; env override `BP_UPLOAD_MAX_BYTES`.
   * Tests inject a small cap directly.
   */
  uploadMaxBytes?: number;
  /**
   * @deprecated since #287. The runtime is single-user by contract and the
   * persistent library lives flat under `<dataRoot>/data/`. This field (and
   * the `BP_USER_ID` env var) are IGNORED for active path resolution. During
   * upgrade only, the old value identifies the one legacy directory eligible
   * for migration; it also produces a deprecation warning. Multi-user
   * isolation belongs to the deployment layer: give each user their own
   * `dataRoot` (bind mount / container / volume).
   */
  persistentUserId?: string;
  /**
   * Per-tool on/off overrides for the three user-controllable Pi-native
   * SystemTools (`skill_search`, `get_domain_knowledge_local`,
   * `search_papers_local`). When omitted, the runtime reads
   * `<dataRoot>/bp_template/tool_toggles.json` on every `ensureAgent`, so a
   * UI flip takes effect on the next new session / expert spawn. Tests
   * inject this to bypass disk entirely for the lifetime of the manager;
   * passing `{}` explicitly pins "all enabled" without touching disk.
   */
  toolToggles?: ToolToggles | null;
  /**
   * #261: cross-user shared root — an absolute directory, OUTSIDE this runtime's
   * dataRoot, exposed READ-ONLY at the `/shared` path prefix and shared across
   * ALL users (public datasets / reference material). Legacy parity with the
   * old `users/shared → /shared:ro` bind mount. Default `undefined` (feature
   * off); env override `BP_SHARED_DIR`. In Docker mode the host dir is bind-
   * mounted read-only and its container path is passed here via env. Tests
   * inject directly.
   */
  sharedDir?: string;
}

/** Roles inferred from agent name. */
function roleFor(name: string): AgentRole {
  if (name === "principal") return "principal";
  if (name === "trace") return "trace";
  return "expert";
}

/**
 * Conservative token estimation from character count (issue #80).
 * English text averages ~4 chars/token; CJK text ~1-2 chars/token.
 * 3.5 gives a safety margin — we'd rather truncate slightly early than
 * overflow the provider's context window. Exported for tests.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Deep clone a SessionStats snapshot for safe external hand-out. */
function cloneSessionStats(s: SessionStats): SessionStats {
  return {
    sessionId: s.sessionId,
    total: cloneAgentStats(s.total),
    byAgent: Object.fromEntries(
      Object.entries(s.byAgent).map(([k, v]) => [k, cloneAgentStats(v)]),
    ),
    byRun: s.byRun.map((r) => ({ ...r, delta: cloneAgentStats(r.delta) })),
  };
}

/** Sum a per-agent token usage breakdown into a single session total. */
function sumAgentUsage(byAgent: Record<string, TokenUsage>): TokenUsage {
  const total = emptyTokenUsage();
  for (const u of Object.values(byAgent)) {
    total.input += u.input;
    total.output += u.output;
    total.cacheRead += u.cacheRead;
    total.cacheWrite += u.cacheWrite;
    total.total += u.total;
  }
  return total;
}

/** Filesystem-safe form of a tool name (for saving truncated results). */
function sanitiseFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

/** Human-readable byte size (e.g. "1.2MB"). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  /** Coalesce repeated Stop task requests into one lifecycle operation. */
  private readonly sessionInterrupts = new Map<string, Promise<boolean>>();
  /**
   * In-flight `restoreOne` promises, keyed by session id. Guards against a
   * refreshed UI firing `state` + `sse` (+ `messages`) near-simultaneously and
   * racing two `createSession` restores for the same evicted session.
   */
  private readonly loading = new Map<string, Promise<boolean>>();
  private readonly dataRoot: string;
  private readonly agentFactory: AgentSessionFactory;
  private readonly persist: boolean;
  private readonly userInputTimeoutMs: number;
  private lastActivityAt = 0;

  // Active task-event delivery. A loop serially processes one target agent.
  // and runs it; the key (`${sid}:${name}`) guards re-entrancy so concurrent
  // wakes for one agent collapse into a single serial loop (its `prompt` is
  // never invoked concurrently).
  private readonly deliveryLoops = new Set<string>();

  // External MCP tools (§9 decision 2): loaded once, lazily, shared by all
  // non-trace agents. Null until first agent is created.
  private mcpBridge: McpBridge | null;
  private mcpTools: SystemTool[] = [];
  private mcpLoaded = false;

  // Built-in skills directory, loaded through Pi's native skill pipeline
  // (`additionalSkillPaths`). The bundled @brainpilot/skills content is
  // materialized here once (lazily) on first agent creation.
  private readonly skillsDir: string;
  // Router skills directory backing the `skill_search` Pi-native tool — the
  // long-tail catalog NOT in `<available_skills>`. Materialized alongside
  // `skillsDir` (each top-level category lands on the side determined by
  // `materializeSkills`).
  private readonly routerSkillsDir: string;
  private skillsMaterialized = false;
  private kbMaterialized = false;

  // Opt-in memory watchdog (§R-4 / issue #20). Null when no budget is set.
  private readonly memWatchdog: MemWatchdog | null;

  // Tool result truncation (issue #80). 0 = disabled.
  private readonly maxToolResultTokens: number;

  // #167: per-session cap on concurrent provider calls. Each agent's delivery
  // loop is already serial, but distinct experts run independently, so a wide
  // delegation fan-out can fire N provider requests at once and self-inflict
  // 429s. A per-session semaphore bounds in-flight `prompt()`s; excess calls
  // queue (they don't fail). Default 4, tunable via BP_MAX_CONCURRENT_AGENTS
  // (intended range ~2–6 for shared/rate-limited gateways).
  private readonly maxConcurrentAgents: number;
  private readonly providerSlots = new Map<string, ProviderSemaphore>();

  // #256: max upload size in bytes (base64 + raw-stream paths). Configurable
  // via BP_UPLOAD_MAX_BYTES / opts; default 1 GiB.
  private readonly uploadMaxBytes: number;

  // #287: active addressing is always flat data/. The deprecated value is
  // retained only as a v1 migration hint; it never changes the v2 root.
  private readonly legacyPersistentUserId: string;
  private persistentLayoutReady?: Promise<void>;

  // Per-tool on/off overrides — TEST INJECTION SEED ONLY.
  //
  // The runtime path reads `bp_template/tool_toggles.json` on every
  // `ensureAgent` (see `ensureToolToggles`), so a UI flip takes effect on the
  // next new session / expert spawn without a restart. This field is only set
  // when a test passes `opts.toolToggles` to the constructor to bypass disk.
  //
  // Sentinel: `undefined` = no injection, read from disk each time;
  //           `null` = injected "no signal → all enabled" (no disk read);
  //           object = injected explicit toggles (no disk read).
  private injectedToolToggles: ToolToggles | null | undefined = undefined;

  // #261: cross-user read-only shared root, addressed by the `/shared` prefix.
  // An absolute dir OUTSIDE dataRoot, shared across ALL users. `undefined` =
  // feature off (the `/shared` prefix is not recognized). Env `BP_SHARED_DIR`.
  private readonly sharedDir?: string;

  constructor(opts: SessionManagerOptions = {}) {
    this.dataRoot = opts.dataRoot ?? process.env.BP_DATA_DIR ?? join(process.cwd(), ".bp-data");
    this.agentFactory = opts.agentFactory ?? selectFactory();
    this.persist = opts.persist ?? true;
    this.userInputTimeoutMs =
      typeof opts.userInputTimeoutMs === "number"
        && Number.isFinite(opts.userInputTimeoutMs)
        && opts.userInputTimeoutMs > 0
        ? Math.floor(opts.userInputTimeoutMs)
        : DEFAULT_USER_INPUT_TIMEOUT_MS;
    this.mcpBridge = opts.mcpBridge ?? null;
    this.maxToolResultTokens =
      opts.maxToolResultTokens ??
      (() => {
        const env = process.env.BP_MAX_TOOL_RESULT_TOKENS?.trim();
        if (env !== undefined && env !== "") {
          const n = Number(env);
          if (Number.isInteger(n) && n >= 0) return n;
        }
        return 64000;
      })();

    // Skills are loaded by Pi from this dir (default <dataRoot>/bp_template/skills).
    this.skillsDir = opts.skillsDir ?? join(this.dataRoot, "bp_template", "skills");
    // The router skill library is a parallel directory with the same on-disk
    // format; `skill_search` reads from here, Pi never sees it.
    this.routerSkillsDir =
      opts.routerSkillsDir ?? join(this.dataRoot, "bp_template", "skills-router");

    this.maxConcurrentAgents = resolveMaxConcurrentAgents(opts.maxConcurrentAgents);
    this.uploadMaxBytes = resolveUploadMaxBytes(opts.uploadMaxBytes);
    // #287: these no longer select the active root. Warn and retain the old
    // resolved value solely to identify the directory eligible for migration.
    warnOnDeprecatedPersistentUserId(opts.persistentUserId);
    this.legacyPersistentUserId = resolveLegacyPersistentUserId(opts.persistentUserId);
    this.sharedDir = resolveSharedDir(opts.sharedDir);

    // Test-only injection path: if callers pass `toolToggles`, use it verbatim
    // and skip disk reads for the lifetime of this manager. `undefined` (the
    // field is absent from opts) leaves the sentinel at `undefined` so
    // `ensureToolToggles` reads disk each time. Passing `null` explicitly
    // pins "no signal → all enabled" without touching disk.
    if (opts.toolToggles !== undefined) {
      this.injectedToolToggles = opts.toolToggles;
    }

    const limitBytes = opts.memLimitBytes ?? parseMemLimitMb(process.env);
    this.memWatchdog =
      limitBytes != null
        ? new MemWatchdog({
            limitBytes,
            readRss: opts.readRss,
            onThrottle: (snap) => this.onMemoryThrottle(snap),
          })
        : null;
    this.memWatchdog?.start();
  }

  /**
   * Materialize the bundled @brainpilot/skills content into `this.skillsDir`
   * (skip-if-exists) so Pi's native skill pipeline can load it. Idempotent —
   * runs at most once per manager. Called at server startup (so skills exist and
   * are user-visible before any agent runs, incl. Docker pure-compose where no
   * CLI scaffold ran) AND lazily before the first non-trace agent. Best-effort:
   * skills are a convenience, not a hard dependency, so failures are swallowed.
   */
  async ensureSkillsMaterialized(): Promise<void> {
    if (this.skillsMaterialized) return;
    this.skillsMaterialized = true;

    try {
      const res = await materializeSkills(this.dataRoot);
      // eslint-disable-next-line no-console
      console.info(
        `[skills] always-on: ${res.copied} copied → ${res.dest}` +
          (res.skipped ? ` (${res.skipped} preserved)` : "") +
          `; router: ${res.routerCopied} copied → ${res.routerDest}` +
          (res.routerSkipped ? ` (${res.routerSkipped} preserved)` : ""),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[skills] failed to materialize built-in skills: ${(err as Error).message}`);
    }
  }

  /**
   * Materialize the KnowledgeBase Python scripts + model_server sidecar
   * bundled with `@brainpilot/kb-scripts` into `~/.brainpilot/KnowledgeBase/`
   * (Part 3's unified fallback location), so npm-only users can use the
   * "Set up Python environment" / "Set up Models" buttons out of the box.
   * See issue #378.
   *
   * Best-effort — like {@link ensureSkillsMaterialized}. A skipped
   * copy (BP_KB_ROOT set / sibling KB present / test env override) is
   * logged and treated as success; only real errors are surfaced.
   * Idempotent — runs at most once per manager.
   */
  async ensureKbMaterialized(): Promise<void> {
    if (this.kbMaterialized) return;
    this.kbMaterialized = true;

    try {
      const res = await materializeKb();
      // Successful copy: always log (rare — first-launch npm installs only).
      // Skip reasons are logged selectively:
      //   - `no-source` is the ONE case a user might need to notice (pkg
      //     missing = the buttons in the UI will fail later).
      //   - `sibling-kb`, `env-override`, `skip-env` are expected / opt-in;
      //     silent to avoid noise on every dev / container launch.
      if (!res.reason) {
        // eslint-disable-next-line no-console
        console.info(
          `[kb-scripts] ${res.copied} copied → ${res.dest}` +
            (res.skipped ? ` (${res.skipped} preserved)` : ""),
        );
      } else if (res.reason === "no-source") {
        // eslint-disable-next-line no-console
        console.warn(
          "[kb-scripts] bundled @brainpilot/kb-scripts not found — " +
            'the KB "Set up Python environment / Models" buttons will fail. ' +
            "Check the install (npm) or that the Dockerfile stages KnowledgeBase/.",
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[kb-scripts] failed to materialize: ${(err as Error).message}`);
    }
  }

  /**
   * Load per-tool on/off overrides. Called from `ensureAgent`; reads disk
   * each time so a UI flip via `PUT /api/tool-toggles` takes effect on the
   * next new session / expert spawn without a runtime restart.
   *
   * The file is tiny (three booleans, ~100 bytes) and `ensureAgent` isn't
   * hot — it fires on session create + expert spawn, not per turn — so the
   * extra fs.readFile is negligible next to the Pi SDK setup that follows.
   *
   * Test injection: if the constructor received an explicit `opts.toolToggles`,
   * that value is returned verbatim on every call and disk is never read.
   *
   * Already-running agents keep the tool list they were given at
   * `agentFactory` time (Pi caches it inside the provider session), so a
   * mid-run flip is still restart-to-apply for the RUNNING session — but a
   * NEW session created after the flip picks up the change immediately.
   */
  private async ensureToolToggles(): Promise<ToolToggles | null> {
    if (this.injectedToolToggles !== undefined) return this.injectedToolToggles;
    try {
      return await loadToolToggles(this.dataRoot);
    } catch {
      // A read failure is not fatal — fall back to "all enabled" for this
      // one call. We retry on the next `ensureAgent` (the fs error may be
      // transient — dir permission changed, disk hiccup, etc.).
      return null;
    }
  }

  /**
   * Load external MCP tools once. No-op in mock mode (BP_MOCK=1) and when no
   * `mcp_servers.json` is present, so the default path stays zero-overhead.
   */
  private async ensureMcpTools(): Promise<SystemTool[]> {
    if (this.mcpLoaded) return this.mcpTools;
    this.mcpLoaded = true;
    if (isMockMode() && !this.mcpBridge) return this.mcpTools;
    try {
      const cfg = await loadMcpServersConfig(this.dataRoot);
      if (!cfg) return this.mcpTools;
      if (!this.mcpBridge) this.mcpBridge = new McpBridge();
      this.mcpTools = await this.mcpBridge.connectAll(cfg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[mcp] bridge load failed:", (err as Error).message);
    }
    return this.mcpTools;
  }

  private bpDir(sid: string): string {
    return join(this.dataRoot, ".bp", sid);
  }
  private workspaceDir(sid: string): string {
    return join(this.dataRoot, "workspaces", sid);
  }
  /**
   * #287 (formerly #257): the persistent library shared across all sessions
   * of this runtime — `<dataRoot>/data/`. Files here outlive any single
   * session (a reusable "library"), unlike `workspaces/<sid>/`. Flat: the
   * runtime is single-user by contract, so there is no per-user subdir; a
   * hosted multi-user deployment gives each user their own dataRoot. The
   * whole `dataRoot` is already the persisted volume, so no extra mount is
   * needed. Addressed by agents/file-routes via the `/data` prefix (see
   * `resolveManagedPath`).
   */
  private persistentDir(): string {
    return join(this.dataRoot, "data");
  }

  /**
   * Initialize the flat persistent layout exactly once per manager. The shared
   * promise is awaited by startup and every /data operation, so requests cannot
   * race migration. Failures stay rejected: serving a split library is less
   * safe than refusing the request with an actionable error.
   */
  ensurePersistentLayout(): Promise<void> {
    this.persistentLayoutReady ??= initializePersistentLayout(
      this.dataRoot,
      this.legacyPersistentUserId,
    );
    return this.persistentLayoutReady;
  }
  /**
   * Conversation-attachments subdir of a session's workspace —
   * `workspaces/<sid>/.attachments/`. Files the user attaches to a message live
   * here: scoped to the session (like the workspace) but kept physically apart
   * from agent-produced files, and hidden from the workspace file tree. The
   * agent reads them from its cwd as `.attachments/<name>`. Addressed by file
   * routes via the `/attachments` prefix (see `resolveManagedPath`).
   */
  private static readonly ATTACHMENTS_DIRNAME = ".attachments";
  private attachmentsDir(sid: string): string {
    return join(this.workspaceDir(sid), SessionManager.ATTACHMENTS_DIRNAME);
  }
  /**
   * #60: composer uploads in single-user mode are POSTed against the literal
   * sandbox id `"local"` (the web `LOCAL_SANDBOX.id`), because a file can be
   * attached in the draft composer *before* the real session exists. They land
   * in `workspaces/local/` — but the agent's cwd is `workspaces/<sessionId>/`,
   * so without this it can't read the file the user just attached. We treat
   * `workspaces/local/` as a staging area and drain it into the real session
   * workspace right before the agent runs (see drainLocalUploads).
   */
  private static readonly UPLOAD_STAGING_SID = "local";
  /**
   * #97: max CONSECUTIVE failed delivery runs for one expert before the failure
   * is escalated to the principal instead of self-retried. Matches the legacy
   * circuit-breaker threshold (3). Only `retryable` errors consume retries;
   * a `fatal` error escalates on the first failure regardless of this cap.
   */
  private static readonly MAX_DELIVERY_RETRIES = 3;
  private historyPath(sid: string, agent: string): string {
    return join(this.bpDir(sid), "history", `${agent}.jsonl`);
  }
  /** User-editable persona override for an agent (`bp_template/agents/<name>/prompt.md`). */
  private agentPromptPath(name: string): string {
    return join(this.dataRoot, "bp_template", "agents", name, "prompt.md");
  }

  /* ----------------------------- workspace files ----------------------------- */

  /**
   * Resolve a managed file path to an absolute one, refusing anything that
   * escapes its declared root (path-traversal guard). This is the single
   * enforcement point for all file routes.
   *
   * FOUR roots are addressable, by path prefix:
   *  - `/workspace[/...]` → the per-session workspace `workspaces/<sid>/`
   *    (the agent's cwd; default when no prefix is given, for backward compat).
   *  - `/data[/...]`      → the persistent library `data/`, reusable across
   *    sessions (#287; flat, single-user — per-user layout was removed).
   *  - `/attachments[/...]` → conversation attachments the user attached to a
   *    message, kept in the hidden `workspaces/<sid>/.attachments/` subdir so
   *    they are scoped to the session but visually separate from agent-produced
   *    workspace files. The agent reads them from its cwd as `.attachments/<f>`.
   *  - `/shared[/...]`    → the cross-user READ-ONLY shared root (#261), an
   *    absolute dir OUTSIDE dataRoot shared across ALL users. Only recognized
   *    when `sharedDir` is configured; writes/deletes against it are rejected by
   *    the callers (see writeSessionFile / deleteSessionFile).
   * Each is guarded WITHIN ITS OWN boundary: paths can never cross between roots
   * and none can escape via `..`. (Attachments sit under the workspace on disk,
   * but the `/attachments` boundary is the `.attachments/` subdir itself.)
   *
   * Returns the absolute path plus which root it resolved against, so callers
   * that echo a path back (writeSessionFile) can re-emit the correct prefix.
   */
  private resolveManagedPath(
    sid: string,
    rawPath: string,
  ): { abs: string; root: string; prefix: "/workspace" | "/data" | "/attachments" | "/shared" } {
    let rel = rawPath ?? "";
    // Cross-platform (#5): accept `\` on the way in (an LLM/pre-#5 client may
    // round-trip a `\` path we handed out). `\` is not a legal filename char.
    rel = rel.replace(/\\/g, "/");

    // Pick the root by prefix. `/data` → persistent library; `/attachments` →
    // the session's hidden attachments subdir; `/shared` → the cross-user
    // read-only root (only when configured); anything else defaults to the
    // session workspace (bare relative paths included, so existing callers keep
    // working unchanged).
    let root: string;
    let prefix: "/workspace" | "/data" | "/attachments" | "/shared";
    if (rel === "/data" || rel.startsWith("/data/")) {
      root = this.persistentDir();
      prefix = "/data";
      rel = rel === "/data" ? "" : rel.slice("/data/".length);
    } else if (rel === "/attachments" || rel.startsWith("/attachments/")) {
      root = this.attachmentsDir(sid);
      prefix = "/attachments";
      rel = rel === "/attachments" ? "" : rel.slice("/attachments/".length);
    } else if (this.sharedDir && (rel === "/shared" || rel.startsWith("/shared/"))) {
      // #261: only recognized when configured; otherwise `/shared/...` falls
      // through to the workspace branch below (backward-compatible no-op).
      root = this.sharedDir;
      prefix = "/shared";
      rel = rel === "/shared" ? "" : rel.slice("/shared/".length);
    } else {
      root = this.workspaceDir(sid);
      prefix = "/workspace";
      if (rel === "/workspace") rel = "";
      else if (rel.startsWith("/workspace/")) rel = rel.slice("/workspace/".length);
    }

    rel = rel.replace(/^\/+/, ""); // never let a leading slash make it absolute
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) {
      const label =
        prefix === "/data"
          ? "data root"
          : prefix === "/attachments"
            ? "attachments"
            : prefix === "/shared"
              ? "shared root"
              : "workspace";
      throw new Error(`path escapes ${label}: ${rawPath}`);
    }
    return { abs, root, prefix };
  }

  private isPersistentPath(rawPath: string): boolean {
    const normalized = (rawPath ?? "").replace(/\\/g, "/");
    return normalized === "/data" || normalized.startsWith("/data/");
  }

  private async ensureLayoutForPath(rawPath: string): Promise<void> {
    if (this.isPersistentPath(rawPath)) await this.ensurePersistentLayout();
  }

  /** List one directory level under the session workspace (default: root). */
  async listSessionFiles(sid: string, rel = ""): Promise<FileEntry[]> {
    await this.ensureLayoutForPath(rel);
    const { abs: dir, root, prefix } = this.resolveManagedPath(sid, rel);
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      // ENOENT is the only benign case: the workspace dir does not exist yet
      // because nothing has been written for this (new) session → empty list.
      // Any OTHER failure (EACCES, EPERM, ENOTDIR, a Windows-specific readdir
      // error, …) is a real problem; swallowing it as `[]` made a broken
      // listing indistinguishable from an empty workspace (#193). Surface it so
      // the panel can show a distinct error instead of a misleading empty state.
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return []; // missing workspace → empty (new session, nothing written yet)
      }
      throw new Error(
        `failed to list workspace for session ${sid} at ${dir}: ${code ?? (err as Error)?.message ?? String(err)}`,
      );
    }
    // Hide the conversation-attachments subdir from the WORKSPACE root listing:
    // attachments are surfaced separately in the chat UI, not the file tree.
    // (Only at the workspace root, and only when listing the workspace itself.)
    const atWorkspaceRoot = prefix === "/workspace" && dir === root;
    const visible = atWorkspaceRoot
      ? dirents.filter((d) => d.name !== SessionManager.ATTACHMENTS_DIRNAME)
      : dirents;
    const entries = await Promise.all(
      visible.map(async (d) => {
        const type: FileEntry["type"] = d.isDirectory()
          ? "folder"
          : d.isSymbolicLink()
            ? "symlink"
            : "file";
        let size = 0;
        let modified = 0;
        let permissions = "";
        try {
          const st = await stat(join(dir, d.name));
          size = st.size;
          modified = Math.floor(st.mtimeMs / 1000);
          // POSIX permission bits are meaningless on Windows (`st.mode` reflects
          // FAT-era read-only attr only and would always render `666`/`777`/`444`),
          // so emit an empty string and let the frontend show `-` instead of a
          // misleading octal value. (#10 — cross-platform pass.)
          permissions = isWindows ? "" : (st.mode & 0o777).toString(8);
        } catch {
          /* broken symlink / race — report zeros */
        }
        return { name: d.name, type, size, modified, permissions };
      }),
    );
    return entries;
  }

  /** Read a workspace text file as UTF-8. */
  async readSessionFile(sid: string, rel: string): Promise<FileContent> {
    await this.ensureLayoutForPath(rel);
    const abs = this.resolveManagedPath(sid, rel).abs;
    const content = await readFile(abs, "utf8");
    return { path: rel, content, size: Buffer.byteLength(content) };
  }

  /** Read a workspace file's raw bytes (images/PDF/download). */
  async readSessionFileRaw(sid: string, rel: string): Promise<Buffer> {
    await this.ensureLayoutForPath(rel);
    const abs = this.resolveManagedPath(sid, rel).abs;
    return readFile(abs);
  }

  /** Read one bounded byte range without buffering the full workspace file. */
  async readSessionFileRange(sid: string, rel: string, start: number, requestedEnd?: number): Promise<{ buffer: Buffer; start: number; end: number; totalSize: number }> {
    if (!Number.isSafeInteger(start) || start < 0 || (requestedEnd !== undefined && (!Number.isSafeInteger(requestedEnd) || requestedEnd < start))) {
      throw new Error("invalid file byte range");
    }
    await this.ensureLayoutForPath(rel);
    const abs = this.resolveManagedPath(sid, rel).abs;
    const info = await stat(abs);
    if (!info.isFile() || start >= info.size) throw new Error("file byte range is outside the file");
    const maxBytes = 8 * 1024 * 1024;
    const end = Math.min(requestedEnd ?? start + maxBytes - 1, start + maxBytes - 1, info.size - 1);
    const buffer = Buffer.allocUnsafe(end - start + 1);
    const handle = await open(abs, "r");
    try {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
      return { buffer: buffer.subarray(0, bytesRead), start, end: start + bytesRead - 1, totalSize: info.size };
    } finally {
      await handle.close();
    }
  }

  /** Delete a workspace file. Returns false if it was already gone. */
  async deleteSessionFile(sid: string, rel: string): Promise<boolean> {
    await this.ensureLayoutForPath(rel);
    const { abs, prefix } = this.resolveManagedPath(sid, rel);
    this.assertWritable(prefix, rel); // #261: the shared root is read-only
    try {
      await rm(abs, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * #261: reject mutations targeting the cross-user shared root. The `/shared`
   * root is exposed read-only (legacy `/shared:ro` parity); in Docker mode the
   * bind mount is `ReadOnly:true` too, but local/static modes have no OS-level
   * barrier, so this runtime check is the enforcement point there.
   */
  private assertWritable(
    prefix: "/workspace" | "/data" | "/attachments" | "/shared",
    rawPath: string,
  ): void {
    if (prefix === "/shared") {
      throw new Error(`shared root is read-only: ${rawPath}`);
    }
  }

  /**
   * #47: write an uploaded file into a managed root. Content arrives
   * base64-encoded (binary-safe over the JSON byte chain). The
   * `resolveManagedPath` guard prevents path traversal; parent dirs are
   * created so an upload like `docs/foo.pdf` works.
   *
   * Target is chosen by the path prefix (#257): a `/data/...` path writes to the
   * shared cross-session persistent root (reusable in later sessions); anything
   * else writes to the session workspace (the agent's cwd). `maxBytes` bounds
   * the decoded size (default: the configured upload cap, `BP_UPLOAD_MAX_BYTES`
   * / 1 GiB — see #256).
   */
  async writeSessionFile(
    sid: string,
    rel: string,
    contentBase64: string,
    maxBytes = this.uploadMaxBytes,
  ): Promise<{ path: string; size: number }> {
    const buf = Buffer.from(contentBase64, "base64");
    if (buf.byteLength > maxBytes) {
      throw new Error(`file too large: ${buf.byteLength} bytes exceeds limit of ${maxBytes}`);
    }
    await this.ensureLayoutForPath(rel);
    const { abs, root, prefix } = this.resolveManagedPath(sid, rel);
    this.assertWritable(prefix, rel); // #261: the shared root is read-only
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    return { path: this.relManagedPath(abs, root, prefix), size: buf.byteLength };
  }

  /**
   * #256: stream an uploaded file into a managed root without buffering the
   * whole payload. The raw request body (`application/octet-stream`) is piped
   * to disk; bytes are counted as they flow and the write is aborted (and the
   * partial file removed) the moment the configured cap is exceeded, so a
   * hostile/oversize upload can't fill the disk. Same traversal guard and
   * parent-dir creation as `writeSessionFile`; symmetric with `readSessionFileRaw`.
   *
   * Like `writeSessionFile`, the target root is chosen by the path prefix
   * (#257): a `/data/...` path streams into the shared cross-session persistent
   * root; anything else into the session workspace.
   *
   * `body` accepts a web `ReadableStream` (Hono's `c.req.raw.body`) or a Node
   * `Readable`; `null`/absent is treated as an empty file.
   */
  async writeSessionFileStream(
    sid: string,
    rel: string,
    body: ReadableStream<Uint8Array> | Readable | null,
    maxBytes = this.uploadMaxBytes,
  ): Promise<{ path: string; size: number }> {
    await this.ensureLayoutForPath(rel);
    const { abs, root, prefix } = this.resolveManagedPath(sid, rel);
    this.assertWritable(prefix, rel); // #261: the shared root is read-only
    await mkdir(dirname(abs), { recursive: true });

    // Normalize either stream flavor to a Node Readable.
    const source: Readable =
      body == null
        ? Readable.from([])
        : body instanceof Readable
          ? body
          : Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>);

    let size = 0;
    let tooLarge = false;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.byteLength;
        if (size > maxBytes) {
          tooLarge = true;
          // Abort the pipeline; the catch below cleans up the partial file.
          cb(new Error(`file too large: exceeds limit of ${maxBytes}`));
          return;
        }
        cb(null, chunk);
      },
    });

    try {
      await pipeline(source, counter, createWriteStream(abs));
    } catch (err) {
      // Remove the partial file so a failed/oversize upload leaves no trace.
      await rm(abs, { force: true }).catch(() => {});
      if (tooLarge) {
        throw new Error(`file too large: ${size} bytes exceeds limit of ${maxBytes}`);
      }
      throw err;
    }
    return { path: this.relManagedPath(abs, root, prefix), size };
  }

  /**
   * Root-relative form of an absolute managed path, carrying the `/data`,
   * `/attachments`, or `/shared` prefix back for non-workspace paths so the path
   * round-trips. Cross-platform (#5): always emit POSIX `/` so the API contract
   * is identical across hosts; the frontend embeds this in URL query strings
   * (`?path=foo/bar.txt`) and the model echoes it back via `read_file`. A bare
   * workspace path is emitted prefix-less for backward compatibility.
   */
  private relManagedPath(
    abs: string,
    root: string,
    prefix: "/workspace" | "/data" | "/attachments" | "/shared",
  ): string {
    const relPart = abs === root ? "" : abs.slice(root.length + 1).split(sep).join("/");
    if (prefix === "/workspace") return relPart;
    return relPart ? `${prefix}/${relPart}` : prefix;
  }

  /**
   * #60: drain the composer upload staging area (`workspaces/local/`) into a
   * real session's workspace so the agent — whose cwd is `workspaces/<sid>/` —
   * can read files the user attached in the draft composer (when no real
   * session id existed yet, the web uploads against the literal `"local"`
   * sandbox id). Called right before the agent runs.
   *
   * Move semantics: each staged entry is renamed into the session workspace
   * (an existing same-named entry in the session is left untouched and the
   * staged copy is discarded), then the staging area is emptied so files never
   * leak into the next session. No-op when the target IS the staging sid, or
   * when the staging dir is missing/empty. Best-effort: never throws — a copy
   * failure must not block the user's prompt.
   *
   * This is directory-recursive, so a draft's conversation attachments staged
   * under `workspaces/local/.attachments/` move as a unit into the fresh
   * session's `.attachments/` subdir (a draft's session is always new, so the
   * target `.attachments/` does not pre-exist).
   */
  private async drainLocalUploads(sessionId: string): Promise<void> {
    if (sessionId === SessionManager.UPLOAD_STAGING_SID) return;
    const stagingDir = this.workspaceDir(SessionManager.UPLOAD_STAGING_SID);
    let names: string[];
    try {
      names = await readdir(stagingDir);
    } catch {
      return; // no staging dir → nothing was uploaded in the draft
    }
    if (names.length === 0) return;
    const destDir = this.workspaceDir(sessionId);
    try {
      await mkdir(destDir, { recursive: true });
    } catch {
      /* best-effort */
    }
    for (const name of names) {
      const from = join(stagingDir, name);
      const to = join(destDir, name);
      try {
        // Don't clobber an existing session file; just drop the staged copy.
        let exists = false;
        try {
          await stat(to);
          exists = true;
        } catch {
          /* target absent → safe to move */
        }
        if (exists) {
          await rm(from, { recursive: true, force: true });
          continue;
        }
        await rename(from, to);
      } catch {
        // rename failed (e.g. cross-device, or `from` is a directory on some
        // platforms): fall back to a content copy so the file still reaches the
        // session, then remove the staged copy. Best-effort, never throws.
        try {
          await this.copyEntry(from, to);
          await rm(from, { recursive: true, force: true });
        } catch {
          /* give up on this entry */
        }
      }
    }
  }

  /** Recursively copy a file or directory tree (drainLocalUploads fallback). */
  private async copyEntry(from: string, to: string): Promise<void> {
    const st = await stat(from);
    if (st.isDirectory()) {
      await mkdir(to, { recursive: true });
      for (const child of await readdir(from)) {
        await this.copyEntry(join(from, child), join(to, child));
      }
      return;
    }
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, await readFile(from));
  }

  /**
   * Resolve an agent's system persona. Prefers the user-editable on-disk
   * `bp_template/agents/<name>/prompt.md` (so personas can be tuned without a
   * rebuild); falls back to the curated built-in persona (`personaFor`) when no
   * file is present or it's empty.
   */
  private async loadPersona(
    name: string,
    role: AgentRole,
    domainResources: DomainResources,
    /**
     * #309: when false, strip router / skill_search teaching from the persona
     * (always-on Meta-Skills guidance is kept). Ignored when domainResources
     * is "base", which already removes all skill/router sections.
     */
    skillSearchEnabled = true,
  ): Promise<string> {
    let base: string | undefined;
    try {
      const raw = (await readFile(this.agentPromptPath(name), "utf8")).trim();
      if (raw) base = raw;
    } catch {
      // No on-disk override — fall through to the built-in persona.
    }
    // #97: append the language-following directive here (not in the persona text
    // / on-disk prompt.md) so it also reaches users who scaffolded earlier, and
    // applies whether the persona came from disk or the built-in constant.
    const selected = base ?? personaFor(name, role);
    let filtered = selected;
    if (domainResources === "base") {
      // Stronger isolation: no skills, no router, no local KB instructions.
      filtered = withoutDomainResourceInstructions(selected);
    } else if (!skillSearchEnabled) {
      // #309: skill_search toggle off — hide router teaching only.
      filtered = withoutRouterSkillInstructions(selected);
    }
    filtered = withCoreCoordinationProtocols(filtered, name, role);
    let persona = withLanguageDirective(filtered);
    // #257: tell working agents (not the passive trace recorder) where the
    // shared cross-session persistent root lives, by absolute path, so they can
    // read/write reusable data directly. Injected at load time (like the
    // language directive) so it reaches on-disk personas too.
    if (role !== "trace") {
      persona = withPersistentRootDirective(persona, this.persistentDir());
      // #261: when a cross-user read-only shared root is configured, tell working
      // agents where it lives (absolute path) so they can read/use it as input.
      if (this.sharedDir) {
        persona = withSharedRootDirective(persona, this.sharedDir);
      }
    }
    return persona;
  }

  /* ---------------------------- session CRUD ---------------------------- */

  async createSession(
    input: {
      id?: string;
      title?: string;
      providerId?: string;
      modelId?: string;
      domainResources?: DomainResources;
    } = {},
    /**
     * Internal restore path (see `restoreFromDisk`): when provided, the entry
     * inherits the on-disk meta.json timestamps verbatim instead of stamping
     * fresh ones, and `writeMeta` is skipped so the canonical file is not
     * clobbered with boot-time values. Public callers should not pass this.
     */
    _restore?: { createdAt: string; updatedAt: string; lastActivityAt: number },
  ): Promise<Session> {
    if (this.memWatchdog?.isOverSoftLimit()) {
      throw new Error("memory budget exceeded: refusing new session");
    }
    // Persisted sessions may hand the absolute data/ path to agents, so finish
    // layout initialization before creating any durable session state.
    if (this.persist) await this.ensurePersistentLayout();
    const id = input.id ?? randomUUID();
    if (this.sessions.has(id)) {
      const existing = this.sessions.get(id)!;
      if (input.domainResources && input.domainResources !== existing.domainResources) {
        throw new Error(
          `session ${id} already uses domainResources=${existing.domainResources}; ` +
            `cannot reopen it as ${input.domainResources}`,
        );
      }
      return this.toSession(existing);
    }
    const nowIso = _restore ? _restore.updatedAt : new Date().toISOString();
    const createdAt = _restore ? _restore.createdAt : nowIso;
    const lastActivityAt = _restore ? _restore.lastActivityAt : Date.now();
    const persistBase = this.persist ? this.bpDir(id) : undefined;
    const domainResources = resolveDomainResources(input.domainResources);

    // Provider ref: explicit input wins; otherwise reuse an existing on-disk ref
    // (restore path) so reviving a session never clobbers its chosen model.
    const explicitRef = input.providerId !== undefined || input.modelId !== undefined;
    const providerRef: SessionProviderRef = explicitRef
      ? { providerId: input.providerId, modelId: input.modelId }
      : this.persist
        ? await this.readProviderRef(id)
        : {};

    const bus = new EventBus({ persistPath: persistBase ? join(persistBase, "events.jsonl") : undefined });
    const taskLedger = new TaskLedger(id, persistBase ? join(persistBase, "tasks.json") : undefined);
    // #79: push every trace mutation to the SSE stream as CUSTOM:trace_node so
    // the web Graph of Trace updates live instead of polling. The store stays
    // bus-agnostic; the manager owns the wire shape.
    const trace = new GraphOfTrace(
      id,
      persistBase ? join(persistBase, "trace.json") : undefined,
      (op, node) => {
        bus.emit(ev.custom({ sessionId: id }, CUSTOM_EVENT.TRACE_NODE, { op, node }));
      },
    );

    const entry: SessionEntry = {
      id,
      title: input.title ?? "Untitled session",
      createdAt,
      updatedAt: nowIso,
      lastActivityAt,
      bus,
      taskLedger,
      trace,
      agents: new Map(),
      deliveryErrors: new Map(),
      runActive: false,
      activeRunId: null,
      userInputs: { queue: [], operations: Promise.resolve() },
      providerRef,
      domainResources,
      tokenUsage: { total: emptyTokenUsage(), byAgent: {} },
      stats: emptySessionStats(id),
    };
    this.sessions.set(id, entry);
    if (!_restore) {
      this.touch(entry);
    } else {
      // #242: a restored session keeps its OLD per-session `entry.lastActivityAt`
      // (historical "last active" for UI/history), but the PROCESS-level liveness
      // anchor must reflect activity since THIS process/container started — not a
      // timestamp frozen on disk days ago. Otherwise a hosted reaper computing
      // `now - metrics.lastActivityAt` sees a huge idle for a freshly-restarted
      // container and kills it immediately (start → reaped → start death spiral).
      // Take the newest activity the process has seen so multi-session restore
      // stays monotonic. Per-session `entry.lastActivityAt` is intentionally
      // untouched here.
      this.lastActivityAt = Math.max(this.lastActivityAt, Date.now());
    }

    if (this.persist) {
      await mkdir(join(this.bpDir(id), "history"), { recursive: true });
      await mkdir(this.workspaceDir(id), { recursive: true });
      // Ensure the persistent library exists so the agent + file routes can
      // read/write it from the first session onward. Cheap + idempotent.
      await mkdir(this.persistentDir(), { recursive: true });
      // On restore, meta.json on disk is the authority — do not write it back.
      if (!_restore) await this.writeMeta(entry);
      // Only (re)write the ref when the caller chose one — restore must not
      // clobber an existing ref with an empty object.
      if (explicitRef) await this.writeProviderRef(entry);
      try {
        await taskLedger.recover();
      } catch (err) {
        bus.clear();
        this.sessions.delete(id);
        throw err;
      }
      await this.loadTrace(entry);
      // Rehydrate cumulative token usage so the running total survives restarts.
      await this.loadUsage(entry);
      // Rehydrate full per-run/per-session stats (tokens+tools+skills+errors).
      // Separate file from usage.json so old sessions without stats.json still
      // rehydrate their token counts.
      await this.loadStats(entry);
      // A process restart cannot restore the promise that was blocked inside
      // ask_user. Close any legacy request that has no persisted terminal
      // event so replay never presents it as live input.
      if (_restore) await this.cancelRestoredOrphanInputs(entry);
    }
    this.emitTaskSnapshot(entry);
    if (_restore) {
      for (const target of taskLedger.notificationTargets()) this.wakeAgent(id, target);
    }
    return this.toSession(entry);
  }

  getSession(id: string): Session | undefined {
    const e = this.sessions.get(id);
    return e ? this.toSession(e) : undefined;
  }

  /**
   * Update a session's title and persist it to meta.json (#29). A blank or
   * non-string title is ignored (idempotent) so the call can't wipe a title.
   * Returns the updated session, or undefined if the session is unknown.
   */
  async renameSession(id: string, title?: unknown): Promise<Session | undefined> {
    const e = this.sessions.get(id);
    if (!e) return undefined;
    if (typeof title === "string" && title.trim().length > 0) {
      e.title = title.trim();
    }
    this.touch(e);
    await this.writeMeta(e);
    return this.toSession(e);
  }

  /**
   * List sessions, merging live in-memory entries with persisted-but-evicted
   * ones discovered on disk (#223). Without this, a session dropped by
   * `evictSession` (or an idle reaper) vanishes from the sidebar even though its
   * `.bp/<sid>/` transcript is intact — a refresh then looks like total loss.
   *
   * Discovery is metadata-only: we read each `meta.json` but do NOT revive the
   * full runtime entry (bus/task ledger/trace/agents), so listing stays cheap and
   * eviction keeps saving memory. The session is lazily revived by
   * `ensureLoaded` only when it's actually opened. In-memory entries win on id
   * collision. Ordering is left to the caller (the web sorts by updatedAt).
   */
  async listSessions(): Promise<Session[]> {
    const out = new Map<string, Session>();
    for (const e of this.sessions.values()) out.set(e.id, this.toSession(e));
    if (this.persist) {
      const root = join(this.dataRoot, ".bp");
      let ids: string[];
      try {
        ids = await readdir(root);
      } catch {
        ids = []; // .bp/ doesn't exist yet — only in-memory sessions
      }
      for (const id of ids) {
        if (out.has(id)) continue;
        const meta = await this.readMeta(id);
        if (!meta) continue;
        const sid = meta.id ?? id;
        if (out.has(sid)) continue;
        out.set(sid, {
          id: sid,
          title: meta.title ?? "Untitled session",
          createdAt: meta.createdAt ?? "",
          updatedAt: meta.updatedAt ?? "",
          domainResources: meta.domainResources === "base" ? "base" : "full",
        });
      }
    }
    return [...out.values()];
  }

  /**
   * Ensure a persisted session is live in memory, reviving it from disk if it
   * was evicted (#223). Returns true when the session is available afterwards.
   * Concurrent calls for the same id share one restore via `this.loading`.
   */
  async ensureLoaded(id: string): Promise<boolean> {
    if (this.sessions.has(id)) return true;
    if (!this.persist) return false;
    const inflight = this.loading.get(id);
    if (inflight) return inflight;
    const p = this.restoreOne(id)
      .then((sid) => sid !== null)
      .finally(() => this.loading.delete(id));
    this.loading.set(id, p);
    return p;
  }

  async deleteSession(id: string): Promise<boolean> {
    const e = this.sessions.get(id);
    if (!e) return false;
    await this.discardUserInputs(e);
    for (const a of e.agents.values()) a.stop();
    e.bus.clear();
    this.sessions.delete(id);
    this.providerSlots.delete(id);
    if (this.persist) {
      await rm(this.bpDir(id), { recursive: true, force: true }).catch(() => {});
      await rm(this.workspaceDir(id), { recursive: true, force: true }).catch(() => {});
    }
    return true;
  }

  /** Evict idle session: stop agents + drop from memory, KEEP disk (§修正2). */
  async evictSession(id: string): Promise<{ evicted: boolean; agentsKilled: number }> {
    const e = this.sessions.get(id);
    if (!e) return { evicted: false, agentsKilled: 0 };
    // Persist the ask_user terminal state before the bus is flushed/cleared.
    // The old order cleared the only live Deferred after persistence had
    // already finished, leaving an unanswered request in replay forever.
    await this.cancelUserInputs(e, () => true, "evicted", false);
    let killed = 0;
    for (const a of e.agents.values()) {
      a.stop();
      killed++;
    }
    await e.bus.flush();
    await e.taskLedger.flush();
    await e.trace.flush();
    e.bus.clear();
    this.sessions.delete(id);
    this.providerSlots.delete(id);
    return { evicted: true, agentsKilled: killed };
  }

  /* ----------------------------- messaging ----------------------------- */

  /** Send a user message to an agent (default principal). §7 L3 isolated. */
  async sendMessage(
    sessionId: string,
    content: string,
    agentName = "principal",
    opts: { uuid?: string } = {},
  ): Promise<{ accepted: boolean; runId?: string; queued?: boolean }> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`session not found: ${sessionId}`);
    this.touch(entry);
    // §R-4: refuse new runs past the soft memory threshold. The HTTP `accepted`
    // flag alone isn't surfaced by the web, so also emit a system message.
    if (this.memWatchdog?.isOverSoftLimit()) {
      entry.bus.emit(
        ev.systemMessage(sessionId, "warning", "内存接近上限,暂不接受新任务,请稍后重试。", {
          agent: agentName,
          recoverable: true,
        }),
      );
      return { accepted: false };
    }
    const agent = await this.ensureAgent(sessionId, agentName);
    // #60: pull any composer uploads staged under workspaces/local/ into this
    // session's workspace (the agent's cwd) before it runs, so it can read the
    // file the user just attached. No-op when nothing was staged.
    await this.drainLocalUploads(sessionId);

    // Defense-in-depth for old clients/direct callers: ordinary text answers
    // the one visible FIFO head. Queued questions are never addressable.
    const visibleInput = entry.userInputs.active;
    if (visibleInput?.phase === "active" && visibleInput.requestId) {
      const requestId = visibleInput.requestId;
      const runId = visibleInput.runId;
      const result = await this.answerInput(sessionId, requestId, content);
      if (result === "ok") {
        entry.bus.emit(
          ev.textMessageChunk(
            { sessionId, agentName, runId },
            opts.uuid ?? randomUUID(),
            content,
            "user",
          ),
        );
        return { accepted: true, runId, queued: true };
      }
      if (result === "invalid" || result === "persist_failed") {
        return { accepted: false, runId };
      }
    }

    // A new explicit user turn resumes delivery paused by Stop or by an
    // exhausted principal/trace notification run. Other targets may resume
    // immediately; this target waits until its direct turn settles so prompts
    // never overlap.
    const resumeTargetAfterRun = await this.resumeTaskDelivery(entry, agentName);

    // Concurrent send: the target agent is still streaming its previous run.
    // A plain prompt() would hit the SDK's "already processing" guard. Queue
    // the message as a follow-up onto the current run instead — no new runId,
    // no new run bookkeeping; the SDK loop drains it before agent_end and the
    // events keep flowing under the in-flight run. The user prompt is still
    // broadcast (so SSE replay stays complete) correlated to the CURRENT run.
    if (agent.isStreaming) {
      const runId = entry.activeRunId ?? undefined;
      entry.bus.emit(
        ev.textMessageChunk({ sessionId, agentName, runId }, opts.uuid ?? randomUUID(), content, "user"),
      );
      void agent.followUp(content).finally(() => {
        if (resumeTargetAfterRun && entry.taskLedger.count(agentName) > 0) {
          this.wakeAgent(sessionId, agentName);
        }
      });
      return { accepted: true, runId, queued: true };
    }

    entry.runActive = true;
    entry.activeRunId = `run_${randomUUID()}`;
    const runId = entry.activeRunId;
    // #70: emit an initial session_state frame here — onStatusChange only fires
    // on a status *change*, and ensureAgent creates the agent as idle without
    // emitting, so without this the panel stays empty until the first
    // setStatus("running"). This first frame carries runState.active=true + the
    // freshly-ensured agent.
    this.emitSessionState(entry);
    // issue #42: persist + broadcast the user's own prompt as a role:"user"
    // CHUNK *before* the agent runs, so SSE replay reconstructs the full
    // transcript (user + assistant). The web composer's optimistic bubble uses
    // the same `uuid`, so the reducer dedupes the replayed event by id rather
    // than duplicating it. Fall back to a fresh id if the client omitted one.
    entry.bus.emit(
      ev.textMessageChunk({ sessionId, agentName, runId }, opts.uuid ?? randomUUID(), content, "user"),
    );
    // Fire-and-track: don't block the HTTP response on the full run.
    // #167: the principal's own turn also counts against the session provider cap.
    void this.withProviderSlot(sessionId, () => agent.prompt(content))
      .catch((err) => {
        entry.bus.emit(
          ev.systemMessage(sessionId, "error", `发送消息失败: ${(err as Error).message}`, { agent: agentName }),
        );
      })
      .finally(() => {
        entry.runActive = false;
        entry.activeRunId = null;
        this.touch(entry);
        // #76: re-evaluate the derived run-active flag now that the user-prompt
        // correlation is cleared. For a direct reply this yields the terminal
        // active=false frame; for a delegation a pending delivery loop keeps it
        // true (the loop emits its own terminal frame when it drains).
        this.emitSessionState(entry);
        if (resumeTargetAfterRun && entry.taskLedger.count(agentName) > 0) {
          this.wakeAgent(sessionId, agentName);
        }
      });
    return { accepted: true, runId };
  }

  private async resumeTaskDelivery(entry: SessionEntry, deferAgent: string): Promise<boolean> {
    if (!entry.taskLedger.hasPausedDelivery()) return false;
    await entry.taskLedger.resumeDelivery();
    for (const target of entry.taskLedger.notificationTargets()) {
      if (target !== deferAgent) this.wakeAgent(entry.id, target);
    }
    return entry.taskLedger.count(deferAgent) > 0;
  }

  /** Queue a user question. Only the FIFO head is persisted and shown. */
  private requestUserInput(
    entry: SessionEntry,
    agent: string,
    runId: string | undefined,
    req: { question: string; options?: string[]; allow_free_text?: boolean },
  ): Promise<string> {
    const deferred = makeDeferred<string>();
    const input: UserInputEntry = {
      agent,
      runId,
      question: req.question,
      options: req.options,
      allowFreeText: req.allow_free_text !== false,
      deferred,
      phase: "queued",
    };
    void this.withUserInputLock(entry, async () => {
      const outstanding = entry.userInputs.queue.length + (entry.userInputs.active ? 1 : 0);
      if (outstanding >= MAX_OUTSTANDING_USER_INPUTS) {
        deferred.reject(new Error(
          `ask_user queue is full (${MAX_OUTSTANDING_USER_INPUTS} outstanding questions); continue without asking again`,
        ));
        return;
      }
      entry.userInputs.queue.push(input);
      await this.promoteNextUserInputLocked(entry);
    }).catch((err) => deferred.reject(err instanceof Error ? err : new Error(String(err))));
    return deferred.promise;
  }

  /** Serialize all human-input transitions, including their durable writes. */
  private withUserInputLock<T>(entry: SessionEntry, operation: () => Promise<T>): Promise<T> {
    const result = entry.userInputs.operations.then(operation, operation);
    entry.userInputs.operations = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Persist and show the next queued question, if any. Caller holds the lock. */
  private async promoteNextUserInputLocked(entry: SessionEntry): Promise<void> {
    while (!entry.userInputs.active && entry.userInputs.queue.length > 0) {
      const input = entry.userInputs.queue.shift()!;
      input.phase = "activating";
      input.requestId = `req_${randomUUID()}`;
      entry.userInputs.active = input;
      try {
        await entry.bus.emitDurable(
          ev.userInputRequest(
            { sessionId: entry.id, agentName: input.agent, runId: input.runId },
            {
              request_id: input.requestId,
              agent: input.agent,
              question: input.question,
              options: input.options,
              allow_free_text: input.allowFreeText,
              timeout_sec: Math.ceil(this.userInputTimeoutMs / 1000),
            },
          ),
        );
      } catch {
        entry.userInputs.active = undefined;
        input.deferred.reject(new Error(
          "ask_user could not persist the question; continue without the user's answer",
        ));
        continue;
      }
      input.phase = "active";
      input.activatedAt = Date.now();
      input.deadlineAt = input.activatedAt + this.userInputTimeoutMs;
      this.armUserInputTimer(entry, input);
      return;
    }
  }

  private armUserInputTimer(entry: SessionEntry, input: UserInputEntry): void {
    this.clearUserInputTimer(input);
    const delay = Math.max(0, (input.deadlineAt ?? Date.now()) - Date.now());
    input.timer = setTimeout(() => {
      if (!input.requestId) return;
      void this.expireUserInput(entry.id, input.requestId);
    }, delay);
    input.timer.unref?.();
  }

  private clearUserInputTimer(input: UserInputEntry): void {
    if (input.timer) clearTimeout(input.timer);
    input.timer = undefined;
  }

  private validUserInputAnswer(answer: string): boolean {
    return answer.trim().length > 0 && answer.length <= MAX_USER_INPUT_ANSWER_LENGTH;
  }

  /** Resolve the currently displayed request and durably record its answer. */
  async answerInput(sessionId: string, requestId: string, answer: string): Promise<UserInputAnswerResult> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return "stale";
    if (!this.validUserInputAnswer(answer)) return "invalid";
    const normalizedAnswer = answer.trim();
    return this.withUserInputLock(entry, async () => {
      const input = entry.userInputs.active;
      if (!input || input.requestId !== requestId || input.phase !== "active") return "stale";
      if (!input.allowFreeText && !(input.options ?? []).includes(normalizedAnswer)) return "invalid";
      input.phase = "finishing";
      this.clearUserInputTimer(input);
      try {
        await entry.bus.emitDurable(
          ev.userInputResponse(
            { sessionId: entry.id, agentName: input.agent, runId: input.runId },
            { request_id: requestId, answer: normalizedAnswer },
          ),
        );
      } catch {
        input.phase = "active";
        this.armUserInputTimer(entry, input);
        return "persist_failed";
      }
      entry.userInputs.active = undefined;
      input.deferred.resolve(normalizedAnswer);
      this.touch(entry);
      await this.promoteNextUserInputLocked(entry);
      return "ok";
    });
  }

  private async expireUserInput(sessionId: string, requestId: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    await this.withUserInputLock(entry, async () => {
      const input = entry.userInputs.active;
      if (!input || input.requestId !== requestId || input.phase !== "active") return;
      await this.cancelActiveUserInputLocked(entry, "expired", true);
    });
  }

  private userInputError(reason: UserInputCancellationReason): Error {
    if (reason === "expired") {
      return new Error(
        "The user did not answer within 5 minutes. Continue without the answer, use a safe default, or explain that the task cannot proceed. Do not immediately call ask_user again with the same question.",
      );
    }
    return new Error(`ask_user ${reason}`);
  }

  /** Cancel the visible request and optionally promote the next FIFO item. */
  private async cancelActiveUserInputLocked(
    entry: SessionEntry,
    reason: UserInputCancellationReason,
    promote: boolean,
  ): Promise<void> {
    const input = entry.userInputs.active;
    if (!input || !input.requestId) return;
    input.phase = "finishing";
    this.clearUserInputTimer(input);
    const event = ev.userInputCancelled(
      { sessionId: entry.id, agentName: input.agent, runId: input.runId },
      { request_id: input.requestId, reason },
    );
    try {
      await entry.bus.emitDurable(event);
    } catch {
      // Cancellation must still unblock the Agent. Publish live and retry the
      // append through the ordinary best-effort path; restore reconciliation
      // closes the orphan later if storage remains unavailable.
      entry.bus.emit(event);
      entry.bus.emit(
        ev.systemMessage(entry.id, "error", "ask_user 终态写入失败，已在内存中取消。", {
          agent: input.agent,
          recoverable: true,
        }),
      );
    }
    entry.userInputs.active = undefined;
    input.deferred.reject(this.userInputError(reason));
    if (promote) await this.promoteNextUserInputLocked(entry);
  }

  /** Cancel matching active/queued inputs. Queued items were never user-visible. */
  private cancelUserInputs(
    entry: SessionEntry,
    predicate: (input: UserInputEntry) => boolean,
    reason: UserInputCancellationReason,
    promote: boolean,
  ): Promise<void> {
    return this.withUserInputLock(entry, async () => {
      const retained: UserInputEntry[] = [];
      for (const input of entry.userInputs.queue) {
        if (predicate(input)) input.deferred.reject(this.userInputError(reason));
        else retained.push(input);
      }
      entry.userInputs.queue = retained;
      const activeMatches = entry.userInputs.active && predicate(entry.userInputs.active);
      if (activeMatches) await this.cancelActiveUserInputLocked(entry, reason, false);
      if (promote && !entry.userInputs.active) await this.promoteNextUserInputLocked(entry);
    });
  }

  /** Settle every in-memory waiter without persisting; the session is deleted next. */
  private discardUserInputs(entry: SessionEntry): Promise<void> {
    return this.withUserInputLock(entry, async () => {
      const error = new Error("ask_user session_deleted");
      if (entry.userInputs.active) {
        this.clearUserInputTimer(entry.userInputs.active);
        entry.userInputs.active.deferred.reject(error);
        entry.userInputs.active = undefined;
      }
      for (const input of entry.userInputs.queue) input.deferred.reject(error);
      entry.userInputs.queue = [];
    });
  }

  /** Close request events left orphaned by a previous process/container. */
  private async cancelRestoredOrphanInputs(entry: SessionEntry): Promise<void> {
    const history = await this.readEventHistory(entry.id, { limit: 0 });
    if (!history) return;
    const pending = new Set<string>();
    for (const event of history.events) {
      const raw = event as unknown as Record<string, unknown>;
      const requestId = raw.request_id ?? raw.requestId;
      if (typeof requestId !== "string" || requestId.length === 0) continue;
      if (event.type === "user_input_request") pending.add(requestId);
      if (event.type === "user_input_response" || event.type === "user_input_cancelled") {
        pending.delete(requestId);
      }
    }
    for (const requestId of pending) {
      try {
        await entry.bus.emitDurable(
          ev.userInputCancelled(
            { sessionId: entry.id },
            { request_id: requestId, reason: "restored" },
          ),
        );
      } catch {
        // Leave the orphan untouched when storage is unavailable so the next
        // restore can retry instead of claiming a terminal state was durable.
      }
    }
  }

  /**
   * Interrupt a session (or a specific agent).
   *
   * Targeted (`agentName` given): abort just that agent. Mailboxes and the
   * principal are left untouched — a narrow "stop this one expert" contract.
   *
   * Whole-session (`agentName` omitted, the Stop button — #90 / #327): abort
   * EVERY agent (incl. their running script subprocesses, via Pi
   * `session.abort()`), pause task delivery without deleting queued work, emit
   * one deterministic system_message acknowledgement, and
   * settle run state so the UI clears Stop without a follow-up provider call.
   * Do NOT prompt the principal solely to acknowledge the interruption (#327).
   */
  async interrupt(sessionId: string, agentName?: string): Promise<boolean> {
    const key = `${sessionId}:${agentName ?? "*"}`;
    const inflight = this.sessionInterrupts.get(key);
    if (inflight) return inflight;
    const operation = this.performInterrupt(sessionId, agentName)
      .finally(() => this.sessionInterrupts.delete(key));
    this.sessionInterrupts.set(key, operation);
    return operation;
  }

  private async performInterrupt(sessionId: string, agentName?: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    const wholeSession = agentName === undefined;
    const targets = agentName ? [entry.agents.get(agentName)].filter(Boolean) : [...entry.agents.values()];
    const hasPendingInput = Boolean(entry.userInputs.active || entry.userInputs.queue.length > 0);
    const hasTargetInput = agentName !== undefined && (
      entry.userInputs.active?.agent === agentName
      || entry.userInputs.queue.some((input) => input.agent === agentName)
    );
    const hasTargetActivity = targets.some((agent) =>
      agent!.status === "running" || agent!.hasActiveTools()
    );
    const hasDelivery = [...this.deliveryLoops].some((key) =>
      key.startsWith(`${sessionId}:`) && (!agentName || key === `${sessionId}:${agentName}`)
    );
    if (
      !hasTargetActivity
      && !hasDelivery
      && !hasTargetInput
      && !(wholeSession && (entry.runActive || hasPendingInput))
    ) {
      return false;
    }
    // Reject any pending ask_user FIRST: a prompt blocked awaiting user input
    // would never settle, so abort()'s waitForIdle (#101) must not run before
    // these are unblocked or it would deadlock.
    await this.cancelUserInputs(
      entry,
      (input) => wholeSession || input.agent === agentName,
      "interrupted",
      !wholeSession,
    );
    // Capture run identity before aborts clear agent state so the interrupt
    // acknowledgement can carry a stable id for client hydrate dedupe (#330).
    const interruptEventId = `interrupt:${sessionId}:${entry.activeRunId ?? randomUUID()}`;
    // Fence new delivery-loop iterations before waiting for in-flight prompts
    // to unwind. The batch already being processed may settle, but later queued
    // events remain durable for the next explicit user turn.
    if (wholeSession) await entry.taskLedger.pauseDelivery();
    // Abort every target and WAIT for each in-flight run to fully settle (#101)
    // — RUN_FINISHED emitted, status settled, provider stream fenced.
    await Promise.all(targets.map((a) => a!.abort()));
    entry.runActive = false;
    entry.activeRunId = null;
    if (wholeSession) {
      // Clear queued task events so they cannot re-wake an agent the user stopped.
      // Deterministic UI/runtime acknowledgement — no model/provider run (#327).
      // Stable `id` so history rehydrate + SSE ring replay coalesce to one bubble (#330).
      entry.bus.emit(
        ev.systemMessage(sessionId, "info", "⏹️ 用户已中断当前任务，任务投递已暂停，正在等候进一步指示。", {
          agent: "principal",
          recoverable: true,
          id: interruptEventId,
        }),
      );
      this.touch(entry);
      this.emitSessionState(entry);
    }
    await entry.bus.flush();
    return targets.length > 0;
  }

  /** Interrupt exactly one currently executing, locally-cancellable tool. */
  async interruptTool(
    sessionId: string,
    toolCallId: string,
  ): Promise<{ interrupted: boolean; reason?: "already_finished" | "not_cancellable" | "timeout" }> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return { interrupted: false, reason: "already_finished" };
    const owner = [...entry.agents.values()].find((agent) => agent.hasTool(toolCallId));
    if (!owner) return { interrupted: false, reason: "already_finished" };
    const result = await owner.interruptTool(toolCallId);
    await entry.bus.flush();
    return result;
  }

  /** Test/diagnostic accessor: number of queued task notifications for `agent`. */
  taskNotificationCount(sessionId: string, agent: string): number {
    return this.sessions.get(sessionId)?.taskLedger.count(agent) ?? 0;
  }

  /* ------------------------------ agents ------------------------------- */

  /**
   * Wrap a SystemTool so its execute() results are guarded against overflowing
   * the model's context window (issue #80). When truncation triggers, the full
   * result is saved to `<workspace>/.truncated/` and a system_message warning
   * is emitted. No-op when maxToolResultTokens is 0.
   */
  private wrapToolWithTruncation(
    tool: SystemTool,
    sessionId: string,
    bus: EventBus,
  ): SystemTool {
    if (this.maxToolResultTokens <= 0) return tool;
    const maxTokens = this.maxToolResultTokens;
    const saveFullResult = (origResult: SystemToolResult) =>
      this.truncateToolResult(tool.name, sessionId, bus, origResult, maxTokens);
    const originalExecute = tool.execute.bind(tool);
    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: async (params: Record<string, unknown>): Promise<SystemToolResult> => {
        const result = await originalExecute(params);
        if (result.isError) return result; // never truncate error messages
        return saveFullResult(result);
      },
    };
  }

  /**
   * Estimate tokens in a tool result, truncate if over budget, save the full
   * content to the session workspace, and emit a warning event.
   */
  private async truncateToolResult(
    toolName: string,
    sessionId: string,
    bus: EventBus,
    result: SystemToolResult,
    maxTokens: number,
  ): Promise<SystemToolResult> {
    // Concatenate all text blocks to estimate total tokens.
    const fullText = result.content.map((c) => c.text).join("");
    const estimated = estimateTokens(fullText);
    if (estimated <= maxTokens) return result;

    // Truncate at ~maxTokens chars (conservative).
    const maxChars = maxTokens * 3.5;
    const truncatedText = fullText.slice(0, Math.floor(maxChars));
    const now = new Date().toISOString();
    const ts = now.replace(/[:.]/g, "-");
    const fname = `${sanitiseFilename(toolName)}_${ts}.json`;
    const relPath = `.truncated/${fname}`;

    // Save full content to workspace.
    try {
      const absDir = join(this.workspaceDir(sessionId), ".truncated");
      await mkdir(absDir, { recursive: true });
      const saved: Record<string, unknown> = {
        tool: toolName,
        truncatedAt: now,
        originalBytes: Buffer.byteLength(fullText),
        truncatedBytes: Buffer.byteLength(truncatedText),
        estimatedTokens: estimated,
        maxTokens,
        content: fullText,
      };
      await writeFile(join(absDir, fname), JSON.stringify(saved, null, 2), "utf8");
    } catch {
      // Best-effort — never block the agent on file I/O.
    }

    // Emit warning.
    bus.emit(
      ev.systemMessage(
        sessionId,
        "warning",
        `⚠️ 工具 ${toolName} 返回结果过大 ` +
          `(原始约 ${estimated} tokens / ${formatBytes(Buffer.byteLength(fullText))})，` +
          `已截断至约 ${estimateTokens(truncatedText)} tokens。` +
          `完整结果已保存至 workspace/${relPath}`,
        { recoverable: true },
      ),
    );

    const notice =
      `\n\n---\n` +
      `[⚠️ 结果已截断: 原始 ${estimated} tokens / ${formatBytes(Buffer.byteLength(fullText))} → ` +
      `截断后 ${estimateTokens(truncatedText)} tokens。` +
      `完整内容已保存至 workspace/${relPath} ，可用 read 工具读取]`;

    return {
      content: [{ type: "text", text: truncatedText + notice }],
    };
  }

  /** Ensure an agent exists (create or resurrect). */
  async ensureAgent(sessionId: string, name: string): Promise<MasAgent> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`session not found: ${sessionId}`);
    const existing = entry.agents.get(name);
    if (existing && existing.status !== "stopped") return existing;

    const role = roleFor(name);
    const deps: ToolDeps = {
      sessionId,
      fromAgent: name,
      trace: entry.trace,
      dispatchTask: async (target, content) => {
        const task = await entry.taskLedger.dispatch(name, target, content);
        entry.bus.emit(ev.custom({ sessionId }, CUSTOM_EVENT.TASK_STATE, { op: "created", task }));
        this.touch(entry);
        this.emitSessionState(entry);
        return task;
      },
      completeTask: async (taskId, reply) => {
        const before = entry.taskLedger.get(taskId);
        const task = await entry.taskLedger.complete(taskId, name, reply);
        if (before?.status !== "completed") {
          entry.bus.emit(ev.custom({ sessionId }, CUSTOM_EVENT.TASK_STATE, { op: "completed", task }));
          this.touch(entry);
          this.emitSessionState(entry);
        }
        return task;
      },
      dispatchTrace: async (content) => entry.taskLedger.enqueueTrace(name, content),
      ensureAgent: async (target) => {
        await this.ensureAgent(sessionId, target);
      },
      destroyAgent: async (target) => {
        await this.destroyAgent(sessionId, target);
      },
      wakeAgent: (target) => this.wakeAgent(sessionId, target),
      requestUserInput: (req) => this.requestUserInput(
        entry,
        name,
        entry.agents.get(name)?.state().activeRunId,
        req,
      ),
      routerSkillsDir: this.routerSkillsDir,
    };
    const toolToggles = toolTogglesForDomainResources(
      entry.domainResources,
      await this.ensureToolToggles(),
    );
    const skillSearchEnabled = isToolEnabled(toolToggles, "skill_search");
    const systemTools = systemToolsForRole(role, name, deps, toolToggles);
    // External MCP tools go to non-trace agents (trace agent is graph-only, §9).
    const mcpTools = role === "trace" ? [] : await this.ensureMcpTools();
    const rawTools = [...systemTools, ...mcpTools];
    // Built-in skills are loaded by Pi natively (not as tools). Materialize the
    // bundled content into bp_template/skills once, then hand the dir to the
    // factory as additionalSkillPaths. Trace agent is skill-less (graph-only).
    let skillPaths: string[] | undefined;
    if (role !== "trace" && entry.domainResources === "full") {
      await this.ensureSkillsMaterialized();
      skillPaths = [this.skillsDir];
    }
    // #80: guard every tool result against context-window overflow.
    const agentTools = rawTools.map((t) => this.wrapToolWithTruncation(t, sessionId, entry.bus));
    const builtins = builtinToolNamesForRole(role, name);
    const allowedToolNames = [...builtins, ...agentTools.map((t) => t.name)];

    // Resolve this session's provider against the SSOT (providers.json). When
    // unset/empty the factory falls back to Pi's env-based default.
    const providerConfig = await resolveSessionProvider(this.dataRoot, entry.providerRef);

    const sessionCwd = this.workspaceDir(sessionId);
    const session = await this.agentFactory({
      sessionId,
      agentName: name,
      role,
      historyPath: this.historyPath(sessionId, name),
      cwd: sessionCwd,
      systemTools: agentTools,
      allowedToolNames,
      systemPrompt: await this.loadPersona(
        name,
        role,
        entry.domainResources,
        skillSearchEnabled,
      ),
      skillPaths,
      // #346: map logical /workspace (and /data, …) onto durable roots so Pi
      // write/edit/bash do not land on the ephemeral container layer.
      managedPathRoots: {
        cwd: sessionCwd,
        persistentDir: this.persistentDir(),
        ...(this.sharedDir ? { sharedDir: this.sharedDir } : {}),
      },
      // #309: when skill_search is off, block generic file tools from the router
      // skill directory (Pi tool_call extension). Always-on skills stay readable.
      blockRouterSkills: !skillSearchEnabled,
      routerSkillsDir: this.routerSkillsDir,
      providerConfig,
      // 意图二 fallback: the trace-reminder extension calls this when an expert
      // was reminded once and still didn't report back, so the principal never
      // dead-waits on a silent expert.
      onUnreplied: (agentName) => this.writeFallbackToTaskCreators(entry, agentName),
      hasPendingTasks: () => entry.taskLedger.pendingAssignedTo(name).length > 0,
      claimTaskReminder: (agentName) => entry.taskLedger.claimReminder(agentName),
      // #97: only the principal gets the live team-status block injected each
      // turn (it is the coordinator). Other roles run without it.
      renderAgentStatus:
        name === "principal" ? () => this.renderAgentStatus(entry) : undefined,
      renderTaskContext: () => this.renderTaskContext(entry, name),
    });

    const agent = new MasAgent({
      sessionId,
      name,
      role,
      session,
      bus: entry.bus,
      // #70: keep the touch (idle-reclaim) AND push an authoritative live
      // snapshot so the web Agents panel updates without a reload/reselect.
      // setStatus early-returns on no-op transitions, so this never storms.
      onStatusChange: () => {
        this.touch(entry);
        this.emitSessionState(entry);
      },
      // Roll the agent's running total into the per-session breakdown, push a
      // live session_state frame, and persist usage.json. Total is recomputed
      // as the sum across agents so it can never drift from the breakdown.
      onUsage: (agentName, _delta, cumulative) => {
        entry.tokenUsage.byAgent[agentName] = cumulative;
        entry.tokenUsage.total = sumAgentUsage(entry.tokenUsage.byAgent);
        this.touch(entry);
        this.emitSessionState(entry);
        void this.writeUsage(entry);
      },
      // Per-run stats: append a RunStats entry, refresh the per-agent
      // cumulative snapshot, recompute the session `total`, and persist
      // stats.json. Called once per completed run.
      onRunStats: (info) => {
        const run: RunStats = {
          runId: info.runId,
          agentName: info.name,
          startedAt: info.startedAt,
          finishedAt: info.finishedAt,
          status: info.status,
          delta: info.delta,
        };
        entry.stats.byRun.push(run);
        entry.stats.byAgent[info.name] = cloneAgentStats(info.cumulative);
        recomputeSessionTotal(entry.stats);
        void this.writeStats(entry);
      },
    });
    // Continue this agent's cumulative count across restarts / lazy revival.
    agent.seedUsage(entry.tokenUsage.byAgent[name]);
    agent.seedStats(entry.stats.byAgent[name]);
    entry.agents.set(name, agent);
    return agent;
  }

  private async writeFallbackToTaskCreators(entry: SessionEntry, expert: string): Promise<void> {
    try {
      const taskIds = await entry.taskLedger.notifyUnhandled(expert);
      const creators = new Set<string>();
      for (const taskId of taskIds) {
        const task = entry.taskLedger.get(taskId);
        if (task) creators.add(task.created_by);
      }
      if (taskIds.length > 0) {
        entry.bus.emit(
          ev.systemMessage(entry.id, "warning", `Agent "${expert}" did not act after one task reminder.`, {
            agent: expert,
            recoverable: true,
          }),
        );
      }
      for (const creator of creators) this.wakeAgent(entry.id, creator);
    } catch {
      // Best-effort fallback must never break an agent run.
    }
  }

  /**
   * #97: snapshot the live team status for injection into the principal's turn
   * (via the agent-status extension's Pi `context` hook). Lists every agent —
   * INCLUDING the principal itself, so it sees its own task backlog — with its
   * authoritative status and the number of task events still queued unread in its
   * durable task-event backlog. Excludes the trace agent and
   * any stopped agent (destroyed; irrelevant to current coordination). Returns
   * "" when nothing is worth reporting so the extension injects nothing.
   */
  private renderAgentStatus(entry: SessionEntry): string {
    const lines = collectAgentStatusLines(
      entry.agents.values(),
      (name) => entry.taskLedger.count(name),
    );
    return renderAgentStatusBlock(lines);
  }

  private renderTaskContext(entry: SessionEntry, name: string): string {
    return renderTaskListBlock(
      entry.taskLedger.pendingAssignedTo(name),
      entry.taskLedger.pendingCreatedBy(name),
      TASK_CONTEXT_MAX_CHARS,
    );
  }

  async destroyAgent(sessionId: string, name: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const agent = entry.agents.get(name);
    if (!agent) return;
    await this.cancelUserInputs(entry, (input) => input.agent === name, "agent_destroyed", true);
    agent.stop();
    entry.agents.delete(name); // history on disk is kept (§5).
    const cancelled = await entry.taskLedger.cancelAssignedTo(name, `Agent "${name}" was destroyed before completion.`);
    for (const task of cancelled) {
      entry.bus.emit(ev.custom({ sessionId }, CUSTOM_EVENT.TASK_STATE, { op: "cancelled", task }));
      this.wakeAgent(sessionId, task.created_by);
    }
  }

  /**
   * #167: run `fn` (an `agent.prompt(...)` call) under the session's provider
   * concurrency cap. `agent.prompt` is error-isolated (never throws), so the
   * slot is always released. A cap of 0/negative disables throttling.
   */
  private async withProviderSlot<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    if (this.maxConcurrentAgents <= 0) return fn();
    let sem = this.providerSlots.get(sessionId);
    if (!sem) {
      sem = new ProviderSemaphore(this.maxConcurrentAgents);
      this.providerSlots.set(sessionId, sem);
    }
    const release = await sem.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /* ---------------------- task-notification delivery ---------------------- */

  /**
   * Wake `name` to consume durable task notifications. Fire-and-forget; task
   * tools call this after committing ledger state.
   * The re-entrancy guard (`deliveryLoops`) means concurrent wakes for the same
   * agent collapse into the one already-running loop (which re-drains after each
   * turn), so an agent's `prompt` is never invoked concurrently.
   */
  private wakeAgent(sessionId: string, name: string): void {
    const current = this.sessions.get(sessionId);
    if (!current || current.taskLedger.isPaused(name)) return;
    const key = `${sessionId}:${name}`;
    if (this.deliveryLoops.has(key)) return;
    this.deliveryLoops.add(key);
    void this.runDeliveryLoop(sessionId, name).finally(() => {
      this.deliveryLoops.delete(key);
      // Emit a final frame AFTER the key is gone: the agent's own running→idle
      // transition fired emitSessionState while this key was still present (so
      // that frame still read active via the pending-delivery check). Without
      // this trailing frame the derived run-active flag would stay stuck true.
      const entry = this.sessions.get(sessionId);
      if (entry) this.emitSessionState(entry);
      // Re-check after releasing the guard: a notification could have been written
      // between the loop's final empty read and this delete, and that writer's
      // wakeAgent would have bailed (key still present) — leaving the notification
      // unread. Re-wake if the queue is non-empty so it never strands.
      if (entry && entry.taskLedger.count(name) > 0) this.wakeAgent(sessionId, name);
    });
  }

  /**
   * Peek `name`'s durable task events and run it, looping so events that arrive
   * during a turn are picked up without a second external wake. Events are only
   * acknowledged after a clean provider run.
   * `MasAgent.prompt` is error-isolated (never throws), so a failed expert turn
   * ends the loop cleanly rather than rejecting. A `session_state` frame is
   * emitted on entry and exit so the derived run-active flag reflects the
   * delegated work even across the await gap between the sender finishing and
   * the target starting.
   */
  private async runDeliveryLoop(sessionId: string, name: string): Promise<void> {
    for (;;) {
      const entry = this.sessions.get(sessionId);
      if (!entry) return;
      if (entry.taskLedger.isPaused(name)) return;
      const notifications = entry.taskLedger.peekBatch(name);
      if (notifications.length === 0) return;
      const agent = await this.ensureAgent(sessionId, name);
      if (agent.status === "stopped") return;
      this.touch(entry);
      // Surface the delegated run immediately (derived active flag, agent list).
      this.emitSessionState(entry);
      // #167: cap concurrent provider calls across experts in this session.
      const ran = await this.withProviderSlot(sessionId, async () => {
        // Stop may have paused delivery while this run waited for a provider
        // semaphore slot. Do not start a new model call after Stop completed.
        const current = this.sessions.get(sessionId);
        if (!current || current !== entry || current.taskLedger.isPaused(name)) return false;
        await agent.prompt(this.renderTaskEvents(notifications));
        return true;
      });
      if (!ran || entry.taskLedger.isPaused(name)) return;

      // Status returns to idle after an explicit abort, so it cannot identify
      // a cleanly consumed batch. Keep aborted input durable for replay after
      // the next explicit user turn resumes delivery.
      if (agent.lastRunOutcome === "aborted") {
        if (!entry.taskLedger.isPaused(name)) await entry.taskLedger.pauseAgent(name);
        return;
      }

      // #97 error path. A delegated run that ended in `error` is handled here
      // (the trace-reminder extension bails on an errored run, leaving the host
      // the sole owner of error recovery). Transient errors self-retry up to a
      // cap; fatal errors (auth/config) and the exhausted cap escalate to the
      // principal. A clean run resets the agent's consecutive-error count.
      if (agent.status === "error") {
        if (agent.role === "expert") {
          if (await this.handleDeliveryError(entry, agent)) continue;
          return;
        }
        if (await this.handleInternalDeliveryError(entry, agent)) continue;
        return;
      }
      if (agent.lastRunOutcome !== "ok") {
        await entry.taskLedger.pauseAgent(name);
        entry.bus.emit(ev.systemMessage(
          entry.id,
          "error",
          `Agent "${name}" 未产生可确认的运行结果，已保留任务事件并暂停投递。`,
          { agent: name, recoverable: true },
        ));
        return;
      }
      // Linearize acknowledgement with pauseDelivery(): if Stop won the ledger
      // write race, retain the batch for the next explicit user turn.
      const acknowledged = await entry.taskLedger.acknowledgeIfActive(
        name,
        notifications.map((item) => item.id),
      );
      if (!acknowledged) return;
      entry.deliveryErrors.delete(name); // clean run → reset the streak
    }
  }

  /**
   * #97: react to a failed delegated expert run. Returns true when a self-retry
   * was queued (the loop should continue and re-drain the agent's own queue),
   * false when the failure was escalated to the principal (the loop should stop).
   *
   * Policy:
   *  - `retryable` (rate limit / 5xx / network) AND under the retry cap →
   *    re-wake the SAME expert with a neutral system nudge in its own queue, and
   *    surface a `warning` to the user ("retrying n/N"). Re-running may succeed.
   *  - `fatal` (auth / missing key / forbidden), OR the cap is reached →
   *    escalate: queue a neutral error event for each task creator and wake it,
   *    surface an `error` to the user, and reset the streak so a future task to
   *    this expert starts fresh.
   */
  private async handleDeliveryError(entry: SessionEntry, agent: MasAgent): Promise<boolean> {
    const name = agent.name;
    const count = (entry.deliveryErrors.get(name) ?? 0) + 1;
    entry.deliveryErrors.set(name, count);
    const kind = agent.lastErrorKind ?? "retryable";
    const headline = agent.state().lastError?.message ?? "未知错误";

    if (kind === "retryable" && count < SessionManager.MAX_DELIVERY_RETRIES) {
      entry.bus.emit(
        ev.systemMessage(
          entry.id,
          "warning",
          `专家 "${name}" 执行任务时出错，正在自动重试 (${count}/${SessionManager.MAX_DELIVERY_RETRIES})…`,
          { agent: name, recoverable: true },
        ),
      );
      // Leave the current notification batch unacknowledged; the serial loop
      // retries the same durable events.
      return true;
    }

    // Fatal, or retries exhausted → notify every creator of a pending task.
    entry.bus.emit(
      ev.systemMessage(
        entry.id,
        "error",
        kind === "fatal"
          ? `专家 "${name}" 发生无法自动恢复的错误，已通知任务派遣者。`
          : `专家 "${name}" 连续 ${count} 次执行失败，已通知任务派遣者。`,
        { agent: name, recoverable: true },
      ),
    );
    // Preserve every event from the failed batch, including completed child
    // results. The next explicit user turn resumes and replays them.
    await entry.taskLedger.pauseAgent(name);
    await this.writeErrorToTaskCreators(entry, name, headline);
    entry.deliveryErrors.delete(name); // reset streak for a future task
    return false;
  }

  private async handleInternalDeliveryError(entry: SessionEntry, agent: MasAgent): Promise<boolean> {
    const name = agent.name;
    const count = (entry.deliveryErrors.get(name) ?? 0) + 1;
    entry.deliveryErrors.set(name, count);
    const kind = agent.lastErrorKind ?? "retryable";
    if (kind === "retryable" && count < SessionManager.MAX_DELIVERY_RETRIES) {
      entry.bus.emit(
        ev.systemMessage(
          entry.id,
          "warning",
          `Agent "${name}" 处理任务事件时出错，正在自动重试 (${count}/${SessionManager.MAX_DELIVERY_RETRIES})…`,
          { agent: name, recoverable: true },
        ),
      );
      return true;
    }
    await entry.taskLedger.pauseAgent(name);
    entry.deliveryErrors.delete(name);
    entry.bus.emit(
      ev.systemMessage(
        entry.id,
        "error",
        `Agent "${name}" 无法处理待投递任务事件，已暂停自动投递；下一条用户消息将恢复。`,
        { agent: name, recoverable: true },
      ),
    );
    return false;
  }

  private async writeErrorToTaskCreators(entry: SessionEntry, expert: string, headline: string): Promise<void> {
    const creators = new Set<string>();
    for (const task of entry.taskLedger.pendingAssignedTo(expert)) {
      try {
        await entry.taskLedger.enqueueSystem(
          task.created_by,
          `Agent "${expert}" failed while task ${task.id} remains pending. Error: ${headline}`,
          task.id,
        );
        creators.add(task.created_by);
      } catch {
        // The user-facing system_message already records the terminal delivery
        // error. A full creator queue must not make the failed assignee retry
        // forever; the pending task remains visible in the creator's task list.
      }
    }
    for (const creator of creators) this.wakeAgent(entry.id, creator);
  }

  private renderTaskEvents(notifications: readonly TaskNotification[]): string {
    return `<task_events>\n${notifications.map((notification) => {
      if (notification.kind === "trace") return notification.content;
      const task = notification.task_id ? ` task_id="${notification.task_id}"` : "";
      return `<task_event kind="${notification.kind}"${task} from="${notification.from_agent}">\n${notification.content}\n</task_event>`;
    }).join("\n\n")}\n</task_events>`;
  }

  /* -------------------------- state authority -------------------------- */

  /** §10 polling fallback: list agents with authoritative status. */
  listAgents(sessionId: string): AgentStatus[] {
    const entry = this.sessions.get(sessionId);
    if (!entry) return [];
    return [...entry.agents.values()].map((a) => {
      const st = a.state();
      const out: AgentStatus = {
        name: a.name,
        status: st.status,
        task: entry.taskLedger.pendingAssignedTo(a.name)[0]?.content ?? "",
        updatedAt: new Date().toISOString(),
        alive: st.status !== "stopped",
        retry: st.retry,
        activeToolExecutions: st.activeToolExecutions,
        activeTools: st.activeTools,
      };
      return out;
    });
  }

  /**
   * #76: a session is "running" whenever ANY non-trace agent is running, or a
   * task-event delivery loop is pending for a non-trace target (the loop is
   * registered synchronously inside `dispatch_task`, so this closes the await gap
   * between the sender finishing its turn and the delegated target starting —
   * without it the flag would flicker false in that window). The trace agent is
   * a real spawned agent (record_trace dispatches `trace_event` envelopes into
   * its internal trace event and it owns the Graph of Trace as editor, see
   * `system-tools.ts:createRecordTraceTool`), but it is excluded from the
   * AGGREGATE: a trace recording isn't "the user's task is still running". It
   * is still LISTED in `agents[]` with its own status so the Agents panel shows
   * its idle/running transitions live.
   */
  private deriveRunActive(entry: SessionEntry): boolean {
    if (entry.runActive) return true;
    for (const a of entry.agents.values()) {
      if (a.role !== "trace" && a.status === "running") return true;
    }
    for (const key of this.deliveryLoops) {
      const sep = entry.id.length;
      // key === `${sid}:${name}` — match this session, exclude the trace target.
      if (key.startsWith(`${entry.id}:`) && key.slice(sep + 1) !== "trace") return true;
    }
    return false;
  }

  /**
   * #70/#76: emit the authoritative live snapshot as a `CUSTOM:session_state`
   * event. This is the wholesale source the web Agents panel replaces its
   * agents list from; it is pushed on every agent status transition
   * (`onStatusChange`), an initial frame in `sendMessage`, and on delivery-loop
   * entry/exit. `runState.active` is DERIVED (any non-trace agent running / a
   * pending delivery), so a delegated expert keeps the run visibly active. The
   * ring buffer replays the last frame on reconnect, so a re-subscribing client
   * recovers the current snapshot. Shape matches `SessionStateSnapshotSchema`.
   */
  private emitSessionState(entry: SessionEntry): void {
    entry.bus.emit(
      ev.custom({ sessionId: entry.id }, "session_state", {
        runState: { active: this.deriveRunActive(entry), runId: entry.activeRunId },
        agents: this.listAgents(entry.id),
        lastActivityTs: new Date(entry.lastActivityAt).toISOString(),
        domainResources: entry.domainResources,
        tokenUsage: entry.tokenUsage,
      }),
    );
  }

  private emitTaskSnapshot(entry: SessionEntry): void {
    entry.bus.emitEphemeral(
      ev.custom({ sessionId: entry.id }, CUSTOM_EVENT.TASK_STATE, {
        op: "snapshot",
        tasks: entry.taskLedger.list(),
      }),
    );
  }

  listTasks(sessionId: string): TaskRecord[] {
    return this.sessions.get(sessionId)?.taskLedger.list() ?? [];
  }

  getSessionState(sessionId: string): {
    runState: { active: boolean; runId: string | null };
    agents: AgentStatus[];
    lastActivityTs: string;
    domainResources: DomainResources;
    tokenUsage: SessionTokenUsage;
  } | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    return {
      runState: { active: this.deriveRunActive(entry), runId: entry.activeRunId },
      agents: this.listAgents(sessionId),
      lastActivityTs: new Date(entry.lastActivityAt).toISOString(),
      domainResources: entry.domainResources,
      tokenUsage: entry.tokenUsage,
    };
  }

  /** The session's Graph of Trace (reasoning DAG), or undefined if no session. */
  getTrace(sessionId: string): TraceGraph | undefined {
    const entry = this.sessions.get(sessionId);
    return entry?.trace.getGraph();
  }

  /**
   * Per-run + per-session usage stats snapshot for a session, or undefined if
   * the session is unknown. Returns a deep copy so callers can safely mutate.
   * The wire shape is `SessionStatsSchema` — this is what
   * `GET /sessions/:id/stats` serializes.
   */
  getSessionStats(sessionId: string): SessionStats | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    return cloneSessionStats(entry.stats);
  }

  /**
   * Read persisted AG-UI events for a session from `.bp/<sid>/events.jsonl`.
   * Used by the web to rehydrate chat history after a runtime restart (the
   * in-memory bus ring buffer only carries `recent()` for live SSE replay).
   *
   * The file is read line-by-line and unparseable lines are skipped so a
   * single corrupt record doesn't poison the whole history.
   *
   * `limit` caps the returned array; when total > limit we return the **tail**
   * (most recent events) for lightweight callers. Default 1000, positive
   * limits are capped at 5000. `limit <= 0` returns the full log and is used by
   * the web rehydrate path so long sessions are not sliced through the middle
   * of a streamed message.
   *
   * History is a **disk read** (`<dataRoot>/.bp/<sid>/events.jsonl`), so it does
   * NOT require the session to be live in memory: a session evicted by the idle
   * reaper (or lost to a runtime restart) keeps its transcript on disk
   * (`evictSession` flushes + drops the in-memory entry but never deletes the
   * file). Returning `undefined` only when neither memory nor disk knows the
   * session is what lets a post-refresh rehydrate replay an evicted session
   * instead of getting a 404 and rendering an empty transcript (#165 / #194-B2).
   *
   * In non-persisting mode (`persist:false`, e.g. unit tests) there is no disk
   * backing, so an unknown session is genuinely `undefined`.
   */
  async readEventHistory(
    sessionId: string,
    opts: { limit?: number } = {},
  ): Promise<{ events: AgUiEvent[]; total: number; truncated: boolean } | undefined> {
    // Without persistence the only source of truth is memory.
    if (!this.persist && !this.sessions.has(sessionId)) return undefined;
    const requestedLimit = opts.limit;
    const limit =
      requestedLimit === undefined || !Number.isFinite(requestedLimit)
        ? 1000
        : requestedLimit <= 0
          ? null
          : Math.max(1, Math.min(requestedLimit, 5000));
    const path = join(this.bpDir(sessionId), "events.jsonl");
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      // No events file. For a live (or persisting-but-new) session this is a
      // valid empty history. For an unknown session with no transcript on disk
      // there is nothing to serve → undefined so the route can 404.
      if (!this.sessions.has(sessionId)) return undefined;
      return { events: [], total: 0, truncated: false };
    }
    const lines = raw.split("\n");
    const events: AgUiEvent[] = [];
    let total = 0;
    for (const line of lines) {
      if (!line) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // skip malformed line
      }
      total++;
      events.push(parsed as AgUiEvent);
    }
    const truncated = limit !== null && events.length > limit;
    const out = truncated ? events.slice(events.length - limit!) : events;
    return { events: out, total, truncated };
  }

  metrics(): {
    activeSessions: number;
    runningAgents: number;
    lastActivityAt: string | null;
    memRss: number;
    memLimitBytes: number | null;
    memRatio: number | null;
  } {
    let runningAgents = 0;
    for (const e of this.sessions.values()) {
      for (const a of e.agents.values()) if (a.status === "running") runningAgents++;
    }
    const snap = this.memWatchdog?.snapshot() ?? null;
    return {
      activeSessions: this.sessions.size,
      runningAgents,
      lastActivityAt: this.lastActivityAt ? new Date(this.lastActivityAt).toISOString() : null,
      memRss: process.memoryUsage().rss,
      // null when the opt-in budget is unset (single-user) — keeps the metric meaningful.
      memLimitBytes: snap ? snap.limitBytes : null,
      memRatio: snap ? snap.ratio : null,
    };
  }

  /**
   * Stop background work (memory watchdog). Called on graceful shutdown so the
   * poll interval doesn't outlive the manager. Idempotent.
   */
  shutdown(): void {
    this.memWatchdog?.stop();
  }

  /**
   * Rising-edge handler when RSS crosses the soft memory threshold (§R-4).
   * Warns every currently-loaded session once so in-flight users see the
   * back-off; new sessions/messages are then refused at their entry points.
   */
  private onMemoryThrottle(snap: { rss: number; limitBytes: number }): void {
    const mb = (n: number) => Math.round(n / (1024 * 1024));
    const msg = `内存使用接近容器上限 (${mb(snap.rss)}MB / ${mb(snap.limitBytes)}MB),正在限流,暂不接受新任务。`;
    for (const [id, entry] of this.sessions) {
      entry.bus.emit(ev.systemMessage(id, "warning", msg, { recoverable: true }));
    }
  }


  /* ----------------------------- SSE/events ---------------------------- */

  subscribe(sessionId: string, listener: EventListener): (() => void) | undefined {
    const entry = this.sessions.get(sessionId);
    return entry?.bus.subscribe(listener);
  }

  recentEvents(sessionId: string): AgUiEvent[] {
    const entry = this.sessions.get(sessionId);
    if (!entry) return [];
    const recent = entry.bus.recent().filter(
      (event) => !(
        event.type === "CUSTOM" &&
        event.name === CUSTOM_EVENT.TASK_STATE &&
        (event.value as { op?: string } | undefined)?.op === "snapshot"
      ),
    );
    recent.push(
      ev.custom({ sessionId }, CUSTOM_EVENT.TASK_STATE, {
        op: "snapshot",
        tasks: entry.taskLedger.list(),
      }),
    );
    return recent;
  }

  /* ----------------------------- shutdown ------------------------------ */

  /** §7: flush all persisted state before exit. */
  async emergencySaveAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].flatMap((e) => [e.bus.flush(), e.taskLedger.flush(), e.trace.flush(), this.writeMeta(e)]),
    );
    await this.mcpBridge?.close().catch(() => {});
  }

  /* ------------------------------ helpers ------------------------------ */

  private touch(entry: SessionEntry): void {
    entry.lastActivityAt = Date.now();
    entry.updatedAt = new Date().toISOString();
    this.lastActivityAt = entry.lastActivityAt;
  }

  private toSession(e: SessionEntry): Session {
    return {
      id: e.id,
      title: e.title,
      createdAt: e.createdAt,
      updatedAt: e.updatedAt,
      domainResources: e.domainResources,
    };
  }

  private async writeMeta(entry: SessionEntry): Promise<void> {
    if (!this.persist) return;
    const meta = {
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lastActivityAt: entry.lastActivityAt,
      domainResources: entry.domainResources,
    };
    await mkdir(this.bpDir(entry.id), { recursive: true }).catch(() => {});
    await writeFile(join(this.bpDir(entry.id), "meta.json"), JSON.stringify(meta, null, 2), "utf8").catch(() => {});
  }

  private providerRefPath(sid: string): string {
    return join(this.bpDir(sid), "provider.json");
  }

  /** Persist this session's `{ providerId, modelId }` reference (no key). */
  private async writeProviderRef(entry: SessionEntry): Promise<void> {
    if (!this.persist) return;
    await mkdir(this.bpDir(entry.id), { recursive: true }).catch(() => {});
    await writeFile(
      this.providerRefPath(entry.id),
      JSON.stringify(entry.providerRef, null, 2),
      "utf8",
    ).catch(() => {});
  }

  /** Load a session's stored provider ref from disk (restore path). */
  private async readProviderRef(sid: string): Promise<SessionProviderRef> {
    try {
      const raw = await readFile(this.providerRefPath(sid), "utf8");
      const ref = JSON.parse(raw) as SessionProviderRef;
      return { providerId: ref.providerId, modelId: ref.modelId };
    } catch {
      return {};
    }
  }

  private async loadTrace(entry: SessionEntry): Promise<void> {
    try {
      const raw = await readFile(join(this.bpDir(entry.id), "trace.json"), "utf8");
      entry.trace.load(JSON.parse(raw));
    } catch {
      /* no trace yet */
    }
  }

  private usagePath(sid: string): string {
    return join(this.bpDir(sid), "usage.json");
  }

  /** Persist cumulative token usage (best-effort; never throws). */
  private async writeUsage(entry: SessionEntry): Promise<void> {
    if (!this.persist) return;
    await mkdir(this.bpDir(entry.id), { recursive: true }).catch(() => {});
    await writeFile(
      this.usagePath(entry.id),
      JSON.stringify(entry.tokenUsage, null, 2),
      "utf8",
    ).catch(() => {});
  }

  /** Rehydrate cumulative token usage from disk (restore path). */
  private async loadUsage(entry: SessionEntry): Promise<void> {
    try {
      const raw = await readFile(this.usagePath(entry.id), "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionTokenUsage>;
      const byAgent: Record<string, TokenUsage> = {};
      for (const [name, u] of Object.entries(parsed.byAgent ?? {})) {
        byAgent[name] = addUsage(emptyTokenUsage(), u as TokenUsage);
      }
      entry.tokenUsage = { byAgent, total: sumAgentUsage(byAgent) };
    } catch {
      /* no usage yet — keep the zeroed default */
    }
  }

  private statsPath(sid: string): string {
    return join(this.bpDir(sid), "stats.json");
  }

  /**
   * Persist full per-run/per-session stats (`stats.json`). Best-effort — a
   * failed write never surfaces (mirrors `writeUsage`). Written on each
   * `onRunStats` callback, not per tool call, so throughput is bounded by
   * completed-runs-per-minute.
   */
  private async writeStats(entry: SessionEntry): Promise<void> {
    if (!this.persist) return;
    await mkdir(this.bpDir(entry.id), { recursive: true }).catch(() => {});
    await writeFile(
      this.statsPath(entry.id),
      JSON.stringify(entry.stats, null, 2),
      "utf8",
    ).catch(() => {});
  }

  /**
   * Rehydrate per-run/per-session stats from disk (restore path). Silent
   * fallback to the zeroed default when the file is missing (old session that
   * predates the feature) or malformed. Only shallow-validates the top-level
   * shape; the per-run entries and inner counters are trusted from disk since
   * we wrote them.
   */
  private async loadStats(entry: SessionEntry): Promise<void> {
    try {
      const raw = await readFile(this.statsPath(entry.id), "utf8");
      const parsed = JSON.parse(raw) as Partial<SessionStats>;
      const seeded = emptySessionStats(entry.id);
      const byAgent = (parsed.byAgent ?? {}) as Record<string, AgentStats>;
      for (const [name, s] of Object.entries(byAgent)) {
        seeded.byAgent[name] = cloneAgentStats(s);
      }
      // Trust byRun on disk — normalize types via cloneAgentStats on each delta
      // to keep runtime references disjoint from the parsed JSON graph.
      const byRun = Array.isArray(parsed.byRun) ? parsed.byRun : [];
      for (const r of byRun) {
        if (!r || typeof r !== "object") continue;
        const rr = r as RunStats;
        seeded.byRun.push({
          runId: String(rr.runId ?? ""),
          agentName: String(rr.agentName ?? ""),
          startedAt: Number(rr.startedAt ?? 0),
          finishedAt: Number(rr.finishedAt ?? 0),
          status:
            rr.status === "error" || rr.status === "aborted" ? rr.status : "ok",
          delta: cloneAgentStats(rr.delta as AgentStats),
        });
      }
      recomputeSessionTotal(seeded);
      entry.stats = seeded;
    } catch {
      /* no stats yet — keep the zeroed default */
    }
  }

  /**
   * Restore session list from disk. Reads `<dataRoot>/.bp/<id>/meta.json` for
   * every directory and recreates the session entry with its original
   * timestamps preserved (provider ref, task ledger, trace also rehydrate via the
   * normal `createSession` restore path). §10 策略A: agents start idle and
   * are lazily revived when the user actually sends a message.
   *
   * Idempotent — sessions already in memory are skipped, not reset.
   *
   * Returns the ids that were restored this call (i.e. excluding ones that
   * were already loaded or whose meta.json was missing / malformed).
   */
  async restoreFromDisk(): Promise<string[]> {
    const restored: string[] = [];
    const root = join(this.dataRoot, ".bp");
    let ids: string[];
    try {
      ids = await readdir(root);
    } catch {
      return restored; // .bp/ doesn't exist yet — fresh install
    }
    for (const id of ids) {
      const sid = await this.restoreOne(id);
      if (sid !== null) restored.push(sid);
    }
    return restored;
  }

  /**
   * Read and parse `.bp/<id>/meta.json`. Returns null when the directory has no
   * meta.json (not a session dir) or the file is malformed. Shared by
   * `restoreOne`, `restoreFromDisk`, and the discovery path in `listSessions`.
   */
  private async readMeta(id: string): Promise<SessionMeta | null> {
    try {
      const raw = await readFile(join(this.dataRoot, ".bp", id, "meta.json"), "utf8");
      const meta = JSON.parse(raw) as SessionMeta;
      resolveDomainResources(meta.domainResources);
      return meta;
    } catch {
      return null;
    }
  }

  /**
   * Revive a single persisted session from disk into memory. Returns the
   * restored session id only when it was **freshly** loaded this call — null
   * when the session is already in memory (idempotent no-op) or there's no valid
   * meta.json on disk. `restoreFromDisk` relies on this to report only newly
   * restored ids; `ensureLoaded` layers "already loaded" on top separately.
   * §10 策略A: agents start idle and are lazily spawned on the next message.
   */
  private async restoreOne(id: string): Promise<string | null> {
    if (this.sessions.has(id)) return null;
    const meta = await this.readMeta(id);
    if (!meta) return null;
    const sid = meta.id ?? id;
    if (this.sessions.has(sid)) return null;
    try {
      const now = new Date().toISOString();
      await this.createSession(
        {
          id: sid,
          title: meta.title,
          domainResources: resolveDomainResources(meta.domainResources),
        },
        {
          createdAt: meta.createdAt ?? now,
          updatedAt: meta.updatedAt ?? now,
          lastActivityAt:
            typeof meta.lastActivityAt === "number" ? meta.lastActivityAt : Date.now(),
        },
      );
      return sid;
    } catch (err) {
      this.sessions.delete(sid);
      // eslint-disable-next-line no-console
      console.warn(`[runtime] skipping ${id}: ${(err as Error).message}`);
      return null;
    }
  }
}
