/* --------------------------------------------------------------------------
 * agentAnalytics — pure derivation functions over the session's ChatMessage[]
 * and the derived AgentEdge[]. No React, no DOM: easy to unit-test and reuse
 * across GlobalOverview / AnalyticsTab / TimelineTab.
 *
 * All inter-agent semantics go through the SAME helpers used to draw the
 * network graph (`getMessageEdge` / `msgTypeKind`) so analytics never drifts
 * from what the graph shows.
 * ------------------------------------------------------------------------ */
import { ChatMessage } from "../../contracts/backend";
import { AgentEdge, getMessageEdge, msgTypeKind } from "./agentNetworkShared";

export interface TrendPoint {
  time: number; // bucket start, ms epoch
  count: number;
}

export interface AgentLoad {
  name: string;
  sent: number;
  received: number;
  total: number;
}

export interface TypeDistribution {
  delegate: number;
  result: number;
  other: number;
}

export interface LatencyStats {
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
}

export interface TokenRow {
  name: string;
  sentMsgs: number;
  avgLen: number;
  tokens: number;
}

export interface Heatmap {
  agents: string[];
  buckets: number;
  bucketMs: number;
  startMs: number;
  /** counts[agentIndex][bucketIndex] */
  counts: number[][];
  max: number;
}

const tsOf = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** Inter-agent messages only (the same set the graph draws edges from). */
function interAgentMessages(messages: ChatMessage[]) {
  return messages
    .map((m) => getMessageEdge(m))
    .filter((e): e is NonNullable<ReturnType<typeof getMessageEdge>> => e !== null);
}

/** Message volume bucketed over [now - windowMs, now]. */
export function computeMessageTrend(
  messages: ChatMessage[],
  nowMs: number,
  windowMs = 3_600_000,
  buckets = 30,
): TrendPoint[] {
  const start = nowMs - windowMs;
  const bucketMs = windowMs / buckets;
  const counts = new Array(buckets).fill(0);
  for (const e of interAgentMessages(messages)) {
    const ts = tsOf(e.timestamp);
    if (ts < start || ts > nowMs) continue;
    const idx = Math.min(buckets - 1, Math.floor((ts - start) / bucketMs));
    counts[idx] += 1;
  }
  return counts.map((count, i) => ({ time: start + i * bucketMs, count }));
}

export function computeAgentLoad(edges: AgentEdge[]): AgentLoad[] {
  const map = new Map<string, AgentLoad>();
  const ensure = (name: string) => {
    let row = map.get(name);
    if (!row) {
      row = { name, sent: 0, received: 0, total: 0 };
      map.set(name, row);
    }
    return row;
  };
  for (const edge of edges) {
    ensure(edge.from).sent += edge.messages.length;
    ensure(edge.to).received += edge.messages.length;
  }
  const rows = Array.from(map.values());
  rows.forEach((r) => (r.total = r.sent + r.received));
  rows.sort((a, b) => b.total - a.total);
  return rows;
}

export function computeTypeDistribution(messages: ChatMessage[]): TypeDistribution {
  const dist: TypeDistribution = { delegate: 0, result: 0, other: 0 };
  for (const e of interAgentMessages(messages)) {
    const kind = msgTypeKind(e.msgType);
    if (kind === "delegate") dist.delegate += 1;
    else if (kind === "result") dist.result += 1;
    else dist.other += 1;
  }
  return dist;
}

/**
 * Pair each delegate with the next result that the delegated-to agent sends
 * back (after the delegate's timestamp). Returns raw latencies in ms.
 */
export function computeResponseLatencies(messages: ChatMessage[]): number[] {
  const inter = interAgentMessages(messages).sort(
    (a, b) => tsOf(a.timestamp) - tsOf(b.timestamp),
  );
  const latencies: number[] = [];
  const usedResultIdx = new Set<number>();

  inter.forEach((msg) => {
    if (msgTypeKind(msg.msgType) !== "delegate") return;
    const delegateTs = tsOf(msg.timestamp);
    // Find earliest unused result FROM the delegated-to agent, after this time.
    for (let i = 0; i < inter.length; i++) {
      if (usedResultIdx.has(i)) continue;
      const cand = inter[i];
      if (msgTypeKind(cand.msgType) !== "result") continue;
      if (cand.from !== msg.to) continue;
      const candTs = tsOf(cand.timestamp);
      if (candTs <= delegateTs) continue;
      usedResultIdx.add(i);
      latencies.push(candTs - delegateTs);
      break;
    }
  });
  return latencies;
}

export function summarizeLatencies(latencies: number[]): LatencyStats | null {
  if (latencies.length === 0) return null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  return {
    count: sorted.length,
    min: sorted[0],
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: sorted[sorted.length - 1],
    mean,
  };
}

/** Rough per-agent token estimate from the content the agent SENT. */
export function estimateTokens(messages: ChatMessage[]): TokenRow[] {
  const map = new Map<string, { chars: number; msgs: number }>();
  for (const e of interAgentMessages(messages)) {
    const row = map.get(e.from) ?? { chars: 0, msgs: 0 };
    row.chars += e.content.length;
    row.msgs += 1;
    map.set(e.from, row);
  }
  const rows: TokenRow[] = Array.from(map.entries()).map(([name, { chars, msgs }]) => ({
    name,
    sentMsgs: msgs,
    avgLen: msgs ? Math.round(chars / msgs) : 0,
    tokens: Math.ceil(chars / 4),
  }));
  rows.sort((a, b) => b.tokens - a.tokens);
  return rows;
}

