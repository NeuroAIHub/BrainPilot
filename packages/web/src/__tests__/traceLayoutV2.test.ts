import { describe, expect, it } from "vitest";
import type { TraceNode } from "../contracts/backend";
import { buildTraceLayout } from "../components/session/traceLayout";

function node(id: string, parents: TraceNode["parents"]): TraceNode {
  return { id, title: id, type: "task", status: "pending", parents, artifacts: [], parentIds: parents.map((parent) => parent.id), childIds: [], toolCalls: [] };
}

describe("V2 trace layout", () => {
  it("does not let reciprocal semantic links participate in dependency rank", () => {
    const a = node("a", [{ id: "b", relation: "supports", edgeType: "semantic" }]);
    const b = node("b", [{ id: "a", relation: "contradicts", edgeType: "semantic" }]);
    const layout = buildTraceLayout([a, b], "LR");
    expect(layout.positioned).toHaveLength(2);
    expect(layout.positioned.map((item) => item.x)).toEqual([72, 72]);
  });
});
