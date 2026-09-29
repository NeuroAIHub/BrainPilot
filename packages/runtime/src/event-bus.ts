/**
 * EventBus — per-session AG-UI event fan-out + optional jsonl persistence.
 *
 * The runtime is the sole producer of AG-UI events. Each SessionManager owns
 * one bus per session; the HTTP SSE endpoint subscribes to stream events to
 * clients. Events are also appended to `events.jsonl` for replay/recovery
 * (§5 file ownership table).
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgUiEvent } from "@brainpilot/protocol";
import type { EventListener } from "./types.js";

export class EventBus {
  private readonly listeners = new Set<EventListener>();
  /** Ring buffer of recent events for late SSE subscribers / replay. */
  private readonly buffer: AgUiEvent[] = [];
  private readonly maxBuffer: number;
  private readonly maxBufferBytes: number;
  private readonly bufferSizes: number[] = [];
  private bufferedBytes = 0;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: { persistPath?: string; maxBuffer?: number; maxBufferBytes?: number } = {},
  ) {
    this.maxBuffer = opts.maxBuffer ?? 500;
    this.maxBufferBytes = opts.maxBufferBytes ?? 2 * 1024 * 1024;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Snapshot of buffered events (for SSE replay on connect). */
  recent(): AgUiEvent[] {
    return [...this.buffer];
  }

  emit(event: AgUiEvent): void {
    this.publish(event);
    if (this.opts.persistPath) void this.enqueuePersist(event).catch(() => {});
  }

  /** Publish to live listeners and the replay ring without appending history. */
  emitEphemeral(event: AgUiEvent): void {
    this.publish(event);
  }

  /** Deliver a compatibility event to connected listeners only. */
  emitLive(event: AgUiEvent): void {
    this.notifyListeners(event);
  }

  /**
   * Persist an event before publishing it. Unlike `emit`, write failures are
   * propagated to the caller so lifecycle endpoints cannot report success for
   * an answer that never reached events.jsonl.
   */
  async emitDurable(event: AgUiEvent): Promise<void> {
    if (this.opts.persistPath) await this.enqueuePersist(event);
    this.publish(event);
  }

  private publish(event: AgUiEvent): void {
    const size = Buffer.byteLength(JSON.stringify(event), "utf8");
    // A large event still reaches live listeners and durable history. The
    // reconnect path seeds current state, so it need not live in this ring.
    if (size <= this.maxBufferBytes && this.maxBuffer > 0) {
      this.buffer.push(event);
      this.bufferSizes.push(size);
      this.bufferedBytes += size;
      while (this.buffer.length > this.maxBuffer || this.bufferedBytes > this.maxBufferBytes) {
        this.buffer.shift();
        this.bufferedBytes -= this.bufferSizes.shift() ?? 0;
      }
    }
    this.notifyListeners(event);
  }

  private notifyListeners(event: AgUiEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A misbehaving listener must never break event fan-out.
      }
    }
  }

  private enqueuePersist(event: AgUiEvent): Promise<void> {
    const path = this.opts.persistPath!;
    // Keep the shared chain alive after a failed write, while returning the
    // unswallowed operation to durable callers.
    const operation = this.writeChain.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, JSON.stringify(event) + "\n", "utf8");
    });
    this.writeChain = operation.catch(() => {});
    return operation;
  }

  /** Await all pending persistence writes (used by emergencySave). */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  clear(): void {
    this.listeners.clear();
    this.buffer.length = 0;
    this.bufferSizes.length = 0;
    this.bufferedBytes = 0;
  }
}
