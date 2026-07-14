/**
 * Per-run + per-session usage stats: tool counters, skill counters (three
 * `skill_search` sub-modes), error counters, per-run deltas, and persistence to
 * `.bp/<id>/stats.json` with rehydrate on restart.
 *
 * Two layers of coverage:
 *   1. Pure helpers (`usage-stats.ts`) — arithmetic on POJOs, no I/O.
 *   2. End-to-end through SessionManager + MockAgentSession — drives the same
 *      Pi-shaped event stream the real runtime consumes.
 */
import { describe, it, expect } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventBus } from "../event-bus.js";
import { MasAgent } from "../mas-agent.js";
import { MockAgentSession } from "../mock-agent.js";
import { SessionManager } from "../session-manager.js";
import { mockAgentFactory } from "../agent-factory.js";
import {
  addStatsDelta,
  cloneAgentStats,
  emptyAgentStats,
  recordSkillCall,
  SKILL_SEARCH_KEY,
  subtractAgentStats,
} from "../usage-stats.js";
import type { AgentStats } from "@brainpilot/protocol";

async function waitFor(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("usage-stats helpers", () => {
  it("emptyAgentStats is a zeroed identity element", () => {
    const s = emptyAgentStats();
    expect(s.tokens.total).toBe(0);
    expect(s.tools).toEqual({});
    expect(s.skills).toEqual({});
    expect(s.errors).toEqual({});
  });

  it("cloneAgentStats deep-copies (no shared references)", () => {
    const s = emptyAgentStats();
    s.tools.read = 3;
    s.skills["foo"] = { queries: 1, loads: 2, browses: 0 };
    const c = cloneAgentStats(s);
    c.tools.read = 99;
    (c.skills["foo"] as { loads: number }).loads = 99;
    expect(s.tools.read).toBe(3);
    expect(s.skills["foo"]!.loads).toBe(2);
  });

  it("addStatsDelta folds tool/skill/error counters and tokens", () => {
    const acc = emptyAgentStats();
    const d: AgentStats = {
      tokens: { input: 5, output: 3, cacheRead: 1, cacheWrite: 0, total: 9 },
      tools: { read: 2, bash: 1 },
      skills: { foo: { queries: 1, loads: 1, browses: 0 } },
      errors: { bash: 1 },
    };
    addStatsDelta(acc, d);
    addStatsDelta(acc, d);
    expect(acc.tokens.input).toBe(10);
    expect(acc.tokens.total).toBe(18); // recomputed from components
    expect(acc.tools).toEqual({ read: 4, bash: 2 });
    expect(acc.skills["foo"]).toEqual({ queries: 2, loads: 2, browses: 0 });
    expect(acc.errors).toEqual({ bash: 2 });
  });

  it("subtractAgentStats returns non-negative deltas", () => {
    const a = emptyAgentStats();
    a.tools.read = 5;
    a.errors.bash = 1;
    a.skills["foo"] = { queries: 2, loads: 1, browses: 0 };
    a.tokens = { input: 10, output: 4, cacheRead: 0, cacheWrite: 0, total: 14 };
    const b = emptyAgentStats();
    b.tools.read = 3;
    b.skills["foo"] = { queries: 1, loads: 0, browses: 0 };
    b.tokens = { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, total: 4 };
    const d = subtractAgentStats(a, b);
    expect(d.tools).toEqual({ read: 2 });
    expect(d.errors).toEqual({ bash: 1 });
    expect(d.skills["foo"]).toEqual({ queries: 1, loads: 1, browses: 0 });
    expect(d.tokens.total).toBe(10);
  });

  describe("recordSkillCall (skill_search args → counters)", () => {
    it("mode=query + skill_name → loads on that skill", () => {
      const s: Record<string, { queries: number; loads: number; browses: number }> = {};
      recordSkillCall(s, { mode: "query", skill_name: "brainstorming" });
      expect(s["brainstorming"]).toEqual({ queries: 0, loads: 1, browses: 0 });
    });

    it("mode=query + keywords only → __search__ queries", () => {
      const s: Record<string, { queries: number; loads: number; browses: number }> = {};
      recordSkillCall(s, { mode: "query", keywords: "how to brainstorm" });
      expect(s[SKILL_SEARCH_KEY]).toEqual({ queries: 1, loads: 0, browses: 0 });
    });

    it("mode=browse + relative_path → derived skill name browses", () => {
      const s: Record<string, { queries: number; loads: number; browses: number }> = {};
      recordSkillCall(s, { mode: "browse", relative_path: "research/brainstorming/SKILL.md" });
      expect(s["brainstorming"]).toEqual({ queries: 0, loads: 0, browses: 1 });
    });

    it("malformed args (JSON parse fails) → __search__ queries, no throw", () => {
      const s: Record<string, { queries: number; loads: number; browses: number }> = {};
      // Pass a garbage string that isn't valid JSON.
      expect(() => recordSkillCall(s, "not { json")).not.toThrow();
      expect(s[SKILL_SEARCH_KEY]).toEqual({ queries: 1, loads: 0, browses: 0 });
    });

    it("unknown sub-mode → __search__ queries, no drop", () => {
      const s: Record<string, { queries: number; loads: number; browses: number }> = {};
      recordSkillCall(s, { mode: "weird", something: "else" });
      expect(s[SKILL_SEARCH_KEY]).toEqual({ queries: 1, loads: 0, browses: 0 });
    });

    it("accepts a JSON-encoded string too", () => {
      const s: Record<string, { queries: number; loads: number; browses: number }> = {};
      recordSkillCall(s, JSON.stringify({ mode: "query", skill_name: "foo" }));
      expect(s["foo"]).toEqual({ queries: 0, loads: 1, browses: 0 });
    });
  });
});

describe("MasAgent stats (unit)", () => {
  it("counts tool invocations per name and marks errors additively", async () => {
    const bus = new EventBus();
    const session = new MockAgentSession({
      sessionId: "s-tools",
      agentName: "principal",
      scriptText: "ok",
      systemTools: [
        {
          name: "ping",
          description: "",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [{ type: "text", text: "pong" }] }),
        },
        {
          name: "boom",
          description: "",
          parameters: { type: "object", properties: {} },
          execute: async () => ({
            isError: true,
            content: [{ type: "text", text: "kaboom" }],
          }),
        },
      ],
    });
    const agent = new MasAgent({
      sessionId: "s-tools",
      name: "principal",
      role: "principal",
      session,
      bus,
    });
    await agent.prompt("do it [[tool:ping {}]]");
    await agent.prompt("again [[tool:ping {}]]");
    await agent.prompt("fail  [[tool:boom {}]]");
    const s = agent.stats();
    expect(s.tools.ping).toBe(2);
    expect(s.tools.boom).toBe(1);
    expect(s.errors.boom).toBe(1);
    expect(s.errors.ping).toBeUndefined();
  });

  it("classifies skill_search sub-modes", async () => {
    const bus = new EventBus();
    const session = new MockAgentSession({
      sessionId: "s-skills",
      agentName: "principal",
      scriptText: "ok",
      systemTools: [
        {
          name: "skill_search",
          description: "",
          parameters: { type: "object", properties: {} },
          execute: async () => ({ content: [{ type: "text", text: "results" }] }),
        },
      ],
    });
    const agent = new MasAgent({
      sessionId: "s-skills",
      name: "principal",
      role: "principal",
      session,
      bus,
    });
    await agent.prompt(
      'load [[tool:skill_search {"mode":"query","skill_name":"brainstorming"}]]',
    );
    await agent.prompt(
      'search [[tool:skill_search {"mode":"query","keywords":"how to plan"}]]',
    );
    await agent.prompt(
      'browse [[tool:skill_search {"mode":"browse","relative_path":"cat/foo/SKILL.md"}]]',
    );
    const s = agent.stats();
    expect(s.skills["brainstorming"]!.loads).toBe(1);
    expect(s.skills[SKILL_SEARCH_KEY]!.queries).toBe(1);
    expect(s.skills["foo"]!.browses).toBe(1);
    expect(s.tools.skill_search).toBe(3);
  });
});

