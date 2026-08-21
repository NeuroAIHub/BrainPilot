import { describe, expect, it } from "vitest";
import {
  restoreNoticeIsCurrent,
  restorePreviewLoadKey,
  shouldReloadRestorePreview,
} from "../components/files/workspaceRestoreState";

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

  it("keeps a restore pending while Files is closed, then reloads after opening", () => {
    const input = {
      sandboxReady: true,
      hasSelectedFile: true,
      selectedFileAffected: true,
      isDirty: false,
      restoreIsLatest: true,
      alreadyReloaded: false,
    };

    expect(shouldReloadRestorePreview({ ...input, isOpen: false })).toBe(false);
    expect(shouldReloadRestorePreview({ ...input, isOpen: true })).toBe(true);
    expect(shouldReloadRestorePreview({ ...input, isOpen: true, alreadyReloaded: true })).toBe(false);
  });

  it("changes the byte-load generation when the same path is restored", () => {
    const path = "/workspace/plot.png";
    const initial = restorePreviewLoadKey(path);
    const restored = restorePreviewLoadKey(path, "restore-1:plot.png");

    expect(restored).not.toBe(initial);
    expect(restorePreviewLoadKey(path, "restore-1:plot.png")).toBe(restored);
  });
});
