/**
 * Focus recovery for a retry control that its own success removes.
 *
 * An inline "Retry" lives inside the failure notice it belongs to. While the
 * retry runs the notice stays mounted, so focus is kept; but when the retry
 * succeeds the notice — and with it the focused button — is unmounted, and the
 * browser drops focus to `<body>`. Keyboard and screen-reader users are then
 * stranded outside the dialog even though the content they asked for just
 * arrived.
 *
 * Doing this in the retry promise's `.finally` does not work: it runs before
 * React has committed the new DOM (the button is still connected), and it also
 * ties recovery to a promise that may wait on optional work the user never
 * asked about (e.g. the provider health overlay). So instead the caller only
 * *remembers* where focus should land, and an effect — which React runs after
 * the commit — decides, from the resource's own settled state, whether to move
 * it.
 *
 * The hook never moves focus at click time and never uses a timer.
 */
import { useCallback, useEffect, useRef } from "react";

/** Structural slice of a load-state resource; matches SettingsResource and SessionsListStatus. */
export interface RetryFocusResource {
  status: "idle" | "loading" | "ready" | "error";
}

/**
 * Record the retry that was just activated. `trigger` is the button itself,
 * `target` where focus should go if the button disappears (a section heading,
 * the search input, ...). Stable across renders.
 */
export type RememberRetryFocus = (trigger: HTMLElement, target: HTMLElement | null) => void;

export function useRetryFocus(isOpen: boolean, resource: RetryFocusResource): RememberRetryFocus {
  const recordRef = useRef<{ trigger: HTMLElement; target: HTMLElement } | null>(null);

  const rememberRetryFocus = useCallback<RememberRetryFocus>((trigger, target) => {
    if (!target) return;
    // Only a *focused* retry can lose focus; a mouse click that left focus
    // elsewhere must not later steal it.
    if (typeof document === "undefined" || document.activeElement !== trigger) return;
    recordRef.current = { trigger, target };
  }, []);

  // Runs after the DOM commit, so `isConnected` below reflects what the user
  // can actually see. Keyed on the resource *object*, not just its status, so a
  // retry that fails again also settles (and clears) the record.
  useEffect(() => {
    if (!isOpen) {
      // Closed: the next open re-runs its own load and owns focus itself.
      recordRef.current = null;
      return;
    }
    const record = recordRef.current;
    if (!record) return;
    // Still in flight: the notice (and the focused button) is still mounted.
    if (resource.status === "loading" || resource.status === "idle") return;
    recordRef.current = null;
    if (resource.status !== "ready") return;
    // The retry is still on screen (e.g. stale data next to a refresh error),
    // so nothing was lost and nothing should move.
    if (record.trigger.isConnected) return;
    // Tab switched, section replaced, or dialog closed: no target to land on.
    if (!record.target.isConnected) return;
    // The user has moved on to another control; only orphaned focus is rescued.
    if (document.activeElement !== document.body) return;
    record.target.focus();
  }, [isOpen, resource]);

  return rememberRetryFocus;
}
