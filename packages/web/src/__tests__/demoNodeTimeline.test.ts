import { describe, expect, it } from "vitest";
import type { TraceNode } from "../contracts/backend";
import { computeNodeMs, nodeTimeMs } from "../components/demo/nodeTimeline";

function node(overrides: Partial<TraceNode>): TraceNode {
  return {
    id: overrides.id ?? "n",
    title: "t",
    type: "step",
    status: "done",
    parents: [],
    artifacts: [],
    parentIds: [],
    childIds: [],
    timestamp: {},
    ...overrides,
  } as TraceNode;
}

/** node.timestamp.completedAt / startedAt / createdAt in ISO. */
function withTimes(ids: string[], isos: (string | undefined)[]): TraceNode[] {
  return ids.map((id, i) => node({ id, timestamp: { createdAt: isos[i] } }));
}

const T0 = 1000;
const T1 = 2000;

describe("computeNodeMs (#6 node/conversation clock alignment)", () => {
  it("returns [] for no nodes", () => {
    expect(computeNodeMs([], T0, T1)).toEqual([]);
  });

  it("uses real times when finite, non-decreasing, and spanning a range", () => {
    const nodes = withTimes(
      ["a", "b", "c"],
      ["1970-01-01T00:00:01.200Z", "1970-01-01T00:00:01.500Z", "1970-01-01T00:00:01.800Z"],
    );
    // 1200, 1500, 1800 all inside [1000, 2000] → used verbatim.
    expect(computeNodeMs(nodes, T0, T1)).toEqual([1200, 1500, 1800]);
  });

  it("clamps real times into the timeline bounds", () => {
    const nodes = withTimes(
      ["a", "b", "c"],
      ["1970-01-01T00:00:00.500Z", "1970-01-01T00:00:01.500Z", "1970-01-01T00:00:09.000Z"],
    );
    // 500 < t0 → 1000; 9000 > t1 → 2000. Still non-decreasing.
    expect(computeNodeMs(nodes, T0, T1)).toEqual([1000, 1500, 2000]);
  });

  it("falls back to even spacing when a timestamp is missing", () => {
    const nodes = withTimes(["a", "b", "c"], ["1970-01-01T00:00:01.200Z", undefined, "1970-01-01T00:00:01.800Z"]);
    expect(computeNodeMs(nodes, T0, T1)).toEqual([1000, 1500, 2000]);
  });

  it("falls back to even spacing when times are non-monotonic in array order", () => {
    const nodes = withTimes(
      ["a", "b", "c"],
      ["1970-01-01T00:00:01.800Z", "1970-01-01T00:00:01.200Z", "1970-01-01T00:00:01.500Z"],
    );
    expect(computeNodeMs(nodes, T0, T1)).toEqual([1000, 1500, 2000]);
  });

  it("falls back to even spacing when all times are identical (no real range)", () => {
    const same = "1970-01-01T00:00:01.500Z";
    const nodes = withTimes(["a", "b", "c"], [same, same, same]);
    expect(computeNodeMs(nodes, T0, T1)).toEqual([1000, 1500, 2000]);
  });

  it("always returns a non-decreasing series (the reveal-slice invariant)", () => {
    const cases: TraceNode[][] = [
      withTimes(["a", "b", "c", "d"], ["x", "y", "z", "w"]), // all unparseable → even
      withTimes(["a", "b"], ["1970-01-01T00:00:01.100Z", "1970-01-01T00:00:01.900Z"]),
    ];
    for (const nodes of cases) {
      const ms = computeNodeMs(nodes, T0, T1);
      for (let i = 1; i < ms.length; i += 1) {
        expect(ms[i]).toBeGreaterThanOrEqual(ms[i - 1]);
      }
    }
  });

  it("puts a single node at t1", () => {
    expect(computeNodeMs([node({ id: "solo" })], T0, T1)).toEqual([T1]);
  });

  it("nodeTimeMs prefers completedAt > startedAt > createdAt", () => {
    expect(
      nodeTimeMs(
        node({
          timestamp: {
            createdAt: "1970-01-01T00:00:01.000Z",
            startedAt: "1970-01-01T00:00:02.000Z",
            completedAt: "1970-01-01T00:00:03.000Z",
          },
        }),
      ),
    ).toBe(3000);
    expect(nodeTimeMs(node({ timestamp: {}, createdAt: "1970-01-01T00:00:04.000Z" }))).toBe(4000);
    expect(Number.isNaN(nodeTimeMs(node({ timestamp: {} })))).toBe(true);
  });
});
