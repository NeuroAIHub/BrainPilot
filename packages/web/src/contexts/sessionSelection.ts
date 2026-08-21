/**
 * Pure helpers for session-list readiness and restore-on-reload (#324).
 *
 * Prevents the empty-session draft effect from racing an in-flight
 * session-list request, and restores a persisted previous selection
 * (or a documented fallback) once the list is ready.
 */

export type SessionsListStatus = "idle" | "loading" | "ready" | "error";

export const LAST_SESSION_STORAGE_KEY = "bp.web.lastSessionId";

export interface SessionRef {
  id: string;
}

export interface ResolveSessionSelectionInput {
  listStatus: SessionsListStatus;
  /** Caller should pass the list sorted as displayed (e.g. updatedAt desc). */
  sessions: SessionRef[];
  /** Persisted last selection from localStorage (may be stale). */
  preferredId: string | null;
  currentSessionId: string | null;
  isDraft: boolean;
  /** A browser-persisted new-conversation draft should win on page reload. */
  hasRecoverableDraft?: boolean;
}

export interface ResolveSessionSelectionResult {
  sessionId: string | null;
  isDraft: boolean;
}

/**
 * Decide which conversation to show after a session-list read.
 *
 * Rules (list must be ready or error-with-empty fallback):
 * - Preserve an intentional draft (isDraft && no current id).
 * - Empty list → draft only when list is ready.
 * - Keep current id if it still exists.
 * - Else restore preferredId if still in the list.
 * - Else fall back to sessions[0] (documented: most-recent when sorted).
 * - While list is idle/loading: do not change selection / do not invent draft.
 */
export function resolveSessionSelection(
  input: ResolveSessionSelectionInput,
): ResolveSessionSelectionResult {
  const { listStatus, sessions, preferredId, currentSessionId, isDraft, hasRecoverableDraft = false } = input;

  if (listStatus === "idle" || listStatus === "loading") {
    return { sessionId: currentSessionId, isDraft };
  }

  // Intentional new-conversation draft after the list is known — don't yank.
  if (isDraft && currentSessionId == null) {
    return { sessionId: null, isDraft: true };
  }

  // On a fresh page load currentSessionId is null. Prefer a recoverable
  // new-conversation draft over reopening the last persisted session.
  if (hasRecoverableDraft && currentSessionId == null) {
    return { sessionId: null, isDraft: true };
  }

  if (sessions.length === 0) {
    // Ready with no conversations: only path that auto-opens a draft.
    // Error with empty list: stay non-draft so the user sees the error path.
    if (listStatus === "ready") {
      return { sessionId: null, isDraft: true };
    }
    return { sessionId: null, isDraft: false };
  }

  const ids = new Set(sessions.map((s) => s.id));

  if (currentSessionId && ids.has(currentSessionId)) {
    return { sessionId: currentSessionId, isDraft: false };
  }

  if (preferredId && ids.has(preferredId)) {
    return { sessionId: preferredId, isDraft: false };
  }

  return { sessionId: sessions[0]!.id, isDraft: false };
}

/**
 * Whether the empty-session draft effect may run.
 * Never true until the session list has finished successfully.
 */
export function shouldAutoStartDraft(
  listStatus: SessionsListStatus,
  sessionsLength: number,
  currentSessionId: string | null,
  isDraft: boolean,
  sandboxRunning: boolean,
): boolean {
  return (
    listStatus === "ready" &&
    sessionsLength === 0 &&
    currentSessionId == null &&
    !isDraft &&
    sandboxRunning
  );
}

export function loadLastSessionId(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LAST_SESSION_STORAGE_KEY);
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

export function saveLastSessionId(
  sessionId: string,
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
): void {
  if (!storage || !sessionId) return;
  try {
    storage.setItem(LAST_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Quota / private mode — selection still works for this page load.
  }
}

export function clearLastSessionId(
  storage: Pick<Storage, "removeItem"> | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(LAST_SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }
  return window.localStorage;
}
