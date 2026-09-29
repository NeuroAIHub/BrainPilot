import { describe, expect, it } from "vitest";
import { TraceDeltaV2Schema, type TraceDeltaV2, type TraceGraphV2 } from "@brainpilot/protocol";
import { GraphOfTrace } from "../trace.js";

function replay(previous: TraceGraphV2 | undefined, delta: TraceDeltaV2): TraceGraphV2 {
  if (delta.op === "snapshot") return delta.graph!;
  expect(delta.op).toBe("patch");
  const base = previous ?? {
    schemaVersion: "2.0" as const, revision: 0, meta: delta.meta!,
    nodes: [], dependencies: [], episodes: [], artifacts: [],
  };
  const apply = <T extends { id: string }>(items: T[], updates: T[] = [], removed: string[] = []): T[] => {
    const next = new Map(items.map((item) => [item.id, item]));
    for (const id of removed) next.delete(id);
    for (const item of updates) next.set(item.id, item);
    return [...next.values()];
  };
  return {
    ...base, revision: delta.revision, meta: delta.meta ?? base.meta,
    nodes: apply(base.nodes, delta.nodes, delta.removed?.nodes),
    dependencies: apply(base.dependencies, delta.dependencies, delta.removed?.dependencies),
    episodes: apply(base.episodes, delta.episodes, delta.removed?.episodes),
    artifacts: apply(base.artifacts, delta.artifacts, delta.removed?.artifacts),
  };
}

describe("bounded TraceGraphV2 deltas", () => {
  it("replays node, parent, artifact, episode, rollback, and audit mutations exactly", () => {
    const deltas: TraceDeltaV2[] = [];
    const trace = new GraphOfTrace("s", undefined, undefined, (delta) => deltas.push(delta));
    const a = trace.createNode({ title: "A", episode: "First" });
    const b = trace.createNode({ title: "B" });
    trace.updateNode(a.id, { summary: "Evidence" });
    trace.proposeCausalParent(b.id, a.id, "support", { type: "agent", name: "trace" });
    const artifact = trace.registerArtifact(a.id, { path: "result.txt", role: "output", blobHash: "v1" })!;
    trace.referenceArtifact(b.id, artifact.id);
    trace.registerArtifact(a.id, { path: "result.txt", role: "output", blobHash: "v2" });
    const second = trace.createEpisode({ title: "Second" });
    trace.assignEpisode(b.id, second.id);
    trace.mergeEpisodes(trace.getGraphV2().episodes[0]!.id, [second.id]);
    trace.markNodesRolledBack([b.id], a.id);
    trace.recordChange({ actor: { type: "host" }, action: "audit_report_submitted", target: {} });

    let restored: TraceGraphV2 | undefined;
    for (const delta of deltas) restored = replay(restored, TraceDeltaV2Schema.parse(delta));
    expect(restored).toEqual(trace.getGraphV2());
    expect(deltas.every((delta) => delta.op === "patch" && !delta.graph)).toBe(true);
    expect(restored!.artifacts.find((item) => item.id === artifact.id)?.blobHash).toBe("v2");
  });

  it("keeps cumulative event bytes close to linear as independent nodes grow", () => {
    const deltas: TraceDeltaV2[] = [];
    const trace = new GraphOfTrace("s", undefined, undefined, (delta) => deltas.push(delta));
    const sizes: number[] = [];
    for (let index = 0; index < 200; index++) {
      trace.createNode({ title: `Node ${index}` });
      if (index === 49 || index === 99 || index === 199) {
        sizes.push(Buffer.byteLength(deltas.map((delta) => JSON.stringify(delta)).join("\n")));
      }
    }
    expect(sizes[1]! / sizes[0]!).toBeLessThan(2.4);
    expect(sizes[2]! / sizes[1]!).toBeLessThan(2.4);
    expect(sizes[2]!).toBeLessThan(500_000);
  });

  it("continues revisions after a historical graph is loaded", () => {
    const deltas: TraceDeltaV2[] = [];
    const trace = new GraphOfTrace("s", undefined, undefined, (delta) => deltas.push(delta));
    trace.load({ meta: { sessionId: "s" }, nodes: [
      { id: "old", title: "Old", type: "task", status: "completed", parents: [], parentIds: [], childIds: [], artifacts: [], toolCalls: [] },
    ] });
    expect(deltas).toHaveLength(0);
    const baseline = trace.getGraphV2();
    trace.updateNode("old", { title: "Updated" });
    expect(replay(baseline, deltas[0]!)).toEqual(trace.getGraphV2());
  });
});
