/**
 * BrainPilot system tools (§9 decision 1) — defined as plain `SystemTool`
 * objects (name + JSON-schema params + execute closure). The real agent
 * factory wraps these with Pi's `defineTool`; the mock invokes `execute`
 * directly. Closures capture session context (task ledger, trace, manager).
 *
 * Per-agent access control (§9, ported from legacy `agent_tool_config`) is
 * applied by `toolsForRole` — each role only receives its allowed tools.
 */
import type { AgentRole, SystemTool } from "../types.js";
import { TaskQueueFullError, type TaskRecord } from "../task-ledger.js";
import type { GraphOfTrace } from "../trace.js";
import { createSkillSearchTool } from "./skill-search.js";
import {
  createGetDomainKnowledgeLocalTool,
  createSearchPapersLocalTool,
} from "./kb/tools.js";
import { isToolEnabled, type ToolToggles } from "../tool-toggles.js";

export interface ToolDeps {
  sessionId: string;
  fromAgent: string;
  trace: GraphOfTrace;
  dispatchTask: (to: string, content: string) => Promise<TaskRecord>;
  completeTask: (taskId: string, reply: string) => Promise<TaskRecord>;
  dispatchTrace: (content: string) => Promise<void>;
  /** Ensure an agent exists (auto-create/resurrect). */
  ensureAgent: (name: string) => Promise<void>;
  /** Destroy an agent (memory only; history kept). */
  destroyAgent: (name: string) => Promise<void>;
  /**
   * Wake a target agent to consume task notifications. Fire-and-forget: kicks a
   * serial delivery loop on the target so a committed task actually starts
   * its run, instead of sitting unread in an idle agent's inbox.
   */
  wakeAgent: (name: string) => void;
  /** Ask the terminal user a question; resolves with their answer. Blocks the turn. */
  requestUserInput: (req: {
    question: string;
    options?: string[];
    allow_free_text?: boolean;
  }) => Promise<string>;
  /**
   * Absolute path to the router skill base directory
   * (`<dataRoot>/bp_template/skills-router`). Backs the `skill_search` tool —
   * a Pi-native custom tool that lazily loads skills NOT exposed via Pi's
   * native `<available_skills>` block. Distinct from the always-on
   * `bp_template/skills/` dir loaded through `additionalSkillPaths`.
   */
  routerSkillsDir: string;
}

function ok(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

export function createDispatchTaskTool(deps: ToolDeps): SystemTool {
  return {
    name: "dispatch_task",
    description:
      "Create an independent task for another agent. Returns a stable task ID; include all context and relevant workspace file paths.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", minLength: 1, description: "Self-contained task and acceptance criteria" },
        to: { type: "string", description: "Target agent name" },
      },
      required: ["content", "to"],
    },
    execute: async (params: Record<string, unknown>) => {
      const to = String(params.to ?? "").trim();
      const content = String(params.content ?? "").trim();
      if (!to || !content) return { ...ok("to and content are required"), isError: true };
      if (to === deps.fromAgent) return { ...ok("cannot dispatch a task to yourself"), isError: true };
      if (to === "trace") return { ...ok("cannot dispatch user tasks to the trace agent"), isError: true };
      await deps.ensureAgent(to);
      try {
        const task = await deps.dispatchTask(to, content);
        deps.wakeAgent(to);
        return ok(`task ${task.id} dispatched to ${to}`);
      } catch (err) {
        if (err instanceof TaskQueueFullError) {
          return { ...ok(`cannot dispatch to ${to}: ${err.message}`), isError: true };
        }
        return { ...ok(`cannot dispatch task: ${(err as Error).message}`), isError: true };
      }
    },
  };
}

