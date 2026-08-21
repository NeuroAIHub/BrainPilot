import { describe, expect, it } from "vitest";
import { restoreErrorMessage } from "../components/session/restoreError";

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe("restore error guidance (#492)", () => {
  it("maps stale, active, conflict, and recovery failures to actionable copy", () => {
    expect(restoreErrorMessage(new Error("workspace changed after restore preview"), t))
      .toBe("trace.checkpoint.staleGuidance");
    expect(restoreErrorMessage(new Error("SESSION_ACTIVE while a task is running"), t))
      .toBe("trace.checkpoint.activeGuidance");
    expect(restoreErrorMessage(new Error("causal rollback has file conflicts"), t))
      .toBe("trace.checkpoint.conflictGuidance");
    expect(restoreErrorMessage(new Error("workspace restore failed and automatic recovery failed"), t))
      .toBe("trace.checkpoint.recoveryFailedGuidance");
  });

  it("keeps an unknown failure as localized fallback detail", () => {
    expect(restoreErrorMessage(new Error("disk offline"), t))
      .toContain("trace.checkpoint.restoreFailed");
  });
});
