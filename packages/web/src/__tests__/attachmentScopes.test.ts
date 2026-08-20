import { describe, expect, it } from "vitest";
import {
  addScopedAttachment,
  AttachmentStore,
  attachmentStore,
  clearScopedAttachments,
  removeScopedAttachment,
  restoreScopedAttachmentsIfEmpty,
  type AttachmentsBySession,
} from "../components/chat/attachmentScopes";

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

describe("session-scoped composer attachments (#404)", () => {
  it("keeps attachments isolated while navigating between sessions and drafts", () => {
    let state: AttachmentsBySession = {};
    state = addScopedAttachment(state, "session-a", "a.csv");
    state = addScopedAttachment(state, "draft", "draft.pdf");

    expect(state["session-a"]).toEqual(["a.csv"]);
    expect(state.draft).toEqual(["draft.pdf"]);
    expect(state["session-b"]).toBeUndefined();
  });

  it("applies late upload completion only to the session that started it", () => {
    const visibleSession = "session-b";
    const state = addScopedAttachment({}, "session-a", "late.nii");

    expect(state[visibleSession]).toBeUndefined();
    expect(state["session-a"]).toEqual(["late.nii"]);
  });

  it("clears and restores only the submitted session", () => {
    let state: AttachmentsBySession = { "session-a": ["a.csv"], "session-b": ["b.csv"] };
    state = clearScopedAttachments(state, "session-a");
    expect(state["session-b"]).toEqual(["b.csv"]);

    state = restoreScopedAttachmentsIfEmpty(state, "session-a", ["a.csv"]);
    state = removeScopedAttachment(state, "session-a", "a.csv");
    expect(state["session-a"]).toEqual([]);
    expect(state["session-b"]).toEqual(["b.csv"]);
  });

  it("keeps pending attachments across composer unmount/remount", () => {
    attachmentStore.delete("returning-session");
    attachmentStore.add("returning-session", "resume.csv");
    expect(attachmentStore.get("returning-session")).toEqual(["resume.csv"]);
    attachmentStore.delete("returning-session");
  });

  it("returns a stable empty snapshot for useSyncExternalStore", () => {
    const store = new AttachmentStore(null);
    expect(store.get("missing")).toBe(store.get("missing"));
  });

  it("restores attachment names after a page reload", () => {
    const storage = memoryStorage();
    const first = new AttachmentStore(storage);
    first.add("__draft__", "paper.pdf");
    first.add("__draft__", "notes.txt");

    const reloaded = new AttachmentStore(storage);
    expect(reloaded.get("__draft__")).toEqual(["paper.pdf", "notes.txt"]);
    expect(reloaded.has("__draft__")).toBe(true);
    reloaded.delete("__draft__");
    expect(new AttachmentStore(storage).get("__draft__")).toEqual([]);
  });
});
