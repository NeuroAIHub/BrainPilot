import { describe, it, expect } from "vitest";
import { reduceTraceForEvent } from "../contexts/traceReducer";
import { normalizeTraceGraph, type TraceGraph, type WebSocketEvent } from "../contracts/backend";

// #79: trace nodes arrive live as CUSTOM { name:"trace_node", value:{ op, node } }.

const node = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `node ${id}`,
  type: "task",
  status: "completed",
  parents: [],
  parentIds: [],
  childIds: [],
  artifacts: [],
  toolCalls: [],
  ...extra,
});
const traceEv = (op: string, n: Record<string, unknown>): WebSocketEvent =>
  ({ type: "CUSTOM", name: "trace_node", value: { op, node: n } } as unknown as WebSocketEvent);

describe("reduceTraceForEvent (#79)", () => {
  it("replays canonical patches and removes merged episodes without losing artifacts", () => {
    const patch = (revision: number, value: Record<string, unknown>): WebSocketEvent => ({
      type: "CUSTOM", name: "trace_delta", value: { schemaVersion: "2.0", revision, op: "patch", meta: { sessionId: "s", rootNodeId: "root" }, ...value },
    } as unknown as WebSocketEvent);
    let graph = reduceTraceForEvent(null, patch(1, {
      nodes: [
        { id: "root", title: "Session Start", type: "session_start", status: "completed", toolCalls: [], artifactIds: [], episodeTags: [], parents: [] },
        { id: "a", title: "A", type: "task", status: "completed", toolCalls: [], artifactIds: ["artifact-a"], episodeTags: [], parents: [{ nodeId: "root", conclusion: "confirmed" }], report: { kind: "agent_report", summary: "Evidence" } },
      ],
      episodes: [{ id: "first", title: "First" }],
      artifacts: [{ id: "artifact-a", producerNodeId: "a", path: "result.txt", kind: "file", exists: "present", verificationStatus: "verified" }],
    }), "s");
    expect(graph?.nodes.find((item) => item.id === "a")).toMatchObject({ summary: "Evidence", artifacts: [{ path: "result.txt" }] });
    graph = reduceTraceForEvent(graph, patch(2, {
      nodes: [{ id: "a", title: "A revised", type: "task", status: "completed", toolCalls: [], artifactIds: ["artifact-a"], episodeTags: [], parents: [{ nodeId: "root", conclusion: "confirmed" }] }],
      episodes: [{ id: "second", title: "Second" }],
      removed: { episodes: ["first"] },
    }), "s");
    expect(graph?.nodes.find((item) => item.id === "a")?.title).toBe("A revised");
    expect(graph?.episodes?.map((item) => item.id)).toEqual(["second"]);
    expect(graph?.nodes.find((item) => item.id === "a")?.artifacts).toEqual([{ path: "result.txt", type: "file" }]);
    expect(graph?.revision).toBe(2);
    expect(reduceTraceForEvent(graph, patch(4, { nodes: [] }), "s")).toBe(graph);
  });

  it("merges a live legacy trace_node before its canonical patch", () => {
    const legacy = reduceTraceForEvent(null, traceEv("created", node("a", { status: "running" })), "s");
    const patch = { type: "CUSTOM", name: "trace_delta", value: {
      schemaVersion: "2.0", revision: 1, op: "patch", meta: { sessionId: "s" },
      nodes: [{ id: "a", title: "A", type: "task", status: "completed", toolCalls: [], artifactIds: [], episodeTags: [], parents: [] }],
    } } as unknown as WebSocketEvent;
    const graph = reduceTraceForEvent(legacy, patch, "s");
    expect(graph?.nodes).toHaveLength(1);
    expect(graph?.nodes[0]).toMatchObject({ id: "a", status: "completed" });
    expect(graph?.revision).toBe(1);
    expect(reduceTraceForEvent(graph, traceEv("updated", node("a", { status: "stale" })), "s"))
      .toBe(graph);
  });

  it("preserves every canonical parent state from a materialized GET graph", () => {
    const graph = normalizeTraceGraph({
      schemaVersion: "2.0",
      revision: 3,
      meta: { sessionId: "s" },
      nodes: [
        { id: "a", title: "A", type: "task", status: "completed", parents: [], causalParents: [], toolCalls: [] },
        { id: "b", title: "B", type: "task", status: "completed", parents: [], causalParents: [], toolCalls: [] },
        { id: "c", title: "C", type: "task", status: "completed", parents: [], causalParents: [], toolCalls: [] },
        { id: "d", title: "D", type: "task", status: "completed", parents: [], causalParents: [], toolCalls: [] },
        {
          id: "target",
          title: "Target",
          type: "task",
          status: "pending",
          // This is the confirmed-only V1 compatibility projection returned
          // by SessionManager.getTrace().
          parents: [{ id: "a", relation: "depends_on", edgeType: "confirmed" }],
          causalParents: [
            { nodeId: "a", conclusion: "confirmed", reason: "accepted" },
            { nodeId: "b", conclusion: "candidate", reason: "awaiting review" },
            { nodeId: "c", conclusion: "uncertain", reason: "weak evidence" },
            { nodeId: "d", conclusion: "rejected", reason: "contradicted" },
          ],
          toolCalls: [],
        },
      ],
      dependencies: [],
      episodes: [],
      artifacts: [],
    });

    const target = graph.nodes.find((item) => item.id === "target")!;
    expect(target.parents).toEqual([
      expect.objectContaining({ id: "a", edgeType: "confirmed", explanation: "accepted" }),
      expect.objectContaining({ id: "b", edgeType: "candidate", explanation: "awaiting review" }),
      expect.objectContaining({ id: "c", edgeType: "uncertain", explanation: "weak evidence" }),
      expect.objectContaining({ id: "d", edgeType: "rejected", explanation: "contradicted" }),
    ]);
  });

  it("accepts runtime-shaped canonical parents in a V2 trace_delta", () => {
    const delta = {
      type: "CUSTOM",
      name: "trace_delta",
      value: {
        schemaVersion: "2.0",
        revision: 4,
        op: "snapshot",
        graph: {
          schemaVersion: "2.0",
          revision: 4,
          meta: { sessionId: "s" },
          nodes: [
            { id: "a", title: "A", type: "task", status: "completed", toolCalls: [], artifactIds: [], episodeTags: [], parents: [] },
            { id: "b", title: "B", type: "task", status: "pending", toolCalls: [], artifactIds: [], episodeTags: [], parents: [{ nodeId: "a", conclusion: "confirmed", reason: "direct evidence" }] },
            { id: "c", title: "C", type: "task", status: "pending", toolCalls: [], artifactIds: [], episodeTags: [], parents: [{ nodeId: "b", conclusion: "candidate" }] },
          ],
          dependencies: [
            { id: "official", prerequisiteId: "a", dependentId: "b", origin: "host", confidence: "high", state: "active", evidence: [] },
            { id: "candidate", prerequisiteId: "b", dependentId: "c", origin: "trace", confidence: "low", state: "proposed", evidence: [] },
          ],
          episodes: [],
          artifacts: [],
        },
      },
    } as unknown as WebSocketEvent;
    const out = reduceTraceForEvent(null, delta, "s")!;
    expect(out).toMatchObject({ schemaVersion: "2.0", revision: 4 });
    const b = out.nodes.find((item) => item.id === "b")!;
    expect(b.parents).toContainEqual(expect.objectContaining({ id: "a", edgeType: "confirmed", explanation: "direct evidence" }));
    expect(b.parentIds).toEqual(["a"]);
    const c = out.nodes.find((item) => item.id === "c")!;
    expect(c.parents).toContainEqual(expect.objectContaining({ id: "b", edgeType: "candidate" }));
  });

  it("does not let a replayed stale V2 revision overwrite a newer graph", () => {
    const start: TraceGraph = { schemaVersion: "2.0", revision: 5, meta: { sessionId: "s" }, nodes: [node("new")] };
    const stale = {
      type: "CUSTOM", name: "trace_delta", value: {
        schemaVersion: "2.0", revision: 4, op: "snapshot",
        graph: { schemaVersion: "2.0", revision: 4, meta: { sessionId: "s" }, nodes: [], dependencies: [], episodes: [], artifacts: [] },
      },
    } as unknown as WebSocketEvent;
    expect(reduceTraceForEvent(start, stale, "s")).toBe(start);
  });

  it("seeds a graph from null on the first node", () => {
    const out = reduceTraceForEvent(null, traceEv("created", node("a")), "s");
    expect(out).not.toBeNull();
    expect(out!.nodes.map((n) => n.id)).toEqual(["a"]);
    expect(out!.meta.sessionId).toBe("s");
  });

  it("appends a new node id", () => {
    const start: TraceGraph = { meta: { sessionId: "s" }, nodes: [node("a")] };
    const out = reduceTraceForEvent(start, traceEv("created", node("b")), "s");
    expect(out!.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("replaces an existing node in place on update", () => {
    const start: TraceGraph = { meta: { sessionId: "s" }, nodes: [node("a", { status: "running" })] };
    const out = reduceTraceForEvent(start, traceEv("updated", node("a", { status: "completed" })), "s");
    expect(out!.nodes).toHaveLength(1);
    expect(out!.nodes[0]!.status).toBe("completed");
  });

  it("recomputes childIds from parent links", () => {
    const start: TraceGraph = { meta: { sessionId: "s" }, nodes: [node("a")] };
    const child = node("b", { parents: [{ id: "a", relation: "follows" }], parentIds: ["a"] });
    const out = reduceTraceForEvent(start, traceEv("created", child), "s");
    const parent = out!.nodes.find((n) => n.id === "a")!;
    expect(parent.childIds).toEqual(["b"]);
  });

  it("ignores non trace_node events (same reference)", () => {
    const start: TraceGraph = { meta: { sessionId: "s" }, nodes: [node("a")] };
    expect(reduceTraceForEvent(start, { type: "RUN_STARTED" } as WebSocketEvent, "s")).toBe(start);
  });

  it("ignores a payload with no node id (same reference)", () => {
    const start: TraceGraph = { meta: { sessionId: "s" }, nodes: [node("a")] };
    const bad = { type: "CUSTOM", name: "trace_node", value: { op: "created", node: {} } } as unknown as WebSocketEvent;
    expect(reduceTraceForEvent(start, bad, "s")).toBe(start);
  });
});
