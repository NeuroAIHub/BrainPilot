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
    this.buffer.push(event);
    if (this.buffer.length > this.maxBuffer) this.buffer.shift();
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // A misbehaving listener must never break event fan-out.
      }
    }
    if (this.opts.persistPath) this.persist(event);
  }

  private persist(event: AgUiEvent): void {
    const path = this.opts.persistPath!;
    // Serialize writes to avoid interleaving; swallow IO errors (best-effort).
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, JSON.stringify(event) + "\n", "utf8");
      })
      .catch(() => {});
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
