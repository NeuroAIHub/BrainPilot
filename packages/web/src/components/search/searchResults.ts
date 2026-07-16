/**
 * Pure helpers for conversation search results (#315).
 */

export type SearchSession = {
  id: string;
  title: string;
  updatedAt: string;
};

/** True when more than one session shares this title (case-sensitive as stored). */
export function titleCollisionIds(sessions: SearchSession[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    counts.set(s.title, (counts.get(s.title) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const s of sessions) {
    if ((counts.get(s.title) ?? 0) > 1) out.add(s.id);
  }
  return out;
}

/** Short id fragment for disambiguating same-title rows. */
export function shortSessionId(id: string, len = 8): string {
  const trimmed = id.trim();
  if (trimmed.length <= len) return trimmed;
  return trimmed.slice(0, len);
}

export type SearchResultMeta = {
  showShortId: boolean;
  shortId: string;
};

export function searchResultMeta(
  session: SearchSession,
  collisions: Set<string>,
): SearchResultMeta {
  const showShortId = collisions.has(session.id);
  return {
    showShortId,
    shortId: shortSessionId(session.id),
  };
}

/**
 * Clamp active index into [0, length-1], or -1 when the list is empty.
 */
export function clampActiveIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/**
 * Move highlight for ArrowUp / ArrowDown. Wraps at ends.
 */
export function moveActiveIndex(
  current: number,
  length: number,
  direction: "up" | "down",
): number {
  if (length <= 0) return -1;
  const base = current < 0 ? (direction === "down" ? -1 : 0) : current;
  if (direction === "down") {
    return (base + 1) % length;
  }
  return (base - 1 + length) % length;
}

export function filterSessionsByQuery(
  sessions: SearchSession[],
  query: string,
): SearchSession[] {
  const q = query.trim().toLowerCase();
  if (!q) return sessions;
  return sessions.filter((s) => s.title.toLowerCase().includes(q));
}
