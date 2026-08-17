import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TraceGraph, TraceNode } from "@brainpilot/protocol";
import { TraceDocumentV2Schema } from "@brainpilot/protocol";
import { GraphOfTrace } from "../trace.js";

function legacyNode(id: string, createdAt: string, parents: TraceNode["parents"] = []): TraceNode {
  return {
    id,
    title: id,
    type: "task",
    status: "completed",
    parents,
    artifacts: [],
    parentIds: parents.map((parent) => parent.id),
    childIds: [],
    createdAt,
    updatedAt: createdAt,
    toolCalls: [],
  };
}

function v1Graph(): TraceGraph {
  const a = legacyNode("a", "2026-01-01T00:00:00.000Z");
  const b = legacyNode("b", "2026-01-01T00:01:00.000Z", [
    { id: "a", relation: "depends_on" },
  ]);
  return {
    meta: { sessionId: "s", createdAt: "2026-01-01T00:00:00.000Z" },
    nodes: [a, b],
  };
}

describe("TraceGraphV2 storage and audit semantics", () => {
  it("records a final review once and rejects conflicting overwrites", () => {
    const graph = new GraphOfTrace("s");
    const parent = graph.createNode({ title: "Evidence" });
    const child = graph.createNode({ title: "Conclusion" });
    const actor = { type: "agent" as const, name: "auditor" };

    expect(graph.review(child.id, "approve", "Supported.", actor)).toBe(true);
    const nodeRevision = graph.getGraphV2().revision;
    expect(graph.review(child.id, "approve", "Supported.", actor)).toBe(true);
    expect(graph.getGraphV2().revision).toBe(nodeRevision);
    expect(graph.review(child.id, "reject", "Conflicting.", actor)).toBe(false);
    expect(graph.getNodeV2(child.id)).toMatchObject({
      reviewConclusion: "approved",
      reviewReason: "Supported.",
    });

    expect(graph.proposeCausalParent(child.id, parent.id, "Direct support.", { type: "agent", name: "trace" })).toBe(true);
    expect(graph.review(child.id, "approve", "Direct support.", actor, parent.id)).toBe(true);
    const edgeRevision = graph.getGraphV2().revision;
    expect(graph.review(child.id, "approve", "Direct support.", actor, parent.id)).toBe(true);
    expect(graph.getGraphV2().revision).toBe(edgeRevision);
    expect(graph.review(child.id, "reject", "Conflicting.", actor, parent.id)).toBe(false);
    expect(graph.getNodeV2(child.id)?.parents).toContainEqual(expect.objectContaining({
      nodeId: parent.id,
      conclusion: "confirmed",
      reason: "Direct support.",
    }));
  });

  it("creates one protected Session Start root as the confirmed fallback", () => {
    const graph = new GraphOfTrace("s");
    const rootId = graph.getGraphV2().meta.rootNodeId!;
    expect(graph.getNodeV2(rootId)).toMatchObject({
      type: "session_start",
      reviewConclusion: "approved",
      revoked: false,
      parents: [],
    });

    const evidence = graph.createNode({ title: "Evidence" });
    const conclusion = graph.createNode({ title: "Conclusion" });
    expect(graph.getNode(evidence.id)?.parentIds).toEqual([rootId]);
    expect(graph.getNode(conclusion.id)?.parentIds).toEqual([rootId]);
    expect(graph.getNodeV2(conclusion.id)?.parents).toContainEqual(
      expect.objectContaining({ nodeId: rootId, origin: "host_fallback" }),
    );
    expect(graph.updateNode(rootId, { title: "Changed" })).toBeUndefined();
    expect(graph.listPendingAuditTargets().some((target) => target.nodeId === rootId)).toBe(false);

    expect(graph.proposeCausalParent(
      conclusion.id,
      evidence.id,
      "Conclusion consumes this evidence.",
      { type: "agent", name: "trace" },
    )).toBe(true);
    expect(graph.getNode(conclusion.id)?.parentIds).toEqual([evidence.id]);
  });

  it("allows Trace to replace the root fallback with a confirmed root parent", () => {
    const graph = new GraphOfTrace("s");
    const rootId = graph.getGraphV2().meta.rootNodeId!;
    const node = graph.createNode({ title: "Independent observation" });

    expect(graph.proposeCausalParent(
      node.id,
      rootId,
      "This observation depends only on the session's initial context.",
      { type: "agent", name: "trace" },
    )).toBe(true);
    expect(graph.getNodeV2(node.id)?.parents).toEqual([
      expect.objectContaining({ nodeId: rootId, conclusion: "confirmed", origin: "trace" }),
    ]);
    expect(graph.listPendingAuditTargets([node.id])).not.toContainEqual(
      expect.objectContaining({ nodeId: node.id, parentNodeId: rootId }),
    );
  });

  it("keeps an already confirmed explicit parent idempotent", () => {
    const graph = new GraphOfTrace("s");
    const parent = graph.createNode({ title: "Evidence" });
    const child = graph.createNode({ title: "Conclusion" });
    const reason = "Evidence directly supports the conclusion.";
    expect(graph.proposeCausalParent(
      child.id,
      parent.id,
      reason,
      { type: "agent", name: "trace" },
    )).toBe(true);
    expect(graph.review(
      child.id,
      "approve",
      reason,
      { type: "agent", name: "auditor" },
      parent.id,
    )).toBe(true);

    expect(graph.proposeCausalParent(
      child.id,
      parent.id,
      reason,
      { type: "agent", name: "trace" },
    )).toBe(true);
    expect(graph.getNodeV2(child.id)?.parents).toContainEqual(
      expect.objectContaining({ nodeId: parent.id, conclusion: "confirmed", origin: "trace" }),
    );
    expect(graph.listPendingAuditTargets([child.id])).not.toContainEqual(
      expect.objectContaining({ parentNodeId: parent.id }),
    );
  });

  it("does not restore the Host root fallback while any non-root parent state exists", () => {
    const graph = new GraphOfTrace("s");
    const rootId = graph.getGraphV2().meta.rootNodeId!;
    const parent = graph.createNode({ title: "Evidence" });
    const child = graph.createNode({ title: "Conclusion" });
    graph.proposeCausalParent(child.id, parent.id, "possible evidence", { type: "agent", name: "trace" });
    expect(graph.getNodeV2(child.id)?.parents.some((item) => item.nodeId === rootId)).toBe(false);

    expect(graph.getNodeV2(child.id)?.parents).toEqual([
      expect.objectContaining({ nodeId: parent.id, conclusion: "confirmed" }),
    ]);
  });

  it("repairs rootless and cyclic V2 data into one all-state DAG", () => {
    const graph = new GraphOfTrace("s");
    graph.load({
      schemaVersion: "2.0",
      revision: 4,
      meta: { sessionId: "s" },
      nodes: [
        { id: "a", title: "A", type: "task", status: "completed", toolCalls: [], artifactIds: [], episodeTags: [], records: [], parents: [{ nodeId: "b", conclusion: "rejected" }], executionResult: "completed", revoked: false, reviewConclusion: "approved" },
        { id: "b", title: "B", type: "task", status: "completed", toolCalls: [], artifactIds: [], episodeTags: [], records: [], parents: [{ nodeId: "a", conclusion: "candidate" }], executionResult: "completed", revoked: false, reviewConclusion: "approved" },
        { id: "orphan", title: "Orphan", type: "task", status: "completed", toolCalls: [], artifactIds: [], episodeTags: [], records: [], parents: [{ nodeId: "missing", conclusion: "confirmed" }], executionResult: "completed", revoked: false, reviewConclusion: "approved" },
      ],
      dependencies: [], episodes: [], artifacts: [],
    });

    const normalized = graph.getGraphV2();
    const rootId = normalized.meta.rootNodeId!;
    const allParents = new Map(normalized.nodes.map((node) => [
      node.id,
      node.parents.map((parent) => parent.nodeId),
    ]));
    const reachesRoot = (start: string): boolean => {
      const seen = new Set<string>();
      const visit = (id: string): boolean => {
        if (id === rootId) return true;
        if (seen.has(id)) return false;
        seen.add(id);
        return (allParents.get(id) ?? []).some(visit);
      };
      return visit(start);
    };
    expect(normalized.nodes.filter((node) => node.id !== rootId).every((node) => reachesRoot(node.id))).toBe(true);
    const parentMap = new Map(normalized.nodes.map((node) => [node.id, node.parents.map((parent) => parent.nodeId)]));
    const isAcyclic = (start: string, visiting = new Set<string>(), visited = new Set<string>()): boolean => {
      if (visiting.has(start)) return false;
      if (visited.has(start)) return true;
      const nextVisiting = new Set(visiting).add(start);
      if (!(parentMap.get(start) ?? []).every((parentId) => isAcyclic(parentId, nextVisiting, visited))) return false;
      visited.add(start);
      return true;
    };
    expect(normalized.nodes.every((node) => isAcyclic(node.id))).toBe(true);
    expect(normalized.nodes.flatMap((node) => node.parents.filter((parent) => parent.nodeId === "a" || parent.nodeId === "b"))).toHaveLength(1);
    expect(graph.getNode("orphan")?.parentIds).toEqual([rootId]);
  });

  it("rejects a reverse Trace edge when it would create a cycle", () => {
    const graph = new GraphOfTrace("s");
    const a = graph.createNode({ title: "A" });
    const b = graph.createNode({ title: "B" });
    expect(graph.proposeCausalParent(b.id, a.id, "A informed B", { type: "agent", name: "trace" })).toBe(true);
    expect(graph.proposeCausalParent(a.id, b.id, "B informed A", { type: "agent", name: "trace" })).toBe(false);
  });

  it("rejects an entire invalid parent batch before graph mutation", () => {
    const graph = new GraphOfTrace("s");
    const a = graph.createNode({ title: "A" });
    const b = graph.createNode({ title: "B" });
    graph.proposeCausalParent(b.id, a.id, "A produces the input for B.", { type: "agent", name: "trace" });
    const before = graph.getGraphV2();

    expect(graph.updateNode(
      a.id,
      { title: "Mutated", episode: "Must Not Exist" },
      { type: "agent", name: "trace" },
      [
        { nodeId: b.id, reason: "This would close a cycle." },
        { nodeId: "missing", reason: "This parent is missing." },
      ],
    )).toBeUndefined();
    expect(graph.getGraphV2()).toEqual(before);
    expect(graph.validateCausalParentCandidates(undefined, [
      { nodeId: a.id, reason: "one" },
      { nodeId: a.id, reason: "duplicate" },
    ])).toMatchObject({ ok: false, reason: expect.stringContaining("duplicate") });
    expect(graph.validateCausalParentCandidates(undefined, [
      { nodeId: a.id, reason: "   " },
    ])).toMatchObject({ ok: false, reason: expect.stringContaining("non-empty") });

    graph.updateNode(a.id, { revoked: true }, { type: "host" });
    expect(graph.validateCausalParentCandidates(undefined, [
      { nodeId: a.id, reason: "revoked evidence" },
    ])).toMatchObject({ ok: false, reason: expect.stringContaining("revoked") });
  });

  it("normalizes, reuses, moves, and persists Episode names", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-trace-episodes-"));
    try {
      const tracePath = join(root, "trace.json");
      const graph = new GraphOfTrace("s", tracePath);
      const first = graph.createNode({
        title: "Baseline setting",
        episode: "  Ａｂｌａｔｉｏｎ   —  Dropout  ",
      });
      const second = graph.createNode({
        title: "Baseline result",
        episode: "ablation — dropout",
      });
      let snapshot = graph.getGraphV2();
      expect(snapshot.episodes).toHaveLength(1);
      expect(snapshot.episodes[0]?.title).toBe("Ablation — Dropout");
      expect(graph.getNodeV2(first.id)?.primaryEpisodeId)
        .toBe(graph.getNodeV2(second.id)?.primaryEpisodeId);

      graph.updateNode(second.id, { episode: "Environment & Reproducibility" });
      await graph.flush();
      const restored = new GraphOfTrace("s", tracePath);
      restored.load(JSON.parse(await readFile(tracePath, "utf8")));
      snapshot = restored.getGraphV2();
      expect(snapshot.episodes.map((episode) => episode.title).sort()).toEqual([
        "Ablation — Dropout",
        "Environment & Reproducibility",
      ]);
      const restoredSecond = restored.getNodeV2(second.id)!;
      expect(snapshot.episodes.find((episode) => episode.id === restoredSecond.primaryEpisodeId)?.title)
        .toBe("Environment & Reproducibility");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates V1 lazily and persists only nodes[].parents as authoritative relationships", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-trace-v2-"));
    try {
      const tracePath = join(root, "trace.json");
      const original = v1Graph();
      await writeFile(tracePath, JSON.stringify(original, null, 2), "utf8");
      const graph = new GraphOfTrace("s", tracePath);
      graph.load(original);

      expect(await readFile(tracePath, "utf8")).toBe(JSON.stringify(original, null, 2));
      expect(graph.getNodeV2("b")?.parents).toContainEqual(
        expect.objectContaining({ nodeId: "a", conclusion: "confirmed" }),
      );
      expect(graph.getNode("b")?.parentIds).toContain("a");
      graph.createNode({ title: "first V2 write" });
      await graph.flush();

      const persisted = JSON.parse(await readFile(tracePath, "utf8")) as Record<string, unknown>;
      expect(persisted.schemaVersion).toBe("2.0");
      expect(JSON.stringify(persisted)).not.toContain('"parentIds"');
      expect(JSON.stringify(persisted)).not.toContain('"childIds"');
      expect(persisted).not.toHaveProperty("dependencies");
      expect(persisted).not.toHaveProperty("semanticLinks");
      expect(TraceDocumentV2Schema.safeParse(persisted).success).toBe(true);
      expect(JSON.parse(await readFile(join(root, "trace.v1.json.bak"), "utf8"))).toEqual(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists and recovers the append-only modification log", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-trace-changes-"));
    try {
      const tracePath = join(root, "trace.json");
      const graph = new GraphOfTrace("s", tracePath);
      const node = graph.createNode({ title: "Model ablation", changeActor: { type: "agent", name: "trace" } });
      graph.review(node.id, "approve", "evidence is sufficient", { type: "agent", name: "auditor" });
      await graph.flush();

      const raw = await readFile(join(root, "trace-changes.jsonl"), "utf8");
      expect(raw).toContain('"action":"node_created"');
      expect(raw).toContain('"action":"node_reviewed"');
      const restored = new GraphOfTrace("s", tracePath);
      restored.load(JSON.parse(await readFile(tracePath, "utf8")));
      await restored.recoverChanges();
      expect(restored.getChanges()).toEqual(expect.arrayContaining([
        expect.objectContaining({ action: "node_created" }),
        expect.objectContaining({ action: "node_reviewed" }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains the complete pending journal tail after an append failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-trace-pending-"));
    try {
      const tracePath = join(root, "trace.json");
      const journalPath = join(root, "trace-changes.jsonl");
      await mkdir(journalPath);
      const graph = new GraphOfTrace("s", tracePath);
      graph.createNode({ title: "First change" });
      graph.createNode({ title: "Second change" });
      await graph.flush();

      const failedSnapshot = JSON.parse(await readFile(tracePath, "utf8")) as { pendingChanges?: unknown[] };
      expect(failedSnapshot.pendingChanges).toHaveLength(2);

      await rm(journalPath, { recursive: true, force: true });
      const restored = new GraphOfTrace("s", tracePath);
      restored.load(failedSnapshot);
      await restored.recoverChanges();

      const actions = (await readFile(journalPath, "utf8"))
        .trim().split("\n").map((line) => JSON.parse(line) as { action: string });
      expect(actions.filter((change) => change.action === "node_created")).toHaveLength(2);
      const recoveredSnapshot = JSON.parse(await readFile(tracePath, "utf8")) as Record<string, unknown>;
      expect(recoveredSnapshot).not.toHaveProperty("pendingChanges");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires current fingerprints and hides revoked nodes from active graphs", () => {
    const graph = new GraphOfTrace("s");
    const node = graph.createNode({
      title: "Model ablation",
      confidence: "low",
      confidenceReason: "One incomplete run.",
    });
    const stale = graph.listPendingAuditTargets().find((target) => target.nodeId === node.id)!;
    graph.updateNode(node.id, {
      summary: "Three seeds now agree.",
      confidence: "high",
      confidenceReason: "Three independent records agree.",
    }, { type: "agent", name: "trace" });

    expect(graph.review(node.id, "approve", "stale", { type: "agent", name: "auditor" }, undefined, stale.fingerprint)).toBe(false);
    const current = graph.listPendingAuditTargets().find((target) => target.nodeId === node.id)!;
    expect(graph.review(node.id, "approve", "supported", { type: "agent", name: "auditor" }, undefined, current.fingerprint)).toBe(true);
    graph.updateNode(node.id, { revoked: true }, { type: "host" });
    expect(graph.getActiveGraph().nodes.some((candidate) => candidate.id === node.id)).toBe(false);
  });
});
