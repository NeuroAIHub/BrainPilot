/**
 * GraphOfTrace (GoT) — the reasoning DAG (§9, ports legacy graph_of_trace.py).
 *
 * Nodes + relations are persisted to `.bp/{sid}/trace.json` as a `TraceGraph`
 * (protocol schema). System tools (create/update node, add relation, get graph)
 * mutate this; the Trace agent is the primary writer.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { TraceGraph, TraceNode } from "@brainpilot/protocol";

function now(): string {
  return new Date().toISOString();
}

/** Mutation kind reported to the `onChange` listener. */
export type TraceChangeOp = "created" | "updated";

export class GraphOfTrace {
  private readonly nodes = new Map<string, TraceNode>();
  private writeChain: Promise<void> = Promise.resolve();
  /** Id of the most recently created node — used to chain auto-captured nodes. */
  private lastNodeId: string | undefined;

  /**
   * @param onChange invoked after every node create/update/relation mutation so
   *   a hosting layer (SessionManager) can push a live `CUSTOM:trace_node` event.
   *   Kept decoupled from the EventBus so the store stays unit-testable on its own.
   */
  constructor(
    readonly sessionId: string,
    private readonly persistPath?: string,
    private readonly onChange?: (op: TraceChangeOp, node: TraceNode) => void,
  ) {}

  createNode(input: {
    title: string;
    type?: string;
    status?: string;
    agent?: string;
    description?: string;
    summary?: string;
    content?: string;
    parents?: Array<{ id: string; relation?: string; explanation?: string }>;
    artifacts?: Array<{ path: string; type?: string }>;
    metadata?: Record<string, unknown>;
    id?: string;
  }): TraceNode {
    const id = input.id ?? `node_${randomUUID()}`;
    const parents = input.parents ?? [];
    const node: TraceNode = {
      id,
      title: input.title,
      type: input.type ?? "task",
      status: input.status ?? "pending",
      agent: input.agent,
      description: input.description,
      summary: input.summary,
      content: input.content,
      parents,
      artifacts: input.artifacts ?? [],
      parentIds: parents.map((p) => p.id),
      childIds: [],
      createdAt: now(),
      updatedAt: now(),
      toolCalls: [],
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    this.nodes.set(id, node);
    // Maintain reverse edges.
    for (const p of parents) {
      const parent = this.nodes.get(p.id);
      if (parent && !parent.childIds.includes(id)) parent.childIds.push(id);
    }
    this.lastNodeId = id;
    this.persist();
    this.onChange?.("created", node);
    return node;
  }

  /**
   * Create a node automatically chained to the most recent node (deterministic
   * hook capture, §8). When no prior node exists it becomes a root. `metadata.auto`
   * is set so the UI can distinguish infra-captured milestones from LLM traces.
   */
  createChainedNode(input: {
    title: string;
    type?: string;
    status?: string;
    agent?: string;
    description?: string;
    metadata?: Record<string, unknown>;
  }): TraceNode {
    const parent = this.lastNodeId ? this.nodes.get(this.lastNodeId) : undefined;
    return this.createNode({
      title: input.title,
      type: input.type ?? "milestone",
      status: input.status ?? "completed",
      agent: input.agent,
      description: input.description,
      parents: parent ? [{ id: parent.id, relation: "follows" }] : undefined,
      metadata: { auto: true, ...input.metadata },
    });
  }

  updateNode(id: string, updates: Partial<TraceNode>): TraceNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;
    Object.assign(node, updates, { id, updatedAt: now() });
    this.persist();
    this.onChange?.("updated", node);
    return node;
  }

  /** Id of the most recently created node, if any. */
  getLastNodeId(): string | undefined {
    return this.lastNodeId;
  }

  addRelation(fromId: string, toId: string, explanation: string, relation = "depends_on"): boolean {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return false;
    if (!to.parents.some((p) => p.id === fromId)) {
      to.parents.push({ id: fromId, relation, explanation });
      to.parentIds.push(fromId);
    }
    if (!from.childIds.includes(toId)) from.childIds.push(toId);
    to.updatedAt = now();
    this.persist();
    this.onChange?.("updated", to);
    return true;
  }

  getNode(id: string): TraceNode | undefined {
    return this.nodes.get(id);
  }

  getGraph(): TraceGraph {
    return {
      meta: { sessionId: this.sessionId, createdAt: now() },
      nodes: [...this.nodes.values()],
    };
  }

  load(graph: TraceGraph): void {
    this.nodes.clear();
    for (const n of graph.nodes) this.nodes.set(n.id, n);
    // Resume chaining from the last-created node (by createdAt, falling back to
    // insertion order) so post-restore auto nodes link to existing history.
    let last: TraceNode | undefined;
    for (const n of this.nodes.values()) {
      if (!last || (n.createdAt ?? "") >= (last.createdAt ?? "")) last = n;
    }
    this.lastNodeId = last?.id;
  }

  private persist(): void {
    if (!this.persistPath) return;
    const graph = this.getGraph();
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(this.persistPath!), { recursive: true });
        await writeFile(this.persistPath!, JSON.stringify(graph, null, 2), "utf8");
      })
      .catch(() => {});
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}
