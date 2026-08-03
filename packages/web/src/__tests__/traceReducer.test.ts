import { describe, it, expect } from "vitest";
import { reduceTraceForEvent } from "../contexts/traceReducer";
import type { TraceGraph, WebSocketEvent } from "../contracts/backend";

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
  it("accepts a canonical V2 trace_delta and materializes active/proposed/semantic edges", () => {
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
            { id: "a", title: "A", type: "task", status: "completed", toolCalls: [], artifactIds: [], episodeTags: [] },
            { id: "b", title: "B", type: "task", status: "pending", toolCalls: [], artifactIds: [], episodeTags: [] },
          ],
          dependencies: [
            { id: "official", prerequisiteId: "a", dependentId: "b", origin: "host", confidence: "high", state: "active", evidence: [] },
            { id: "candidate", prerequisiteId: "b", dependentId: "a", origin: "trace", confidence: "low", state: "proposed", evidence: [] },
          ],
          semanticLinks: [{ id: "sequence", fromId: "a", toId: "b", type: "sequence_after" }],
          episodes: [],
          artifacts: [],
        },
      },
    } as unknown as WebSocketEvent;
    const out = reduceTraceForEvent(null, delta, "s")!;
    expect(out).toMatchObject({ schemaVersion: "2.0", revision: 4 });
    const b = out.nodes.find((item) => item.id === "b")!;
    expect(b.parents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "a", edgeType: "active" }),
      expect.objectContaining({ id: "a", edgeType: "semantic" }),
    ]));
    const a = out.nodes.find((item) => item.id === "a")!;
    expect(a.parents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "b", edgeType: "proposed" }),
    ]));
  });

  it("does not let a replayed stale V2 revision overwrite a newer graph", () => {
    const start: TraceGraph = { schemaVersion: "2.0", revision: 5, meta: { sessionId: "s" }, nodes: [node("new")] };
    const stale = {
      type: "CUSTOM", name: "trace_delta", value: {
        schemaVersion: "2.0", revision: 4, op: "snapshot",
        graph: { schemaVersion: "2.0", revision: 4, meta: { sessionId: "s" }, nodes: [], dependencies: [], semanticLinks: [], episodes: [], artifacts: [] },
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
