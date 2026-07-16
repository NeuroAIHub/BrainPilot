/**
 * Pure helpers for Trace graph empty-state taxonomy (#317).
 *
 * Distinguishes “corpus is empty” from “filters/playback hid every node”
 * so the UI never claims “no filter matches” when total is 0/0.
 */

export type TraceGraphEmptyReason = "no-nodes" | "filtered-out" | null;

/**
 * Classify why the graph has nothing to draw.
 *
 * @param totalCount full corpus size (`trace.nodes.length`)
 * @param visibleCount nodes after playback slice + filters
 */
export function resolveTraceGraphEmpty(
  totalCount: number,
  visibleCount: number,
): TraceGraphEmptyReason {
  if (totalCount <= 0) return "no-nodes";
  if (visibleCount <= 0) return "filtered-out";
  return null;
}

/** Filter / layout controls only matter when the corpus is non-empty. */
export function traceControlsEffective(totalCount: number): boolean {
  return totalCount > 0;
}

export type TraceLayoutDirection = "LR" | "TB";

/**
 * Semantic props for the horizontal/vertical layout toggle pair.
 * Pure so vitest can lock `aria-pressed` / `disabled` without React.
 */
export function layoutToggleState(
  direction: TraceLayoutDirection,
  effective: boolean,
): {
  lr: { pressed: boolean; disabled: boolean };
  tb: { pressed: boolean; disabled: boolean };
} {
  return {
    lr: { pressed: direction === "LR", disabled: !effective },
    tb: { pressed: direction === "TB", disabled: !effective },
  };
}

/** i18n key for the graph empty label, or null when the graph should render. */
export function traceEmptyLabelKey(
  reason: TraceGraphEmptyReason,
): "trace.emptyNoNodes" | "trace.noMatch" | null {
  if (reason === "no-nodes") return "trace.emptyNoNodes";
  if (reason === "filtered-out") return "trace.noMatch";
  return null;
}
