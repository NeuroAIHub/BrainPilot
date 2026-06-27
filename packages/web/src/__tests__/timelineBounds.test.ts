import { describe, it, expect } from "vitest";
import { computeTimeBounds } from "../components/session/TimelineTab";

describe("computeTimeBounds (#166)", () => {
  const now = 1_000_000;

  it("falls back to a 60s window ending at `now` when there are no dots", () => {
    expect(computeTimeBounds([], now, false)).toEqual({ start: now - 60_000, end: now });
    expect(computeTimeBounds([], now, true)).toEqual({ start: now - 60_000, end: now });
  });

  it("ends at the last message for a finished (not running) session", () => {
    const first = 100_000;
    const last = 200_000;
    // `now` is far in the future, but the axis must NOT stretch to it.
    const bounds = computeTimeBounds([first, last], now, false);
    expect(bounds).toEqual({ start: first, end: last });
  });

  it("does not grow the axis as wall-clock `now` advances when idle", () => {
    const ts = [100_000, 200_000];
    const a = computeTimeBounds(ts, 500_000, false);
    const b = computeTimeBounds(ts, 9_000_000, false);
    // Same dots, later `now` → identical bounds (no creeping right edge).
    expect(a).toEqual(b);
    expect(b.end).toBe(200_000);
  });

  it("extends to `now` while the session is actively running", () => {
    const ts = [100_000, 200_000];
    const bounds = computeTimeBounds(ts, now, true);
    expect(bounds).toEqual({ start: 100_000, end: now });
  });

  it("when running but `now` is before the last message, keeps the last message", () => {
    const ts = [100_000, 200_000];
    const bounds = computeTimeBounds(ts, 150_000, true);
    expect(bounds.end).toBe(200_000);
  });

  it("expands a degenerate (single-dot / identical-ts) span to 60s", () => {
    const bounds = computeTimeBounds([100_000], 100_000, false);
    expect(bounds).toEqual({ start: 100_000, end: 160_000 });
  });

  it("expands a degenerate span even while running", () => {
    // Single dot, now == that dot → end would equal start, must be padded.
    const bounds = computeTimeBounds([100_000], 100_000, true);
    expect(bounds).toEqual({ start: 100_000, end: 160_000 });
  });
});
