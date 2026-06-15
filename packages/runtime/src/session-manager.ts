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
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AgUiEvent, AgentStatus, Session } from "@brainpilot/protocol";
import { EventBus } from "./event-bus.js";
import { Mailbox } from "./mailbox.js";
import { GraphOfTrace } from "./trace.js";
import { MasAgent } from "./mas-agent.js";
import { systemToolsForRole, builtinToolNamesForRole, type ToolDeps } from "./tools/system-tools.js";
import { ev } from "./events.js";
import { selectFactory, isMockMode } from "./agent-factory.js";
import { personaFor } from "./personas.js";
import { McpBridge, loadMcpServersConfig } from "./mcp-bridge.js";
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

  constructor(opts: SessionManagerOptions = {}) {
    this.dataRoot = opts.dataRoot ?? process.env.BP_DATA_DIR ?? join(process.cwd(), ".bp-data");
    this.agentFactory = opts.agentFactory ?? selectFactory();
    this.persist = opts.persist ?? true;
    this.mcpBridge = opts.mcpBridge ?? null;
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

  async createSession(input: { id?: string; title?: string } = {}): Promise<Session> {
    const id = input.id ?? randomUUID();
    if (this.sessions.has(id)) return this.toSession(this.sessions.get(id)!);
    const nowIso = new Date().toISOString();
    const persistBase = this.persist ? this.bpDir(id) : undefined;

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
    };
    this.sessions.set(id, entry);
    this.touch(entry);

    if (this.persist) {
      await mkdir(join(this.bpDir(id), "history"), { recursive: true });
      await mkdir(this.sessionSkillsDir(id), { recursive: true });
      await mkdir(this.workspaceDir(id), { recursive: true });
      await this.writeMeta(entry);
      await mailbox.recover();
      await this.loadTrace(entry);
    }
    return this.toSession(entry);
  }

  getSession(id: string): Session | undefined {
    const e = this.sessions.get(id);
    return e ? this.toSession(e) : undefined;
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
  async sendMessage(sessionId: string, content: string, agentName = "principal"): Promise<{ accepted: boolean; runId?: string }> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`session not found: ${sessionId}`);
    this.touch(entry);
    const agent = await this.ensureAgent(sessionId, agentName);
    entry.runActive = true;
    entry.activeRunId = `run_${randomUUID()}`;
    const runId = entry.activeRunId;
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

  metrics(): { activeSessions: number; runningAgents: number; lastActivityAt: string | null; memRss: number } {
    let runningAgents = 0;
    for (const e of this.sessions.values()) {
      for (const a of e.agents.values()) if (a.status === "running") runningAgents++;
    }
    return {
      activeSessions: this.sessions.size,
      runningAgents,
      lastActivityAt: this.lastActivityAt ? new Date(this.lastActivityAt).toISOString() : null,
      memRss: process.memoryUsage().rss,
    };
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
