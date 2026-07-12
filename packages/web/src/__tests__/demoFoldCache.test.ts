import { describe, expect, it } from "vitest";
import type { ChatMessage, WebSocketEvent } from "../contracts/backend";
import { reduceMessagesForEvent } from "../contexts/messageReducer";
import { foldUpTo, type FoldEntry } from "../components/demo/foldCache";

/**
 * The incremental fold cache must produce EXACTLY what a from-scratch fold of
 * every event ≤ cursor would produce, for any cursor and any sequence of cursor
 * moves (forward during playback, backward on scrub/restart). These tests pin
 * that equivalence plus the incremental behaviour (#2 replay perf).
 */

function startEnd(id: string, text: string, ms: number): FoldEntry[] {
  return [
    { ms, ev: { type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" } as unknown as WebSocketEvent },
    { ms, ev: { type: "TEXT_MESSAGE_CONTENT", messageId: id, delta: text } as unknown as WebSocketEvent },
  ];
}

const sorted: FoldEntry[] = [
  ...startEnd("a", "hello", 10),
  ...startEnd("b", "world", 20),
  ...startEnd("c", "again", 30),
];

/** Reference implementation: fold everything ≤ cursor from scratch. */
function foldFromScratch(entries: FoldEntry[], cursor: number): ChatMessage[] {
  let acc: ChatMessage[] = [];
  for (const { ev, ms } of entries) {
    if (ms > cursor) break;
    acc = reduceMessagesForEvent(acc, ev);
  }
  return acc;
}

/**
 * The reducer stamps `createdAt` with the wall clock at fold time, so two folds
 * of the same events run a millisecond apart differ only on that field. Strip it
 * before comparing the incremental fold against the from-scratch reference.
 */
function stable(messages: ChatMessage[]): Array<Omit<ChatMessage, "createdAt">> {
  return messages.map(({ createdAt: _createdAt, ...rest }) => rest);
}

describe("foldUpTo (incremental demo replay fold)", () => {
  it("matches a from-scratch fold at every cursor value", () => {
    for (const cursor of [0, 5, 10, 15, 20, 25, 30, 100]) {
      const { messages } = foldUpTo(sorted, cursor, null);
      expect(stable(messages)).toEqual(stable(foldFromScratch(sorted, cursor)));
    }
  });

  it("advances incrementally without re-folding the whole prefix", () => {
    let cache = foldUpTo(sorted, 10, null).cache;
    expect(cache.count).toBe(2); // both events at ms=10 folded
    const step = foldUpTo(sorted, 20, cache);
    expect(step.cache.count).toBe(4); // only the two ms=20 events added
    expect(stable(step.messages)).toEqual(stable(foldFromScratch(sorted, 20)));
    cache = step.cache;
  });

  it("reuses the cache (no growth) when the cursor does not cross a new event", () => {
    const first = foldUpTo(sorted, 20, null);
    const again = foldUpTo(sorted, 22, first.cache);
    expect(again.cache.count).toBe(first.cache.count);
    expect(stable(again.messages)).toEqual(stable(first.messages));
  });

  it("rebuilds correctly when the cursor moves backward", () => {
    const forward = foldUpTo(sorted, 30, null);
    expect(forward.cache.count).toBe(6);
    const backward = foldUpTo(sorted, 10, forward.cache);
    expect(backward.cache.count).toBe(2);
    expect(stable(backward.messages)).toEqual(stable(foldFromScratch(sorted, 10)));
  });

  it("drops to empty when the cursor rewinds before the first event", () => {
    const forward = foldUpTo(sorted, 30, null);
    const rewound = foldUpTo(sorted, 0, forward.cache);
    expect(rewound.messages).toEqual([]);
    expect(rewound.cache.count).toBe(0);
  });

  it("restarts from scratch when the timeline identity changes", () => {
    const cache = foldUpTo(sorted, 30, null).cache;
    const other: FoldEntry[] = startEnd("z", "new", 5);
    const res = foldUpTo(other, 30, cache);
    expect(stable(res.messages)).toEqual(stable(foldFromScratch(other, 30)));
    expect(res.cache.sorted).toBe(other);
  });
});
