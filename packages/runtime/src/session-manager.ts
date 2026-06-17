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
import { mkdir, readFile, writeFile, readdir, rm, stat } from "node:fs/promises";
import { join, resolve, sep, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgUiEvent, AgentStatus, FileContent, FileEntry, Session, TraceGraph } from "@brainpilot/protocol";
import { EventBus } from "./event-bus.js";
import { Mailbox } from "./mailbox.js";
import { GraphOfTrace } from "./trace.js";
import { MasAgent } from "./mas-agent.js";
import { systemToolsForRole, builtinToolNamesForRole, type ToolDeps } from "./tools/system-tools.js";
import { ev } from "./events.js";
import { selectFactory, isMockMode } from "./agent-factory.js";
import { personaFor } from "./personas.js";
import { McpBridge, loadMcpServersConfig } from "./mcp-bridge.js";
import { resolveSessionProvider, type SessionProviderRef } from "./provider-config.js";
import { MemWatchdog, parseMemLimitMb } from "./mem-watchdog.js";
import type { AgentRole, AgentSessionFactory, EventListener, SystemTool } from "./types.js";

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
}

/** Roles inferred from agent name. */
function roleFor(name: string): AgentRole {
  if (name === "principal") return "principal";
  if (name === "trace") return "trace";
  return "expert";
}

export class SessionManager {
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly dataRoot: string;
  private readonly agentFactory: AgentSessionFactory;
  private readonly persist: boolean;
  private lastActivityAt = 0;

  // External MCP tools (§9 decision 2): loaded once, lazily, shared by all
  // non-trace agents. Null until first agent is created.
  private mcpBridge: McpBridge | null;
  private mcpTools: SystemTool[] = [];
  private mcpLoaded = false;

  // Opt-in memory watchdog (§R-4 / issue #20). Null when no budget is set.
  private readonly memWatchdog: MemWatchdog | null;

  constructor(opts: SessionManagerOptions = {}) {
    this.dataRoot = opts.dataRoot ?? process.env.BP_DATA_DIR ?? join(process.cwd(), ".bp-data");
    this.agentFactory = opts.agentFactory ?? selectFactory();
    this.persist = opts.persist ?? true;
    this.mcpBridge = opts.mcpBridge ?? null;

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
  ): Promise<Session> {
    if (this.memWatchdog?.isOverSoftLimit()) {
      throw new Error("memory budget exceeded: refusing new session");
    }
    const id = input.id ?? randomUUID();
    if (this.sessions.has(id)) return this.toSession(this.sessions.get(id)!);
    const nowIso = new Date().toISOString();
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
    const trace = new GraphOfTrace(id, persistBase ? join(persistBase, "trace.json") : undefined);

    const entry: SessionEntry = {
      id,
      title: input.title ?? "Untitled session",
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActivityAt: Date.now(),
      bus,
      mailbox,
      trace,
      agents: new Map(),
      tasks: new Map(),
      runActive: false,
      activeRunId: null,
      providerRef,
    };
    this.sessions.set(id, entry);
    this.touch(entry);

    if (this.persist) {
      await mkdir(join(this.bpDir(id), "history"), { recursive: true });
      await mkdir(this.sessionSkillsDir(id), { recursive: true });
      await mkdir(this.workspaceDir(id), { recursive: true });
      await this.writeMeta(entry);
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
    entry.runActive = true;
    entry.activeRunId = `run_${randomUUID()}`;
    const runId = entry.activeRunId;
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
      });
    return { accepted: true, runId };
  }

  /** Interrupt a session (or a specific agent). */
  async interrupt(sessionId: string, agentName?: string): Promise<boolean> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return false;
    const targets = agentName ? [entry.agents.get(agentName)].filter(Boolean) : [...entry.agents.values()];
    for (const a of targets) await a!.abort();
    entry.runActive = false;
    entry.activeRunId = null;
    return targets.length > 0;
  }

  /* ------------------------------ agents ------------------------------- */

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
    };
    const systemTools = systemToolsForRole(role, name, deps);
    // External MCP tools go to non-trace agents (trace agent is graph-only, §9).
    const mcpTools = role === "trace" ? [] : await this.ensureMcpTools();
    const agentTools = [...systemTools, ...mcpTools];
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
    });

    const agent = new MasAgent({
      sessionId,
      name,
      role,
      session,
      bus: entry.bus,
      onStatusChange: () => this.touch(entry),
    });
    entry.agents.set(name, agent);
    if (!entry.tasks.has(name)) entry.tasks.set(name, "");
    return agent;
  }

  async destroyAgent(sessionId: string, name: string): Promise<void> {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    const agent = entry.agents.get(name);
    if (!agent) return;
    agent.stop();
    entry.agents.delete(name); // history on disk is kept (§5).
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

  getSessionState(sessionId: string): {
    runState: { active: boolean; runId: string | null };
    agents: AgentStatus[];
    lastActivityTs: string;
  } | undefined {
    const entry = this.sessions.get(sessionId);
    if (!entry) return undefined;
    return {
      runState: { active: entry.runActive, runId: entry.activeRunId },
      agents: this.listAgents(sessionId),
      lastActivityTs: new Date(entry.lastActivityAt).toISOString(),
    };
  }

  /** The session's Graph of Trace (reasoning DAG), or undefined if no session. */
  getTrace(sessionId: string): TraceGraph | undefined {
    const entry = this.sessions.get(sessionId);
    return entry?.trace.getGraph();
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

  /** Restore session list from disk (§10 策略A: agents start idle, lazily revived). */
  async restoreFromDisk(): Promise<string[]> {
    const restored: string[] = [];
    const root = join(this.dataRoot, ".bp");
    let ids: string[];
    try {
      ids = await readdir(root);
    } catch {
      return restored;
    }
    for (const id of ids) {
      try {
        const raw = await readFile(join(root, id, "meta.json"), "utf8");
        const meta = JSON.parse(raw) as { id: string; title?: string };
        if (!this.sessions.has(meta.id)) {
          await this.createSession({ id: meta.id, title: meta.title });
          restored.push(meta.id);
        }
      } catch {
        /* skip non-session dirs */
      }
    }
    return restored;
  }
}
