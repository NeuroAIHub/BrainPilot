/**
 * Per-session token usage accounting. The runtime reads the provider-reported
 * `usage` off each assistant `message_end` (the mock agent injects deterministic
 * counters), accumulates a whole-session total + per-agent breakdown, surfaces
 * it on `session_state` frames and `getSessionState`, and persists it to
 * `.bp/<id>/usage.json` so the running total survives a restart.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";
import { addUsage, emptyTokenUsage } from "../mas-agent.js";

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("session token usage", () => {
  it("addUsage sums components into total and tolerates missing fields", () => {
    const acc = emptyTokenUsage();
    addUsage(acc, { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 99 });
    expect(acc).toEqual({ input: 10, output: 5, cacheRead: 2, cacheWrite: 1, total: 18 });
    addUsage(acc, { input: 4 }); // missing fields count as 0
    expect(acc).toEqual({ input: 14, output: 5, cacheRead: 2, cacheWrite: 1, total: 22 });
    addUsage(acc, undefined); // no-op
    expect(acc.total).toBe(22);
  });

  it("accumulates real usage and exposes it on session_state", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();

    expect(m.getSessionState(s.id)!.tokenUsage.total.total).toBe(0);

    await m.sendMessage(s.id, "hello");
    await waitFor(() => m.listAgents(s.id)[0]?.status === "idle");

    const usage = m.getSessionState(s.id)!.tokenUsage;
    expect(usage.byAgent.principal).toBeDefined();
    expect(usage.byAgent.principal!.input).toBeGreaterThan(0);
    expect(usage.byAgent.principal!.output).toBeGreaterThan(0);
    // Session total equals the sum across agents.
    expect(usage.total.total).toBe(
      Object.values(usage.byAgent).reduce((s, u) => s + u.total, 0),
    );
    expect(usage.total.total).toBeGreaterThan(0);
  });

  it("session_state frames carry the running tokenUsage", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();
    const totals: number[] = [];
    m.subscribe(s.id, (e) => {
      if (e.type === "CUSTOM" && (e as { name?: string }).name === "session_state") {
        const v = (e as { value?: { tokenUsage?: { total?: { total?: number } } } }).value;
        if (v?.tokenUsage?.total?.total !== undefined) totals.push(v.tokenUsage.total.total);
      }
    });
    await m.sendMessage(s.id, "hello world");
    await waitFor(() => totals.some((t) => t > 0));
    expect(Math.max(...totals)).toBeGreaterThan(0);
  });

  it("persists usage.json and restores the cumulative total", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-usage-"));
    const m1 = new SessionManager({ dataRoot, agentFactory: mockAgentFactory });
    const s = await m1.createSession();
    await m1.sendMessage(s.id, "first message");
    await waitFor(() => m1.listAgents(s.id)[0]?.status === "idle");
    const before = m1.getSessionState(s.id)!.tokenUsage.total.total;
    expect(before).toBeGreaterThan(0);

    // usage.json is persisted (write is fire-and-forget; poll for it).
    const usagePath = join(dataRoot, ".bp", s.id, "usage.json");
    let raw = "";
    await waitFor(() => {
      try {
        raw = readFileSync(usagePath, "utf8");
        return JSON.parse(raw).total.total === before;
      } catch {
        return false;
      }
    });
    expect(JSON.parse(raw).total.total).toBe(before);

    // Fresh manager restores the same cumulative total.
    const m2 = new SessionManager({ dataRoot, agentFactory: mockAgentFactory });
    await m2.restoreFromDisk();
    expect(m2.getSessionState(s.id)!.tokenUsage.total.total).toBe(before);

    // A new turn keeps accumulating on top of the restored total.
    await m2.sendMessage(s.id, "second message");
    await waitFor(() => m2.listAgents(s.id)[0]?.status === "idle");
    expect(m2.getSessionState(s.id)!.tokenUsage.total.total).toBeGreaterThan(before);
  });
});
