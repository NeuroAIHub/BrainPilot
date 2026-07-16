import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isTracePlaybackActive,
  playbackControlsState,
  sliderA11y,
  sliderValueToNodeIndex,
  DEMO_TRANSPORT_LAYOUT_CLASS,
  DEMO_TRANSPORT_SPEEDS_CLASS,
} from "../components/demo/demoPlayback";

describe("isTracePlaybackActive (#320)", () => {
  it("is false for zero nodes (0/0)", () => {
    expect(isTracePlaybackActive(0)).toBe(false);
  });

  it("is true when the Trace has nodes", () => {
    expect(isTracePlaybackActive(1)).toBe(true);
    expect(isTracePlaybackActive(12)).toBe(true);
  });
});

describe("playbackControlsState (#320)", () => {
  it("disables Play, Prev, Next, Restart, slider, and speeds when empty", () => {
    expect(playbackControlsState(0, 0)).toEqual({
      active: false,
      playDisabled: true,
      prevDisabled: true,
      nextDisabled: true,
      restartDisabled: true,
      sliderDisabled: true,
      speedDisabled: true,
    });
  });

  it("enables Play/Restart/slider at the start of a non-empty Trace", () => {
    const s = playbackControlsState(5, 0);
    expect(s.active).toBe(true);
    expect(s.playDisabled).toBe(false);
    expect(s.restartDisabled).toBe(false);
    expect(s.sliderDisabled).toBe(false);
    expect(s.speedDisabled).toBe(false);
    expect(s.prevDisabled).toBe(true);
    expect(s.nextDisabled).toBe(false);
  });

  it("keeps Prev disabled until two nodes are revealed (historical DemoView)", () => {
    expect(playbackControlsState(5, 1).prevDisabled).toBe(true);
    expect(playbackControlsState(5, 2).prevDisabled).toBe(false);
  });

  it("disables Next at the end and enables Prev mid-playback", () => {
    const mid = playbackControlsState(4, 2);
    expect(mid.prevDisabled).toBe(false);
    expect(mid.nextDisabled).toBe(false);

    const end = playbackControlsState(4, 4);
    expect(end.prevDisabled).toBe(false);
    expect(end.nextDisabled).toBe(true);
  });
});

describe("sliderA11y (#320)", () => {
  it("exposes step counts, not millisecond timestamps", () => {
    const a = sliderA11y(2, 7);
    expect(a.min).toBe(0);
    expect(a.max).toBe(7);
    expect(a.now).toBe(2);
    expect(a.ariaLabelKey).toBe("demo.transport.slider");
    expect(a.valueTextKey).toBe("demo.transport.step");
    expect(a.valueTextVars).toEqual({ index: 2, total: 7 });
  });

  it("clamps now into [0, total] for empty and overshoot", () => {
    expect(sliderA11y(0, 0)).toMatchObject({ min: 0, max: 0, now: 0 });
    expect(sliderA11y(99, 3)).toMatchObject({ now: 3, max: 3 });
    expect(sliderA11y(-1, 3)).toMatchObject({ now: 0 });
  });
});

describe("sliderValueToNodeIndex", () => {
  it("maps revealed count to stepTo node index", () => {
    expect(sliderValueToNodeIndex(0)).toBe(-1);
    expect(sliderValueToNodeIndex(1)).toBe(0);
    expect(sliderValueToNodeIndex(3)).toBe(2);
  });
});

describe("transport layout CSS (#320 narrow speeds)", () => {
  const css = readFileSync(
    join(__dirname, "../styles/global.css"),
    "utf8",
  );

  it("keeps transport and speeds classes with wrap so 1×–8× are not clipped", () => {
    expect(css).toContain(`.${DEMO_TRANSPORT_LAYOUT_CLASS}`);
    expect(css).toContain(`.${DEMO_TRANSPORT_SPEEDS_CLASS}`);
    // Transport row may wrap; speeds stay fully visible on narrow panels.
    const transportBlock = css.slice(
      css.indexOf(`.${DEMO_TRANSPORT_LAYOUT_CLASS} {`),
      css.indexOf(`.${DEMO_TRANSPORT_LAYOUT_CLASS} {`) + 400,
    );
    expect(transportBlock).toMatch(/flex-wrap:\s*wrap/);
    const speedsBlock = css.slice(
      css.indexOf(`.${DEMO_TRANSPORT_SPEEDS_CLASS} {`),
      css.indexOf(`.${DEMO_TRANSPORT_SPEEDS_CLASS} {`) + 300,
    );
    expect(speedsBlock).toMatch(/flex-shrink:\s*0/);
  });
});
