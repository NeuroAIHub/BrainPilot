import { describe, expect, it } from "vitest";
import type { TraceNode } from "../contracts/backend";
import { withEpisodeGroups } from "../components/session/AgentTraceViews";

function node(id: string, episode: string | undefined, parents: string[] = []): TraceNode {
  return {
    id,
    title: id,
    type: "result",
    status: "completed",
    parents: parents.map((parentId) => ({ id: parentId, edgeType: "confirmed" })),
    parentIds: [...parents],
    childIds: [],
    artifacts: [],
    toolCalls: [],
    ...(episode ? { primaryEpisodeId: episode } : {}),
  };
}

describe("Trace Episode grouping", () => {
  it("preserves cross-Episode dependencies without mutating the source graph", () => {
    const nodes = [
      node("setting", "ablation"),
      node("result", "ablation", ["setting"]),
      node("synthesis", "final", ["result"]),
      node("report", undefined, ["synthesis"]),
    ];
    const before = structuredClone(nodes);
    const grouped = withEpisodeGroups(nodes, [
      { id: "ablation", title: "Ablation — dropout" },
      { id: "final", title: "Final Synthesis" },
    ], true);

    expect(nodes).toEqual(before);
    expect(grouped.find((item) => item.id === "episode:final")?.parentIds)
      .toEqual(["episode:ablation"]);
    expect(grouped.find((item) => item.id === "report")?.parentIds)
      .toEqual(["episode:final"]);
    expect(grouped.find((item) => item.id === "episode:ablation")?.parentIds)
      .toEqual([]);
  });
});
