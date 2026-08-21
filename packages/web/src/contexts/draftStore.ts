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
export const DRAFT_STORAGE_KEY = "bp.web.composerDrafts.v1";

function defaultLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readPersistedDrafts(storage: Pick<Storage, "getItem"> | null): Map<string, string> {
  if (!storage) return new Map();
  try {
    const parsed = JSON.parse(storage.getItem(DRAFT_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return new Map(Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0));
  } catch {
    return new Map();
  }
}

export class DraftStore {
  private drafts: Map<string, string>;
  private listeners = new Map<string, Set<() => void>>();

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = defaultLocalStorage()) {
    this.drafts = readPersistedDrafts(storage);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (this.drafts.size === 0) {
        this.storage.removeItem(DRAFT_STORAGE_KEY);
      } else {
        this.storage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.drafts)));
      }
    } catch {
      // Quota/private mode: keep the in-memory draft for this page lifetime.
    }
  }

  get(sessionId: string): string {
    return this.drafts.get(sessionId) ?? "";
  }

  set(sessionId: string, value: string): void {
    if (this.drafts.get(sessionId) === value) {
      // Skip notify on no-op writes so React doesn't schedule needless work.
      return;
    }
    if (value.length > 0) this.drafts.set(sessionId, value);
    else this.drafts.delete(sessionId);
    this.persist();
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
    this.persist();
    this.listeners.get(sessionId)?.forEach((listener) => listener());
  }

  has(sessionId: string): boolean {
    return this.get(sessionId).length > 0;
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
