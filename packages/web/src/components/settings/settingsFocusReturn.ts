export type FocusScheduler = (callback: () => void) => void;

function scheduleAfterPaint(callback: () => void): void {
  // WebKit can move focus back to the document while removing a focused
  // dialog during the first frame. Wait for that browser cleanup as well as
  // React's inert cleanup before restoring the opener.
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
}

/**
 * Restore focus only after React has finished every modal cleanup. Safari
 * ignores focus() while the opener is still inside an inert background tree;
 * the Settings focus cleanup runs before the sibling-inert cleanup on unmount.
 */
export function restoreFocusAfterModalClose(
  element: HTMLElement | null,
  schedule: FocusScheduler = scheduleAfterPaint,
): void {
  if (!element) return;
  schedule(() => {
    if (!element.isConnected || element.closest("[inert]")) return;
    try {
      element.focus({ preventScroll: true });
    } catch {
      // The opener may have been removed or become non-focusable while the
      // modal was open. Closing Settings must still complete normally.
    }
  });
}
