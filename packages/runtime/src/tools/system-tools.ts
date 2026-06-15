/**
 * BrainPilot system tools (§9 decision 1) — defined as plain `SystemTool`
 * objects (name + JSON-schema params + execute closure). The real agent
 * factory wraps these with Pi's `defineTool`; the mock invokes `execute`
 * directly. Closures capture session context (mailbox, trace, manager).
 *
 * Per-agent access control (§9, ported from legacy `agent_tool_config`) is
 * applied by `toolsForRole` — each role only receives its allowed tools.
 */
import type { AgentRole, SystemTool } from "../types.js";
import type { Mailbox, MsgType } from "../mailbox.js";
import type { GraphOfTrace } from "../trace.js";

export interface ToolDeps {
  sessionId: string;
  fromAgent: string;
  mailbox: Mailbox;
  trace: GraphOfTrace;
  /** Ensure an agent exists (auto-create/resurrect). */
  ensureAgent: (name: string) => Promise<void>;
  /** Destroy an agent (memory only; history kept). */
  destroyAgent: (name: string) => Promise<void>;
}

function ok(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

export function createSendMessageTool(deps: ToolDeps): SystemTool {
  return {
    name: "send_message",
    description: "Send a message to another agent (e.g. principal or an expert).",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message body" },
        to: { type: "string", description: "Target agent name", default: "principal" },
        msg_type: { type: "string", enum: ["result_deliver", "task_delegate"] },
      },
      required: ["content"],
    },
    execute: async (params: Record<string, unknown>) => {
      const to = (params.to as string) ?? "principal";
      const content = String(params.content ?? "");
      const msgType = (params.msg_type as MsgType) ?? deriveMsgType(deps.fromAgent, to);
      await deps.ensureAgent(to);
      await deps.mailbox.write({ fromAgent: deps.fromAgent, toAgent: to, content, msgType });
      return ok(`delivered to ${to}`);
    },
  };
}

function deriveMsgType(from: string, to: string): MsgType {
  if (to === "principal") return "result_deliver";
  return "task_delegate";
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
    description: "Record a reasoning/trace event into the Graph of Trace.",
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
      const node = deps.trace.createNode({
        title: String(params.description ?? "trace"),
        type: "trace",
        status: "completed",
        agent: deps.fromAgent,
        description: String(params.description ?? ""),
        content: String(params.context ?? ""),
        artifacts: ((params.artifacts as string[]) ?? []).map((p) => ({ path: p })),
      });
      return ok(`trace recorded: ${node.id}`);
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
      const parentId = params.parent_id ? String(params.parent_id) : undefined;
      const node = deps.trace.createNode({
        title: String(params.title ?? ""),
        type: params.type ? String(params.type) : undefined,
        status: params.status ? String(params.status) : undefined,
        description: params.description ? String(params.description) : undefined,
        agent: deps.fromAgent,
        parents: parentId ? [{ id: parentId, relation: "parent" }] : undefined,
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
    description: "Add a relation (edge) between two trace nodes.",
    parameters: {
      type: "object",
      properties: {
        from_id: { type: "string" },
        to_id: { type: "string" },
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

/** All system tools, keyed by name. */
export function allSystemTools(deps: ToolDeps): Map<string, SystemTool> {
  const tools = [
    createSendMessageTool(deps),
    createCreateAgentTool(deps),
    createDestroyAgentTool(deps),
    createRecordTraceTool(deps),
    createTraceNodeTool(deps),
    createUpdateTraceNodeTool(deps),
    createAddTraceRelationTool(deps),
    createGetTraceGraphTool(deps),
  ];
  return new Map(tools.map((t) => [t.name, t]));
}

/**
 * Per-agent system-tool access control (§9, ported from legacy
 * `agent_tool_config`). Returns the system tools a role may use. Built-in Pi
 * tools (read/bash/grep/...) are controlled separately via `builtinToolsForRole`.
 */
export const AGENT_TOOL_CONFIG: Record<string, string[]> = {
  principal: ["send_message", "create_agent", "destroy_agent", "record_trace"],
  trace: ["create_trace_node", "update_trace_node", "add_trace_relation", "get_trace_graph"],
  expert: ["send_message", "record_trace"],
  // Default for any other expert-like agent.
  _default: ["send_message", "record_trace"],
};

/**
 * Built-in Pi tool allowlist per role. Valid Pi builtin names:
 * `bash, edit, find, glob, grep, ls, read, write`.
 */
export const BUILTIN_TOOL_CONFIG: Record<string, string[]> = {
  principal: [],
  trace: ["read"],
  expert: ["read", "grep", "find"],
  _default: ["read", "grep", "find"],
};

/**
 * Per-agent-name builtin overrides, keyed by name (not role). Authoring agents
 * need write/edit + a shell; the read-only researcher keeps the lean default.
 * Falls through to BUILTIN_TOOL_CONFIG by role when a name has no entry.
 */
export const BUILTIN_TOOL_CONFIG_BY_NAME: Record<string, string[]> = {
  engineer: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  experimentalist: ["read", "write", "edit", "bash", "grep", "find", "glob", "ls"],
  writer: ["read", "write", "edit", "grep", "find", "glob", "ls"],
  librarian: ["read", "grep", "find", "glob"],
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
): SystemTool[] {
  const allowed = new Set(systemToolNamesForRole(role, agentName));
  const all = allSystemTools(deps);
  return [...allowed].map((n) => all.get(n)).filter((t): t is SystemTool => !!t);
}