export function createCompleteTaskTool(deps: ToolDeps): SystemTool {
  return {
    name: "complete_task",
    description:
      "Complete one task assigned to you and return its result to the task creator. Include conclusions and relevant workspace file paths; if blocked, explain why.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", minLength: 1, description: "Exact ID from assigned_to_me" },
        reply: { type: "string", minLength: 1, description: "Result, limitations, and artifact paths" },
      },
      required: ["task_id", "reply"],
    },
    execute: async (params: Record<string, unknown>) => {
      const taskId = String(params.task_id ?? "").trim();
      const reply = String(params.reply ?? "").trim();
      if (!taskId || !reply) return { ...ok("task_id and reply are required"), isError: true };
      try {
        const task = await deps.completeTask(taskId, reply);
        deps.wakeAgent(task.created_by);
        return ok(`task ${task.id} completed for ${task.created_by}`);
      } catch (err) {
        return { ...ok(`cannot complete task: ${(err as Error).message}`), isError: true };
      }
    },
  };
}

export function createAskUserTool(deps: ToolDeps): SystemTool {
  return {
    name: "ask_user",
    description:
      "Ask the human user a question and wait for their answer. Use when you need a decision or information only the user can provide. Returns the user's answer as text.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description: "The question to show the user",
        },
        options: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 500 },
          maxItems: 20,
          uniqueItems: true,
          description: "Optional choices to offer the user",
        },
        allow_free_text: {
          type: "boolean",
          description: "Whether the user may type a free-text answer (default true)",
        },
      },
      required: ["question"],
    },
    execute: async (params: Record<string, unknown>) => {
      const question = typeof params.question === "string" ? params.question.trim() : "";
      if (!question || question.length > 4000) {
        return { ...ok("question must contain 1–4000 characters"), isError: true };
      }
      if (params.options !== undefined && !Array.isArray(params.options)) {
        return { ...ok("options must be an array of strings"), isError: true };
      }
      const rawOptions = (params.options as unknown[] | undefined) ?? [];
      if (rawOptions.length > 20 || rawOptions.some((option) => typeof option !== "string")) {
        return { ...ok("options must contain at most 20 strings"), isError: true };
      }
      const options = rawOptions.map((option) => (option as string).trim());
      if (options.some((option) => !option || option.length > 500)) {
        return { ...ok("each option must contain 1–500 characters"), isError: true };
      }
      if (new Set(options).size !== options.length) {
        return { ...ok("options must not contain duplicates"), isError: true };
      }
      const allowFreeText =
        typeof params.allow_free_text === "boolean" ? params.allow_free_text : true;
      if (!allowFreeText && options.length === 0) {
        return { ...ok("ask_user needs options when free-text answers are disabled"), isError: true };
      }
      const answer = await deps.requestUserInput({
        question,
        options: options.length > 0 ? options : undefined,
        allow_free_text: allowFreeText,
      });
      return ok(answer);
    },
  };
}

export function createCreateAgentTool(deps: ToolDeps): SystemTool {
  return {
    name: "create_agent",
    description: "Create (or resurrect) an expert agent by type.",
    parameters: {
      type: "object",
      properties: { agent_type: { type: "string" } },
      required: ["agent_type"],
    },
    execute: async (params: Record<string, unknown>) => {
      const name = String(params.agent_type ?? "");
      await deps.ensureAgent(name);
      return ok(`agent ${name} ready`);
    },
  };
}

export function createDestroyAgentTool(deps: ToolDeps): SystemTool {
  return {
    name: "destroy_agent",
    description: "Destroy an expert agent (history preserved; can be revived).",
    parameters: {
      type: "object",
      properties: { agent_type: { type: "string" } },
      required: ["agent_type"],
    },
    execute: async (params: Record<string, unknown>) => {
      const name = String(params.agent_type ?? "");
      await deps.destroyAgent(name);
      return ok(`agent ${name} destroyed`);
    },
  };
}

