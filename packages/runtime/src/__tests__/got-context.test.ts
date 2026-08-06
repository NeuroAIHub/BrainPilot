import { describe, expect, it } from "vitest";
import { GraphOfTrace } from "../trace.js";
import {
  makeGoTContextExt,
  renderGoTAuditContext,
  renderPrincipalGoTContext,
} from "../extensions/got-context.js";

interface FakeMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
}

function fakePi() {
  let handler:
    | ((event: { messages: FakeMessage[] }) => { messages: FakeMessage[] } | void)
    | undefined;
  return {
    pi: {
      on(_event: "context", callback: typeof handler) {
        handler = callback;
      },
    },
    fire(messages: FakeMessage[]) {
      if (!handler) throw new Error("context handler was not registered");
      return handler({ messages });
    },
  };
}

const userMessage = (text: string): FakeMessage => ({
  role: "user",
  content: [{ type: "text", text }],
});

describe("GoT ephemeral context", () => {
  it("renders the latest compact active graph and Principal usage guidance", () => {
    const trace = new GraphOfTrace("s");
    const node = trace.createNode({
      title: "Evidence",
      description: "A durable result",
      episode: "Ablation — dropout",
      confidence: "high",
      reviewConclusion: "approved",
    });
    const block = renderPrincipalGoTContext(trace.getGraphV2());
    expect(block).toContain(`revision="${trace.getGraphV2().revision}"`);
    expect(block).toContain(`"id":"${node.id}"`);
    expect(block).toContain('"episode":"Ablation — dropout"');
    expect(block).not.toContain(String(trace.getNodeV2(node.id)?.primaryEpisodeId));
    expect(block).toContain("get_trace_neighborhood");
    expect(block).not.toContain('"type":"session_start"');
  });

  it("renders an explicit empty active graph", () => {
    const trace = new GraphOfTrace("s");
    const block = renderPrincipalGoTContext(trace.getGraphV2());
    expect(block).toContain(`revision="${trace.getGraphV2().revision}"`);
    expect(block).toContain("<active_nodes>\n</active_nodes>");
  });

  it("omits parent links to revoked nodes from the compact graph", () => {
    const trace = new GraphOfTrace("s");
    const parent = trace.createNode({ title: "Revoked evidence" });
    const child = trace.createNode({ title: "Conclusion" });
    trace.proposeCausalParent(child.id, parent.id, "consumed evidence", { type: "agent", name: "trace" });
    trace.updateNode(parent.id, { revoked: true }, { type: "agent", name: "trace" });
    const block = renderPrincipalGoTContext(trace.getGraphV2());
    expect(block).toContain(`"id":"${child.id}"`);
    expect(block).not.toContain(`"nodeId":"${parent.id}"`);
  });

  it("injects a fresh block and strips an older ephemeral snapshot", () => {
    let block = '<graph_of_trace revision="1">old</graph_of_trace>';
    const { pi, fire } = fakePi();
    makeGoTContextExt({ renderContext: () => block })(pi as never);
    block = '<graph_of_trace revision="2">new</graph_of_trace>';
    const result = fire([
      userMessage("hello"),
      userMessage('<graph_of_trace revision="1">old</graph_of_trace>'),
    ]) as { messages: FakeMessage[] };
    expect(result.messages).toEqual([
      userMessage("hello"),
      userMessage('<graph_of_trace revision="2">new</graph_of_trace>'),
    ]);
  });

  it("renders a bound audit with detailed local and compact global evidence", () => {
    const trace = new GraphOfTrace("s");
    const parent = trace.createNode({ title: "Evidence", episode: "Main Experiment — accuracy" });
    const child = trace.createNode({ title: "Conclusion", episode: "Final Synthesis" });
    trace.proposeCausalParent(child.id, parent.id, "consumed evidence", { type: "agent", name: "trace" });
    const target = trace.listPendingAuditTargets().find((item) => item.parentNodeId === parent.id)!;
    const block = renderGoTAuditContext({
      graph: trace.getGraphV2(),
      target,
      targetNode: trace.getNodeDetail(child.id),
      parentNode: trace.getNodeDetail(parent.id),
      neighborhood: trace.getNeighborhood(child.id, 2),
    });
    expect(block).toContain("<bound_target>");
    expect(block).toContain("<target_evidence>");
    expect(block).toContain("<local_neighborhood>");
    expect(block).toContain("<compact_active_graph>");
    expect(block).toContain('"episode": "Final Synthesis"');
    expect(block).toContain("Textual traceability alone is not scientific validation");
    expect(block).toContain("Episode membership alone never establishes dependency");
  });
});
