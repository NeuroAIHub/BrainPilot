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

  it("keeps a depends_on edge prerequisite→dependent when given correctly", () => {
    const g = new GraphOfTrace("s");
    const survey: TraceNode = {
      id: "survey", title: "survey", type: "task", status: "completed",
      parents: [], artifacts: [], parentIds: [], childIds: [],
      createdAt: "2026-01-01T11:20:18.000Z", updatedAt: "2026-01-01T11:20:18.000Z",
      toolCalls: [],
    };
    const synthesis: TraceNode = { ...survey, id: "synthesis", title: "synthesis", createdAt: "2026-01-01T11:24:55.000Z", updatedAt: "2026-01-01T11:24:55.000Z" };
    g.load({ meta: { sessionId: "s" }, nodes: [survey, synthesis] });

    // Correct direction: survey (earlier) is prerequisite of synthesis (later).
    expect(g.addRelation("survey", "synthesis", "synthesis builds on the survey")).toBe(true);
    // synthesis depends_on survey: survey recorded as synthesis's parent.
    expect(g.getNode("synthesis")!.parentIds).toContain("survey");
    expect(g.getNode("survey")!.childIds).toContain("synthesis");
  });

  it("auto-corrects a reversed depends_on edge to follow chronology (#110)", () => {
    const g = new GraphOfTrace("s");
    // Chain: survey -> synthesis -> audit, each created later than the last.
    const mk = (id: string, ts: string): TraceNode => ({
      id, title: id, type: "task", status: "completed",
      parents: [], artifacts: [], parentIds: [], childIds: [],
      createdAt: ts, updatedAt: ts, toolCalls: [],
    });
    g.load({
      meta: { sessionId: "s" },
      nodes: [
        mk("survey", "2026-01-01T11:20:18.000Z"),
        mk("synthesis", "2026-01-01T11:24:55.000Z"),
        mk("audit", "2026-01-01T11:31:22.000Z"),
      ],
    });

    // Reversed args: caller says from=synthesis (later) -> to=survey (earlier).
    // The guard must swap so the edge still points survey -> synthesis.
    expect(g.addRelation("synthesis", "survey", "synthesis depends on survey")).toBe(true);
    expect(g.getNode("synthesis")!.parentIds).toContain("survey");
    expect(g.getNode("synthesis")!.parentIds).not.toContain("synthesis");
    expect(g.getNode("survey")!.childIds).toContain("synthesis");
    expect(g.getNode("survey")!.parentIds).not.toContain("synthesis");

    // Reversed again: from=audit (latest) -> to=synthesis. Swap → synthesis -> audit.
    expect(g.addRelation("audit", "synthesis", "audit depends on synthesis")).toBe(true);
    expect(g.getNode("audit")!.parentIds).toContain("synthesis");
    expect(g.getNode("synthesis")!.childIds).toContain("audit");

    // Every depends_on edge now points earlier → later (no time reversal).
    for (const node of g.getGraph().nodes) {
      for (const p of node.parents) {
        if (p.relation !== "depends_on") continue;
        const parent = g.getNode(p.id)!;
        expect(parent.createdAt! <= node.createdAt!).toBe(true);
      }
    }
  });

  it("does not reorder non-depends_on relations (parent/follows left intact)", () => {
    const g = new GraphOfTrace("s");
    const mk = (id: string, ts: string): TraceNode => ({
      id, title: id, type: "task", status: "completed",
      parents: [], artifacts: [], parentIds: [], childIds: [],
      createdAt: ts, updatedAt: ts, toolCalls: [],
    });
    g.load({
      meta: { sessionId: "s" },
      nodes: [mk("early", "2026-01-01T00:00:00.000Z"), mk("late", "2026-01-02T00:00:00.000Z")],
    });
    // A 'parent' edge from the later node is a legitimate hierarchy link; the
    // chronology guard only applies to depends_on and must leave this as-is.
    expect(g.addRelation("late", "early", "hierarchy", "parent")).toBe(true);
    expect(g.getNode("early")!.parentIds).toContain("late");
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
