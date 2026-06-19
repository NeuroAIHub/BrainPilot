/**
 * SessionManager — orchestration core + STATE AUTHORITY (§10).
 *
 * Owns all sessions. Each session owns its agents (MasAgent), Mailbox, trace
 * (GraphOfTrace), and EventBus. The manager is the sole authority for agent
 * status; it surfaces `GET /sessions/:id/agents`, `agent_status_update` SSE
 * events, and feeds `/metrics`.
 *
 * Persistence (§5): config/history/state live under `<dataRoot>/.bp/{sid}/`,
 * work files under `<dataRoot>/workspaces/{sid}/`.
 */
import { mkdir, readFile, writeFile, readdir, rm, stat, rename } from "node:fs/promises";
import { join, resolve, sep, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  CUSTOM_EVENT,
  type AgUiEvent,
  type AgentStatus,
  type FileContent,
  type FileEntry,
  type Session,
  type TraceGraph,
} from "@brainpilot/protocol";
import { EventBus } from "./event-bus.js";
import { Mailbox, type MailboxMessage } from "./mailbox.js";
import { GraphOfTrace } from "./trace.js";
import { MasAgent } from "./mas-agent.js";
import { systemToolsForRole, builtinToolNamesForRole, type ToolDeps } from "./tools/system-tools.js";
import { ev } from "./events.js";
import { selectFactory, isMockMode } from "./agent-factory.js";
import { personaFor } from "./personas.js";
import { McpBridge, loadMcpServersConfig } from "./mcp-bridge.js";
import { resolveSessionProvider, type SessionProviderRef } from "./provider-config.js";
import { MemWatchdog, parseMemLimitMb } from "./mem-watchdog.js";
import type { AgentRole, AgentSessionFactory, EventListener, SystemTool, SystemToolResult } from "./types.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface SessionEntry {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: number;
  bus: EventBus;
  mailbox: Mailbox;
  trace: GraphOfTrace;
  agents: Map<string, MasAgent>;
  /** agent name → task description (for AgentStatus.task). */
  tasks: Map<string, string>;
  runActive: boolean;
  activeRunId: string | null;
  /** Outstanding ask_user requests, keyed by request_id (§ ask_user). */
  pendingInputs: Map<string, Deferred<string>>;
  /** This session's chosen provider/model (resolved against providers.json). */
  providerRef: SessionProviderRef;
}

export interface SessionManagerOptions {
  /** Data root (default: BP_DATA_DIR or cwd/.bp-data). */
  dataRoot?: string;
  /** Override the agent session factory (default: env-selected). */
  agentFactory?: AgentSessionFactory;
  /** Persist events.jsonl / mailbox / trace.json (default true). */
  persist?: boolean;
  /** Override the external MCP bridge (default: real stdio bridge). Tests inject a fake. */
  mcpBridge?: McpBridge;
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
  private readonly dataRoot: string;
  private readonly agentFactory: AgentSessionFactory;
  private readonly persist: boolean;
  private lastActivityAt = 0;

  // #76: active mailbox delivery. A delivery loop drains a target agent's inbox
  // and runs it; the key (`${sid}:${name}`) guards re-entrancy so concurrent
  // wakes for one agent collapse into a single serial loop (its `prompt` is
  // never invoked concurrently).
  private readonly deliveryLoops = new Set<string>();

  // External MCP tools (§9 decision 2): loaded once, lazily, shared by all
  // non-trace agents. Null until first agent is created.
  private mcpBridge: McpBridge | null;
  private mcpTools: SystemTool[] = [];
  private mcpLoaded = false;

  // Opt-in memory watchdog (§R-4 / issue #20). Null when no budget is set.
  private readonly memWatchdog: MemWatchdog | null;

  // Tool result truncation (issue #80). 0 = disabled.
  private readonly maxToolResultTokens: number;

