import type { AgentStatus, ChatMessage, TraceNode } from "../../contracts/backend";
import { buildEdges, statusKind } from "./agentNetworkShared";

export interface AgentSessionSummary {
  simple: boolean;
  participantCount: number;
  runningCount: number;
  chatMessageCount: number;
  crossAgentMessageCount: number;
}

/**
 * A normal user ↔ Principal conversation is not an agent network. Keep the
 * graph workbench available, but only promote it when another agent or a real
 * delegation has participated.
 */
export function summarizeAgentSession(
  agents: AgentStatus[],
  messages: ChatMessage[],
  subagentCount: number,
): AgentSessionSummary {
  const edges = buildEdges(messages);
  const participantNames = new Set(
    agents
      .map((agent) => agent.name)
      .filter((name) => name !== "trace" && name !== "user"),
  );
  for (const edge of edges) {
    participantNames.add(edge.from);
    participantNames.add(edge.to);
  }
  const crossAgentMessageCount = edges.reduce(
    (total, edge) => total + edge.messages.length,
    0,
  );
  const chatMessageCount = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      (!message.kind || message.kind === "text"),
  ).length;
  const runningCount = agents.filter(
    (agent) => statusKind(agent.status) === "running",
  ).length;

  return {
    simple:
      participantNames.size <= 1 &&
      crossAgentMessageCount === 0 &&
      subagentCount === 0,
    participantCount: participantNames.size,
    runningCount,
    chatMessageCount,
    crossAgentMessageCount,
  };
}

export interface TraceSessionSummary {
  simple: boolean;
  meaningfulNodeCount: number;
  totalNodeCount: number;
}

/** Session Start is bookkeeping, not a user-meaningful reasoning trace. */
export function summarizeTraceSession(nodes: TraceNode[]): TraceSessionSummary {
  const meaningfulNodeCount = nodes.filter(
    (node) => node.type !== "session_start",
  ).length;
  return {
    simple: meaningfulNodeCount === 0,
    meaningfulNodeCount,
    totalNodeCount: nodes.length,
  };
}
