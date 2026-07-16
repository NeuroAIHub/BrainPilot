/**
 * Pure helpers for Live Demo Trace playback controls (#320).
 *
 * When the demo Trace has zero nodes, transport must not look operable.
 * When nodes exist, the slider exposes step semantics (not internal ms).
 */

export interface PlaybackControlsState {
  /** True when the Trace has at least one node to play through. */
  active: boolean;
  playDisabled: boolean;
  prevDisabled: boolean;
  nextDisabled: boolean;
  restartDisabled: boolean;
  sliderDisabled: boolean;
  speedDisabled: boolean;
}

/**
 * Whether Trace-node playback is meaningful for this corpus.
 */
export function isTracePlaybackActive(nodeCount: number): boolean {
  return nodeCount > 0;
}

/**
 * Disable flags for Play / Prev / Next / Restart / slider / speeds.
 *
 * @param nodeCount total nodes in the demo Trace
 * @param stepIndex nodes revealed so far (0 … nodeCount)
 */
export function playbackControlsState(
  nodeCount: number,
  stepIndex: number,
): PlaybackControlsState {
  const active = isTracePlaybackActive(nodeCount);
  if (!active) {
    return {
      active: false,
      playDisabled: true,
      prevDisabled: true,
      nextDisabled: true,
      restartDisabled: true,
      sliderDisabled: true,
      speedDisabled: true,
    };
  }

  const clampedStep = Math.max(0, Math.min(stepIndex, nodeCount));
  // Match historical DemoView: Prev is only useful once at least two nodes
  // have been revealed (stepIndex > 1); Restart handles full reset.
  return {
    active: true,
    playDisabled: false,
    prevDisabled: clampedStep <= 1,
    nextDisabled: clampedStep >= nodeCount,
    restartDisabled: false,
    sliderDisabled: false,
    speedDisabled: false,
  };
}

/**
 * Map a step-based slider value (revealed count) to the node index used by
 * `stepTo` in DemoView: reveal nodes [0..nodeIdx], or t0 when empty.
 *
 * Slider range is 0 … total (revealed count). stepTo expects the last
 * revealed node's index, or a negative value to reset.
 */
export function sliderValueToNodeIndex(revealedCount: number): number {
  if (revealedCount <= 0) return -1;
  return revealedCount - 1;
}

export interface SliderA11y {
  /** Min revealed count (always 0). */
  min: number;
  /** Max revealed count (= total nodes). */
  max: number;
  /** Current revealed count. */
  now: number;
  /** i18n key for aria-label (not the Play button label). */
  ariaLabelKey: "demo.transport.slider";
  /** i18n key for aria-valuetext / visible step label. */
  valueTextKey: "demo.transport.step";
  valueTextVars: { index: number; total: number };
}

/**
 * Accessible range semantics for the playback slider.
 * Uses step counts, never internal millisecond timestamps.
 */
export function sliderA11y(stepIndex: number, total: number): SliderA11y {
  const max = Math.max(0, total);
  const now = Math.max(0, Math.min(stepIndex, max));
  return {
    min: 0,
    max,
    now,
    ariaLabelKey: "demo.transport.slider",
    valueTextKey: "demo.transport.step",
    valueTextVars: { index: now, total: max },
  };
}

/** CSS class marker for narrow-layout regression coverage. */
export const DEMO_TRANSPORT_LAYOUT_CLASS = "demo-transport";
export const DEMO_TRANSPORT_SPEEDS_CLASS = "demo-transport__speeds";
