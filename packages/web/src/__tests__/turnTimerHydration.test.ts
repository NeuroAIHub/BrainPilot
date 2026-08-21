import { describe, expect, it } from "vitest";
import { isHistoricalTurnSignal } from "../contexts/useTurnTimer";

describe("turn timer hydration boundary (#489)", () => {
  it("ignores replayed active frames older than the mounted session", () => {
    expect(isHistoricalTurnSignal(10_000, 20_000)).toBe(true);
  });

  it("accepts live frames and small clock-ordering differences", () => {
    expect(isHistoricalTurnSignal(20_000, 20_000)).toBe(false);
    expect(isHistoricalTurnSignal(19_500, 20_000)).toBe(false);
  });
});
