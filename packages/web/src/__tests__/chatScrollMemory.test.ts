import { beforeEach, describe, expect, it } from "vitest";
import {
  getChatScroll,
  setChatScroll,
  resolveScrollTop,
} from "../components/chat/chatScrollMemory";

describe("chatScrollMemory (#89)", () => {
  beforeEach(() => {
    // Each test uses unique keys, but clear shared rows defensively.
    setChatScroll("s1", { scrollTop: 0, pinned: true });
    setChatScroll("s2", { scrollTop: 0, pinned: true });
  });

  it("stores and reads per-session state", () => {
    setChatScroll("s1", { scrollTop: 120, pinned: false });
    expect(getChatScroll("s1")).toEqual({ scrollTop: 120, pinned: false });
  });

  it("isolates sessions", () => {
    setChatScroll("s1", { scrollTop: 50, pinned: false });
    setChatScroll("s2", { scrollTop: 999, pinned: true });
    expect(getChatScroll("s1")?.scrollTop).toBe(50);
    expect(getChatScroll("s2")?.scrollTop).toBe(999);
  });

  it("ignores undefined keys", () => {
    setChatScroll(undefined, { scrollTop: 5, pinned: false });
    expect(getChatScroll(undefined)).toBeUndefined();
  });

  describe("resolveScrollTop", () => {
    it("returns bottom when there is no memory (fresh conversation)", () => {
      expect(resolveScrollTop(undefined, 4000)).toBe(4000);
    });

    it("returns bottom when the user was pinned (following live output)", () => {
      expect(resolveScrollTop({ scrollTop: 100, pinned: true }, 4000)).toBe(4000);
    });

    it("restores the saved position when the user was reading history", () => {
      expect(resolveScrollTop({ scrollTop: 800, pinned: false }, 4000)).toBe(800);
    });

    it("clamps a stale position to the current scrollHeight", () => {
      expect(resolveScrollTop({ scrollTop: 9000, pinned: false }, 4000)).toBe(4000);
    });
  });
});
