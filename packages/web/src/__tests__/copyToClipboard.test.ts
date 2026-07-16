import { describe, it, expect, vi } from "vitest";
import {
  copyFailureMessageKey,
  copyTextToClipboard,
} from "../utils/copyToClipboard";

describe("copyTextToClipboard (#329)", () => {
  it("reports success when Clipboard API writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const r = await copyTextToClipboard("hello", {
      clipboard: { writeText },
      isSecureContext: true,
      legacyCopy: () => {
        throw new Error("legacy should not run");
      },
    });
    expect(r).toEqual({ ok: true });
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("reports denied on NotAllowedError and does not claim success", async () => {
    const err = new Error("denied");
    err.name = "NotAllowedError";
    const writeText = vi.fn().mockRejectedValue(err);
    const r = await copyTextToClipboard("secret", {
      clipboard: { writeText },
      isSecureContext: true,
      legacyCopy: () => false,
    });
    expect(r).toEqual({ ok: false, reason: "denied" });
  });

  it("reports denied on SecurityError", async () => {
    const err = new Error("blocked");
    err.name = "SecurityError";
    const r = await copyTextToClipboard("x", {
      clipboard: { writeText: vi.fn().mockRejectedValue(err) },
      isSecureContext: true,
      legacyCopy: () => false,
    });
    expect(r).toEqual({ ok: false, reason: "denied" });
  });

  it("falls back to legacy when Clipboard API is unavailable", async () => {
    const legacyCopy = vi.fn().mockReturnValue(true);
    const r = await copyTextToClipboard("plain-http", {
      clipboard: null,
      isSecureContext: false,
      legacyCopy,
    });
    expect(r).toEqual({ ok: true });
    expect(legacyCopy).toHaveBeenCalledWith("plain-http");
  });

  it("reports unavailable when Clipboard API is missing and legacy fails", async () => {
    const r = await copyTextToClipboard("nope", {
      clipboard: null,
      isSecureContext: false,
      legacyCopy: () => false,
    });
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });

  it("reports failed when writeText fails non-permission and legacy also fails", async () => {
    const r = await copyTextToClipboard("x", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("boom")) },
      isSecureContext: true,
      legacyCopy: () => false,
    });
    expect(r).toEqual({ ok: false, reason: "failed" });
  });

  it("maps failure reasons to i18n keys", () => {
    expect(copyFailureMessageKey("denied")).toBe("chat.copyDenied");
    expect(copyFailureMessageKey("unavailable")).toBe("chat.copyUnavailable");
    expect(copyFailureMessageKey("failed")).toBe("chat.copyFailed");
  });
});
