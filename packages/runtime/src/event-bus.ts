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
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly opts: { persistPath?: string; maxBuffer?: number } = {},
  ) {
    this.maxBuffer = opts.maxBuffer ?? 500;
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
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
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
  }
}
