/**
 * demoLayout.ts — pure geometry for the Live Demo player's resizable columns.
 *
 * The player is a three-part row: conversation (left) | file preview (middle) |
 * trace+tree (right). The two dividers between them are draggable. The left and
 * right panels are sized in pixels (CSS vars) and the middle preview absorbs the
 * remaining space, so a drag only ever moves one boundary.
 *
 * Kept free of React so the clamping is unit-testable without jsdom (the
 * monorepo has no jsdom/@testing-library; DemoView drives the real pointer
 * events, this helper decides the numbers), mirroring sidebarResize.ts.
 */

/** Which boundary is being dragged. */
export type DemoEdge = "chat" | "right";

/** Minimum width for the outer (chat / right) panels. */
export const DEMO_PANEL_MIN = 220;
/** The middle preview never shrinks below this, so a drag can't crush it. */
export const DEMO_PREVIEW_MIN = 260;
/** Combined width of the two divider handles (kept in sync with the CSS). */
export const DEMO_HANDLES_WIDTH = 12;

/** Default panel widths (px) — the middle preview gets whatever is left. */
export const DEMO_DEFAULT_CHAT = 340;
export const DEMO_DEFAULT_RIGHT = 360;

/**
 * Clamp a dragged panel's proposed width so that:
 *  - it never goes below DEMO_PANEL_MIN, and
 *  - the middle preview keeps at least DEMO_PREVIEW_MIN given the opposite
 *    panel's current width and the total container width.
 *
 * `containerWidth <= 0` (e.g. before layout / in a headless test) disables the
 * upper container-based bound and only the panel minimum applies.
 */
export function resolveDemoResize(
  proposedWidth: number,
  otherWidth: number,
  containerWidth: number,
): number {
  const upper =
    containerWidth > 0
      ? Math.max(DEMO_PANEL_MIN, containerWidth - otherWidth - DEMO_PREVIEW_MIN - DEMO_HANDLES_WIDTH)
      : Number.POSITIVE_INFINITY;
  return Math.round(Math.max(DEMO_PANEL_MIN, Math.min(upper, proposedWidth)));
}

/**
 * Turn a pointer delta on a given edge into the panel's new proposed width.
 * Dragging the chat|preview divider right grows chat; dragging the
 * preview|right divider right *shrinks* right (its left edge moves right).
 */
export function proposedWidthForEdge(edge: DemoEdge, startWidth: number, deltaX: number): number {
  return edge === "chat" ? startWidth + deltaX : startWidth - deltaX;
}

/** Persisted column widths (px). */
export interface DemoWidths {
  chat: number;
  right: number;
}

export const DEMO_WIDTHS_STORAGE_KEY = "demo-panel-widths";

/**
 * Parse a persisted widths payload, keeping only finite values within the sane
 * bounds and falling back to the defaults otherwise. Pure so it can be unit
 * tested; localStorage access (which can throw) is isolated in loadDemoWidths.
 */
export function parseDemoWidths(raw: string | null): DemoWidths {
  const fallback: DemoWidths = { chat: DEMO_DEFAULT_CHAT, right: DEMO_DEFAULT_RIGHT };
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DemoWidths>;
    const sane = (v: unknown): v is number =>
      typeof v === "number" && Number.isFinite(v) && v >= DEMO_PANEL_MIN;
    return {
      chat: sane(parsed.chat) ? Math.round(parsed.chat) : fallback.chat,
      right: sane(parsed.right) ? Math.round(parsed.right) : fallback.right,
    };
  } catch {
    return fallback;
  }
}

/** Load persisted widths, tolerating unavailable / malformed storage. */
export function loadDemoWidths(): DemoWidths {
  try {
    return parseDemoWidths(localStorage.getItem(DEMO_WIDTHS_STORAGE_KEY));
  } catch {
    return { chat: DEMO_DEFAULT_CHAT, right: DEMO_DEFAULT_RIGHT };
  }
}

/** Persist widths, silently ignoring storage failures (quota / disabled). */
export function saveDemoWidths(widths: DemoWidths): void {
  try {
    localStorage.setItem(DEMO_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    /* ignore */
  }
}
