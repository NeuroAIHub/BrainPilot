import { describe, expect, it } from "vitest";
import {
  failedResource,
  idleResource,
  isConfirmedEmpty,
  loadingResource,
  readyResource,
  resetResourceForReopen,
  resourceErrorMessage,
  resourceItems,
  resourcePhase,
} from "../components/settings/settingsResources";

describe("settings resource state (#556 follow-up)", () => {
  it("distinguishes never-requested, in-flight, failed and genuinely empty", () => {
    const idle = idleResource<string[]>();
    expect(resourcePhase(idle)).toBe("pending");
    expect(isConfirmedEmpty(idle)).toBe(false);

    const loading = loadingResource(idle);
    expect(resourcePhase(loading)).toBe("pending");
    expect(isConfirmedEmpty(loading)).toBe(false);

    const failed = failedResource(loading, "404 Not Found");
    expect(resourcePhase(failed)).toBe("failed");
    expect(isConfirmedEmpty(failed)).toBe(false);

    // Only an actual empty 200 may render the "nothing configured" copy.
    const empty = readyResource<string[]>([]);
    expect(resourcePhase(empty)).toBe("empty");
    expect(isConfirmedEmpty(empty)).toBe(true);

    expect(resourcePhase(readyResource(["a"]))).toBe("present");
  });

  it("keeps the last good list when a refresh fails, and never degrades to []", () => {
    const loaded = readyResource(["anthropic"]);
    const refreshing = loadingResource(loaded);
    expect(resourceItems(refreshing)).toEqual(["anthropic"]);

    const failed = failedResource(refreshing, "boom");
    expect(resourceItems(failed)).toEqual(["anthropic"]);
    expect(resourcePhase(failed)).toBe("failed");
    expect(isConfirmedEmpty(failed)).toBe(false);
  });

  it("clears a scoped error once the resource loads again", () => {
    const failed = failedResource(idleResource<string[]>(), "boom");
    expect(failed.error).toBe("boom");
    expect(loadingResource(failed).error).toBeNull();
    expect(readyResource(["ok"]).error).toBeNull();
  });

  it("drops an empty/failed outcome on close but keeps a good list for reopen", () => {
    // Otherwise a reopened dialog renders last session's "no providers yet"
    // before its new request has even started.
    const emptyAgain = resetResourceForReopen(readyResource<string[]>([]));
    expect(emptyAgain.status).toBe("idle");
    expect(isConfirmedEmpty(emptyAgain)).toBe(false);
    expect(resourcePhase(emptyAgain)).toBe("pending");

    const afterFailure = resetResourceForReopen(failedResource(idleResource<string[]>(), "boom"));
    expect(afterFailure.error).toBeNull();
    expect(resourcePhase(afterFailure)).toBe("pending");

    const afterSuccess = resetResourceForReopen(readyResource(["anthropic"]));
    expect(afterSuccess.data).toEqual(["anthropic"]);
    expect(resourcePhase(afterSuccess)).toBe("present");
  });

  it("falls back to localized copy when a rejection carries no message", () => {
    expect(resourceErrorMessage(new Error("404 Not Found"), "fallback")).toBe("404 Not Found");
    expect(resourceErrorMessage(new Error("   "), "fallback")).toBe("fallback");
    expect(resourceErrorMessage(undefined, "fallback")).toBe("fallback");
    expect(resourceErrorMessage("plain string", "fallback")).toBe("plain string");
  });
});