export function createRecordTraceTool(deps: ToolDeps): SystemTool {
  return {
    name: "record_trace",
    description:
      "Notify the Trace Agent of a reasoning/trace event. The Trace Agent is a " +
      "real agent that owns the Graph of Trace; it decides whether to create a " +
      "new node, update an existing one, or merge with a sibling.",
    parameters: {
      type: "object",
      properties: {
        description: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
        context: { type: "string" },
      },
      required: ["description"],
    },
    execute: async (params: Record<string, unknown>) => {
      // §10 (legacy parity): record_trace does NOT mutate the graph directly.
      // Instead it dispatches a [Trace Event] envelope into the trace agent's
      // durable internal queue; the trace agent receives it and
      // calls create_trace_node / update_trace_node / add_trace_relation as the
      // editor. This keeps the trace agent's status authentically live in the
      // Agents panel (otherwise it would be a permanently-dormant placeholder)
      // and lets the trace agent merge/dedupe across multiple sources, which is
      // exactly the persona we already ship for it.
      const description = String(params.description ?? "");
      const context = String(params.context ?? "");
      const artifacts = (params.artifacts as string[]) ?? [];
      const lines = [`[Trace Event]`, `Description: ${description}`];
      if (context) lines.push(`Context: ${context}`);
      lines.push("", "Artifacts:");
      if (artifacts.length === 0) {
        lines.push("(none)");
      } else {
        for (const a of artifacts) lines.push(`- ${a}`);
      }
      const envelope = lines.join("\n");

      // Spawn-on-demand: the trace agent is a real Pi session. ensureAgent
      // creates one if it doesn't exist yet (idempotent) and resurrects a
      // stopped one. That spawn is what finally surfaces the trace agent as
      // "idle/running" in the Agents panel.
      await deps.ensureAgent("trace");
      try {
        await deps.dispatchTrace(envelope);
      } catch (err) {
        if (err instanceof TaskQueueFullError) return { ...ok(`cannot deliver to trace: ${err.message}`), isError: true };
        throw err;
      }
      // Fire-and-forget: kick the trace agent's delivery loop so the envelope
      // is consumed in its own run rather than sitting unread.
      deps.wakeAgent("trace");
      return ok("trace event dispatched");
    },
  };
}

export function createTraceNodeTool(deps: ToolDeps): SystemTool {
  return {
    name: "create_trace_node",
    description: "Create a node in the Graph of Trace.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        type: { type: "string" },
        status: { type: "string" },
        description: { type: "string" },
        parent_id: { type: "string" },
      },
      required: ["title"],
    },
    execute: async (params: Record<string, unknown>) => {
      // Honour an explicit parent_id; otherwise chain to the most recent node so
      // the graph stays connected instead of accumulating orphan nodes.
      const explicitParent = params.parent_id ? String(params.parent_id) : undefined;
      const parentId = explicitParent ?? deps.trace.getLastNodeId();
      const relation = explicitParent ? "parent" : "follows";
      const node = deps.trace.createNode({
        title: String(params.title ?? ""),
        type: params.type ? String(params.type) : undefined,
        status: params.status ? String(params.status) : undefined,
        description: params.description ? String(params.description) : undefined,
        agent: deps.fromAgent,
        parents: parentId ? [{ id: parentId, relation }] : undefined,
      });
      return ok(`node ${node.id} created`);
    },
  };
}

export function createUpdateTraceNodeTool(deps: ToolDeps): SystemTool {
  return {
    name: "update_trace_node",
    description: "Update fields of an existing trace node.",
    parameters: {
      type: "object",
      properties: {
        node_id: { type: "string" },
        status: { type: "string" },
        summary: { type: "string" },
        content: { type: "string" },
      },
      required: ["node_id"],
    },
    execute: async (params: Record<string, unknown>) => {
      const id = String(params.node_id ?? "");
      const updates: Record<string, unknown> = {};
      for (const k of ["status", "summary", "content", "title", "description"]) {
        if (params[k] !== undefined) updates[k] = params[k];
      }
      const node = deps.trace.updateNode(id, updates);
      return node ? ok(`node ${id} updated`) : { ...ok(`node ${id} not found`), isError: true };
    },
  };
}

