import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveSessionSelection,
  shouldAutoStartDraft,
  loadLastSessionId,
  saveLastSessionId,
  clearLastSessionId,
  LAST_SESSION_STORAGE_KEY,
} from "../contexts/sessionSelection";

function sessions(...ids: string[]) {
  return ids.map((id) => ({ id }));
}

describe("shouldAutoStartDraft (#324)", () => {
  it("never drafts while the session list is still loading", () => {
    expect(shouldAutoStartDraft("idle", 0, null, false, true)).toBe(false);
    expect(shouldAutoStartDraft("loading", 0, null, false, true)).toBe(false);
  });

  it("drafts only when list is ready, empty, no selection, not already draft, sandbox up", () => {
    expect(shouldAutoStartDraft("ready", 0, null, false, true)).toBe(true);
  });

  it("does not draft when conversations exist or selection/draft already set", () => {
    expect(shouldAutoStartDraft("ready", 2, null, false, true)).toBe(false);
    expect(shouldAutoStartDraft("ready", 0, "s1", false, true)).toBe(false);
    expect(shouldAutoStartDraft("ready", 0, null, true, true)).toBe(false);
    expect(shouldAutoStartDraft("ready", 0, null, false, false)).toBe(false);
  });

  it("does not draft on list error", () => {
    expect(shouldAutoStartDraft("error", 0, null, false, true)).toBe(false);
  });
});

describe("resolveSessionSelection (#324)", () => {
  it("does not invent a draft while list is delayed (idle/loading)", () => {
    expect(
      resolveSessionSelection({
        listStatus: "loading",
        sessions: [],
        preferredId: "old",
        currentSessionId: null,
        isDraft: false,
      }),
    ).toEqual({ sessionId: null, isDraft: false });

    expect(
      resolveSessionSelection({
        listStatus: "idle",
        sessions: [],
        preferredId: null,
        currentSessionId: null,
        isDraft: false,
      }),
    ).toEqual({ sessionId: null, isDraft: false });
  });

  it("restores preferred selection when it still exists after delayed load", () => {
    const r = resolveSessionSelection({
      listStatus: "ready",
      sessions: sessions("a", "b", "c", "d"),
      preferredId: "c",
      currentSessionId: null,
      isDraft: false,
    });
    expect(r).toEqual({ sessionId: "c", isDraft: false });
  });

  it("falls back to first session when preferred is unavailable (no transient draft)", () => {
    const r = resolveSessionSelection({
      listStatus: "ready",
      sessions: sessions("newest", "older"),
      preferredId: "deleted-id",
      currentSessionId: null,
      isDraft: false,
    });
    expect(r).toEqual({ sessionId: "newest", isDraft: false });
  });

  it("keeps current session when still present (preferred ignored)", () => {
    const r = resolveSessionSelection({
      listStatus: "ready",
      sessions: sessions("a", "b"),
      preferredId: "b",
      currentSessionId: "a",
      isDraft: false,
    });
    expect(r).toEqual({ sessionId: "a", isDraft: false });
  });

  it("preserves intentional draft after list is ready", () => {
    const r = resolveSessionSelection({
      listStatus: "ready",
      sessions: sessions("a", "b"),
      preferredId: "a",
      currentSessionId: null,
      isDraft: true,
    });
    expect(r).toEqual({ sessionId: null, isDraft: true });
  });

  it("opens draft when list is ready and empty", () => {
    expect(
      resolveSessionSelection({
        listStatus: "ready",
        sessions: [],
        preferredId: "gone",
        currentSessionId: null,
        isDraft: false,
      }),
    ).toEqual({ sessionId: null, isDraft: true });
  });

  it("on error with empty list does not force a draft", () => {
    expect(
      resolveSessionSelection({
        listStatus: "error",
        sessions: [],
        preferredId: null,
        currentSessionId: null,
        isDraft: false,
      }),
    ).toEqual({ sessionId: null, isDraft: false });
  });

  it("replaces a stale current id with preferred or fallback", () => {
    expect(
      resolveSessionSelection({
        listStatus: "ready",
        sessions: sessions("x", "y"),
        preferredId: "y",
        currentSessionId: "stale",
        isDraft: false,
      }),
    ).toEqual({ sessionId: "y", isDraft: false });
  });
});

describe("last session id storage", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
  };

  beforeEach(() => {
    mem.clear();
  });

  it("round-trips preferred id", () => {
    expect(loadLastSessionId(storage)).toBe(null);
    saveLastSessionId("sess-1", storage);
    expect(loadLastSessionId(storage)).toBe("sess-1");
    expect(mem.get(LAST_SESSION_STORAGE_KEY)).toBe("sess-1");
    clearLastSessionId(storage);
    expect(loadLastSessionId(storage)).toBe(null);
  });

  it("returns null for empty / whitespace values", () => {
    mem.set(LAST_SESSION_STORAGE_KEY, "   ");
    expect(loadLastSessionId(storage)).toBe(null);
  });
});