export function computeLifecycleHeatmap(
  messages: ChatMessage[],
  agentNames: string[],
  nowMs: number,
  buckets = 20,
): Heatmap {
  const inter = interAgentMessages(messages);
  const times = inter.map((e) => tsOf(e.timestamp)).filter((t) => t > 0);
  const startMs = times.length ? Math.min(...times) : nowMs;
  const span = Math.max(1, nowMs - startMs);
  const bucketMs = span / buckets;

  const agents = agentNames.filter((name) =>
    inter.some((e) => e.from === name || e.to === name),
  );
  const indexOf = new Map(agents.map((a, i) => [a, i]));
  const counts = agents.map(() => new Array(buckets).fill(0));
  let max = 0;

  for (const e of inter) {
    const ts = tsOf(e.timestamp);
    const bIdx = Math.min(buckets - 1, Math.max(0, Math.floor((ts - startMs) / bucketMs)));
    for (const who of [e.from, e.to]) {
      const aIdx = indexOf.get(who);
      if (aIdx === undefined) continue;
      counts[aIdx][bIdx] += 1;
      if (counts[aIdx][bIdx] > max) max = counts[aIdx][bIdx];
    }
  }

  return { agents, buckets, bucketMs, startMs, counts, max };
}

export function computeErrorCount(messages: ChatMessage[]): number {
  return messages.filter((m) => m.kind === "error").length;
}

/** Human-friendly duration formatter for latency values. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/* --------------------------------------------------------------------------
 * Per-agent activity statistics (all messages, not just send_message)
 * ------------------------------------------------------------------------ */

export interface AgentActivity {
  name: string;
  // Message output by role
  assistantMessages: number;
  reasoningMessages: number;
  toolMessages: number;
  systemMessages: number;
  totalMessages: number;
  // Content volume
  totalChars: number;
  estimatedTokens: number;
  // Tool usage
  toolCalls: number;
  toolCallsByName: Record<string, number>;
  topTools: Array<{ name: string; count: number }>;
  // Communication (send_message only)
  sentMessages: number;
  receivedMessages: number;
  communicationPartners: string[];
}

/**
 * Compute comprehensive activity stats for a specific agent.
 * Includes all message types, tool calls, and communication patterns.
 */
export function computeAgentActivity(
  agentName: string,
  messages: ChatMessage[],
  edges: AgentEdge[],
): AgentActivity {
  // Filter messages from this agent
  const agentMessages = messages.filter((m) => m.agent === agentName);

  // Count by role
  let assistantMessages = 0;
  let reasoningMessages = 0;
  let toolMessages = 0;
  let systemMessages = 0;
  let totalChars = 0;

  for (const msg of agentMessages) {
    if (msg.role === "assistant") assistantMessages++;
    else if (msg.role === "system") systemMessages++;
    // Tool messages are identified by kind, not role
    if (msg.kind === "thinking") reasoningMessages++;
    else if (msg.kind === "tool") toolMessages++;

    totalChars += (msg.content || "").length;
  }

  // Tool call statistics
  const toolCallsByName: Record<string, number> = {};
  let toolCalls = 0;

  for (const msg of agentMessages) {
    if (msg.kind === "tool" && msg.toolName) {
      toolCalls++;
      toolCallsByName[msg.toolName] = (toolCallsByName[msg.toolName] || 0) + 1;
    }
  }

  const topTools = Object.entries(toolCallsByName)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // Communication statistics (from edges)
  let sentMessages = 0;
  let receivedMessages = 0;
  const partners = new Set<string>();

  for (const edge of edges) {
    if (edge.from === agentName) {
      sentMessages += edge.messages.length;
      partners.add(edge.to);
    }
    if (edge.to === agentName) {
      receivedMessages += edge.messages.length;
      partners.add(edge.from);
    }
  }

  return {
    name: agentName,
    assistantMessages,
    reasoningMessages,
    toolMessages,
    systemMessages,
    totalMessages: agentMessages.length,
    totalChars,
    estimatedTokens: Math.ceil(totalChars / 4),
    toolCalls,
    toolCallsByName,
    topTools,
    sentMessages,
    receivedMessages,
    communicationPartners: Array.from(partners).sort(),
  };
}

/**
 * Compute activity stats for all agents in the session.
 * Returns a map of agent name -> activity stats.
 */
export function computeAllAgentActivities(
  messages: ChatMessage[],
  edges: AgentEdge[],
): Map<string, AgentActivity> {
  const agentNames = new Set<string>();

  // Collect all agent names from messages
  for (const msg of messages) {
    if (msg.agent) agentNames.add(msg.agent);
  }

  // Also collect from edges
  for (const edge of edges) {
    agentNames.add(edge.from);
    agentNames.add(edge.to);
  }

  const activities = new Map<string, AgentActivity>();
  for (const name of agentNames) {
    activities.set(name, computeAgentActivity(name, messages, edges));
  }

  return activities;
}

/**
 * Compute global activity percentages for an agent.
 */
export interface AgentActivityPercentages {
  messagePercent: number; // This agent's messages / total messages
  toolCallPercent: number; // This agent's tool calls / total tool calls
  tokenPercent: number; // This agent's tokens / total tokens
}

export function computeAgentActivityPercentages(
  activity: AgentActivity,
  allActivities: Map<string, AgentActivity>,
): AgentActivityPercentages {
  let totalMessages = 0;
  let totalToolCalls = 0;
  let totalTokens = 0;

  for (const a of allActivities.values()) {
    totalMessages += a.totalMessages;
    totalToolCalls += a.toolCalls;
    totalTokens += a.estimatedTokens;
  }

  return {
    messagePercent: totalMessages > 0 ? (activity.totalMessages / totalMessages) * 100 : 0,
    toolCallPercent: totalToolCalls > 0 ? (activity.toolCalls / totalToolCalls) * 100 : 0,
    tokenPercent: totalTokens > 0 ? (activity.estimatedTokens / totalTokens) * 100 : 0,
  };
}
