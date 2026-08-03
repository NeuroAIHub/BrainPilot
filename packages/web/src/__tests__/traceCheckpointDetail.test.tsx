import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TraceNode } from "../contracts/backend";
import { TraceCheckpointDetail } from "../components/session/TraceCheckpointDetail";

const t = (key: string, vars?: Record<string, string | number>) => vars ? `${key}:${JSON.stringify(vars)}` : key;

function node(): TraceNode {
  return {
    id: "n1",
    title: "Write report",
    type: "task",
    status: "completed",
    parents: [],
    artifacts: [],
    parentIds: [],
    childIds: [],
    toolCalls: [],
    checkpoints: [{
      id: "checkpoint_1",
      commitId: "abc123",
      status: "partial",
      capturedAt: "2026-07-21T00:00:00.000Z",
      stats: { files: 2, added: 1, modified: 1, deleted: 0, renamed: 0 },
      skippedCount: 1,
    }],
  };
}

describe("TraceCheckpointDetail", () => {
  it("renders checkpoint state and remains read-only without a live session", () => {
    const html = renderToStaticMarkup(<TraceCheckpointDetail node={node()} t={t} />);
    expect(html).toContain("trace.checkpoint.title");
    expect(html).toContain("trace.checkpoint.partial");
    expect(html).toContain("trace.checkpoint.summary");
    expect(html).not.toContain("trace.checkpoint.restore");
  });

  it("renders restore controls for a live session and disables them while active", () => {
    const html = renderToStaticMarkup(<TraceCheckpointDetail node={node()} sessionId="s1" restoreDisabled t={t} />);
    expect(html).toContain("trace.checkpoint.restore");
    expect(html).toContain("trace.checkpoint.causalRollback");
    expect(html).toContain("trace.checkpoint.activeBlocked");
    expect(html).toContain("disabled");
  });

  it("offers causal rollback at a branch point without its own checkpoint", () => {
    const branchPoint = { ...node(), checkpoints: [] };
    const html = renderToStaticMarkup(<TraceCheckpointDetail node={branchPoint} sessionId="s1" t={t} />);
    expect(html).toContain("trace.checkpoint.causalRollback");
    expect(html).not.toContain("trace.checkpoint.restoreSnapshot");
  });

  it("never exposes Undo, including for legacy recovery metadata", () => {
    const audit = { ...node(), checkpoints: [], metadata: { recoveryCheckpointId: "recovery_1" } };
    const html = renderToStaticMarkup(<TraceCheckpointDetail node={audit} sessionId="s1" t={t} />);
    expect(html).not.toContain("trace.checkpoint.undo");
    expect(html).toContain("trace.checkpoint.causalRollback");
  });
});