export function createAddTraceRelationTool(deps: ToolDeps): SystemTool {
  return {
    name: "add_trace_relation",
    description:
      "Add a directed dependency edge between two trace nodes. DIRECTION MATTERS: " +
      "`from_id` is the PREREQUISITE (the earlier source work that must exist first), " +
      "`to_id` is the DEPENDENT (the later downstream work that relies on it). The " +
      "edge points from_id ──▶ to_id, read as \"to_id depends_on from_id\". " +
      "Example: a librarian survey is the prerequisite of an experimentalist synthesis, " +
      "so call add_trace_relation(from_id=<survey>, to_id=<synthesis>) — NOT the reverse. " +
      "Rule of thumb: the prerequisite (from_id) is almost always the node that was " +
      "created earlier; if you find yourself pointing from a later node to an earlier " +
      "one, you have the arguments backwards.",
    parameters: {
      type: "object",
      properties: {
        from_id: { type: "string", description: "Prerequisite / earlier source node." },
        to_id: { type: "string", description: "Dependent / later downstream node." },
        explanation: { type: "string" },
      },
      required: ["from_id", "to_id", "explanation"],
    },
    execute: async (params: Record<string, unknown>) => {
      const okEdge = deps.trace.addRelation(
        String(params.from_id ?? ""),
        String(params.to_id ?? ""),
        String(params.explanation ?? ""),
      );
      return okEdge
        ? ok("relation added")
        : { ...ok("relation failed: node not found"), isError: true };
    },
  };
}

export function createGetTraceGraphTool(deps: ToolDeps): SystemTool {
  return {
    name: "get_trace_graph",
    description: "Get the current Graph of Trace as JSON.",
    parameters: { type: "object", properties: {} },
    execute: async () => ok(JSON.stringify(deps.trace.getGraph())),
  };
}

/**
 * All system tools, keyed by name.
 *
 * `toggles` is an OPTIONAL user-configured per-tool on/off table (loaded from
 * `<dataRoot>/bp_template/tool_toggles.json`). When a tool is disabled, we
 * omit it from the Map entirely so it never appears in any role's tool list —
 * the agent can't see it in its `tools` block and can't call it (Pi rejects
 * unknown tool names). When `toggles` is undefined or a given field is unset,
 * the tool is enabled (default-on for backwards compatibility). Only the three
 * user-facing Pi-native tools (skill_search, get_domain_knowledge_local,
 * search_papers_local) are toggleable — communication/orchestration/trace
 * primitives are unconditional (removing them would break §9 role contracts).
 */
export function allSystemTools(
  deps: ToolDeps,
  toggles?: ToolToggles | null,
): Map<string, SystemTool> {
  // Always-on tools (comms, orchestration, trace primitives).
  const tools: SystemTool[] = [
    createDispatchTaskTool(deps),
    createCompleteTaskTool(deps),
    createAskUserTool(deps),
    createCreateAgentTool(deps),
    createDestroyAgentTool(deps),
    createRecordTraceTool(deps),
    createTraceNodeTool(deps),
    createUpdateTraceNodeTool(deps),
    createAddTraceRelationTool(deps),
    createGetTraceGraphTool(deps),
  ];
  if (isToolEnabled(toggles, "skill_search")) {
    tools.push(createSkillSearchTool(deps));
  }
  // Local KB tools: powered by the KnowledgeBase/ directory (its scripts
  // build the store; here we just consume the on-disk artefacts plus an
  // auto-spawned bge sidecar). Both are no-op-safe when the KB hasn't
  // been built yet — they return a clear "build the KB first" error.
  if (isToolEnabled(toggles, "get_domain_knowledge_local")) {
    tools.push(createGetDomainKnowledgeLocalTool());
  }
  if (isToolEnabled(toggles, "search_papers_local")) {
    tools.push(createSearchPapersLocalTool());
  }
  return new Map(tools.map((t) => [t.name, t]));
}

/**
 * Per-agent system-tool access control (§9, ported from legacy
 * `agent_tool_config`). Returns the system tools a role may use. Built-in Pi
 * tools (read/bash/grep/...) are controlled separately via `builtinToolsForRole`.
 */
