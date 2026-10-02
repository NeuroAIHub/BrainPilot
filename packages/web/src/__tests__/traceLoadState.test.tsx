import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceGraph, WebSocketEvent } from "../contracts/backend";

const mocks = vi.hoisted(() => ({
  getTrace: vi.fn(),
  sse: {
    connectSession: vi.fn(), disconnectSession: vi.fn(), tick: 0,
    queueRef: { current: new Map<string, unknown[]>() }, connections: new Map(),
  },
}));
vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
vi.mock("../contexts/SandboxContext", () => ({ useSandbox: () => ({ currentSandbox: null }) }));
vi.mock("../contexts/SSEContext", () => ({ useSSE: () => mocks.sse }));
vi.mock("../utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/api")>();
  return { ...actual, api: { ...actual.api, sessions: {
    ...actual.api.sessions,
    list: async () => [{ id: "s", title: "Trace race", createdAt: "2026-10-02", updatedAt: "2026-10-02" }],
    getHistory: async () => ({ events: [], total: 0, truncated: false }),
    state: async () => ({ agents: [], subagents: [] }),
    getTrace: (...args: unknown[]) => mocks.getTrace(...args),
  } } };
});

import { SessionProvider, useSessions } from "../contexts/SessionContext";
let latest: ReturnType<typeof useSessions>;
let renderer: ReactTestRenderer | undefined;
function Probe() { latest = useSessions(); return null; }
const view = () => <SessionProvider><Probe /></SessionProvider>;
const graph = (revision?: number): TraceGraph => ({
  schemaVersion: "2.0", ...(revision !== undefined ? { revision } : {}),
  meta: { sessionId: "s" }, nodes: [], dependencies: [], artifacts: [], episodes: [],
});
const snapshot = (revision: number): WebSocketEvent => ({
  type: "CUSTOM", name: "trace_delta", sessionId: "s",
  value: { schemaVersion: "2.0", revision, op: "snapshot", graph: graph(revision) },
} as WebSocketEvent);
const patch = (revision: number): WebSocketEvent => ({
  type: "CUSTOM", name: "trace_delta", sessionId: "s",
  value: { schemaVersion: "2.0", revision, op: "patch", nodes: [] },
} as WebSocketEvent);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function flush() {
  await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); });
}
async function mount() {
  await act(async () => { renderer = create(view()); });
  await flush();
}
async function receive(event: WebSocketEvent) {
  mocks.sse.queueRef.current.set("s", [event]);
  mocks.sse.tick++;
  await act(async () => { renderer!.update(view()); });
  await flush();
}
beforeEach(() => {
  mocks.getTrace.mockReset();
  mocks.sse.queueRef.current.clear();
  mocks.sse.tick = 0;
});
afterEach(async () => { if (renderer) await act(async () => renderer!.unmount()); renderer = undefined; });

describe("Trace GET ownership beside incremental SSE", () => {
  it.each([2, undefined])("ignores delayed GET revision %s after SSE 5 and still applies patch 6", async (revision) => {
    const request = deferred<TraceGraph>();
    mocks.getTrace.mockReturnValueOnce(request.promise);
    await mount();
    expect(mocks.getTrace).toHaveBeenCalledOnce();
    await receive(snapshot(5));
    expect(latest.currentTrace?.revision).toBe(5);
    await act(async () => { request.resolve(graph(revision)); });
    await flush();
    expect(latest.currentTrace?.revision).toBe(5);
    await receive(patch(6));
    expect(latest.currentTrace?.revision).toBe(6);
  });

  it("accepts a newer GET and applies its next patch", async () => {
    const request = deferred<TraceGraph>();
    mocks.getTrace.mockReturnValueOnce(request.promise);
    await mount();
    await receive(snapshot(5));
    await act(async () => { request.resolve(graph(6)); });
    await flush();
    expect(latest.currentTrace?.revision).toBe(6);
    await receive(patch(7));
    expect(latest.currentTrace?.revision).toBe(7);
  });

  it("seeds an initial graph from GET before SSE arrives", async () => {
    mocks.getTrace.mockResolvedValueOnce(graph(2));
    await mount();
    expect(latest.currentTrace?.revision).toBe(2);
    await receive(patch(3));
    expect(latest.currentTrace?.revision).toBe(3);
  });
});
