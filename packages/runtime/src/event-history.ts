import { open, type FileHandle } from "node:fs/promises";
import type { AgUiEvent } from "@brainpilot/protocol";

// Bounds apply to disk bytes as well as event counts. A single legacy Trace
// snapshot may exceed a page, but can never exceed the separate event bound.
export const HISTORY_PAGE_BYTES = 4 * 1024 * 1024;
export const HISTORY_EVENT_BYTES = 16 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const DEFAULT_LIMIT = 1000;

export class HistoryReadError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 413 | 429) {
    super(message);
  }
}

export interface HistoryPage {
  events: AgUiEvent[];
  /** null until the whole frozen log has been counted; never a guessed total. */
  total: number | null;
  truncated: boolean;
  nextCursor?: string;
}

interface Cursor { offset: number; end: number; count: number; file: string }

function decodeCursor(value: string): Cursor {
  try {
    if (value.length > 512) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (![cursor.offset, cursor.end, cursor.count].every((n) => Number.isSafeInteger(n) && n >= 0)
      || cursor.offset > cursor.end || typeof cursor.file !== "string") throw new Error();
    return cursor;
  } catch {
    throw new HistoryReadError("Invalid history cursor. Reload the session history.", 400);
  }
}

/** Fixed-size reads with a bounded line accumulator; no readFile/split of a log. */
async function* lines(
  file: FileHandle, start: number, end: number, signal?: AbortSignal, skipOversized = false,
): AsyncGenerator<{ text: string; start: number; end: number; bytes: number }> {
  let position = start;
  let lineStart = start;
  let parts: Buffer[] = [];
  let length = 0;
  let oversized = false;
  while (position < end) {
    signal?.throwIfAborted();
    const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, end - position));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, position);
    if (!bytesRead) throw new HistoryReadError("History changed while reading. Reload the session history.", 409);
    let chunkStart = 0;
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] !== 10) continue;
      const part = buffer.subarray(chunkStart, i);
      length += part.length;
      if (length > HISTORY_EVENT_BYTES) oversized = true;
      if (oversized && !skipOversized) throw new HistoryReadError("A history event exceeds the safe read limit (16 MiB). The original log is preserved; compact the oversized event before retrying.", 413);
      if (!oversized) {
        parts.push(part);
        yield { text: Buffer.concat(parts, length).toString("utf8"), start: lineStart, end: position + i + 1, bytes: length + 1 };
      }
      parts = [];
      length = 0;
      oversized = false;
      lineStart = position + i + 1;
      chunkStart = i + 1;
    }
    const tail = buffer.subarray(chunkStart, bytesRead);
    length += tail.length;
    if (length > HISTORY_EVENT_BYTES) {
      if (!skipOversized) throw new HistoryReadError("A history event exceeds the safe read limit (16 MiB). The original log is preserved; compact the oversized event before retrying.", 413);
      oversized = true;
      parts = [];
    } else if (!oversized && tail.length) parts.push(tail);
    position += bytesRead;
  }
  if (length && !oversized) {
    yield { text: Buffer.concat(parts, length).toString("utf8"), start: lineStart, end, bytes: length };
  }
}

function parseEvent(text: string): AgUiEvent | undefined {
  try {
    const event: unknown = JSON.parse(text);
    return event && typeof event === "object" && typeof (event as { type?: unknown }).type === "string"
      ? event as AgUiEvent : undefined;
  } catch { return undefined; }
}

