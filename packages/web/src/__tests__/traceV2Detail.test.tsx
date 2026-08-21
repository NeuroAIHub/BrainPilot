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
  confidence: "high", reviewConclusion: "approved", reviewReason: "Checked", reason: "Evidence", context: "Study",
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
  episodes: [{ id: "ep", title: "Evidence review" }],
  artifacts: [{ id: "artifact", producerNodeId: "a", path: "evidence.csv", kind: "data", exists: "present", verificationStatus: "reserved" }],
};

describe("TraceNodeDetail V2 sections", () => {
  it("separates official/candidate/episode data and exposes decisions", () => {
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
    expect(html).toContain("trace.node.candidateDependencies");
    expect(html).toContain("trace.node.episodeTitle");
    expect(html).toContain("Evidence review");
    expect(html).toContain("trace.node.acceptDependency");
    expect(html).toContain("trace.node.rejectDependency");
    expect(html).toContain("trace.node.reviewTitle");
    expect(html).toContain("trace.node.reasonTitle");
    expect(html).toContain("trace.node.contextTitle");
    expect(html).toContain("trace.review.approved");
    expect(html).toContain("trace.confidence.low");
    expect(html).not.toContain(">Accept<");
    expect(html).not.toContain(">Reject<");
    expect(html).not.toContain(">approved<");
  });

  it("localizes the system start node instead of exposing host implementation text", () => {
    const root: TraceNode = {
      id: "root",
      title: "Session Start",
      type: "session_start",
      status: "completed",
      agent: "host",
      description: "Initial context and structural root for this session.",
      confidenceReason: "Created deterministically by the Host for this session.",
      reviewReason: "System structural node; no scientific review required.",
      parents: [],
      artifacts: [],
      parentIds: [],
      childIds: [],
      toolCalls: [],
    };
    const html = renderToStaticMarkup(
      <TraceNodeDetail node={root} nodes={[root]} onSelectNode={() => {}} t={t} />,
    );
    expect(html).toContain("trace.sessionStart.title");
    expect(html).toContain("trace.sessionStart.summary");
    expect(html).toContain("trace.sessionStart.confidenceReason");
    expect(html).toContain("trace.sessionStart.reviewReason");
    expect(html).toContain("trace.origin.system");
    expect(html).not.toContain("Session Start");
    expect(html).not.toContain("Initial context and structural root");
    expect(html).not.toContain(">host<");
  });
});
