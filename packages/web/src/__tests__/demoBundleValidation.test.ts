import { describe, expect, it } from "vitest";
import {
  DEMO_BUNDLE_FORMAT,
  DEMO_BUNDLE_VERSION,
  isDemoBundle,
  type DemoBundle,
} from "../contracts/demoBundle";
import { parseDemoBundle } from "../components/demo/demoBundle";

function validBundle(): DemoBundle {
  return {
    format: DEMO_BUNDLE_FORMAT,
    version: DEMO_BUNDLE_VERSION,
    exportedAt: "2026-07-14T00:00:00.000Z",
    timeline: "timestamped",
    packedWithSandbox: true,
    session: { id: "session-1", title: "Demo" },
    events: [{ type: "TEXT_MESSAGE_CONTENT", _ts: "2026-07-14T00:00:00.000Z" }],
    trace: {
      meta: { sessionId: "session-1" },
      nodes: [
        {
          id: "node-1",
          title: "Answer",
          type: "agent",
          status: "completed",
          parents: [],
          artifacts: [],
          parentIds: [],
          childIds: [],
          toolCalls: [],
        },
      ],
    },
    agents: [{ name: "principal", status: "idle", task: "" }],
    files: [
      {
        path: "report.md",
        mime: "text/markdown",
        encoding: "utf8",
        size: 2,
        truncated: false,
        data: "ok",
      },
    ],
  };
}

describe("Live Demo bundle import validation", () => {
  it("accepts a complete current-version bundle", () => {
    const bundle = validBundle();
    expect(isDemoBundle(bundle)).toBe(true);
    expect(parseDemoBundle(JSON.stringify(bundle))).toEqual(bundle);
  });

  it("rejects unsupported versions", () => {
    expect(isDemoBundle({ ...validBundle(), version: DEMO_BUNDLE_VERSION + 1 })).toBe(false);
  });

  it("rejects a timeline whose payload does not match its mode", () => {
    const bundle = { ...validBundle(), events: undefined };
    expect(isDemoBundle(bundle)).toBe(false);
  });

  it("rejects trace nodes that would crash the replay renderer", () => {
    const bundle = validBundle() as unknown as Record<string, any>;
    delete bundle.trace.nodes[0].parentIds;
    expect(isDemoBundle(bundle)).toBe(false);
  });

  it("rejects non-truncated files with no embedded data", () => {
    const bundle = validBundle() as unknown as Record<string, any>;
    delete bundle.files[0].data;
    expect(isDemoBundle(bundle)).toBe(false);
  });
});
