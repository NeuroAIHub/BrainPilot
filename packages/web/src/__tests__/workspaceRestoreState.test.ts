import { describe, expect, it } from "vitest";
import { restoreNoticeIsCurrent } from "../components/files/workspaceRestoreState";

describe("workspace restore preview state (#492)", () => {
  it("requires the restore to be latest and the bytes to be reloaded", () => {
    expect(restoreNoticeIsCurrent({
      restoreMessageIndex: 3,
      messageCount: 4,
      isDirty: false,
      successfullyReloaded: true,
    })).toBe(true);
    expect(restoreNoticeIsCurrent({
      restoreMessageIndex: 3,
      messageCount: 4,
      isDirty: false,
      successfullyReloaded: false,
    })).toBe(false);
  });

  it("invalidates after a later event or local edit", () => {
    expect(restoreNoticeIsCurrent({
      restoreMessageIndex: 3,
      messageCount: 5,
      isDirty: false,
      successfullyReloaded: true,
    })).toBe(false);
    expect(restoreNoticeIsCurrent({
      restoreMessageIndex: 3,
      messageCount: 4,
      isDirty: true,
      successfullyReloaded: true,
    })).toBe(false);
  });
});
