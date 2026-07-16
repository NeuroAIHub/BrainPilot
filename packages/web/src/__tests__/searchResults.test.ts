import { describe, it, expect } from "vitest";
import {
  clampActiveIndex,
  filterSessionsByQuery,
  moveActiveIndex,
  searchResultMeta,
  shortSessionId,
  titleCollisionIds,
} from "../components/search/searchResults";

const sessions = [
  { id: "aaaaaaaa-1111", title: "你好", updatedAt: "2026-07-01T10:00:00.000Z" },
  { id: "bbbbbbbb-2222", title: "你好", updatedAt: "2026-07-02T11:00:00.000Z" },
  { id: "cccccccc-3333", title: "Other", updatedAt: "2026-07-03T12:00:00.000Z" },
];

describe("titleCollisionIds / searchResultMeta (#315)", () => {
  it("marks same-title conversations for short-id disambiguation", () => {
    const collisions = titleCollisionIds(sessions);
    expect(collisions.has("aaaaaaaa-1111")).toBe(true);
    expect(collisions.has("bbbbbbbb-2222")).toBe(true);
    expect(collisions.has("cccccccc-3333")).toBe(false);

    expect(searchResultMeta(sessions[0]!, collisions)).toEqual({
      showShortId: true,
      shortId: "aaaaaaaa",
    });
    expect(searchResultMeta(sessions[2]!, collisions).showShortId).toBe(false);
  });

  it("shortens ids to 8 chars by default", () => {
    expect(shortSessionId("abcdefghij")).toBe("abcdefgh");
    expect(shortSessionId("short")).toBe("short");
  });
});

describe("filterSessionsByQuery", () => {
  it("returns all when query empty", () => {
    expect(filterSessionsByQuery(sessions, "  ")).toHaveLength(3);
  });

  it("filters by title case-insensitively", () => {
    expect(filterSessionsByQuery(sessions, "other").map((s) => s.id)).toEqual([
      "cccccccc-3333",
    ]);
  });

  it("returns empty list when nothing matches", () => {
    expect(filterSessionsByQuery(sessions, "zzz")).toEqual([]);
  });
});

describe("keyboard active index", () => {
  it("clamps and wraps", () => {
    expect(clampActiveIndex(5, 3)).toBe(2);
    expect(clampActiveIndex(-1, 3)).toBe(0);
    expect(clampActiveIndex(0, 0)).toBe(-1);
    expect(moveActiveIndex(0, 3, "down")).toBe(1);
    expect(moveActiveIndex(2, 3, "down")).toBe(0);
    expect(moveActiveIndex(0, 3, "up")).toBe(2);
  });
});
