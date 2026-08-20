type FocusScheduler = (callback: () => void) => void;

/**
 * Restore focus only after React has finished every modal cleanup. Safari
 * ignores focus() while the opener is still inside an inert background tree;
 * the Settings focus cleanup runs before the sibling-inert cleanup on unmount.
 */
export function restoreFocusAfterModalClose(
  element: HTMLElement | null,
  schedule: FocusScheduler = (callback) => {
    window.requestAnimationFrame(callback);
  },
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
