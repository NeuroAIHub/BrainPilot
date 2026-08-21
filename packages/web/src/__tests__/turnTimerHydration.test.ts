import { describe, expect, it } from "vitest";
import { isHistoricalTurnSignal, latestDurableUserTurn } from "../contexts/useTurnTimer";
import { initialTurnTimerState, turnTimerReducer } from "../contexts/turnTimer";

describe("turn timer hydration boundary (#489)", () => {
  it("ignores replayed active frames older than the mounted session", () => {
    expect(isHistoricalTurnSignal(10_000, 20_000)).toBe(true);
  });

  it("accepts live frames and small clock-ordering differences", () => {
    expect(isHistoricalTurnSignal(20_000, 20_000)).toBe(false);
    expect(isHistoricalTurnSignal(19_500, 20_000)).toBe(false);
  });

  it("selects the newest durable user run when hydration order is not chronological", () => {
    expect(latestDurableUserTurn([
      { role: "user", runId: "run-new", createdAt: "2026-08-21T04:36:14.456Z" },
      { role: "assistant", runId: "run-internal", createdAt: "2026-08-21T04:36:16.000Z" },
      { role: "user", runId: "run-old", createdAt: "2026-08-21T04:32:27.757Z" },
    ])).toEqual({
      id: "run-new",
      atMs: Date.parse("2026-08-21T04:36:14.456Z"),
    });
  });

  it("keeps the whole interrupted duration when a turn contains queued follow-ups", () => {
    const turn = latestDurableUserTurn([
      { role: "user", runId: "run-current", createdAt: "2026-08-21T04:36:27.456Z" },
      { role: "user", runId: "run-old", createdAt: "2026-08-21T04:32:27.757Z" },
      { role: "user", runId: "run-current", createdAt: "2026-08-21T04:36:14.456Z" },
    ]);
    expect(turn).toEqual({
      id: "run-current",
      atMs: Date.parse("2026-08-21T04:36:14.456Z"),
    });

    const stopped = turnTimerReducer(initialTurnTimerState, {
      type: "interrupt",
      turnId: turn!.id,
      startedAt: turn!.atMs,
      atMs: Date.parse("2026-08-21T04:36:34.456Z"),
    });
    expect(stopped.lastDurationMs).toBe(20_000);
  });

  it("ignores malformed timestamps rather than turning them into a current run", () => {
    expect(latestDurableUserTurn([
      { role: "user", runId: "run-invalid", createdAt: "not-a-date" },
    ])).toBeNull();
  });
});
