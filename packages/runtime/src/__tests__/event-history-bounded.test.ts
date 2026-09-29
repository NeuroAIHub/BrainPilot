import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFile, mkdtemp, rename, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HISTORY_EVENT_BYTES,
  HISTORY_PAGE_BYTES,
  pendingUserInputs,
  readHistoryPage,
} from "../event-history.js";

const event = (id: number, delta = `message-${id}`) =>
  JSON.stringify({ type: "TEXT_MESSAGE_CHUNK", message_id: `m-${id}`, delta });

describe("bounded event history", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bp-bounded-history-"));
    path = join(dir, "events.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("uses a bounded tail for limit=0 and a chronological positive-limit tail", async () => {
    await writeFile(path, Array.from({ length: 6 }, (_, i) => event(i)).join("\n") + "\n");
    const all = await readHistoryPage(path, { limit: 0 });
    expect(all?.events.map((item) => item.message_id)).toEqual(
      Array.from({ length: 6 }, (_, i) => `m-${i}`),
    );
    expect(all).toMatchObject({ total: 6, truncated: false });
    const tail = await readHistoryPage(path, { limit: 2 });
    expect(tail?.events.map((item) => item.message_id)).toEqual(["m-4", "m-5"]);
    expect(tail).toMatchObject({ total: 6, truncated: true });
  });

  it("walks every event boundary, skips malformed lines, and freezes EOF across append", async () => {
    const unicode = "a".repeat(65_530) + "汉🧠"; // crosses a 64 KiB read boundary
    await writeFile(path, [event(0), "{broken", event(1, unicode), event(2)].join("\n") + "\n");
    const first = await readHistoryPage(path, { cursor: "start", limit: 1 });
    expect(first?.events.map((item) => item.message_id)).toEqual(["m-0"]);
    expect(first).toMatchObject({ total: null, truncated: true });
    expect(first?.nextCursor).toEqual(expect.any(String));
    await appendFile(path, event(3) + "\n");

    const events = [...first!.events];
    let cursor = first!.nextCursor;
    let last = first!;
    while (cursor) {
      last = (await readHistoryPage(path, { cursor, limit: 1 }))!;
      events.push(...last.events);
      cursor = last.nextCursor;
    }
    expect(events.map((item) => item.message_id)).toEqual(["m-0", "m-1", "m-2"]);
    expect(events[1]!.delta).toBe(unicode);
    expect(last).toMatchObject({ total: 3, truncated: false });
    expect((await readHistoryPage(path, { limit: 1 }))?.events[0]?.message_id).toBe("m-3");
  });

  it("keeps a complete event starting exactly at the tail byte boundary", async () => {
    const overhead = Buffer.byteLength(event(1, "") + "\n");
    const last = event(1, "x".repeat(HISTORY_PAGE_BYTES - overhead)) + "\n";
    await writeFile(path, event(0) + "\n" + last);
    const page = await readHistoryPage(path, { limit: 1 });
    expect(page?.events).toHaveLength(1);
    expect(page?.events[0]?.message_id).toBe("m-1");
    expect(page?.truncated).toBe(true);
  });

  it("rejects replaced and truncated logs with 409", async () => {
    await writeFile(path, event(0) + "\n" + event(1) + "\n");
    const page = (await readHistoryPage(path, { cursor: "start", limit: 1 }))!;
    const replacement = join(dir, "replacement.jsonl");
    await writeFile(replacement, event(9) + "\n");
    await rename(replacement, path);
    await expect(readHistoryPage(path, { cursor: page.nextCursor })).rejects.toMatchObject({ status: 409 });

    await writeFile(path, event(0) + "\n" + event(1) + "\n");
    const another = (await readHistoryPage(path, { cursor: "start", limit: 1 }))!;
    await truncate(path, 1);
    await expect(readHistoryPage(path, { cursor: another.nextCursor })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects malformed and non-boundary cursors with 400", async () => {
    await writeFile(path, event(0) + "\n" + event(1) + "\n");
    await expect(readHistoryPage(path, { cursor: "not-base64-json" })).rejects.toMatchObject({ status: 400 });
    const page = (await readHistoryPage(path, { cursor: "start", limit: 1 }))!;
    const parsed = JSON.parse(Buffer.from(page.nextCursor!, "base64url").toString("utf8"));
    parsed.offset += 1;
    const midEvent = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    await expect(readHistoryPage(path, { cursor: midEvent })).rejects.toMatchObject({ status: 400 });
  });

  it("rejects an oversized event with 413 while keeping its file", async () => {
    await writeFile(path, event(0, "x".repeat(HISTORY_EVENT_BYTES)) + "\n");
    await expect(readHistoryPage(path, { cursor: "start" })).rejects.toMatchObject({ status: 413 });
    expect(await readHistoryPage(path, { limit: 1 })).toMatchObject({ events: [], total: null, truncated: true });
  });

  it("returns a whole event larger than the page byte target", async () => {
    const delta = "x".repeat(4 * 1024 * 1024 + 1);
    await writeFile(path, event(0, delta) + "\n" + event(1) + "\n");
    const first = (await readHistoryPage(path, { cursor: "start", limit: 2 }))!;
    expect(first.events).toHaveLength(1);
    expect(first.events[0]?.delta).toBe(delta);
    expect(first).toMatchObject({ total: null, truncated: true });
    const second = (await readHistoryPage(path, { cursor: first.nextCursor }))!;
    expect(second.events.map((item) => item.message_id)).toEqual(["m-1"]);
    expect(second).toMatchObject({ total: 2, truncated: false });
  });

  it("honors abort and leaves the file readable for a later request", async () => {
    await writeFile(path, event(0) + "\n");
    const controller = new AbortController();
    controller.abort();
    await expect(readHistoryPage(path, { cursor: "start", signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect((await readHistoryPage(path, { cursor: "start" }))?.events).toHaveLength(1);
  });

  it("restores pending requests without interpreting trace snapshots as requests", async () => {
    await writeFile(path, [
      JSON.stringify({ type: "trace_snapshot", nodes: [{ type: "user_input_request", request_id: "nested" }] }),
      JSON.stringify({ type: "trace_snapshot", payload: "x".repeat(HISTORY_EVENT_BYTES) }),
      JSON.stringify({ type: "user_input_request", request_id: "answered" }),
      JSON.stringify({ type: "user_input_request", requestId: "cancelled" }),
      JSON.stringify({ type: "user_input_request", request_id: "still-pending" }),
      JSON.stringify({ type: "user_input_response", request_id: "answered" }),
      JSON.stringify({ type: "user_input_cancelled", requestId: "cancelled" }),
      "{broken",
    ].join("\n") + "\n");
    expect(await pendingUserInputs(path)).toEqual(new Set(["still-pending"]));
  });

  it("returns undefined for a missing log and an empty pending set", async () => {
    expect(await readHistoryPage(path, { cursor: "start" })).toBeUndefined();
    expect(await pendingUserInputs(path)).toEqual(new Set());
  });
});
