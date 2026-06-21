/**
 * Pure reset-signal logic for the Live Demo player (issue #111).
 *
 * The shell bumps a monotonic `resetSignal` every time the sidebar "Live Demo"
 * entry is clicked. DemoView must return to its session-selection landing on a
 * *change* of that signal — but NOT on the initial mount, or importing/packing
 * a freshly-selected bundle would be undone immediately. Extracted as a pure
 * function so this guard is unit-testable without rendering the component (the
 * monorepo has no jsdom/@testing-library).
 */
export function shouldResetDemo(
  previous: number | undefined,
  next: number | undefined,
): boolean {
  return next !== previous;
}
