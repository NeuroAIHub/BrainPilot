import { describe, it, expect } from "vitest";
import {
  turnTimerReducer,
  initialTurnTimerState,
  type TurnTimerState,
} from "./turnTimer";

/** Apply a sequence of events from the initial state. */
function run(events: Parameters<typeof turnTimerReducer>[1][]): TurnTimerState {
  return events.reduce(turnTimerReducer, initialTurnTimerState);
}

describe("turnTimerReducer (#99 whole-turn timing)", () => {
  it("times a simple turn: user input → active true → active false → settle", () => {
    const s = run([
      { type: "userInput", atMs: 1000 },
      { type: "active", value: true, atMs: 1010 },
      { type: "active", value: false, atMs: 4200 },
      { type: "settle" },
    ]);
    expect(s.running).toBe(false);
    // Duration spans user input (1000) → terminal active=false (4200) = 3.2s.
    expect(s.lastDurationMs).toBe(3200);
    expect(s.startedAt).toBeNull();
    expect(s.candidateEndAt).toBeNull();
  });

  it("does NOT end the turn on a mid-flap false that is re-woken before settle", () => {
    let s = run([
      { type: "userInput", atMs: 1000 },
      { type: "active", value: true, atMs: 1010 },
      // Principal turn ends momentarily...
      { type: "active", value: false, atMs: 2000 },
    ]);
    expect(s.running).toBe(true); // still running (candidate pending, not settled)
    expect(s.candidateEndAt).toBe(2000);

    // ...but a hook / task event re-wakes an agent before settle fires.
    s = turnTimerReducer(s, { type: "active", value: true, atMs: 2050 });
    expect(s.candidateEndAt).toBeNull(); // candidate discarded
    expect(s.running).toBe(true);
    expect(s.startedAt).toBe(1000); // original start preserved

    // Real end later.
    s = turnTimerReducer(s, { type: "active", value: false, atMs: 5000 });
    s = turnTimerReducer(s, { type: "settle" });
    expect(s.lastDurationMs).toBe(4000); // 1000 → 5000, the re-wake didn't reset it
  });

  it("uses the candidate-end timestamp, not the settle time, for the duration", () => {
    // settle is dispatched 'later' but the committed duration must reflect the
    // authoritative active=false timestamp (the settle window is not counted).
    const s = run([
      { type: "userInput", atMs: 0 },
      { type: "active", value: true, atMs: 5 },
      { type: "active", value: false, atMs: 1000 },
      { type: "settle" }, // wall-clock-wise this happens ~800ms later, irrelevant
    ]);
    expect(s.lastDurationMs).toBe(1000);
  });

  it("seeds startedAt from active=true if the user-input open was missed (reconnect)", () => {
    const s = run([
      { type: "active", value: true, atMs: 3000 },
      { type: "active", value: false, atMs: 3500 },
      { type: "settle" },
    ]);
    expect(s.lastDurationMs).toBe(500);
  });

  it("ignores active=false when no turn is running", () => {
    const s = run([{ type: "active", value: false, atMs: 100 }]);
    expect(s).toEqual(initialTurnTimerState);
  });

  it("preserves the original start when a second userInput arrives mid-turn", () => {
    const s = run([
      { type: "userInput", atMs: 1000 },
      { type: "active", value: true, atMs: 1010 },
      { type: "userInput", atMs: 1500 }, // steering / follow-up during the run
    ]);
    expect(s.startedAt).toBe(1000);
    expect(s.running).toBe(true);
  });

  it("starts a new timer when a different run id arrives inside the settle window", () => {
    let s = run([
      { type: "userInput", atMs: 1_000, turnId: "run_old" },
      { type: "active", value: true, atMs: 1_010 },
      { type: "active", value: false, atMs: 14_500 },
    ]);
    expect(s.candidateEndAt).toBe(14_500);

    s = turnTimerReducer(s, { type: "userInput", atMs: 14_600, turnId: "run_new" });
    expect(s.currentTurnId).toBe("run_new");
    expect(s.startedAt).toBe(14_600);
    expect(s.candidateEndAt).toBeNull();

    s = turnTimerReducer(s, { type: "active", value: false, atMs: 14_850 });
    s = turnTimerReducer(s, { type: "settle" });
    expect(s.lastTurnId).toBe("run_new");
    expect(s.lastDurationMs).toBe(250);
    expect(s.lastStatus).toBe("completed");
  });

  it("labels an interrupted turn separately and ignores a stale interrupt", () => {
    let s = run([
      { type: "userInput", atMs: 1_000, turnId: "run_1" },
      { type: "active", value: true, atMs: 1_010 },
      { type: "interrupt", atMs: 5_000, turnId: "run_1" },
    ]);
    expect(s.lastTurnId).toBe("run_1");
    expect(s.lastDurationMs).toBe(4_000);
    expect(s.lastStatus).toBe("interrupted");

    s = turnTimerReducer(s, { type: "userInput", atMs: 6_000, turnId: "run_2" });
    const unchanged = turnTimerReducer(s, { type: "interrupt", atMs: 6_100, turnId: "run_1" });
    expect(unchanged).toEqual(s);
  });

  it("hydrates a settled run-to-duration record after reload", () => {
    const s = run([{
      type: "hydrate",
      turnId: "run_saved",
      durationMs: 3_200,
      status: "completed",
    }]);
    expect(s.running).toBe(false);
    expect(s.lastTurnId).toBe("run_saved");
    expect(s.lastDurationMs).toBe(3_200);
    expect(s.lastStatus).toBe("completed");
  });

  it("keeps lastDurationMs across a reset of the active turn but reset() clears all", () => {
    let s = run([
      { type: "userInput", atMs: 0 },
      { type: "active", value: true, atMs: 1 },
      { type: "active", value: false, atMs: 2000 },
      { type: "settle" },
    ]);
    expect(s.lastDurationMs).toBe(2000);
    s = turnTimerReducer(s, { type: "reset" });
    expect(s).toEqual(initialTurnTimerState);
  });
});
