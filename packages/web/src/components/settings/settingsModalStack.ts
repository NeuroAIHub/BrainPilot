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
 * Resolve the boundary control for a focus trap. Treat focus on the dialog
 * container itself (or any other non-control) as outside the ordered control
 * list so Tab cannot fall through to the inert page behind it.
 */
export function resolveFocusTrapTarget<T>(
  focusable: readonly T[],
  active: T | null,
  shiftKey: boolean,
): T | null {
  if (focusable.length === 0) return null;
  const activeIndex = active === null ? -1 : focusable.indexOf(active);
  if (shiftKey && activeIndex <= 0) return focusable[focusable.length - 1]!;
  if (!shiftKey && (activeIndex < 0 || activeIndex === focusable.length - 1)) {
    return focusable[0]!;
  }
  return null;
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
  if (target) {
    event.preventDefault();
    target.focus();
    return true;
  }
  return false;
}
