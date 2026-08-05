/** Ephemeral Graph of Trace context for Principal reasoning and bound audits. */
import type { TraceGraphV2, TraceNodeV2 } from "@brainpilot/protocol";
import type { TraceAuditTarget } from "../trace.js";

interface PiContextMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
  timestamp?: number;
}

interface PiExtensionApi {
  on(
    event: "context",
    handler: (event: { messages: PiContextMessage[] }) =>
      | { messages: PiContextMessage[] }
      | void,
  ): void;
}

const PRINCIPAL_TAG = "<graph_of_trace";
const AUDIT_TAG = "<got_audit_context";

export interface GoTContextDeps {
  renderContext: () => string;
}

function isGoTContextMessage(message: PiContextMessage): boolean {
  return message.role === "user" && message.content.some((part) => {
    const text = part.text ?? "";
    return part.type === "text" &&
      (text.startsWith(PRINCIPAL_TAG) || text.startsWith(AUDIT_TAG));
  });
}

/** Replaces the previous per-turn GoT block without writing it to Pi history. */
export function makeGoTContextExt(deps: GoTContextDeps): (pi: PiExtensionApi) => void {
  return (pi) => {
    pi.on("context", (event) => {
      const stripped = event.messages.filter((message) => !isGoTContextMessage(message));
      const block = deps.renderContext();
      if (!block) {
        return stripped.length === event.messages.length ? undefined : { messages: stripped };
      }
      stripped.push({ role: "user", content: [{ type: "text", text: block }] });
      return { messages: stripped };
    });
  };
}

function shorten(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function compactNode(
  node: TraceNodeV2,
  rootId: string | undefined,
  activeIds: ReadonlySet<string>,
  episodeTitle: string | undefined,
): Record<string, unknown> {
  return {
    id: node.id,
    title: node.title,
    ...(episodeTitle ? { episode: episodeTitle } : {}),
    type: node.type,
    status: node.status,
    ...(node.description ? { description: shorten(node.description, 600) } : {}),
    ...(node.confidence ? { confidence: node.confidence } : {}),
    reviewConclusion: node.reviewConclusion,
    updatedAt: node.updatedAt,
    parents: node.parents
      .filter((parent) =>
        activeIds.has(parent.nodeId) ||
        (parent.nodeId === rootId && parent.origin === "trace"),
      )
      .map((parent) => ({
        nodeId: parent.nodeId,
        conclusion: parent.conclusion,
        ...(parent.origin ? { origin: parent.origin } : {}),
        ...(parent.reason ? { reason: shorten(parent.reason, 300) } : {}),
      })),
  };
}

function compactGraphLines(graph: TraceGraphV2, maxChars: number): string[] {
  const rootId = graph.meta.rootNodeId;
  const nodes = graph.nodes.filter((node) => !node.revoked && node.id !== rootId);
  const activeIds = new Set(nodes.map((node) => node.id));
  const episodeTitles = new Map(graph.episodes.map((episode) => [episode.id, episode.title]));
  const lines: string[] = [];
  let used = 0;
  for (const node of nodes) {
    const line = JSON.stringify(compactNode(
      node,
      rootId,
      activeIds,
      node.primaryEpisodeId ? episodeTitles.get(node.primaryEpisodeId) : undefined,
    ));
    if (used + line.length + 1 > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  if (lines.length < nodes.length) {
    lines.push(JSON.stringify({ omittedNodes: nodes.length - lines.length }));
  }
  return lines;
}

/** Current compact GoT plus usage guidance, injected only into Principal turns. */
export function renderPrincipalGoTContext(
  graph: TraceGraphV2,
  maxChars = 24_000,
): string {
  const rootId = graph.meta.rootNodeId;
  const header = [
    `<graph_of_trace revision="${graph.revision}" root_node_id="${rootId ?? ""}">`,
    "This is the current compact Graph of Trace. Use it when planning, synthesizing expert results, handling new evidence, and checking whether work already exists.",
    "Use get_trace_graph, get_trace_node, get_trace_neighborhood, or get_trace_diff when more detail is needed. Review approval is audit history, not a substitute for your own reasoning.",
    "<active_nodes>",
  ];
  const footer = ["</active_nodes>", "</graph_of_trace>"];
  const fixed = header.join("\n").length + footer.join("\n").length + 2;
  const lines = compactGraphLines(graph, Math.max(0, maxChars - fixed));
  return [...header, ...lines, ...footer].join("\n");
}

function clippedJson(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value, null, 2);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 24))}\n... [truncated]`;
}

export interface GoTAuditContextInput {
  graph: TraceGraphV2;
  target: TraceAuditTarget;
  targetNode?: unknown;
  parentNode?: unknown;
  neighborhood?: unknown;
}

/** Detailed bound evidence plus compact global state for one background GoT audit. */
export function renderGoTAuditContext(
  input: GoTAuditContextInput,
  maxChars = 48_000,
): string {
  const { graph, target } = input;
  const header = [
    `<got_audit_context revision="${graph.revision}">`,
    "Review exactly the bound target. Check internal consistency, conflicts with other active/approved nodes, whether evidence supports strong words such as unique/direct/proves/refutes, and whether a proposed parent is a real evidential or computational prerequisite rather than chronology or similarity.",
    "Also check whether the node is too coarse or too fine, whether independently reviewable settings/results/analyses/findings were improperly merged, whether settings in one ablation were falsely chained, and whether result-to-analysis-to-finding-to-conclusion dependencies skip necessary direct evidence. Episode membership alone never establishes dependency.",
    "If competing explanations cannot be excluded, return uncertain. Textual traceability alone is not scientific validation.",
    `<bound_target>${clippedJson(target, 2_000)}</bound_target>`,
  ];
  const footer = "</got_audit_context>";
  const sections: Array<[string, unknown, number]> = [
    ["target_evidence", input.targetNode, 14_000],
    ["parent_evidence", input.parentNode, 8_000],
    ["local_neighborhood", input.neighborhood, 14_000],
    ["compact_active_graph", compactGraphLines(graph, 10_000).map((line) => JSON.parse(line)), 12_000],
  ];
  const lines = [...header];
  for (const [name, value, sectionLimit] of sections) {
    if (value === undefined) continue;
    const remaining = maxChars - lines.join("\n").length - footer.length - name.length * 2 - 16;
    if (remaining <= 80) break;
    const content = clippedJson(value, Math.min(sectionLimit, remaining));
    lines.push(`<${name}>${content}</${name}>`);
  }
  lines.push(footer);
  return lines.join("\n");
}
