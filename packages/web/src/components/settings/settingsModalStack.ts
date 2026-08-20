/**
 * Nested settings modal Escape stack (#328).
 * Topmost dialog closes first: MCP → Provider → Settings.
 */

export type SettingsModalLayer = "mcp" | "provider" | "settings";

export function resolveEscapeLayer(state: {
  isMcpFormOpen: boolean;
  isProviderFormOpen: boolean;
  isSettingsOpen: boolean;
}): SettingsModalLayer | null {
  if (!state.isSettingsOpen) return null;
  if (state.isMcpFormOpen) return "mcp";
  if (state.isProviderFormOpen) return "provider";
  return "settings";
}

/** CSS selector for focusable controls inside a dialog. */
export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function listFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null,
  );
}

/**
 * Resolve the next control for a focus trap. The trap owns every Tab movement
 * instead of relying on WebKit's native traversal through an inert background;
 * Safari can otherwise drop focus onto body between two valid dialog controls.
 * Focus on the dialog container itself (or another non-control) starts at the
 * appropriate boundary.
 */
export function resolveFocusTrapTarget<T>(
  focusable: readonly T[],
  active: T | null,
  shiftKey: boolean,
): T | null {
  if (focusable.length === 0) return null;
  const activeIndex = active === null ? -1 : focusable.indexOf(active);
  if (shiftKey) {
    const previousIndex = activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1;
    return focusable[previousIndex]!;
  }
  const nextIndex = activeIndex < 0 || activeIndex === focusable.length - 1
    ? 0
    : activeIndex + 1;
  return focusable[nextIndex]!;
}

/**
 * Keep Tab / Shift+Tab inside `container`. Returns true if the event was handled.
 */
export function trapFocusKeyDown(container: HTMLElement, event: KeyboardEvent): boolean {
  if (event.key !== "Tab") return false;
  const focusable = listFocusable(container);
  if (focusable.length === 0) {
    event.preventDefault();
    return true;
  }
  const active = document.activeElement as HTMLElement | null;
  const target = resolveFocusTrapTarget(
    focusable,
    active && container.contains(active) ? active : null,
    event.shiftKey,
  );
  event.preventDefault();
  target?.focus();
  return true;
}
