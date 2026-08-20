import { useCallback, useSyncExternalStore } from "react";

export type AttachmentsBySession = Record<string, string[]>;
export const ATTACHMENT_STORAGE_KEY = "bp.web.composerAttachments.v1";

function defaultLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readPersistedAttachments(
  storage: Pick<Storage, "getItem"> | null,
): AttachmentsBySession {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(ATTACHMENT_STORAGE_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).flatMap(([sessionId, value]) => {
      if (!Array.isArray(value)) return [];
      const names = value.filter((item): item is string => typeof item === "string" && item.length > 0);
      return names.length > 0 ? [[sessionId, [...new Set(names)]]] : [];
    }));
  } catch {
    return {};
  }
}

const EMPTY_ATTACHMENTS: string[] = [];

export function addScopedAttachment(
  state: AttachmentsBySession,
  sessionId: string,
  filename: string,
): AttachmentsBySession {
  const existing = state[sessionId] ?? [];
  return existing.includes(filename)
    ? state
    : { ...state, [sessionId]: [...existing, filename] };
}

export function clearScopedAttachments(
  state: AttachmentsBySession,
  sessionId: string,
): AttachmentsBySession {
  return { ...state, [sessionId]: [] };
}

export function restoreScopedAttachmentsIfEmpty(
  state: AttachmentsBySession,
  sessionId: string,
  filenames: readonly string[],
): AttachmentsBySession {
  return (state[sessionId] ?? []).length === 0
    ? { ...state, [sessionId]: [...filenames] }
    : state;
}

export function removeScopedAttachment(
  state: AttachmentsBySession,
  sessionId: string,
  filename: string,
): AttachmentsBySession {
  return {
    ...state,
    [sessionId]: (state[sessionId] ?? []).filter((item) => item !== filename),
  };
}

export class AttachmentStore {
  private values: AttachmentsBySession;
  private listeners = new Map<string, Set<() => void>>();

  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = defaultLocalStorage()) {
    this.values = readPersistedAttachments(storage);
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const nonEmpty = Object.fromEntries(Object.entries(this.values).filter(([, names]) => names.length > 0));
      if (Object.keys(nonEmpty).length === 0) this.storage.removeItem(ATTACHMENT_STORAGE_KEY);
      else this.storage.setItem(ATTACHMENT_STORAGE_KEY, JSON.stringify(nonEmpty));
    } catch {
      // Quota/private mode: preserve the module-level state for this page.
    }
  }

  get(sessionId: string): string[] {
    return this.values[sessionId] ?? EMPTY_ATTACHMENTS;
  }

  private update(sessionId: string, next: AttachmentsBySession): void {
    if (next === this.values) return;
    this.values = next;
    this.persist();
    this.listeners.get(sessionId)?.forEach((listener) => listener());
  }

  add(sessionId: string, filename: string): void {
    this.update(sessionId, addScopedAttachment(this.values, sessionId, filename));
  }

  clear(sessionId: string): void {
    this.update(sessionId, clearScopedAttachments(this.values, sessionId));
  }

  restoreIfEmpty(sessionId: string, filenames: readonly string[]): void {
    this.update(sessionId, restoreScopedAttachmentsIfEmpty(this.values, sessionId, filenames));
  }

  remove(sessionId: string, filename: string): void {
    this.update(sessionId, removeScopedAttachment(this.values, sessionId, filename));
  }

  delete(sessionId: string): void {
    if (!(sessionId in this.values)) return;
    const { [sessionId]: _removed, ...next } = this.values;
    this.values = next;
    this.persist();
    this.listeners.get(sessionId)?.forEach((listener) => listener());
  }

  has(sessionId: string): boolean {
    return this.get(sessionId).length > 0;
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    };
  }
}

export const attachmentStore = new AttachmentStore();

const NOOP_UNSUBSCRIBE = () => {};

export function useAttachments(sessionId: string | null): string[] {
  const subscribe = useCallback(
    (listener: () => void) => sessionId ? attachmentStore.subscribe(sessionId, listener) : NOOP_UNSUBSCRIBE,
    [sessionId],
  );
  const getSnapshot = useCallback(
    () => sessionId ? attachmentStore.get(sessionId) : EMPTY_ATTACHMENTS,
    [sessionId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
