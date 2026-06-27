/**
 * sidebarResize.ts — pure geometry for the sidebar resize→collapse interaction
 * (#159). Kept free of React so it can be unit-tested without jsdom (the
 * monorepo has no jsdom/@testing-library; DesktopShell drives the real
 * pointer events, these helpers decide the numbers).
 *
 * Behaviour: while dragging the sidebar's right edge leftward, once the would-be
 * width crosses a collapse threshold that sits *below* the normal minimum, the
 * rail snaps to the collapsed icon rail (rather than refusing to shrink past the
 * minimum, which is what made drag-to-collapse impossible before #159).
 */

/** Normal drag bounds — the sidebar clamps here while it stays expanded. */
export const MIN_SIDEBAR_WIDTH = 220;
export const MAX_SIDEBAR_WIDTH = 420;

/**
 * Drag the edge below this (well under MIN, giving a deliberate "drag past the
 * min a bit more" buffer so a normal min-width drag doesn't accidentally
 * collapse) and the rail snaps shut.
 */
export const COLLAPSE_THRESHOLD = 160;

/** Width the rail restores to when it expands again (matches the default). */
export const DEFAULT_SIDEBAR_WIDTH = 268;

export interface ResizeOutcome {
  /** Clamped width to apply while expanded (ignored when collapse is true). */
  width: number;
  /** True when the drag has gone narrow enough to collapse to the icon rail. */
  collapse: boolean;
}

/**
 * Given the drag's raw proposed width (start width + pointer delta), decide
 * whether to collapse and, if not, the clamped expanded width.
 *
 * - proposed <= COLLAPSE_THRESHOLD → collapse.
 * - otherwise clamp into [MIN, MAX].
 */
export function resolveResize(proposedWidth: number): ResizeOutcome {
  if (proposedWidth <= COLLAPSE_THRESHOLD) {
    return { width: MIN_SIDEBAR_WIDTH, collapse: true };
  }
  return {
    width: Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, proposedWidth)),
    collapse: false,
  };
}
