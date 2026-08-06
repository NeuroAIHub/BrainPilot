import { describe, expect, it } from "vitest";
import {
  addScopedAttachment,
  attachmentStore,
  clearScopedAttachments,
  removeScopedAttachment,
  restoreScopedAttachmentsIfEmpty,
  type AttachmentsBySession,
} from "../components/chat/attachmentScopes";

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
});
