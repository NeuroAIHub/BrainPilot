import { CUSTOM_EVENT } from "@brainpilot/protocol";
import type { TraceGraph, TraceNode, TraceDeltaV2, WebSocketEvent } from "../contracts/backend";
import { normalizeTraceGraph, normalizeTraceNode } from "../contracts/backend";

/** A reconnect seed is not a new activity unless it advances a known graph. */
export function isNewTraceActivity(previous: TraceGraph | null, next: TraceGraph | null, event: WebSocketEvent): boolean {
  if (!next || next === previous) return false;
  if (event.type === "CUSTOM" && event.name === CUSTOM_EVENT.TRACE_DELTA
    && (event.value as { op?: string } | undefined)?.op === "snapshot") {
    return previous?.revision !== undefined && (next.revision ?? -1) > previous.revision;
  }
  return true;
}

/**
 * #79: merge a single `CUSTOM:trace_node` event into the live Graph of Trace.
 *
 * The runtime emits `CUSTOM { name:"trace_node", value:{ op, node } }` on every
 * trace mutation (LLM `record_trace`/`create_trace_*` and the deterministic
 * post-turn hook). This keeps the Trace panel live without polling the whole
 * graph every few seconds.
 *
 * Merge rules:
 *  - a non-`trace_node` event returns the same graph reference (no-op);
 *  - an unparseable / id-less payload is ignored (same reference);
 *  - a node id already present is replaced in place (status/summary updates);
 *  - a new node id is appended;
 *  - `childIds` are recomputed from every node's `parentIds` so edges stay
 *    consistent regardless of arrival order (a child can arrive before its
 *    parent's childIds is known).
 */
export function reduceTraceForEvent(
  graph: TraceGraph | null,
  event: WebSocketEvent,
  sessionId: string,
): TraceGraph | null {
  const e = event as Record<string, unknown>;
  if (e.type !== "CUSTOM") return graph;
  if (e.name === CUSTOM_EVENT.TRACE_DELTA) {
    const delta = (e.value ?? {}) as TraceDeltaV2;
    if (delta.schemaVersion !== "2.0" || !Number.isSafeInteger(delta.revision)) return graph;
    if (delta.op === "snapshot") {
      if (!delta.graph) return graph;
      const next = normalizeTraceGraph(delta.graph);
      if ((graph?.revision ?? -1) > (next.revision ?? -1)) return graph;
      const registry = new Map(delta.graph.artifacts.map((artifact) => [artifact.id, artifact]));
      return { ...next, nodes: withChildIds(delta.graph.nodes.map((node) => normalizeCanonicalNode(node, registry))) };
    }
    if (delta.op !== "patch" || (graph?.revision ?? -1) >= delta.revision) return graph;
    // A gap in a numbered stream requires a fresh authoritative snapshot.
    if (graph?.revision !== undefined && delta.revision !== graph.revision + 1) return graph;
    if (!graph && delta.revision !== 1) return graph;
    const base: TraceGraph = graph ?? { schemaVersion: "2.0", revision: 0, meta: { sessionId }, nodes: [], dependencies: [], episodes: [], artifacts: [] };
    const removed = delta.removed ?? {};
    const artifacts = patchEntities(base.artifacts ?? [], delta.artifacts ?? [], removed.artifacts ?? []);
    const registry = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
    const nodes = patchEntities(base.nodes, (delta.nodes ?? []).map((raw) => normalizeCanonicalNode(raw, registry)), removed.nodes ?? []);
    // Artifact records can change independently of their producer node.
    const changedArtifacts = new Set((delta.artifacts ?? []).map((item) => item.id));
    const refreshedNodes = changedArtifacts.size === 0 ? nodes : nodes.map((node) => {
      if (!node.artifactIds?.some((id) => changedArtifacts.has(id))) return node;
      return { ...node, artifacts: node.artifactIds.map((id) => registry.get(id)).filter(Boolean).map((artifact) => ({ path: artifact!.path, type: artifact!.type ?? artifact!.kind })) };
    });
    return {
      ...base,
      schemaVersion: "2.0",
      revision: delta.revision,
      meta: delta.meta ?? base.meta,
      nodes: withChildIds(refreshedNodes),
      dependencies: patchEntities(base.dependencies ?? [], delta.dependencies ?? [], removed.dependencies ?? []),
      episodes: patchEntities(base.episodes ?? [], delta.episodes ?? [], removed.episodes ?? []),
      artifacts,
    };
  }
  if (e.name !== CUSTOM_EVENT.TRACE_NODE) return graph;
  // Current runtimes send the legacy projection immediately before each V2
  // patch. Once a numbered graph exists, only the canonical stream may change it.
  if (graph?.schemaVersion === "2.0" && graph.revision !== undefined) return graph;
  const value = (e.value ?? {}) as Record<string, unknown>;
  const rawNode = value.node;
  if (!rawNode || typeof rawNode !== "object") return graph;
  const node = normalizeTraceNode(rawNode);
  if (!node.id) return graph;

  const base: TraceGraph = graph ?? {
    meta: { sessionId },
    nodes: [],
  };
  const idx = base.nodes.findIndex((n) => n.id === node.id);
  const nextNodes =
    idx >= 0
      ? base.nodes.map((n, i) => (i === idx ? node : n))
      : [...base.nodes, node];

  return { ...base, nodes: withChildIds(nextNodes) };
}

function normalizeCanonicalNode(
  raw: NonNullable<TraceDeltaV2["nodes"]>[number],
  registry: Map<string, NonNullable<TraceDeltaV2["artifacts"]>[number]>,
): TraceNode {
  return normalizeTraceNode({
    ...raw,
    summary: raw.report?.summary,
    content: raw.report?.content,
    artifacts: raw.artifactIds.map((id) => registry.get(id)).filter(Boolean).map((artifact) => ({ path: artifact!.path, type: artifact!.type ?? artifact!.kind })),
    causalParents: raw.parents,
  });
}

function patchEntities<T extends { id: string }>(existing: T[], updates: T[], removed: string[]): T[] {
  if (updates.length === 0 && removed.length === 0) return existing;
  const excluded = new Set(removed);
  const next = existing.filter((item) => !excluded.has(item.id));
  const indexes = new Map(next.map((item, index) => [item.id, index]));
  for (const item of updates) {
    const index = indexes.get(item.id);
    if (index === undefined) { indexes.set(item.id, next.length); next.push(item); }
    else next[index] = item;
  }
  return next;
}
/** Recompute every node's `childIds` from the parent links across the set. */
function withChildIds(nodes: TraceNode[]): TraceNode[] {
  const childrenByParent = new Map<string, Set<string>>();
  for (const n of nodes) {
    for (const pid of n.parentIds) {
      const set = childrenByParent.get(pid) ?? new Set<string>();
      set.add(n.id);
      childrenByParent.set(pid, set);
    }
  }
  return nodes.map((n) => ({
    ...n,
    childIds: Array.from(childrenByParent.get(n.id) ?? []),
  }));
}
