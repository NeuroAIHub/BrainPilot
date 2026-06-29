import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

/**
 * #165 / #194-B2: history must be readable off disk even after the session has
 * been evicted from memory (idle reaper / runtime restart). Before the fix,
 * `readEventHistory` returned undefined the moment the session left the
 * in-memory map, so a post-refresh rehydrate got a 404 and rendered an empty
 * transcript despite events.jsonl being intact on disk.
 */
describe("readEventHistory disk fallback (#165/#194-B2)", () => {
  let dataRoot: string;
  let m: SessionManager;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "bp-history-"));
    m = new SessionManager({ persist: true, dataRoot, agentFactory: mockAgentFactory });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it("serves persisted history after the session is evicted from memory", async () => {
    const s = await m.createSession({ title: "Evicted" });
    const events: AgUiEvent[] = [];
    const unsub = m.subscribe(s.id, (e) => events.push(e));
    const res = await m.sendMessage(s.id, "hello principal");
    expect(res.accepted).toBe(true);
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));
    unsub?.();

    // Evict from memory — evictSession flushes the persist write-chain first, so
    // the disk transcript is complete and must survive the in-memory drop.
    const { evicted } = await m.evictSession(s.id);
    expect(evicted).toBe(true);
    expect(m.getSession(s.id)).toBeUndefined();

    // The whole point: history still resolves from disk (not undefined/404),
    // with the full transcript that was emitted during the run.
    const afterEvict = await m.readEventHistory(s.id, { limit: 0 });
    expect(afterEvict).toBeDefined();
    expect(afterEvict!.events.length).toBeGreaterThan(0);
    expect(afterEvict!.total).toBe(afterEvict!.events.length);
    expect(afterEvict!.events.some((e) => e.type === "RUN_FINISHED")).toBe(true);
  });

  it("returns undefined for a session with no transcript on disk", async () => {
    const missing = await m.readEventHistory("does-not-exist", { limit: 0 });
    expect(missing).toBeUndefined();
  });

  it("non-persisting manager still returns undefined for unknown sessions", async () => {
    const mem = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const r = await mem.readEventHistory("whoever", { limit: 0 });
    expect(r).toBeUndefined();
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