  constructor(opts: SessionManagerOptions = {}) {
    this.dataRoot = opts.dataRoot ?? process.env.BP_DATA_DIR ?? join(process.cwd(), ".bp-data");
    this.agentFactory = opts.agentFactory ?? selectFactory();
    this.persist = opts.persist ?? true;
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
   * #60: composer uploads in single-user mode are POSTed against the literal
   * sandbox id `"local"` (the web `LOCAL_SANDBOX.id`), because a file can be
   * attached in the draft composer *before* the real session exists. They land
   * in `workspaces/local/` — but the agent's cwd is `workspaces/<sessionId>/`,
   * so without this it can't read the file the user just attached. We treat
   * `workspaces/local/` as a staging area and drain it into the real session
   * workspace right before the agent runs (see drainLocalUploads).
   */
  private static readonly UPLOAD_STAGING_SID = "local";
  private historyPath(sid: string, agent: string): string {
    return join(this.bpDir(sid), "history", `${agent}.jsonl`);
  }
  /** Skills shared by every session (user-editable `bp_template/skills/`). */
  private templateSkillsDir(): string {
    return join(this.dataRoot, "bp_template", "skills");
  }
  /** This session's own skill dir (`.bp/<sid>/skills/`), overrides/augments the template. */
  private sessionSkillsDir(sid: string): string {
    return join(this.bpDir(sid), "skills");
  }
  /** User-editable persona override for an agent (`bp_template/agents/<name>/prompt.md`). */
  private agentPromptPath(name: string): string {
    return join(this.dataRoot, "bp_template", "agents", name, "prompt.md");
  }

  /* ----------------------------- workspace files ----------------------------- */

  /**
   * Resolve a workspace-relative path to an absolute one, refusing anything that
   * escapes the session's `workspaces/<sid>/` root (path traversal guard). This
   * is the single enforcement point for all file routes.
   *
   * The SPA addresses files with a `/workspace`-rooted convention
   * (`/workspace`, `/workspace/sub/file.txt`); we normalize that to a path
   * relative to the on-disk workspace root before resolving.
   */
  private resolveWorkspacePath(sid: string, rawPath: string): string {
    const root = this.workspaceDir(sid);
    let rel = rawPath ?? "";
    if (rel === "/workspace") rel = "";
    else if (rel.startsWith("/workspace/")) rel = rel.slice("/workspace/".length);
    rel = rel.replace(/^\/+/, ""); // never let a leading slash make it absolute
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) {
      throw new Error(`path escapes workspace: ${rawPath}`);
    }
    return abs;
  }

