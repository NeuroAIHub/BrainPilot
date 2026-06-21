import { CUSTOM_EVENT } from "@brainpilot/protocol";
import type { TraceGraph, TraceNode, WebSocketEvent } from "../contracts/backend";
import { normalizeTraceNode } from "../contracts/backend";

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
  if (e.type !== "CUSTOM" || e.name !== CUSTOM_EVENT.TRACE_NODE) return graph;
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

  return { meta: base.meta, nodes: withChildIds(nextNodes) };
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
