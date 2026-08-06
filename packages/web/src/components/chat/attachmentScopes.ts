import { useCallback, useSyncExternalStore } from "react";

export type AttachmentsBySession = Record<string, string[]>;

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

class AttachmentStore {
  private values: AttachmentsBySession = {};
  private listeners = new Map<string, Set<() => void>>();

  get(sessionId: string): string[] {
    return this.values[sessionId] ?? [];
  }

  private update(sessionId: string, next: AttachmentsBySession): void {
    if (next === this.values) return;
    this.values = next;
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
    this.listeners.get(sessionId)?.forEach((listener) => listener());
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

const EMPTY_ATTACHMENTS: string[] = [];
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
