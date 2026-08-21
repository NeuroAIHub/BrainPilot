import { describe, expect, it } from "vitest";

import { DRAFT_STORAGE_KEY, DraftStore } from "../contexts/draftStore";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("DraftStore reload persistence", () => {
  it("restores non-empty drafts from persistent browser storage", () => {
    const storage = memoryStorage();
    const first = new DraftStore(storage);
    first.set("__draft__", "unsent research prompt");

    const reloaded = new DraftStore(storage);
    expect(reloaded.get("__draft__")).toBe("unsent research prompt");
    expect(reloaded.has("__draft__")).toBe(true);
  });

  it("removes persisted state when a draft is cleared", () => {
    const storage = memoryStorage();
    const store = new DraftStore(storage);
    store.set("s1", "draft");
    store.set("s1", "");
    expect(storage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("ignores malformed persisted data", () => {
    const storage = memoryStorage();
    storage.setItem(DRAFT_STORAGE_KEY, "not-json");
    expect(new DraftStore(storage).get("s1")).toBe("");
  });
});