  /** List one directory level under the session workspace (default: root). */
  async listSessionFiles(sid: string, rel = ""): Promise<FileEntry[]> {
    const dir = this.resolveWorkspacePath(sid, rel);
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return []; // missing workspace → empty (new session, nothing written yet)
    }
    const entries = await Promise.all(
      dirents.map(async (d) => {
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
          permissions = (st.mode & 0o777).toString(8);
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
    const abs = this.resolveWorkspacePath(sid, rel);
    const content = await readFile(abs, "utf8");
    return { path: rel, content, size: Buffer.byteLength(content) };
  }

  /** Read a workspace file's raw bytes (images/PDF/download). */
  async readSessionFileRaw(sid: string, rel: string): Promise<Buffer> {
    const abs = this.resolveWorkspacePath(sid, rel);
    return readFile(abs);
  }

  /** Delete a workspace file. Returns false if it was already gone. */
  async deleteSessionFile(sid: string, rel: string): Promise<boolean> {
    const abs = this.resolveWorkspacePath(sid, rel);
    try {
      await rm(abs, { recursive: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * #47: write an uploaded file into the session workspace. Content arrives
   * base64-encoded (binary-safe over the JSON byte chain). The same
   * `resolveWorkspacePath` guard prevents path traversal; parent dirs are
   * created so an upload like `docs/foo.pdf` works. The file lands in the
   * agent's cwd, so it can `read` it by its workspace-relative path.
   * `maxBytes` (default 20 MiB) bounds the decoded size.
   */
  async writeSessionFile(
    sid: string,
    rel: string,
    contentBase64: string,
    maxBytes = 20 * 1024 * 1024,
  ): Promise<{ path: string; size: number }> {
    const buf = Buffer.from(contentBase64, "base64");
    if (buf.byteLength > maxBytes) {
      throw new Error(`file too large: ${buf.byteLength} bytes exceeds limit of ${maxBytes}`);
    }
    const abs = this.resolveWorkspacePath(sid, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buf);
    // Return the workspace-relative path (strip the absolute root prefix).
    const root = this.workspaceDir(sid);
    const relOut = abs === root ? "" : abs.slice(root.length + 1);
    return { path: relOut, size: buf.byteLength };
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
  private async loadPersona(name: string, role: AgentRole): Promise<string> {
    try {
      const raw = (await readFile(this.agentPromptPath(name), "utf8")).trim();
      if (raw) return raw;
    } catch {
      // No on-disk override — fall through to the built-in persona.
    }
    return personaFor(name, role);
  }

  /* ---------------------------- session CRUD ---------------------------- */

  async createSession(
    input: { id?: string; title?: string; providerId?: string; modelId?: string } = {},
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
    const id = input.id ?? randomUUID();
    if (this.sessions.has(id)) return this.toSession(this.sessions.get(id)!);
    const nowIso = _restore ? _restore.updatedAt : new Date().toISOString();
    const createdAt = _restore ? _restore.createdAt : nowIso;
    const lastActivityAt = _restore ? _restore.lastActivityAt : Date.now();
    const persistBase = this.persist ? this.bpDir(id) : undefined;

    // Provider ref: explicit input wins; otherwise reuse an existing on-disk ref
    // (restore path) so reviving a session never clobbers its chosen model.
    const explicitRef = input.providerId !== undefined || input.modelId !== undefined;
    const providerRef: SessionProviderRef = explicitRef
      ? { providerId: input.providerId, modelId: input.modelId }
      : this.persist
        ? await this.readProviderRef(id)
        : {};

    const bus = new EventBus({ persistPath: persistBase ? join(persistBase, "events.jsonl") : undefined });
    const mailbox = new Mailbox(id, persistBase ? join(persistBase, "mailbox") : undefined);
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
      mailbox,
      trace,
      agents: new Map(),
      tasks: new Map(),
      runActive: false,
      activeRunId: null,
      pendingInputs: new Map(),
      providerRef,
    };
    this.sessions.set(id, entry);
    if (!_restore) this.touch(entry);
    else this.lastActivityAt = entry.lastActivityAt;

    if (this.persist) {
      await mkdir(join(this.bpDir(id), "history"), { recursive: true });
      await mkdir(this.sessionSkillsDir(id), { recursive: true });
      await mkdir(this.workspaceDir(id), { recursive: true });
      // On restore, meta.json on disk is the authority — do not write it back.
      if (!_restore) await this.writeMeta(entry);
      // Only (re)write the ref when the caller chose one — restore must not
      // clobber an existing ref with an empty object.
      if (explicitRef) await this.writeProviderRef(entry);
      await mailbox.recover();
      await this.loadTrace(entry);
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

  listSessions(): Session[] {
    return [...this.sessions.values()].map((e) => this.toSession(e));
  }

  async deleteSession(id: string): Promise<boolean> {
    const e = this.sessions.get(id);
    if (!e) return false;
    for (const a of e.agents.values()) a.stop();
    e.bus.clear();
    this.sessions.delete(id);
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
    let killed = 0;
    for (const a of e.agents.values()) {
      a.stop();
      killed++;
    }
    await e.bus.flush();
    await e.mailbox.flush();
    await e.trace.flush();
    e.bus.clear();
    for (const [id2, d] of e.pendingInputs) {
      d.reject(new Error("evicted"));
      e.pendingInputs.delete(id2);
    }
    this.sessions.delete(id);
    return { evicted: true, agentsKilled: killed };
  }

  /* ----------------------------- messaging ----------------------------- */

  /** Send a user message to an agent (default principal). §7 L3 isolated. */
  async sendMessage(
    sessionId: string,
    content: string,
    agentName = "principal",
    opts: { uuid?: string } = {},
  ): Promise<{ accepted: boolean; runId?: string }> {
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
    void agent
      .prompt(content)
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
      });
    return { accepted: true, runId };
  }

  /**
   * Ask the terminal user a question on behalf of `agent`. Emits a
   * `user_input_request` event and returns a promise that resolves when
   * `resolveInput` is called with the matching request_id, or rejects if the
   * session is interrupted/evicted. Blocks the calling tool's turn.
   */
  private requestUserInput(
    entry: SessionEntry,
    agent: string,
    req: { question: string; options?: string[]; allow_free_text?: boolean },
  ): Promise<string> {
    const requestId = `req_${randomUUID()}`;
    const deferred = makeDeferred<string>();
    entry.pendingInputs.set(requestId, deferred);
    entry.bus.emit(
      ev.userInputRequest(
        { sessionId: entry.id, runId: entry.activeRunId ?? undefined },
        { request_id: requestId, agent, question: req.question, options: req.options, allow_free_text: req.allow_free_text },
      ),
    );
    return deferred.promise;
  }

  /**
   * Resolve an outstanding ask_user request. Returns false when the session or
   * request_id is unknown/already consumed (stale answer). Pure lookup; never
   * throws — the server handles 404 for unknown sessions before calling.
   */
  resolveInput(sessionId: string, requestId: string, answer: string): boolean {
    const entry = this.sessions.get(sessionId);
    const deferred = entry?.pendingInputs.get(requestId);
    if (!entry || !deferred) return false;
    entry.pendingInputs.delete(requestId);
    deferred.resolve(answer);
    this.touch(entry);
    return true;
  }

  /**
   * Interrupt a session (or a specific agent).
   *
   * Targeted (`agentName` given): abort just that agent. Mailboxes and the
   * principal are left untouched — a narrow "stop this one expert" contract.
   *
   * Whole-session (`agentName` omitted, the Stop button — #90): abort EVERY
   * agent (incl. their running script subprocesses, via Pi `session.abort()`),
   * then clear ALL mailboxes so a queued message can't re-wake a stopped agent,
   * surface a user-facing system_message, and immediately prompt the principal
   * one run with an interrupt notice so PI knows the user interrupted and should
   * await further instructions.
   */
  async interrupt(sessionId: string, agentName?: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    const wholeSession = agentName === undefined;
    const targets = agentName ? [entry.agents.get(agentName)].filter(Boolean) : [...entry.agents.values()];
    for (const a of targets) await a!.abort();
    entry.runActive = false;
    entry.activeRunId = null;
    for (const [id, d] of entry.pendingInputs) {
      d.reject(new Error("interrupted"));
      entry.pendingInputs.delete(id);
    }
    if (wholeSession) {
      // Clear every inbox BEFORE notifying PI: otherwise a queued task_delegate
      // would re-wake the expert the user just stopped.
      await entry.mailbox.clearAll();
      entry.bus.emit(
        ev.systemMessage(sessionId, "info", "⏹️ 用户已中断当前任务,信箱已清空,正在等候进一步指示。", {
          agent: "principal",
          recoverable: true,
        }),
      );
      this.notifyPrincipalInterrupted(entry);
    }
    return targets.length > 0;
  }

  /**
   * #90: after a whole-session Stop, prompt the principal one run with an
   * interrupt notice. Mirrors `sendMessage`'s fire-and-track run accounting but
   * emits NO role:"user" text chunk — the notice is system context, not a user
   * bubble. The principal should acknowledge briefly and await the user.
   */
  private notifyPrincipalInterrupted(entry: SessionEntry): void {
    const notice =
      "<system_notice>\n" +
      "  The user interrupted the current task. All running agents were stopped " +
      "and every mailbox was cleared, so any in-flight delegation is cancelled. " +
      "Do not resume or re-delegate the prior work. Briefly acknowledge the " +
      "interruption and wait for the user's next instruction.\n" +
      "</system_notice>";
    void this.ensureAgent(entry.id, "principal")
      .then((agent) => {
        entry.runActive = true;
        entry.activeRunId = `run_${randomUUID()}`;
        this.emitSessionState(entry);
        return agent.prompt(notice).finally(() => {
          entry.runActive = false;
          entry.activeRunId = null;
          this.touch(entry);
          this.emitSessionState(entry);
        });
      })
      .catch(() => {
        /* error-isolated: prompt() never throws, ensureAgent failure is best-effort */
      });
  }

  /** Test/diagnostic accessor: number of queued messages in `agent`'s inbox. */
  mailboxCount(sessionId: string, agent: string): number {
    return this.sessions.get(sessionId)?.mailbox.count(agent) ?? 0;
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
      mailbox: entry.mailbox,
      trace: entry.trace,
      ensureAgent: async (target) => {
        await this.ensureAgent(sessionId, target);
      },
      destroyAgent: async (target) => {
        await this.destroyAgent(sessionId, target);
      },
      wakeAgent: (target) => this.wakeAgent(sessionId, target),
      requestUserInput: (req) => this.requestUserInput(entry, name, req),
    };
    const systemTools = systemToolsForRole(role, name, deps);
    // External MCP tools go to non-trace agents (trace agent is graph-only, §9).
    const mcpTools = role === "trace" ? [] : await this.ensureMcpTools();
    const rawTools = [...systemTools, ...mcpTools];
    // #80: guard every tool result against context-window overflow.
    const agentTools = rawTools.map((t) => this.wrapToolWithTruncation(t, sessionId, entry.bus));
    const builtins = builtinToolNamesForRole(role, name);
    const allowedToolNames = [...builtins, ...agentTools.map((t) => t.name)];

    // Resolve this session's provider against the SSOT (providers.json). When
    // unset/empty the factory falls back to Pi's env-based default.
    const providerConfig = await resolveSessionProvider(this.dataRoot, entry.providerRef);

    const session = await this.agentFactory({
      sessionId,
      agentName: name,
      role,
      historyPath: this.historyPath(sessionId, name),
      cwd: this.workspaceDir(sessionId),
      systemTools: agentTools,
      allowedToolNames,
      systemPrompt: await this.loadPersona(name, role),
      skillPaths: [this.templateSkillsDir(), this.sessionSkillsDir(sessionId)],
      providerConfig,
      // 意图二 fallback: the trace-reminder extension calls this when an expert
      // was reminded once and still didn't report back, so the principal never
      // dead-waits on a silent expert.
      onUnreplied: (agentName) => this.writeFallbackToPrincipal(entry, agentName),
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
    });
    entry.agents.set(name, agent);
    if (!entry.tasks.has(name)) entry.tasks.set(name, "");
    return agent;
  }

  /**
   * 意图二 fallback — the trace-reminder extension calls this (via the factory's
   * `onUnreplied`) when an expert was reminded once and STILL did not
   * `send_message` the principal. We write a system note into the principal's
   * mailbox and wake it, so the principal can re-delegate or proceed without the
   * silent expert's output rather than dead-waiting. Best-effort: a failed write
   * must never break the agent loop.
   */
  private writeFallbackToPrincipal(entry: SessionEntry, expert: string): void {
    void entry.mailbox
      .write({
        fromAgent: "system",
        toAgent: "principal",
        msgType: "system",
        content: `专家 ${expert} 多次未回交结果。建议重新委派该任务，或不依赖其输出继续推进。`,
      })
      .then(() => this.wakeAgent(entry.id, "principal"))
      .catch(() => {
        /* best-effort */
      });
  }

  async destroyAgent(sessionId: string, name: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const agent = entry.agents.get(name);
    if (!agent) return;
    agent.stop();
    entry.agents.delete(name); // history on disk is kept (§5).
  }

  /* ------------------------- mailbox delivery (#76) ------------------------- */

  /**
   * #76: wake `name` to consume its mailbox. Fire-and-forget — `send_message`
   * calls this after writing; the actual run happens in a serial delivery loop.
   * The re-entrancy guard (`deliveryLoops`) means concurrent wakes for the same
   * agent collapse into the one already-running loop (which re-drains after each
   * turn), so an agent's `prompt` is never invoked concurrently.
   */
  private wakeAgent(sessionId: string, name: string): void {
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
      // Re-check after releasing the guard: a message could have been written
      // between the loop's final empty read and this delete, and that writer's
      // wakeAgent would have bailed (key still present) — leaving the message
      // unread. Re-wake if the inbox is non-empty so it never strands.
      if (entry && entry.mailbox.count(name) > 0) this.wakeAgent(sessionId, name);
    });
  }

  /**
   * Drain `name`'s inbox and run it, looping so messages that arrive *during* a
   * turn are picked up without a second external wake. Each iteration atomically
   * drains the inbox, ensures the agent, wraps the messages as
   * `<message_envelope>`s (the format the A2A persona documents), and prompts.
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
      const msgs = await entry.mailbox.readBatch(name); // bounded FIFO batch (#76)
      if (msgs.length === 0) return;
      const agent = await this.ensureAgent(sessionId, name);
      if (agent.status === "stopped") return;
      this.touch(entry);
      // Surface the delegated run immediately (derived active flag, agent list).
      this.emitSessionState(entry);
      await agent.prompt(this.renderEnvelopes(msgs, name));
    }
  }

  /**
   * Wrap drained mailbox messages in the `<message_envelope>` header the A2A
   * persona (`personas.ts`) tells agents to expect, so the model knows who sent
   * each message and why. User-origin messages declare `<source type="user"/>`;
   * agent-origin ones name the sender.
   *
   * 意图一·触发点2 (Pi-native hooks): when the PRINCIPAL receives a message from
   * another agent (not the user — i.e. an expert reporting back), append a single
   * static line nudging it to record_trace any real decision it makes while
   * processing the reply. Stateless, loop-free (at most one line per delivery).
   */
  private renderEnvelopes(msgs: readonly MailboxMessage[], toAgent: string): string {
    const body = msgs
      .map((m) => {
        const source =
          m.msgType === "user_message"
            ? `<source type="user" />`
            : `<source type="agent" name="${m.fromAgent}" />`;
        return `<message_envelope>\n  ${source}\n  <type>${m.msgType}</type>\n</message_envelope>\n${m.content}`;
      })
      .join("\n\n");

    const fromAgent = msgs.some((m) => m.msgType !== "user_message");
    if (toAgent === "principal" && fromAgent) {
      return `${body}\n\n[提醒：处理完这些消息后，如有实质决策请调用 record_trace 记录。]`;
    }
    return body;
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
        task: entry.tasks.get(a.name) ?? "",
        updatedAt: new Date().toISOString(),
        alive: st.status !== "stopped",
      };
      return out;
    });
  }

