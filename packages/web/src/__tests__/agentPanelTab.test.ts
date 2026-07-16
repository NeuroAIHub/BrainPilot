import { describe, it, expect, beforeEach } from "vitest";
import {
  hasAnalyticsData,
  resolveAgentTabForSession,
  loadPreferredAgentTab,
  savePreferredAgentTab,
  parseAgentTab,
  AGENT_TAB_STORAGE_KEY,
} from "../components/session/agentPanelTab";

describe("hasAnalyticsData (#326)", () => {
  it("is false when there are no edges or only empty edges", () => {
    expect(hasAnalyticsData([])).toBe(false);
    expect(hasAnalyticsData([{ messages: [] }, { messages: [] }])).toBe(false);
  });

  it("is true when any edge carries messages", () => {
    expect(
      hasAnalyticsData([
        { messages: [] },
        { messages: [{ id: "m1" }] },
      ]),
    ).toBe(true);
  });
});

describe("resolveAgentTabForSession (#326)", () => {
  it("falls back to detail when preferred is analytics but session has no data", () => {
    expect(resolveAgentTabForSession("analytics", false)).toBe("detail");
  });

  it("keeps analytics when the destination conversation has data", () => {
    expect(resolveAgentTabForSession("analytics", true)).toBe("analytics");
  });

  it("preserves detail and timeline regardless of analytics data", () => {
    expect(resolveAgentTabForSession("detail", false)).toBe("detail");
    expect(resolveAgentTabForSession("detail", true)).toBe("detail");
    expect(resolveAgentTabForSession("timeline", false)).toBe("timeline");
    expect(resolveAgentTabForSession("timeline", true)).toBe("timeline");
  });

  it("models switching from a data-rich Analytics view to an empty conversation", () => {
    // User left session A on analytics (preferred stays analytics).
    const preferred = "analytics" as const;
    // Enter session B with no inter-agent traffic.
    expect(resolveAgentTabForSession(preferred, hasAnalyticsData([]))).toBe("detail");
    // Enter session C that has traffic — restore preferred analytics.
    const rich = [{ messages: [{}, {}] }];
    expect(resolveAgentTabForSession(preferred, hasAnalyticsData(rich))).toBe("analytics");
  });
});

describe("preferred tab storage", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };

  beforeEach(() => mem.clear());

  it("round-trips user preference without treating auto-detail as preferred", () => {
    savePreferredAgentTab("analytics", storage);
    expect(loadPreferredAgentTab(storage)).toBe("analytics");
    // Auto-correct display to detail must NOT call savePreferredAgentTab.
    expect(resolveAgentTabForSession(loadPreferredAgentTab(storage), false)).toBe("detail");
    expect(loadPreferredAgentTab(storage)).toBe("analytics");
    expect(mem.get(AGENT_TAB_STORAGE_KEY)).toBe("analytics");
  });

  it("parseAgentTab rejects unknown values", () => {
    expect(parseAgentTab("nope")).toBe(null);
    expect(parseAgentTab("detail")).toBe("detail");
  });
});
