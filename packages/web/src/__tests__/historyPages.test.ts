import { describe, expect, it, vi } from "vitest";
import { normalizeWebSocketEvent } from "../contracts/backend";
import { reduceMessagesForEvent } from "../contexts/messageReducer";
import { consumeHistoryPages, type EventHistoryPage } from "../utils/historyPages";

type Event = Record<string, unknown>;
const message = (type: string, delta?: string): Event => ({
  type,
  session_id: "s",
  message_id: "m",
  role: "assistant",
  agent_name: "principal",
  ...(delta ? { delta } : {}),
});

describe("consumeHistoryPages", () => {
  it("folds START, CONTENT, and END split across pages in order", async () => {
    const pages = new Map<string, EventHistoryPage<Event>>([
      ["start", { events: [message("TEXT_MESSAGE_START")], total: null, truncated: true, nextCursor: "after-start" }],
      ["after-start", { events: [message("TEXT_MESSAGE_CONTENT", "Hello ")], total: null, truncated: true, nextCursor: "after-content" }],
      ["after-content", { events: [message("TEXT_MESSAGE_CONTENT", "world"), message("TEXT_MESSAGE_END")], total: null, truncated: false }],
    ]);
    const fetched: string[] = [];
    let messages: ReturnType<typeof reduceMessagesForEvent> = [];
    await consumeHistoryPages(async (cursor) => {
      fetched.push(cursor);
      return pages.get(cursor)!;
    }, (events) => {
      for (const event of events) messages = reduceMessagesForEvent(messages, normalizeWebSocketEvent(event));
    });
    expect(fetched).toEqual(["start", "after-start", "after-content"]);
    expect(messages).toMatchObject([{ id: "m", content: "Hello world", streaming: false }]);
  });

  it("finishes consuming a page before requesting the next one", async () => {
    const order: string[] = [];
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const fetchPage = vi.fn(async (cursor: string): Promise<EventHistoryPage<number>> => {
      order.push(`fetch:${cursor}`);
      return cursor === "start"
        ? { events: [1], total: null, truncated: true, nextCursor: "next" }
        : { events: [2], total: null, truncated: false };
    });
    const pending = consumeHistoryPages(fetchPage, async (events) => {
      order.push(`consume:${events[0]}`);
      if (events[0] === 1) await barrier;
    });
    await vi.waitFor(() => expect(order).toEqual(["fetch:start", "consume:1"]));
    expect(fetchPage).toHaveBeenCalledTimes(1);
    release();
    await pending;
    expect(order).toEqual(["fetch:start", "consume:1", "fetch:next", "consume:2"]);
  });

  it("rejects an incomplete response with no cursor before consuming it", async () => {
    const consume = vi.fn();
    await expect(consumeHistoryPages(async () => ({
      events: [1], total: null, truncated: true,
    }), consume)).rejects.toThrow(/incomplete history/);
    expect(consume).not.toHaveBeenCalled();
  });

  it("stops on a repeated cursor instead of looping forever", async () => {
    const fetchPage = vi.fn(async () => ({ events: [1], total: null, truncated: true, nextCursor: "start" }));
    await expect(consumeHistoryPages(fetchPage, () => {})).rejects.toThrow(/did not advance/);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("stops before requesting another page after cancellation", async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async () => ({ events: [1], total: null, truncated: true, nextCursor: "next" }));
    await expect(consumeHistoryPages(fetchPage, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("rejects cancellation during an asynchronous final-page consumer", async () => {
    const controller = new AbortController();
    await expect(consumeHistoryPages(
      async () => ({ events: [1], total: 1, truncated: false }),
      async () => { controller.abort(); await Promise.resolve(); },
      controller.signal,
    )).rejects.toMatchObject({ name: "AbortError" });
  });
});