  /**
   * #76: a session is "running" whenever ANY non-trace agent is running, or a
   * mailbox delivery loop is pending for a non-trace target (the loop is
   * registered synchronously inside `send_message`, so this closes the await gap
   * between the sender finishing its turn and the delegated target starting —
   * without it the flag would flicker false in that window). The trace agent is
   * a real spawned agent (record_trace dispatches `trace_event` envelopes into
   * its mailbox and it owns the Graph of Trace as editor, see
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
      }),
    );
  }

  getSessionState(sessionId: string): {
    runState: { active: boolean; runId: string | null };
    agents: AgentStatus[];
    lastActivityTs: string;
  } | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    return {
      runState: { active: this.deriveRunActive(entry), runId: entry.activeRunId },
      agents: this.listAgents(sessionId),
      lastActivityTs: new Date(entry.lastActivityAt).toISOString(),
    };
  }

  /** The session's Graph of Trace (reasoning DAG), or undefined if no session. */
  getTrace(sessionId: string): TraceGraph | undefined {
    const entry = this.sessions.get(sessionId);
    return entry?.trace.getGraph();
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
   * Returns `undefined` if the session id isn't in memory — this method is
   * only useful for known sessions (call `restoreFromDisk` first if needed).
   */
  async readEventHistory(
    sessionId: string,
    opts: { limit?: number } = {},
  ): Promise<{ events: AgUiEvent[]; total: number; truncated: boolean } | undefined> {
    if (!this.sessions.has(sessionId)) return undefined;
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
      // No events file yet — empty history is valid (newly created session).
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
    return this.sessions.get(sessionId)?.bus.recent() ?? [];
  }

  /* ----------------------------- shutdown ------------------------------ */

  /** §7: flush all persisted state before exit. */
  async emergencySaveAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.values()].flatMap((e) => [e.bus.flush(), e.mailbox.flush(), e.trace.flush(), this.writeMeta(e)]),
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
    return { id: e.id, title: e.title, createdAt: e.createdAt, updatedAt: e.updatedAt };
  }

  private async writeMeta(entry: SessionEntry): Promise<void> {
    if (!this.persist) return;
    const meta = {
      id: entry.id,
      title: entry.title,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      lastActivityAt: entry.lastActivityAt,
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

  /**
   * Restore session list from disk. Reads `<dataRoot>/.bp/<id>/meta.json` for
   * every directory and recreates the session entry with its original
   * timestamps preserved (provider ref, mailbox, trace also rehydrate via the
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
      if (this.sessions.has(id)) continue;
      const metaPath = join(root, id, "meta.json");
      let raw: string;
      try {
        raw = await readFile(metaPath, "utf8");
      } catch {
        continue; // not a session dir (no meta.json) — silent skip
      }
      try {
        const meta = JSON.parse(raw) as {
          id?: string;
          title?: string;
          createdAt?: string;
          updatedAt?: string;
          lastActivityAt?: number;
        };
        const sid = meta.id ?? id;
        if (this.sessions.has(sid)) continue;
        const now = new Date().toISOString();
        await this.createSession(
          { id: sid, title: meta.title },
          {
            createdAt: meta.createdAt ?? now,
            updatedAt: meta.updatedAt ?? now,
            lastActivityAt:
              typeof meta.lastActivityAt === "number" ? meta.lastActivityAt : Date.now(),
          },
        );
        restored.push(sid);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[runtime] skipping ${id}: ${(err as Error).message}`);
      }
    }
    return restored;
  }
}
