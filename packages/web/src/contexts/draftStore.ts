import { useCallback, useSyncExternalStore } from "react";

/**
 * Module-scoped store for unsent textarea drafts, keyed by session id.
 *
 * Why this exists: keeping draft state in SessionContext caused every keystroke
 * to re-render the whole chat subtree (MessageStream + all MarkdownMessage
 * children), producing visible input lag once the conversation grew past a few
 * hundred messages. Pulling draft state out of React context and subscribing to
 * it only from the ComposerInput leaf component lets typing skip the list
 * entirely.
 *
 * Why a module-level store rather than per-component useState:
 *   - PromptComposer unmounts when the user switches to the Agents/Trace tab,
 *     so local state would lose the unsent draft.
 *   - Drafts must be isolated per session — switching sessions keeps the
 *     composer mounted but should swap which draft is visible.
 */
class DraftStore {
  private drafts = new Map<string, string>();
  private listeners = new Map<string, Set<() => void>>();

  get(sessionId: string): string {
    return this.drafts.get(sessionId) ?? "";
  }

  set(sessionId: string, value: string): void {
    if (this.drafts.get(sessionId) === value) {
      // Skip notify on no-op writes so React doesn't schedule needless work.
      return;
    }
    this.drafts.set(sessionId, value);
    const subs = this.listeners.get(sessionId);
    if (subs) {
      subs.forEach((listener) => listener());
    }
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    let subs = this.listeners.get(sessionId);
    if (!subs) {
      subs = new Set();
      this.listeners.set(sessionId, subs);
    }
    subs.add(listener);
    return () => {
      const current = this.listeners.get(sessionId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(sessionId);
      }
    };
  }

  delete(sessionId: string): void {
    this.drafts.delete(sessionId);
    // Keep listener set alive — if a component is currently mounted on this id
    // (rare, but possible during async deletion), it will still get notified
    // of the implicit "" snapshot via get().
  }
}

export const draftStore = new DraftStore();

const NOOP_UNSUBSCRIBE = () => {};
const EMPTY_SUBSCRIBE = (_listener: () => void) => NOOP_UNSUBSCRIBE;
const EMPTY_SNAPSHOT = () => "";

/**
 * Subscribe to the draft for a given session id.
 *
 * When sessionId is null (no active session) returns ["", noop] and does not
 * subscribe to anything — keeps the hook safe to call unconditionally.
 */
export function useDraft(sessionId: string | null): [string, (value: string) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (sessionId === null) return NOOP_UNSUBSCRIBE;
      return draftStore.subscribe(sessionId, listener);
    },
    [sessionId],
  );
  const getSnapshot = useCallback(
    () => (sessionId === null ? "" : draftStore.get(sessionId)),
    [sessionId],
  );

  const draft = useSyncExternalStore(
    sessionId === null ? EMPTY_SUBSCRIBE : subscribe,
    sessionId === null ? EMPTY_SNAPSHOT : getSnapshot,
  );

  const setDraft = useCallback(
    (value: string) => {
      if (sessionId === null) return;
      draftStore.set(sessionId, value);
    },
    [sessionId],
  );

  return [draft, setDraft];
}
