import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TraceChange, TraceNode } from "../contracts/backend";
import { findPendingCausalRollback, TraceCheckpointDetail } from "../components/session/TraceCheckpointDetail";

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
  const change = (id: string, action: string, metadata?: Record<string, unknown>): TraceChange => ({
    id, revision: Number(id.replace(/\D/g, "")) || 1, actor: { type: "user" }, action,
    target: { nodeId: "n1" }, metadata, createdAt: "2026-07-21T00:00:00.000Z",
  });

  it("rehydrates only the latest causal rollback that has not been undone", () => {
    const changes = [
      change("change_1", "causal_rollback", { recoveryCheckpointId: "recovery_1" }),
      change("change_2", "causal_rollback_undo", { rollbackChangeId: "change_1" }),
      change("change_3", "causal_rollback", { recoveryCheckpointId: "recovery_2" }),
    ];
    expect(findPendingCausalRollback(changes, "n1")).toBe("recovery_2");
    expect(findPendingCausalRollback([
      ...changes,
      change("change_4", "causal_rollback_undo", { rollbackChangeId: "change_3" }),
    ], "n1")).toBeNull();
  });

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

  it("offers undo on a rollback audit node without a normal checkpoint", () => {
    const audit = { ...node(), checkpoints: [], metadata: { recoveryCheckpointId: "recovery_1" } };
    const html = renderToStaticMarkup(<TraceCheckpointDetail node={audit} sessionId="s1" t={t} />);
    expect(html).toContain("trace.checkpoint.undo");
    expect(html).not.toContain("trace.checkpoint.causalRollback");
  });
});
