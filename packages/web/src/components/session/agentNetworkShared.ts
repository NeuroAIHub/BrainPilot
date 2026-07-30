/* --------------------------------------------------------------------------
 * Shared pure helpers, types, and the static agent catalog for the Agent
 * Network view. Extracted from `AgentNetwork.tsx` so the new sub-views
 * (`AnalyticsTab`, `TimelineTab`, `GlobalOverview`, `NodeTooltip`) can reuse
 * the SAME derivation logic — in particular the `dispatch_task` tool-name
 * matching and edge building, which previously lived only in the component
 * and is the single source of truth for "who talked to whom".
 * ------------------------------------------------------------------------ */
import {
  BarChart3,
  Bot,
  BookOpen,
  GitBranch,
  Microscope,
  PenLine,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  Wrench,
} from "lucide-react";
import { ChatMessage } from "../../contracts/backend";

/* --------------------------------------------------------------------------
 * Static catalog: per-agent profile (role, accent color, default tools).
 * Mirrors the prompts in `claude/agents/*.md` and `agent_tool_config` in
 * `agent_runtime/session_manager.py`. Unknown agents fall back to `_default`.
 * ------------------------------------------------------------------------ */

export interface AgentProfile {
  displayName: string;
  /** i18n key for the role line (resolve with t() at render). */
  role: string;
  /** i18n key for the description (resolve with t() at render). */
  description: string;
  accent: string; // CSS variable name fragment (e.g. "info")
  defaultTools: string[];
}

export const AGENT_PROFILES: Record<string, AgentProfile> = {
  principal: {
    displayName: "Principal Investigator",
    role: "profile.principal.role",
    description: "profile.principal.desc",
    accent: "info",
    defaultTools: [
      "dispatch_task",
      "complete_task",
      "create_agent",
      "destroy_agent",
      "record_trace",
      "search_web",
      "fetch_url",
    ],
  },
  librarian: {
    displayName: "Librarian",
    role: "profile.librarian.role",
    description: "profile.librarian.desc",
    accent: "info",
    defaultTools: ["dispatch_task", "complete_task", "record_trace", "search_web", "fetch_url"],
  },
  trace: {
    displayName: "Trace Agent",
    role: "profile.trace.role",
    description: "profile.trace.desc",
    accent: "neutral",
    defaultTools: [
      "create_trace_node",
      "update_trace_node",
      "add_trace_relation",
      "get_trace_graph",
      "read_session_history",
      "Read",
    ],
  },
  experimentalist: {
    displayName: "Experimentalist",
    role: "profile.experimentalist.role",
    description: "profile.experimentalist.desc",
    accent: "success",
    defaultTools: ["Read", "Write", "Grep", "Bash", "dispatch_task", "complete_task"],
  },
  engineer: {
    displayName: "Engineer",
    role: "profile.engineer.role",
    description: "profile.engineer.desc",
    accent: "success",
    defaultTools: ["Read", "Write", "Grep", "Bash", "dispatch_task", "complete_task"],
  },
  writer: {
    displayName: "Writer",
    role: "profile.writer.role",
    description: "profile.writer.desc",
    accent: "warning",
    defaultTools: ["Read", "Write", "Grep", "Bash", "dispatch_task", "complete_task"],
  },
  auditor: {
    displayName: "Auditor",
    role: "profile.auditor.role",
    description: "profile.auditor.desc",
    accent: "danger",
    defaultTools: ["Read", "Grep", "Bash", "Write", "dispatch_task", "complete_task", "record_trace"],
  },
  user: {
    displayName: "You",
    role: "profile.user.role",
    description: "profile.user.desc",
    accent: "neutral",
    defaultTools: [],
  },
};

export const DEFAULT_PROFILE: AgentProfile = {
  displayName: "Custom Agent",
  role: "profile.default.role",
  description: "profile.default.desc",
  accent: "neutral",
  defaultTools: ["dispatch_task", "complete_task", "record_trace", "search_web", "fetch_url"],
};

export function getAgentProfile(name: string): AgentProfile {
  return AGENT_PROFILES[name] ?? DEFAULT_PROFILE;
}

/**
 * Built-in agent roster — default expert types the PI knows about regardless
 * of whether they have been spawned this session. Rendered as "dormant"
 * placeholders so the full team is always visible. Custom agents created at
 * runtime via `create_agent` flow in through `AgentStatus[]` and union with
 * this list in `nodeNames`.
 */
export const BUILTIN_AGENT_NAMES = [
  "principal",
  "librarian",
  "trace",
  "experimentalist",
  "engineer",
  "writer",
  "auditor",
] as const;

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

export interface AgentEdgeMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  msgType?: string;
  timestamp: string;
  streaming?: boolean;
}

export interface AgentEdge {
  key: string; // `${from}->${to}`
  from: string;
  to: string;
  messages: AgentEdgeMessage[];
  lastTimestamp: string;
}

