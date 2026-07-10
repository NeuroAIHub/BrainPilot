import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Coverage for buildDemoBundle's file collection (#5 concurrent fetch,
 * deterministic budget; #9 abort). The api module is mocked so we can drive
 * trace artifacts and sandbox reads without a backend.
 */

const getTrace = vi.fn();
const getHistory = vi.fn();
const state = vi.fn();
const getVersion = vi.fn();
const readFile = vi.fn();
const readRawFile = vi.fn();

vi.mock("../utils/api", () => ({
  api: {
    getVersion: () => getVersion(),
    sessions: {
      getTrace: (id: string) => getTrace(id),
      getHistory: (id: string, opts: unknown) => getHistory(id, opts),
      state: (id: string) => state(id),
    },
    sandbox: {
      readFile: (sid: string, path: string) => readFile(sid, path),
      readRawFile: (sid: string, path: string) => readRawFile(sid, path),
    },
  },
}));

// Imported after the mock is registered.
const { buildDemoBundle, PackAbortedError } = await import("../components/demo/demoBundle");

function traceWith(paths: string[]) {
  return {
    nodes: [
      {
        id: "n1",
        artifacts: paths.map((p) => ({ path: p, type: "file" })),
        parents: [],
        parentIds: [],
        childIds: [],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getVersion.mockResolvedValue({ version: "test" });
  getHistory.mockResolvedValue({ events: [{ type: "X", _ts: "t" }], total: 1, truncated: false });
  state.mockResolvedValue({ agents: [] });
});

describe("buildDemoBundle file collection", () => {
  it("marks all files unreadable when no sandbox is available", async () => {
    getTrace.mockResolvedValue(traceWith(["a.txt", "b.png"]));
    const bundle = await buildDemoBundle({
      session: { id: "s", title: "S" },
      filesUnavailableDetail: "no sandbox",
    });
    expect(bundle.packedWithSandbox).toBe(false);
    expect(bundle.files).toHaveLength(2);
    expect(bundle.files.every((f) => f.truncated && f.reason === "unreadable")).toBe(true);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("fetches files concurrently but preserves path order in the result", async () => {
    getTrace.mockResolvedValue(traceWith(["1.txt", "2.txt", "3.txt"]));
    let inFlight = 0;
    let maxInFlight = 0;
    readFile.mockImplementation(async (_sid: string, path: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { content: path, size: path.length };
    });
    const bundle = await buildDemoBundle({ session: { id: "s", title: "S" }, sandboxId: "sb" });
    expect(bundle.files.map((f) => f.path)).toEqual(["1.txt", "2.txt", "3.txt"]);
    expect(bundle.files.map((f) => f.data)).toEqual(["/workspace/1.txt", "/workspace/2.txt", "/workspace/3.txt"]);
    expect(maxInFlight).toBeGreaterThan(1); // genuinely concurrent
  });

  it("records a read failure as unreadable, not tooLarge", async () => {
    getTrace.mockResolvedValue(traceWith(["ok.txt", "bad.txt"]));
    readFile.mockImplementation(async (_sid: string, path: string) => {
      if (path.endsWith("bad.txt")) {
        throw new Error("boom");
      }
      return { content: "hi", size: 2 };
    });
    const bundle = await buildDemoBundle({ session: { id: "s", title: "S" }, sandboxId: "sb" });
    const bad = bundle.files.find((f) => f.path === "bad.txt")!;
    expect(bad.reason).toBe("unreadable");
    expect(bad.detail).toBe("boom");
  });

  it("throws PackAbortedError when the signal is already aborted", async () => {
    getTrace.mockResolvedValue(traceWith(["a.txt"]));
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildDemoBundle({ session: { id: "s", title: "S" }, sandboxId: "sb", signal: controller.signal }),
    ).rejects.toBeInstanceOf(PackAbortedError);
  });
});
