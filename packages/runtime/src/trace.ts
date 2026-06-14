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

export class GraphOfTrace {
  private readonly nodes = new Map<string, TraceNode>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    readonly sessionId: string,
    private readonly persistPath?: string,
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
    };
    this.nodes.set(id, node);
    // Maintain reverse edges.
    for (const p of parents) {
      const parent = this.nodes.get(p.id);
      if (parent && !parent.childIds.includes(id)) parent.childIds.push(id);
    }
    this.persist();
    return node;
  }

  updateNode(id: string, updates: Partial<TraceNode>): TraceNode | undefined {
    const node = this.nodes.get(id);
    if (!node) return undefined;
    Object.assign(node, updates, { id, updatedAt: now() });
    this.persist();
    return node;
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
