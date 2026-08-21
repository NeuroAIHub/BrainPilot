import { describe, expect, it } from "vitest";
import {
  DEMO_BUNDLE_FORMAT,
  DEMO_BUNDLE_VERSION,
  isDemoBundle,
  type DemoBundle,
} from "../contracts/demoBundle";
import { normalizeDemoReplayNodes, parseDemoBundle } from "../components/demo/demoBundle";

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

  it("cleans legacy v1 file entries before replay and re-export", () => {
    const bundle = validBundle();
    bundle.trace.nodes[0].artifacts = [
      { path: "checkpoint:checkpoint_123", type: "checkpoint" },
      { path: "/workspace/report.md", type: "markdown" },
      { path: "report.md", type: "file" },
    ];
    bundle.files = [
      {
        path: "checkpoint:checkpoint_123",
        mime: "application/octet-stream",
        encoding: "base64",
        size: 0,
        truncated: true,
        reason: "unreadable",
      },
      {
        path: "/workspace/report.md",
        mime: "text/markdown",
        encoding: "utf8",
        size: 2,
        truncated: false,
        data: "ok",
      },
      {
        path: "report.md",
        mime: "text/markdown",
        encoding: "utf8",
        size: 2,
        truncated: false,
        data: "ok",
      },
    ];

    const imported = parseDemoBundle(JSON.stringify(bundle));
    const replayNodes = normalizeDemoReplayNodes(imported.trace.nodes, imported.files);
    const reExported = JSON.parse(JSON.stringify(imported)) as DemoBundle;

    expect(imported.files.map((file) => file.path)).toEqual(["/workspace/report.md"]);
    expect(replayNodes[0].artifacts.map((artifact) => artifact.path))
      .toEqual(["/workspace/report.md"]);
    expect(reExported.files.map((file) => file.path)).toEqual(["/workspace/report.md"]);
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
