/**
 * Per-session chat scroll memory (#89).
 *
 * Switching workspace tabs (Chat ↔ Agents ↔ Trace) unmounts/remounts the Chat
 * subtree in DesktopShell, so MessageStream loses its scroll position and its
 * "is the user pinned to the bottom" intent. This module-level store survives
 * those remounts, keyed by session id, so returning to Chat can restore where
 * the user was — at the bottom following live output, or up in the history they
 * were reading — without a visible top-to-bottom replay.
 *
 * Module-level (not React state) on purpose: it must outlive the component that
 * reads it, and it is deliberately ephemeral (lost on full page reload, which
 * is the right default — a reload starts a fresh view).
 */

export interface ChatScrollState {
  /** Last observed scrollTop of the message stack. */
  scrollTop: number;
  /** Whether the user was pinned to (near) the bottom. */
  pinned: boolean;
}

const store = new Map<string, ChatScrollState>();

export function getChatScroll(key: string | undefined): ChatScrollState | undefined {
  if (!key) return undefined;
  return store.get(key);
}

export function setChatScroll(key: string | undefined, state: ChatScrollState): void {
  if (!key) return;
  store.set(key, state);
}

/**
 * Resolve the scrollTop to apply on (re)mount.
 *
 * - no memory yet, or the user was pinned → bottom (scrollHeight); this is the
 *   default for a freshly-opened conversation and for "following live output".
 * - the user had scrolled up to read history → restore that exact position,
 *   clamped to the current scrollHeight in case content shrank.
 */
export function resolveScrollTop(
  mem: ChatScrollState | undefined,
  scrollHeight: number,
): number {
  if (!mem || mem.pinned) return scrollHeight;
  return Math.min(mem.scrollTop, scrollHeight);
}
