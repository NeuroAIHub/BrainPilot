import { describe, expect, it } from "vitest";
import { composerErrorSummaryKey, isTechnicalComposerError, resolveComposerStatus, type ComposerStatusInput } from "../components/chat/composerStatus";

const input = (overrides: Partial<ComposerStatusInput> = {}): ComposerStatusInput => ({
  canSend: true,
  draftModelUnavailable: false,
  sandboxRunning: true,
  isConnected: true,
  ...overrides,
});

const texts = (lines: ReturnType<typeof resolveComposerStatus>) =>
  lines.map((line) => (line.tone === "error" ? line.text : line.messageKey));

describe("resolveComposerStatus", () => {
  it("shows nothing when everything is fine", () => {
    expect(resolveComposerStatus(input())).toEqual([]);
  });

  it("keeps run, operation and staging errors as distinct inspectable lines", () => {
    expect(texts(resolveComposerStatus(input({
      runError: "run failed",
      operationError: "model save failed",
      stagingError: "attachment staging failed",
    })))).toEqual(["run failed", "model save failed", "attachment staging failed"]);
  });

  it("no longer lets an upload error mask a staging error", () => {
    expect(texts(resolveComposerStatus(input({
      operationError: "upload failed",
      stagingError: "staging failed",
    })))).toEqual(["upload failed", "staging failed"]);
  });

  it("deduplicates identical error texts", () => {
    expect(texts(resolveComposerStatus(input({
      runError: "same failure",
      operationError: "same failure",
    })))).toEqual(["same failure"]);
  });

  it("ignores blank errors", () => {
    expect(resolveComposerStatus(input({ runError: "   ", operationError: null }))).toEqual([]);
  });

  it("emits exactly one blocked hint when nothing else explains the block", () => {
    expect(texts(resolveComposerStatus(input({ canSend: false, sandboxRunning: false }))))
      .toEqual(["chat.status.startSandbox"]);
    expect(texts(resolveComposerStatus(input({ canSend: false, isConnected: true }))))
      .toEqual(["chat.status.preparing"]);
    expect(texts(resolveComposerStatus(input({ canSend: false, isConnected: false }))))
      .toEqual(["chat.status.connecting"]);
  });

  it("drops the generic hint when a specific error already names the blocker", () => {
    // The old footer showed the raw error, the staging error AND "start the
    // sandbox" / "connecting…" all at once.
    expect(texts(resolveComposerStatus(input({
      canSend: false,
      sandboxRunning: false,
      isConnected: false,
      runError: "WebSocket closed",
      stagingError: "staging failed",
    })))).toEqual(["WebSocket closed", "staging failed"]);
  });

  it("drops the generic hint while the provider load failure notice is shown", () => {
    expect(resolveComposerStatus(input({
      canSend: false,
      isConnected: false,
      providerLoadFailed: true,
    }))).toEqual([]);
  });

  it("keeps the specific unavailable-model hint even next to errors", () => {
    expect(texts(resolveComposerStatus(input({
      canSend: false,
      draftModelUnavailable: true,
      sandboxRunning: false,
      runError: "previous run failed",
    })))).toEqual(["previous run failed", "chat.status.modelUnavailable"]);
  });

  it("marks tones so errors keep the danger style and hints stay muted", () => {
    const lines = resolveComposerStatus(input({ canSend: false, runError: "boom" }));
    expect(lines).toEqual([{ id: "run", tone: "error", text: "boom" }]);
    const hint = resolveComposerStatus(input({ canSend: false, sandboxRunning: false }));
    expect(hint).toEqual([
      { id: "blocked", tone: "hint", messageKey: "chat.status.startSandbox" },
    ]);
  });
});


describe("technical composer errors", () => {
  it.each(["<!DOCTYPE HTML><html>404 Not Found</html>", '{"error":"unavailable"}', "Error: bad\n    at request", "Failed to fetch", "x".repeat(241)])("summarizes %s while retaining the original payload", (payload) => {
    expect(isTechnicalComposerError(payload)).toBe(true);
    expect(resolveComposerStatus(input({ operationError: payload }))[0]).toEqual({ id: "operation", tone: "error", text: payload });
  });
  it("leaves actionable short errors inline", () => {
    expect(isTechnicalComposerError("Please choose a supported model.")).toBe(false);
    expect(isTechnicalComposerError("文件太大，请选择小于 10 MB 的文件。")).toBe(false);
  });
  it("names the affected operation rather than implying missing providers", () => {
    expect(composerErrorSummaryKey("staging")).toBe("chat.status.attachmentFailed");
    expect(composerErrorSummaryKey("operation")).toBe("chat.status.operationFailed");
    expect(composerErrorSummaryKey("run")).toBe("chat.status.requestFailed");
  });
});
