/**
 * Mailbox — Principal↔Expert message bus (§5/§9).
 *
 * Single-process model: no fcntl needed. An in-memory per-agent inbox provides
 * real-time delivery; each inbox is also persisted to
 * `.bp/{sid}/mailbox/{agent}.json` so unread messages survive a crash (§12.1).
 *
 * Delivery semantics (ported from legacy `mailbox.py`): reading an inbox
 * atomically drains it (avoids re-delivery). Writes append.
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

  /** Write a message to `toAgent`'s inbox (in-memory + persisted). */
  async write(msg: Omit<MailboxMessage, "timestamp"> & { timestamp?: number }): Promise<void> {
    const full: MailboxMessage = { ...msg, timestamp: msg.timestamp ?? Date.now() };
    this.inbox(full.toAgent).push(full);
    await this.persist(full.toAgent);
  }

  /** Atomically drain `agent`'s inbox (returns messages, clears the box). */
  async read(agent: string): Promise<MailboxMessage[]> {
    const box = this.inbox(agent);
    const out = box.splice(0, box.length);
    if (out.length > 0) await this.persist(agent);
    return out;
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
