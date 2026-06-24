import { describe, it, expect } from "vitest";
import {
  resolveResize,
  MIN_SIDEBAR_WIDTH,
  MAX_SIDEBAR_WIDTH,
  COLLAPSE_THRESHOLD,
  DEFAULT_SIDEBAR_WIDTH,
} from "../components/shell/sidebarResize";

// #159 — drag-to-collapse geometry. The monorepo has no jsdom, so the real
// pointer-drag is exercised by DesktopShell at runtime; here we pin the pure
// decision: when does a drag collapse the rail, and how is width clamped.
describe("resolveResize — #159 drag-to-collapse", () => {
  it("collapses when dragged at/below the collapse threshold", () => {
    expect(resolveResize(COLLAPSE_THRESHOLD).collapse).toBe(true);
    expect(resolveResize(COLLAPSE_THRESHOLD - 1).collapse).toBe(true);
    expect(resolveResize(0).collapse).toBe(true);
    expect(resolveResize(-50).collapse).toBe(true); // dragged past the left edge
  });

  it("does NOT collapse between the threshold and the minimum (buffer zone)", () => {
    // Sitting at the min width is a normal narrow drag, not a collapse intent.
    expect(resolveResize(MIN_SIDEBAR_WIDTH).collapse).toBe(false);
    expect(resolveResize(COLLAPSE_THRESHOLD + 1).collapse).toBe(false);
    expect(resolveResize(200).collapse).toBe(false);
  });

  it("clamps expanded width into [MIN, MAX]", () => {
    // Above threshold but below min → clamp up to min (still expanded).
    expect(resolveResize(190)).toEqual({ width: MIN_SIDEBAR_WIDTH, collapse: false });
    // In range → passthrough.
    expect(resolveResize(300)).toEqual({ width: 300, collapse: false });
    // Above max → clamp down.
    expect(resolveResize(999)).toEqual({ width: MAX_SIDEBAR_WIDTH, collapse: false });
  });

  it("threshold sits below the minimum so a min-width drag never collapses", () => {
    expect(COLLAPSE_THRESHOLD).toBeLessThan(MIN_SIDEBAR_WIDTH);
  });

  it("default restore width is a valid expanded width", () => {
    expect(DEFAULT_SIDEBAR_WIDTH).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTH);
    expect(DEFAULT_SIDEBAR_WIDTH).toBeLessThanOrEqual(MAX_SIDEBAR_WIDTH);
    expect(resolveResize(DEFAULT_SIDEBAR_WIDTH).collapse).toBe(false);
  });
});