/** `cursor=start` walks forward losslessly. Legacy calls return a bounded tail. */
export async function readHistoryPage(
  path: string, opts: { limit?: number; cursor?: string; signal?: AbortSignal } = {},
): Promise<HistoryPage | undefined> {
  let file: FileHandle;
  try { file = await open(path, "r"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const info = await file.stat();
    const identity = `${info.dev}:${info.ino}:${info.birthtimeMs}`;
    const limit = Number.isFinite(opts.limit) && opts.limit! > 0
      ? Math.max(1, Math.min(Math.floor(opts.limit!), 5000)) : DEFAULT_LIMIT;
    if (opts.cursor !== undefined) {
      const cursor: Cursor = opts.cursor === "start"
        ? { offset: 0, end: info.size, count: 0, file: identity } : decodeCursor(opts.cursor);
      if (cursor.file !== identity || cursor.end > info.size) {
        throw new HistoryReadError("History was replaced or truncated. Reload the session history.", 409);
      }
      if (cursor.offset > 0 && cursor.offset < cursor.end) {
        const previous = Buffer.alloc(1);
        await file.read(previous, 0, 1, cursor.offset - 1);
        if (previous[0] !== 10) throw new HistoryReadError("History cursor is not at an event boundary.", 400);
      }
      const events: AgUiEvent[] = [];
      let offset = cursor.offset;
      let bytes = 0;
      for await (const line of lines(file, offset, cursor.end, opts.signal)) {
        if (bytes > 0 && bytes + line.bytes > HISTORY_PAGE_BYTES) break;
        bytes += line.bytes;
        offset = line.end;
        const event = parseEvent(line.text);
        if (event) events.push(event);
        if (events.length >= limit || bytes >= HISTORY_PAGE_BYTES) break;
      }
      const count = cursor.count + events.length;
      const more = offset < cursor.end;
      return {
        events, total: more ? null : count, truncated: more,
        ...(more ? { nextCursor: Buffer.from(JSON.stringify({ ...cursor, offset, count })).toString("base64url") } : {}),
      };
    }

    // Read at most a byte window from the end, dropping its partial first line.
    // This also bounds work for limit=0 and for callers requesting only one event.
    let start = Math.max(0, info.size - HISTORY_PAGE_BYTES);
    const previous = Buffer.alloc(1);
    if (start) await file.read(previous, 0, 1, start - 1);
    if (start && previous[0] !== 10) {
      const head = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, info.size - start));
      let found = false;
      while (start < info.size) {
        opts.signal?.throwIfAborted();
        const { bytesRead } = await file.read(head, 0, Math.min(head.length, info.size - start), start);
        if (!bytesRead) break;
        const newline = head.subarray(0, bytesRead).indexOf(10);
        if (newline >= 0) { start += newline + 1; found = true; break; }
        start += bytesRead;
      }
      if (!found || start === info.size) {
        // No complete event fits this window; explicit pagination can read a
        // larger individual event within HISTORY_EVENT_BYTES.
        return { events: [], total: null, truncated: true };
      }
    }
    const ring: AgUiEvent[] = [];
    let count = 0;
    for await (const line of lines(file, start, info.size, opts.signal)) {
      const event = parseEvent(line.text);
      if (!event) continue;
      ring[count % limit] = event;
      count++;
    }
    const events = count > limit ? [...ring.slice(count % limit), ...ring.slice(0, count % limit)] : ring;
    return { events, total: start === 0 ? count : null, truncated: start > 0 || count > limit };
  } finally { await file.close(); }
}

/** Restore only request lifecycle metadata, never materialize graph snapshots. */
export async function pendingUserInputs(path: string): Promise<Set<string>> {
  const pending = new Set<string>();
  let file: FileHandle;
  try { file = await open(path, "r"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return pending;
    throw error;
  }
  try {
    const { size } = await file.stat();
    for await (const line of lines(file, 0, size, undefined, true)) {
      if (!/"type"\s*:\s*"user_input_(?:request|response|cancelled)"/.test(line.text)) continue;
      const event = parseEvent(line.text) as unknown as Record<string, unknown> | undefined;
      if (!event) continue;
      const id = event.request_id ?? event.requestId;
      if (typeof id !== "string" || !id) continue;
      if (event.type === "user_input_request") pending.add(id);
      else if (event.type === "user_input_response" || event.type === "user_input_cancelled") pending.delete(id);
    }
    return pending;
  } finally { await file.close(); }
}
