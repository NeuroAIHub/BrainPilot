import { describe, expect, it } from "vitest";
import {
  DEMO_DEFAULT_CHAT,
  DEMO_DEFAULT_RIGHT,
  DEMO_HANDLES_WIDTH,
  DEMO_PANEL_MIN,
  DEMO_PREVIEW_MIN,
  parseDemoWidths,
  proposedWidthForEdge,
  resolveDemoResize,
} from "../components/demo/demoLayout";

describe("resolveDemoResize — draggable demo columns", () => {
  const CONTAINER = 1200;

  it("clamps below the panel minimum up to the minimum", () => {
    expect(resolveDemoResize(50, 360, CONTAINER)).toBe(DEMO_PANEL_MIN);
    expect(resolveDemoResize(-100, 360, CONTAINER)).toBe(DEMO_PANEL_MIN);
  });

  it("passes a comfortable width straight through", () => {
    expect(resolveDemoResize(400, 360, CONTAINER)).toBe(400);
  });

  it("caps the width so the middle preview keeps its minimum", () => {
    const other = 360;
    const max = CONTAINER - other - DEMO_PREVIEW_MIN - DEMO_HANDLES_WIDTH;
    expect(resolveDemoResize(9999, other, CONTAINER)).toBe(max);
    // One px under the cap is allowed.
    expect(resolveDemoResize(max - 1, other, CONTAINER)).toBe(max - 1);
  });

  it("never returns below the panel minimum even when the container is tiny", () => {
    // A cramped container would push the preview-based cap below the min; the
    // panel minimum wins so the dragged panel never collapses to nothing.
    expect(resolveDemoResize(400, 900, 1000)).toBe(DEMO_PANEL_MIN);
  });

  it("ignores the container bound when width is unknown (<= 0)", () => {
    // Headless / pre-layout: only the panel minimum applies, no upper cap.
    expect(resolveDemoResize(5000, 360, 0)).toBe(5000);
    expect(resolveDemoResize(10, 360, 0)).toBe(DEMO_PANEL_MIN);
  });

  it("rounds to whole pixels", () => {
    expect(resolveDemoResize(400.6, 360, CONTAINER)).toBe(401);
  });
});

describe("proposedWidthForEdge — pointer delta to panel width", () => {
  it("chat divider: dragging right grows the chat panel", () => {
    expect(proposedWidthForEdge("chat", 340, 40)).toBe(380);
    expect(proposedWidthForEdge("chat", 340, -40)).toBe(300);
  });

  it("right divider: dragging right shrinks the right panel", () => {
    expect(proposedWidthForEdge("right", 360, 40)).toBe(320);
    expect(proposedWidthForEdge("right", 360, -40)).toBe(400);
  });
});

describe("parseDemoWidths — persisted layout", () => {
  const defaults = { chat: DEMO_DEFAULT_CHAT, right: DEMO_DEFAULT_RIGHT };

  it("returns defaults for null / empty / invalid JSON", () => {
    expect(parseDemoWidths(null)).toEqual(defaults);
    expect(parseDemoWidths("")).toEqual(defaults);
    expect(parseDemoWidths("{not json")).toEqual(defaults);
  });

  it("round-trips valid stored widths", () => {
    expect(parseDemoWidths(JSON.stringify({ chat: 400, right: 300 }))).toEqual({ chat: 400, right: 300 });
  });

  it("rounds fractional stored widths", () => {
    expect(parseDemoWidths(JSON.stringify({ chat: 400.4, right: 300.9 }))).toEqual({ chat: 400, right: 301 });
  });

  it("falls back per-field for missing, non-numeric, or sub-minimum values", () => {
    expect(parseDemoWidths(JSON.stringify({ chat: 400 }))).toEqual({ chat: 400, right: DEMO_DEFAULT_RIGHT });
    expect(parseDemoWidths(JSON.stringify({ chat: "wide", right: 300 }))).toEqual({ chat: DEMO_DEFAULT_CHAT, right: 300 });
    expect(parseDemoWidths(JSON.stringify({ chat: 10, right: 300 }))).toEqual({ chat: DEMO_DEFAULT_CHAT, right: 300 });
    expect(parseDemoWidths(JSON.stringify({ chat: Infinity, right: 300 }))).toEqual({ chat: DEMO_DEFAULT_CHAT, right: 300 });
  });
});
