import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgUiEvent } from "@brainpilot/protocol";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";

/**
 * #223: a persisted session dropped by `evictSession` (idle reaper) must stay
 * DISCOVERABLE (listSessions) and REVIVABLE (ensureLoaded → messages/state),
 * not just history-readable (#197). Before the fix, `listSessions` returned only
 * the in-memory map, so a refreshed sidebar lost the session entirely, and even
 * if the id was known, `sendMessage`/`getSessionState`/SSE all 404'd.
 */
describe("evicted-session rediscovery + revival (#223)", () => {
  let dataRoot: string;
  let m: SessionManager;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), "bp-rediscover-"));
    m = new SessionManager({ persist: true, dataRoot, agentFactory: mockAgentFactory });
  });

  afterEach(async () => {
    // Evict every live session first so agent threads stop and their persist
    // write-chain (mailbox/trace/usage) is flushed before we remove the dir —
    // otherwise a background write races `rm` and throws ENOTEMPTY.
    for (const s of await m.listSessions()) await m.evictSession(s.id);
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function runOnce(title: string): Promise<string> {
    const s = await m.createSession({ title });
    const events: AgUiEvent[] = [];
    const unsub = m.subscribe(s.id, (e) => events.push(e));
    await m.sendMessage(s.id, "hello principal");
    await waitFor(() => events.some((e) => e.type === "RUN_FINISHED"));
    unsub?.();
    return s.id;
  }

  it("listSessions still includes an evicted session (disk discovery)", async () => {
    const id = await runOnce("Discover me");
    expect((await m.listSessions()).map((s) => s.id)).toContain(id);

    await m.evictSession(id);
    expect(m.getSession(id)).toBeUndefined();

    const listed = await m.listSessions();
    const found = listed.find((s) => s.id === id);
    expect(found).toBeDefined();
    expect(found!.title).toBe("Discover me");
  });

  it("listSessions dedups a live session against its disk copy", async () => {
    const id = await runOnce("No dupes");
    const listed = await m.listSessions();
    expect(listed.filter((s) => s.id === id)).toHaveLength(1);
  });

  it("ensureLoaded revives an evicted session so state + messages work again", async () => {
    const id = await runOnce("Revive me");
    await m.evictSession(id);
    expect(m.getSessionState(id)).toBeUndefined();

    const ok = await m.ensureLoaded(id);
    expect(ok).toBe(true);
    expect(m.getSessionState(id)).toBeDefined();

    // A revived session accepts a new message (would throw "session not found"
    // pre-fix, since evict dropped it from the in-memory map).
    const res = await m.sendMessage(id, "second turn");
    expect(res.accepted).toBe(true);
  });

  it("concurrent ensureLoaded for the same id restores exactly once", async () => {
    const id = await runOnce("Race me");
    await m.evictSession(id);

    const [a, b, c] = await Promise.all([
      m.ensureLoaded(id),
      m.ensureLoaded(id),
      m.ensureLoaded(id),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
    // A double restore would have duplicated the session; the map holds one.
    expect((await m.listSessions()).filter((s) => s.id === id)).toHaveLength(1);
  });

  it("ensureLoaded returns false for an unknown session", async () => {
    expect(await m.ensureLoaded("does-not-exist")).toBe(false);
  });

  it("non-persisting manager cannot revive (no disk backing)", async () => {
    const mem = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    expect(await mem.ensureLoaded("whoever")).toBe(false);
  });
});

async function waitFor(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}
