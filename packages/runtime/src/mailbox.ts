/**
 * Mailbox — Principal↔Expert message bus (§5/§9).
 *
 * Single-process model: no fcntl needed. An in-memory per-agent inbox provides
 * real-time delivery; each inbox is also persisted to
 * `.bp/{sid}/mailbox/{agent}.json` so unread messages survive a crash (§12.1).
 *
 * Delivery semantics (ported from legacy `mailbox.py`): reading an inbox
 * atomically drains it (avoids re-delivery). Writes append.
 *
 * Backpressure (#76): an inbox is capped at `MAX_INBOX` messages. A write past
 * the cap throws `MailboxFullError` so the sending tool surfaces the failure to
 * its agent (Pi signals tool failure by throwing) instead of letting a runaway
 * agent↔agent ping-pong grow the inbox without bound.
 */
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export type MsgType =
  | "user_message"
  | "result_deliver"
  | "task_delegate"
  | "trace_event"
  | "system";

export interface MailboxMessage {
  fromAgent: string;
  toAgent: string;
  content: string;
  msgType: MsgType;
  timestamp: number;
}

/** Per-agent inbox capacity (#76). A write past this is rejected. */
export const MAX_INBOX = 20;

/**
 * Default batch limits for one delivery turn (#76). The loop drains at most
 * `BATCH_MAX_MESSAGES`, and stops early once the accumulated content would
 * exceed `BATCH_MAX_CHARS` — except the FIRST message is always taken even if it
 * alone exceeds the budget (so an oversized message is delivered on its own
 * rather than stranded forever).
 */
export const BATCH_MAX_MESSAGES = 3;
export const BATCH_MAX_CHARS = 24_000;

/** Thrown by `write` when the target inbox is at capacity. */
export class MailboxFullError extends Error {
  constructor(readonly agent: string, readonly limit: number) {
    super(`mailbox for "${agent}" is full (limit ${limit}); message rejected`);
    this.name = "MailboxFullError";
  }
}

export class Mailbox {
  private readonly inboxes = new Map<string, MailboxMessage[]>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    readonly sessionId: string,
    private readonly baseDir?: string,
  ) {}

  private inbox(agent: string): MailboxMessage[] {
    let box = this.inboxes.get(agent);
    if (!box) {
      box = [];
      this.inboxes.set(agent, box);
    }
    return box;
  }

  /**
   * Write a message to `toAgent`'s inbox (in-memory + persisted). Throws
   * `MailboxFullError` when the inbox is already at `MAX_INBOX` (#76 backpressure
   * — keeps a runaway ping-pong from growing the inbox without bound).
   */
  async write(msg: Omit<MailboxMessage, "timestamp"> & { timestamp?: number }): Promise<void> {
    const box = this.inbox(msg.toAgent);
    if (box.length >= MAX_INBOX) throw new MailboxFullError(msg.toAgent, MAX_INBOX);
    const full: MailboxMessage = { ...msg, timestamp: msg.timestamp ?? Date.now() };
    box.push(full);
    await this.persist(full.toAgent);
  }

  /** Atomically drain `agent`'s inbox (returns messages, clears the box). */
  async read(agent: string): Promise<MailboxMessage[]> {
    const box = this.inbox(agent);
    const out = box.splice(0, box.length);
    if (out.length > 0) await this.persist(agent);
    return out;
  }

  /**
   * Drain a bounded batch from the FRONT of `agent`'s inbox (#76). Takes up to
   * `maxMessages`, stopping early once including the next message would push the
   * accumulated content past `maxChars` — except the first message is always
   * taken (an oversized message ships alone rather than stranding). Remaining
   * messages stay queued in order for the next turn. FIFO preserved.
   */
  async readBatch(
    agent: string,
    maxMessages = BATCH_MAX_MESSAGES,
    maxChars = BATCH_MAX_CHARS,
  ): Promise<MailboxMessage[]> {
    const box = this.inbox(agent);
    if (box.length === 0) return [];
    const take: MailboxMessage[] = [];
    let chars = 0;
    for (const m of box) {
      if (take.length >= maxMessages) break;
      const next = chars + m.content.length;
      // Always take the first; otherwise respect the char budget.
      if (take.length > 0 && next > maxChars) break;
      take.push(m);
      chars = next;
    }
    box.splice(0, take.length);
    await this.persist(agent);
    return take;
  }

  /** Non-destructive peek. */
  peek(agent: string): readonly MailboxMessage[] {
    return [...this.inbox(agent)];
  }

  count(agent: string): number {
    return this.inbox(agent).length;
  }

  private inboxPath(agent: string): string | undefined {
    if (!this.baseDir) return undefined;
    return join(this.baseDir, `${agent}.json`);
  }

  private async persist(agent: string): Promise<void> {
    const path = this.inboxPath(agent);
    if (!path) return;
    const snapshot = [...this.inbox(agent)];
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(this.baseDir!, { recursive: true });
        await writeFile(path, JSON.stringify(snapshot, null, 2), "utf8");
      })
      .catch(() => {});
    await this.writeChain;
  }

  /** Recover all persisted inboxes from disk into memory (crash recovery). */
  async recover(): Promise<void> {
    if (!this.baseDir) return;
    let files: string[];
    try {
      files = await readdir(this.baseDir);
    } catch {
      return; // no mailbox dir yet
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const agent = f.slice(0, -".json".length);
      try {
        const raw = await readFile(join(this.baseDir, f), "utf8");
        const msgs = JSON.parse(raw) as MailboxMessage[];
        if (Array.isArray(msgs) && msgs.length) this.inboxes.set(agent, msgs);
      } catch {
        // skip corrupt inbox file
      }
    }
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }
}
