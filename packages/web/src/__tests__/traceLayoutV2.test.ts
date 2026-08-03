import { describe, expect, it } from "vitest";
import type { TraceNode } from "../contracts/backend";
import { buildTraceLayout } from "../components/session/traceLayout";

function node(id: string, parents: TraceNode["parents"]): TraceNode {
  return { id, title: id, type: "task", status: "pending", parents, artifacts: [], parentIds: parents.map((parent) => parent.id), childIds: [], toolCalls: [] };
}

describe("V2 trace layout", () => {
  it("ranks canonical causal parents before their children", () => {
    const a = node("a", []);
    const b = node("b", [{ id: "a", relation: "depends_on", edgeType: "candidate" }]);
    const layout = buildTraceLayout([a, b], "LR");
    expect(layout.positioned).toHaveLength(2);
    expect(layout.byId.get("a")!.x).toBeLessThan(layout.byId.get("b")!.x);
  });

  it("fails closed instead of recursing forever on a malformed cyclic payload", () => {
    const a = node("a", [{ id: "b", relation: "depends_on", edgeType: "rejected" }]);
    const b = node("b", [{ id: "a", relation: "depends_on", edgeType: "candidate" }]);
    const layout = buildTraceLayout([a, b], "LR");
    expect(layout.positioned).toHaveLength(2);
    expect(layout.positioned.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
