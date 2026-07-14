/**
 * normalizeSessionState parses the optional `tokenUsage` carried on
 * session_state frames into the camelCase SessionTokenUsage shape, and tolerates
 * its absence (older runtime / pre-first-turn).
 */
import { describe, it, expect } from "vitest";
import { normalizeSession, normalizeSessionState } from "../contracts/backend";

describe("normalizeSessionState tokenUsage", () => {
  it("parses total + per-agent breakdown", () => {
    const snap = normalizeSessionState({
      run_state: { active: false, run_id: null },
      agents: [],
      last_activity_ts: "2026-06-20T00:00:00.000Z",
      token_usage: {
        total: { input: 30, output: 12, cache_read: 4, cache_write: 1, total: 47 },
        by_agent: {
          principal: { input: 20, output: 8, cache_read: 4, cache_write: 1, total: 33 },
          librarian: { input: 10, output: 4, cache_read: 0, cache_write: 0, total: 14 },
        },
      },
    });
    expect(snap.tokenUsage).toBeDefined();
    expect(snap.tokenUsage!.total.total).toBe(47);
    expect(snap.tokenUsage!.total.cacheRead).toBe(4);
    expect(snap.tokenUsage!.byAgent.principal.input).toBe(20);
    expect(snap.tokenUsage!.byAgent.librarian.total).toBe(14);
  });

  it("normalizes the frozen domain-resource mode", () => {
    expect(normalizeSession({ id: "base", domain_resources: "base" }).domainResources).toBe("base");
    expect(normalizeSession({ id: "legacy" }).domainResources).toBe("full");
    expect(normalizeSessionState({
      run_state: { active: false, run_id: null },
      agents: [],
      last_activity_ts: "",
      domain_resources: "base",
    }).domainResources).toBe("base");
  });

  it("omits tokenUsage when absent and coerces missing numbers to 0", () => {
    const snap = normalizeSessionState({
      run_state: { active: true, run_id: "run_1" },
      agents: [],
      last_activity_ts: "2026-06-20T00:00:00.000Z",
    });
    expect(snap.tokenUsage).toBeUndefined();

    const partial = normalizeSessionState({
      run_state: { active: true, run_id: "run_1" },
      agents: [],
      last_activity_ts: "2026-06-20T00:00:00.000Z",
      token_usage: { total: { input: 5 }, by_agent: {} },
    });
    expect(partial.tokenUsage!.total.input).toBe(5);
    expect(partial.tokenUsage!.total.output).toBe(0);
    expect(partial.tokenUsage!.total.total).toBe(0);
  });
});
