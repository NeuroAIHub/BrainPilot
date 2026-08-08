import { describe, expect, it } from "vitest";
import { normalizeSessionState } from "../contracts/backend";

describe("subagent session state", () => {
  it("normalizes optional child lifecycle records without affecting agents", () => {
    const state = normalizeSessionState({
      run_state: { active: true, run_id: "run-1" },
      agents: [{ name: "librarian", status: "running", task: "survey" }],
      subagents: [{
        id: "scan-1",
        parent_agent: "librarian",
        root_run_id: "run-1",
        profile: "literature-scout",
        label: "scan",
        task: "find papers",
        status: "succeeded",
        duration_ms: 42,
        result_summary: "found evidence",
        artifacts: ["subagent-results/scan-1/papers.json"],
      }],
      last_activity_ts: "2026-07-21T00:00:00.000Z",
    });
    expect(state.agents[0]?.name).toBe("librarian");
    expect(state.subagents?.[0]).toMatchObject({
      id: "scan-1",
      parentAgent: "librarian",
      rootRunId: "run-1",
      status: "succeeded",
      durationMs: 42,
      resultSummary: "found evidence",
    });
  });

  it("keeps old snapshots compatible when subagents is absent", () => {
    expect(normalizeSessionState({ runState: { active: false }, agents: [], lastActivityTs: "" }).subagents).toEqual([]);
  });

  it("keeps PI and whole-session activity distinct", () => {
    const state = normalizeSessionState({
      run_state: { active: false, run_id: null },
      work_state: { active: true },
      agents: [{ name: "engineer", status: "running" }],
      last_activity_ts: "2026-08-09T00:00:00.000Z",
    });
    expect(state.runState.active).toBe(false);
    expect(state.workState.active).toBe(true);
  });
});
