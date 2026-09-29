export interface EventHistoryPage<T> {
  events: T[];
  total: number | null;
  truncated: boolean;
  nextCursor?: string;
}

/** The endpoint returned a sliced tail but cannot continue from a cursor. */
export class HistoryPaginationUnavailableError extends Error {
  constructor() {
    super("The server returned incomplete history. Update the server to load the full conversation safely.");
    this.name = "HistoryPaginationUnavailableError";
  }
}

/** Consume and release each page before asking for more. Cursor freezes EOF. */
export async function consumeHistoryPages<T>(
  fetchPage: (cursor: string) => Promise<EventHistoryPage<T>>,
  consume: (events: T[]) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let cursor = "start";
  const seen = new Set<string>();
  for (;;) {
    signal?.throwIfAborted();
    if (seen.has(cursor)) throw new Error("History pagination did not advance. Reload the session.");
    seen.add(cursor);
    const page = await fetchPage(cursor);
    signal?.throwIfAborted();
    if (page.truncated && !page.nextCursor) {
      throw new HistoryPaginationUnavailableError();
    }
    await consume(page.events);
    signal?.throwIfAborted();
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}