/* --------------------------------------------------------------------------
 * Edge / message derivation
 * ------------------------------------------------------------------------ */

export function safeParseJson(input: unknown): Record<string, unknown> | null {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input !== "string" || !input.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Tool name matcher — accepts both the bare SDK name (`dispatch_task`) and the
 * MCP-namespaced name as it actually appears in JSONL / AG-UI snapshots
 * (`mcp__builtin__dispatch_task`, or any future namespaced variant).
 */
export function isDispatchTaskTool(toolName?: string): boolean {
  if (!toolName) return false;
  if (toolName === "dispatch_task") return true;
  // MCP convention: `mcp__<server>__<tool>` — match the trailing tool name.
  return toolName.endsWith("__dispatch_task") || toolName.endsWith(":dispatch_task");
}

export function getMessageEdge(message: ChatMessage): AgentEdgeMessage | null {
  if (message.kind !== "tool" || !isDispatchTaskTool(message.toolName)) {
    return null;
  }
  const args = safeParseJson(message.toolInput);
  if (!args) {
    return null;
  }
  const from = message.agent || "principal";
  const to = typeof args.to === "string" && args.to ? args.to : "principal";
  if (from === to) {
    return null;
  }
  // Filter out messages to/from 'trace' — trace is an internal system agent
  // that should only be interacted with via record_trace tool, not dispatch_task.
  // Any dispatch_task involving trace is a rejected call and should not appear
  // as a collaboration edge in the Agent Network graph.
  if (from === "trace" || to === "trace") {
    return null;
  }
  const content = typeof args.content === "string" ? args.content : "";
  const msgTypeRaw = "task_delegate";
  return {
    id: message.id,
    from,
    to,
    content,
    msgType: msgTypeRaw,
    timestamp: message.createdAt,
    streaming: message.streaming,
  };
}

export function buildEdges(messages: ChatMessage[]): AgentEdge[] {
  const map = new Map<string, AgentEdge>();
  for (const message of messages) {
    const item = getMessageEdge(message);
    if (!item) continue;
    const key = `${item.from}->${item.to}`;
    const edge = map.get(key) ?? {
      key,
      from: item.from,
      to: item.to,
      messages: [],
      lastTimestamp: item.timestamp,
    };
    edge.messages.push(item);
    if (item.timestamp > edge.lastTimestamp) {
      edge.lastTimestamp = item.timestamp;
    }
    map.set(key, edge);
  }
  // Sort messages within each edge by time ascending
  for (const edge of map.values()) {
    edge.messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return Array.from(map.values());
}

/** Count of messages sent / received by `name` across all edges. */
export function countMessagesFor(
  name: string,
  edges: AgentEdge[],
): { sent: number; received: number } {
  let sent = 0;
  let received = 0;
  for (const edge of edges) {
    if (edge.from === name) sent += edge.messages.length;
    if (edge.to === name) received += edge.messages.length;
  }
  return { sent, received };
}

/* --------------------------------------------------------------------------
 * Display helpers
 * ------------------------------------------------------------------------ */

export function getAgentIcon(name: string) {
  const normalized = name.toLowerCase();
  if (normalized === "principal") return UserRoundCog;
  if (normalized === "user") return UserRoundCog;
  if (normalized.includes("librari")) return BookOpen;
  if (normalized.includes("data") || normalized.includes("analy")) return BarChart3;
  if (normalized.includes("trace")) return GitBranch;
  if (normalized.includes("experiment")) return Microscope;
  if (normalized.includes("engineer")) return Wrench;
  if (normalized.includes("writer")) return PenLine;
  if (normalized.includes("audit")) return ShieldCheck;
  if (normalized.includes("idea") || normalized.includes("creat")) return Sparkles;
  return Bot;
}

/** Map an agent profile's `accent` to a CSS color token. */
export function getAgentAccentVar(name: string): string {
  const profile = getAgentProfile(name);
  switch (profile.accent) {
    case "info":
      return "var(--color-info)";
    case "success":
      return "var(--color-success)";
    case "warning":
      return "var(--color-warning)";
    case "danger":
      return "var(--color-danger)";
    default:
      return "var(--color-text-subtle)";
  }
}

export function relativeTime(iso: string, nowMs: number): string {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = nowMs - ts;
  if (diff < 1000) return "just now";
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return new Date(iso).toLocaleTimeString();
}

export function msgTypeKind(msgType?: string): "delegate" | "result" | "neutral" {
  if (!msgType) return "neutral";
  if (msgType.includes("delegate") || msgType.includes("request")) return "delegate";
  if (
    msgType.includes("result") ||
    msgType.includes("reply") ||
    msgType.includes("response")
  )
    return "result";
  return "neutral";
}

export function statusKind(status: string): "running" | "idle" | "error" | "stopped" {
  if (status === "running" || status === "in_progress") return "running";
  if (status === "error" || status === "failed") return "error";
  if (status === "stopped" || status === "destroyed") return "stopped";
  return "idle";
}
