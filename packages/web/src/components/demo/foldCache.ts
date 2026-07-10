import type { ChatMessage, WebSocketEvent } from "../../contracts/backend";
import { reduceMessagesForEvent } from "../../contexts/messageReducer";

/**
 * Incremental prefix-fold cache for the timestamped Live Demo replay.
 *
 * The player's play loop nudges the cursor every TICK_MS, and folding every
 * event ≤ cursor from scratch on each tick is O(events) per tick → O(events ×
 * frames) across a replay, which drops frames on large sessions. Instead we
 * cache the folded prefix and how many timeline entries it covers, then only
 * fold the newly-crossed events when the cursor advances. When the cursor moves
 * backward (scrub / restart — reduceMessagesForEvent is not reversible) we reset
 * to empty and rebuild once.
 *
 * Extracted as a pure function so the incremental logic is unit-testable without
 * rendering the component (the monorepo has no jsdom / @testing-library).
 */

/** One timeline entry: a normalized event and its resolved timestamp (ms). */
export interface FoldEntry {
  ev: WebSocketEvent;
  ms: number;
}

export interface FoldCache {
  /** Identity of the timeline this cache belongs to (reference-compared). */
  sorted: FoldEntry[];
  /** Number of leading entries already folded into `acc`. */
  count: number;
  /** The folded messages covering the first `count` entries. */
  acc: ChatMessage[];
}

/**
 * Fold all timeline entries with `ms <= cursor`, reusing `prev` when possible.
 * Returns the folded messages plus the next cache to store. Pass the returned
 * cache back as `prev` on the following call to keep the fold incremental.
 */
export function foldUpTo(
  sorted: FoldEntry[],
  cursor: number,
  prev: FoldCache | null,
): { messages: ChatMessage[]; cache: FoldCache } {
  const fresh = prev?.sorted === sorted;
  let count = fresh ? prev!.count : 0;
  let acc: ChatMessage[] = fresh ? prev!.acc : [];
  // The last-folded event now lies past the cursor → the cursor moved backward;
  // the reducer can't undo, so drop back to empty and rebuild from the start.
  if (count > 0 && sorted[count - 1].ms > cursor) {
    count = 0;
    acc = [];
  }
  while (count < sorted.length && sorted[count].ms <= cursor) {
    acc = reduceMessagesForEvent(acc, sorted[count].ev);
    count += 1;
  }
  const cache: FoldCache = { sorted, count, acc };
  return { messages: acc, cache };
}
