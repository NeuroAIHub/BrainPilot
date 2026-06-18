/**
 * GraphOfTrace (#79) — onChange emission, chaining, and restore.
 */
import { describe, it, expect } from "vitest";
import { GraphOfTrace } from "../trace.js";
import type { TraceChangeOp } from "../trace.js";
import type { TraceNode } from "@brainpilot/protocol";

describe("GraphOfTrace onChange (#79)", () => {
  it("fires onChange on create / update / relation", () => {
    const events: Array<{ op: TraceChangeOp; id: string }> = [];
    const g = new GraphOfTrace("s", undefined, (op, node) => events.push({ op, id: node.id }));

    const a = g.createNode({ title: "A" });
    const b = g.createNode({ title: "B" });
    g.updateNode(a.id, { status: "completed" });
    g.addRelation(a.id, b.id, "because");

    expect(events).toEqual([
      { op: "created", id: a.id },
      { op: "created", id: b.id },
      { op: "updated", id: a.id },
      { op: "updated", id: b.id }, // addRelation emits on the `to` node
    ]);
  });

  it("createChainedNode links to the previous node and tags metadata.auto", () => {
    const g = new GraphOfTrace("s");
    const root = g.createChainedNode({ title: "root", agent: "principal" });
    expect(root.parents).toEqual([]); // first node is a root
    expect(root.metadata?.auto).toBe(true);

    const next = g.createChainedNode({ title: "next", agent: "principal" });
    expect(next.parents).toEqual([{ id: root.id, relation: "follows" }]);
    expect(next.parentIds).toEqual([root.id]);
    // Reverse edge maintained.
    expect(g.getNode(root.id)!.childIds).toContain(next.id);
  });

  it("getLastNodeId tracks the most recent create", () => {
    const g = new GraphOfTrace("s");
    expect(g.getLastNodeId()).toBeUndefined();
    const a = g.createNode({ title: "A" });
    expect(g.getLastNodeId()).toBe(a.id);
    const b = g.createNode({ title: "B" });
    expect(g.getLastNodeId()).toBe(b.id);
  });

  it("load() resumes chaining from the latest node", () => {
    const g = new GraphOfTrace("s");
    const older: TraceNode = {
      id: "n1", title: "older", type: "task", status: "completed",
      parents: [], artifacts: [], parentIds: [], childIds: [],
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      toolCalls: [],
    };
    const newer: TraceNode = { ...older, id: "n2", title: "newer", createdAt: "2026-02-01T00:00:00.000Z" };
    g.load({ meta: { sessionId: "s" }, nodes: [older, newer] });
    expect(g.getLastNodeId()).toBe("n2");
    const chained = g.createChainedNode({ title: "after-restore" });
    expect(chained.parentIds).toEqual(["n2"]);
  });
});
