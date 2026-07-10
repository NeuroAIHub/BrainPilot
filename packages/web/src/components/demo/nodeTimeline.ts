import type { TraceNode } from "../../contracts/backend";

/**
 * Compute the reveal time (ms) for each trace node in the Live Demo replay.
 *
 * The player reveals nodes by taking `nodeMs.filter((ms) => ms <= cursor).length`
 * and slicing `nodes.slice(0, count)`. For that slice to equal the set of nodes
 * with `ms <= cursor`, `nodeMs` MUST be non-decreasing in array order.
 *
 * Trace node timestamps are frequently missing, all-equal, or non-monotonic, so
 * we only trust them when every node has a finite time, the sequence is
 * non-decreasing in array order, and it spans a real range. When it does, using
 * the real times aligns the reasoning graph with the conversation panel (which
 * folds by real event time). Otherwise we fall back to even spacing across the
 * timeline — nodes stream in one by one, in creation order, paced across the
 * replay — which is always safely monotonic.
 *
 * Extracted as a pure function so the trust check is unit-testable without
 * rendering the component (the monorepo has no jsdom / @testing-library).
 */

/** Best-effort single timestamp for a node, in ms since epoch, or NaN. */
export function nodeTimeMs(node: TraceNode): number {
  const raw =
    node.timestamp?.completedAt ??
    node.timestamp?.startedAt ??
    node.timestamp?.createdAt ??
    node.createdAt ??
    node.updatedAt;
  return raw ? Date.parse(String(raw)) : NaN;
}

/** Even-spacing fallback: node j lands at fraction j/(n-1) of [t0, t1]. */
function evenlySpaced(count: number, t0: number, t1: number): number[] {
  const span = t1 > t0 ? t1 - t0 : 1;
  return Array.from({ length: count }, (_, j) =>
    count <= 1 ? t1 : t0 + (j / (count - 1)) * span,
  );
}

export function computeNodeMs(nodes: TraceNode[], t0: number, t1: number): number[] {
  if (nodes.length === 0) {
    return [];
  }
  const times = nodes.map(nodeTimeMs);
  const allFinite = times.every(Number.isFinite);
  let nonDecreasing = true;
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] < times[i - 1]) {
      nonDecreasing = false;
      break;
    }
  }
  const spansRange = allFinite && times[times.length - 1] > times[0];
  if (allFinite && nonDecreasing && spansRange) {
    // Real times are trustworthy — clamp into the timeline bounds (preserves the
    // non-decreasing invariant the slice relies on).
    return times.map((ms) => Math.min(Math.max(ms, t0), t1));
  }
  return evenlySpaced(nodes.length, t0, t1);
}
