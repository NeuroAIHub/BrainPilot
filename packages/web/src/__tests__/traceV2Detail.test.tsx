import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TraceGraph, TraceNode } from "../contracts/backend";
import { TraceNodeDetail } from "../components/session/TraceNodeDetail";

const t = (key: string) => key;

const a: TraceNode = {
  id: "a", title: "Collect", type: "task", status: "completed", parents: [], artifacts: [], parentIds: [], childIds: ["b"], toolCalls: [],
};
const b: TraceNode = {
  id: "b", title: "Analyze", type: "task", status: "pending", parents: [], artifacts: [], parentIds: [], childIds: [], toolCalls: [], primaryEpisodeId: "ep", episodeTags: ["review"],
};

const graph: TraceGraph = {
  schemaVersion: "2.0",
  revision: 3,
  meta: { sessionId: "s" },
  nodes: [a, b],
  dependencies: [
    { id: "official", prerequisiteId: "a", dependentId: "b", origin: "host", confidence: "high", state: "active", evidence: [] },
    { id: "candidate", prerequisiteId: "a", dependentId: "b", origin: "trace", confidence: "low", state: "proposed", evidence: [{ source: "trace", kind: "trace_inference" }] },
  ],
  semanticLinks: [{ id: "supports", fromId: "a", toId: "b", type: "supports" }],
  episodes: [{ id: "ep", title: "Evidence review" }],
  artifacts: [{ id: "artifact", producerNodeId: "a", path: "evidence.csv", kind: "data", exists: "present", verificationStatus: "reserved" }],
};

describe("TraceNodeDetail V2 sections", () => {
  it("separates official/candidate/semantic/episode data and exposes decisions", () => {
    const html = renderToStaticMarkup(
      <TraceNodeDetail
        node={b}
        nodes={[a, b]}
        graph={graph}
        onSelectNode={() => {}}
        onDependencyDecision={() => {}}
        t={t}
      />,
    );
    expect(html).toContain("trace.node.dependencies");
    expect(html).toContain("Candidate dependencies / evidence");
    expect(html).toContain("Semantic links");
    expect(html).toContain("Episode");
    expect(html).toContain("Evidence review");
    expect(html).toContain("Accept");
    expect(html).toContain("Reject");
  });
});