export const AGENT_TOOL_CONFIG: Record<string, string[]> = {
  // skill_search opens the router skill library (the long-tail domain catalog
  // not in <available_skills>). Trace is deliberately excluded: it is a
  // graph-only recorder, not a domain reasoner.
  principal: [
    "dispatch_task",
    "complete_task",
    "create_agent",
    "destroy_agent",
    "record_trace",
    "ask_user",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  trace: ["create_trace_node", "update_trace_node", "add_trace_relation", "get_trace_graph"],
  expert: [
    "dispatch_task",
    "complete_task",
    "record_trace",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  // Auditor: comms + self-trace only. Deliberately NO `get_trace_graph` —
  // evidence is restricted to the session workspace; the audit must not
  // dredge the trace graph or other agents' internal state. skill_search and
  // the local KB tools are included so an audit can resolve a methodology
  // skill referenced in a draft and verify a cited claim against the KB.
  auditor: [
    "dispatch_task",
    "complete_task",
    "record_trace",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  // Writer: needs ask_user to present format/style options before drafting.
  writer: [
    "dispatch_task",
    "complete_task",
    "record_trace",
    "ask_user",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
  // Default for any other expert-like agent.
  _default: [
    "dispatch_task",
    "complete_task",
    "record_trace",
    "skill_search",
    "get_domain_knowledge_local",
    "search_papers_local",
  ],
};

/**
 * Built-in Pi tool allowlist per role. Valid Pi builtin names:
 * `bash, edit, find, glob, grep, ls, read, write`.
 */
export const BUILTIN_TOOL_CONFIG: Record<string, string[]> = {
  // PI is the user-facing orchestrator: it must be able to inspect and touch the
  // workspace directly (read a file, run a quick check, make a small edit) for
  // the lightweight framing / synthesis its persona promises. Substantial domain
  // work is still delegated to experts — that's a persona discipline, not a tool
  // restriction. Previously `[]`, which made PI truthfully report it could not
  // read/write/bash, contradicting its own prompt.
  principal: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  trace: ["read"],
  expert: ["read", "write", "grep", "find"],
  _default: ["read", "write", "grep", "find"],
};

/**
 * Per-agent-name builtin overrides, keyed by name (not role). Authoring agents
 * need write/edit + a shell; the research specialist keeps a lean no-shell set.
 * Falls through to BUILTIN_TOOL_CONFIG by role when a name has no entry.
 */
export const BUILTIN_TOOL_CONFIG_BY_NAME: Record<string, string[]> = {
  engineer: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  experimentalist: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  writer: ["read", "write", "edit", "grep", "find", "glob", "ls"],
  librarian: ["read", "write", "grep", "find", "glob"],
  // Auditor: read-only inspection + `write` for its own audit report. NO `edit`
  // (must not modify other agents' artefacts). `bash` is included for
  // grep/awk/jq/diff style filesystem inspection — its read-only discipline is
  // enforced by the auditor persona, not by the tool whitelist.
  auditor: ["read", "grep", "find", "glob", "bash", "write"],
};

export function systemToolNamesForRole(role: AgentRole, agentName: string): string[] {
  // `trace` agent keyed by role; principal by role; experts share `_default`
  // unless a named override exists.
  if (role === "principal") return AGENT_TOOL_CONFIG.principal!;
  if (role === "trace") return AGENT_TOOL_CONFIG.trace!;
  return AGENT_TOOL_CONFIG[agentName] ?? AGENT_TOOL_CONFIG.expert ?? AGENT_TOOL_CONFIG._default!;
}

export function builtinToolNamesForRole(role: AgentRole, agentName?: string): string[] {
  // Principal and trace are role-scoped; experts may carry a per-name override
  // (e.g. engineer gets write+bash) before falling back to the role default.
  if (role === "expert" && agentName && BUILTIN_TOOL_CONFIG_BY_NAME[agentName]) {
    return BUILTIN_TOOL_CONFIG_BY_NAME[agentName]!;
  }
  return BUILTIN_TOOL_CONFIG[role] ?? BUILTIN_TOOL_CONFIG._default!;
}

export function systemToolsForRole(
  role: AgentRole,
  agentName: string,
  deps: ToolDeps,
  toggles?: ToolToggles | null,
): SystemTool[] {
  const allowed = new Set(systemToolNamesForRole(role, agentName));
  // Toggles filter INSIDE `allSystemTools`; if a role names a disabled tool,
  // the lookup misses and the filter drops it. Role config stays declarative
  // ("who is allowed") and orthogonal to physical availability ("does this
  // tool exist at all right now").
  const all = allSystemTools(deps, toggles);
  return [...allowed].map((n) => all.get(n)).filter((t): t is SystemTool => !!t);
}