describe("SessionManager stats (end-to-end)", () => {
  it("exposes SessionStats via getSessionStats and pushes per-run entries", async () => {
    const m = new SessionManager({ persist: false, agentFactory: mockAgentFactory });
    const s = await m.createSession();
    // Before any run.
    expect(m.getSessionStats(s.id)?.byRun).toEqual([]);

    await m.sendMessage(s.id, "hello");
    await waitFor(() => m.listAgents(s.id)[0]?.status === "idle");
    await waitFor(() => (m.getSessionStats(s.id)?.byRun.length ?? 0) >= 1);

    const stats = m.getSessionStats(s.id)!;
    expect(stats.sessionId).toBe(s.id);
    expect(stats.byRun.length).toBeGreaterThanOrEqual(1);
    const first = stats.byRun[0]!;
    expect(first.agentName).toBe("principal");
    expect(first.status).toBe("ok");
    expect(first.delta.tokens.total).toBeGreaterThan(0);
    expect(stats.byAgent["principal"]).toBeDefined();
    // Session total equals per-agent sum (tokens).
    const perAgentSum = Object.values(stats.byAgent).reduce(
      (a, s2) => a + s2.tokens.total,
      0,
    );
    expect(stats.total.tokens.total).toBe(perAgentSum);
  });

  it("persists stats.json and rehydrates on restart", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-stats-"));
    const m1 = new SessionManager({ dataRoot, agentFactory: mockAgentFactory });
    const s = await m1.createSession();
    await m1.sendMessage(s.id, "first");
    await waitFor(() => m1.listAgents(s.id)[0]?.status === "idle");
    await waitFor(() => (m1.getSessionStats(s.id)?.byRun.length ?? 0) >= 1);
    const before = m1.getSessionStats(s.id)!;
    expect(before.byRun.length).toBeGreaterThanOrEqual(1);

    // stats.json on disk (fire-and-forget write; poll).
    const statsPath = join(dataRoot, ".bp", s.id, "stats.json");
    await waitFor(async () => {
      try {
        const raw = await readFile(statsPath, "utf8");
        return JSON.parse(raw).byRun?.length >= before.byRun.length;
      } catch {
        return false;
      }
    });

    // Fresh manager restores byRun + byAgent + total.
    const m2 = new SessionManager({ dataRoot, agentFactory: mockAgentFactory });
    await m2.restoreFromDisk();
    const rest = m2.getSessionStats(s.id)!;
    expect(rest.byRun.length).toBe(before.byRun.length);
    expect(rest.total.tokens.total).toBe(before.total.tokens.total);

    // A new turn keeps appending on top of the restored history.
    await m2.sendMessage(s.id, "second");
    await waitFor(() => m2.listAgents(s.id)[0]?.status === "idle");
    await waitFor(
      () => (m2.getSessionStats(s.id)?.byRun.length ?? 0) > before.byRun.length,
    );
    expect(m2.getSessionStats(s.id)!.byRun.length).toBeGreaterThan(before.byRun.length);
  });
});
