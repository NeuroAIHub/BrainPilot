import { describe, expect, it } from "vitest";
import { TraceDeltaV2Schema, type TraceDeltaV2, type TraceGraphV2 } from "@brainpilot/protocol";
import { GraphOfTrace } from "../trace.js";

function applyDelta(base: TraceGraphV2, raw: TraceDeltaV2): TraceGraphV2 {
  const delta = TraceDeltaV2Schema.parse(raw);
  if (delta.op === "snapshot") return delta.graph!;
  const patch = <T extends { id: string }>(old: T[], updates: T[], removed: string[] = []): T[] => {
    const map = new Map(old.map((item) => [item.id, item]));
    for (const id of removed) map.delete(id);
    for (const item of updates) map.set(item.id, item);
    return [...map.values()];
  };
  return {
    ...base,
    revision: delta.revision,
    meta: delta.meta ?? base.meta,
    nodes: patch(base.nodes, delta.nodes, delta.removed?.nodes),
    dependencies: patch(base.dependencies, delta.dependencies, delta.removed?.dependencies),
    episodes: patch(base.episodes, delta.episodes, delta.removed?.episodes),
    artifacts: patch(base.artifacts, delta.artifacts, delta.removed?.artifacts),
  };
}

describe("trace delta replay acceptance", () => {
  it("matches the canonical graph after each public mutation", () => {
    let replayed!: TraceGraphV2;
    const trace = new GraphOfTrace("s", undefined, undefined, (delta) => {
      replayed = applyDelta(replayed, delta);
      expect(replayed).toEqual(trace.getGraphV2());
    });
    replayed = trace.getGraphV2();
    const matches = () => expect(replayed).toEqual(trace.getGraphV2());

    const a = trace.createNode({ title: "A" }); matches();
    const b = trace.createNode({ title: "B" }); matches();
    const c = trace.createNode({ title: "C" }); matches();
    trace.createNode({ title: "D", parents: [{ id: a.id, relation: "depends_on", explanation: "legacy relation" }] }); matches();
    trace.updateNode(a.id, { summary: "Evidence" }); matches();
    trace.appendRecord(a.id, { sourceAgent: "worker", description: "Observed", createdAt: "2026-01-01T00:00:00Z" }, { type: "host" }); matches();
    const proposed = trace.proposeDependency({ prerequisiteId: a.id, dependentId: b.id, origin: "host", reason: "reported" });
    expect(proposed.ok).toBe(true); matches();
    trace.decideDependency(proposed.dependency!.id, "accept", "verified"); matches();
    trace.proposeCausalParent(c.id, b.id, "used B", { type: "agent", name: "trace" }); matches();
    trace.review(c.id, "approve", "checked", { type: "user" }); matches();
    const artifact = trace.registerArtifact(a.id, { path: "out.txt", role: "output" })!; matches();
    trace.referenceArtifact(c.id, artifact.id); matches();
    trace.attachArtifactInput(b.id, { path: "input.txt", role: "input" }); matches();
    const first = trace.createEpisode({ title: "First" }); matches();
    const second = trace.createEpisode({ title: "Second" }); matches();
    trace.assignEpisode(a.id, first.id); matches();
    trace.updateNode(c.id, { episode: "Ad hoc" }); matches();
    trace.assignEpisode(b.id, first.id, [first.id]); matches();
    trace.renameEpisode(first.id, "Renamed"); matches();
    trace.mergeEpisodes(second.id, [first.id]); matches();
    const split = trace.splitEpisode(second.id, [{ title: "Split", nodeIds: [a.id] }]);
    expect(split).toHaveLength(1); matches();
    trace.markNodesRolledBack([b.id, c.id], a.id); matches();
    trace.recordChange({ actor: { type: "host" }, action: "audit_report_submitted", target: {} }); matches();
  });

  it("replays a later mutation from a restored baseline", () => {
    let replayed!: TraceGraphV2;
    const trace = new GraphOfTrace("s", undefined, undefined, (delta) => {
      replayed = applyDelta(replayed, delta);
      expect(replayed).toEqual(trace.getGraphV2());
    });
    const replacement = new GraphOfTrace("s");
    const newNode = replacement.createNode({ title: "Replacement" });
    replacement.createEpisode({ title: "Imported episode" });
    trace.load(replacement.getGraphV2());
    // Bootstrap/reconnect sends a canonical snapshot before any later deltas.
    replayed = trace.getGraphV2();
    expect(replayed).toEqual(trace.getGraphV2());
    trace.updateNode(newNode.id, { title: "Updated replacement" });
    expect(replayed).toEqual(trace.getGraphV2());
  });
});
