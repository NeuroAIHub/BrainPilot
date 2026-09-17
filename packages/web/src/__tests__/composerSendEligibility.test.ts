import { describe, expect, it } from "vitest";
import {
  resolveComposerCanSend,
  resolveModelPickerEnabled,
} from "../components/chat/PromptComposer";
import { resolveComposerStatus } from "../components/chat/composerStatus";
import { providerListPhase } from "../components/chat/noProviderBanner";
import type { ProviderProfile } from "../contracts/backend";

// Transport readiness ("sandbox running", "socket connected") used to be the
// whole Send gate. For a *draft* that is not enough: with no provider/model
// chosen there is nowhere to send, so an enabled button promised a send that
// failed immediately afterwards. These tests pin the narrow extra condition and
// the two states it must NOT touch: existing pinned sessions and drafts that
// already have a (cached) selection.

const transportReady = {
  sandboxRunning: true,
  isSending: false,
  uploading: false,
  connectedOrDraft: true,
  draftModelUnavailable: false,
};

const profile = (id: string) => ({ id, name: id, models: ["m1"] }) as unknown as ProviderProfile;

describe("composer send eligibility", () => {
  it("does not enable Send for a fresh draft with no provider/model", () => {
    expect(resolveComposerCanSend({
      ...transportReady,
      isDraft: true,
      hasProviderSelection: false,
    })).toBe(false);
  });

  it("enables Send for a draft whose cached selection is valid", () => {
    expect(resolveComposerCanSend({
      ...transportReady,
      isDraft: true,
      hasProviderSelection: true,
    })).toBe(true);
  });

  it("leaves an existing pinned session usable regardless of the picker state", () => {
    // A non-draft session has its provider/model frozen server-side; the
    // composer's own selection state is irrelevant to whether it can send.
    expect(resolveComposerCanSend({
      ...transportReady,
      isDraft: false,
      hasProviderSelection: false,
    })).toBe(true);
  });

  it("keeps the transport conditions authoritative", () => {
    const selected = { isDraft: true, hasProviderSelection: true };
    expect(resolveComposerCanSend({ ...transportReady, ...selected, sandboxRunning: false })).toBe(false);
    expect(resolveComposerCanSend({ ...transportReady, ...selected, isSending: true })).toBe(false);
    expect(resolveComposerCanSend({ ...transportReady, ...selected, uploading: true })).toBe(false);
    expect(resolveComposerCanSend({ ...transportReady, ...selected, connectedOrDraft: false })).toBe(false);
    expect(resolveComposerCanSend({ ...transportReady, ...selected, draftModelUnavailable: true })).toBe(false);
  });

  it("stays backward compatible for callers that pass no selection info", () => {
    expect(resolveComposerCanSend(transportReady)).toBe(true);
  });
});

describe("model picker availability", () => {
  it("stays disabled while the first provider load is pending", () => {
    const phase = providerListPhase({ status: "loading", profiles: null, error: null });
    expect(phase).toBe("pending");
    expect(resolveModelPickerEnabled({ phase, hasCachedProfiles: false })).toBe(false);
  });

  it("stays disabled when the first load failed with nothing cached", () => {
    // An enabled picker would open onto an empty list reading as "you have no
    // providers, add one" — the wrong diagnosis of a failed request. The
    // load-failed notice keeps the retry.
    const phase = providerListPhase({ status: "ready", profiles: null, error: "boom" });
    expect(phase).toBe("failed");
    expect(resolveModelPickerEnabled({ phase, hasCachedProfiles: false })).toBe(false);
  });

  it("keeps cached profiles pickable through a failed refresh", () => {
    const phase = providerListPhase({ status: "ready", profiles: [profile("p1")], error: "boom" });
    expect(phase).toBe("failed");
    expect(resolveModelPickerEnabled({ phase, hasCachedProfiles: true })).toBe(true);
  });

  it("keeps the picker for a genuine confirmed-empty success (onboarding)", () => {
    const phase = providerListPhase({ status: "ready", profiles: [], error: null });
    expect(phase).toBe("empty");
    expect(resolveModelPickerEnabled({ phase, hasCachedProfiles: false })).toBe(true);
  });

  it("enables the picker once providers are present", () => {
    const phase = providerListPhase({ status: "ready", profiles: [profile("p1")], error: null });
    expect(phase).toBe("present");
    expect(resolveModelPickerEnabled({ phase, hasCachedProfiles: true })).toBe(true);
  });
});

describe("blocked-send hint suppression", () => {
  const blocked = {
    canSend: false,
    draftModelUnavailable: false,
    sandboxRunning: true,
    isConnected: true,
  };

  it("stays quiet when the choose-model notice already explains the block", () => {
    expect(resolveComposerStatus({ ...blocked, providerSelectionMissing: true })).toEqual([]);
  });

  it("stays quiet when the history-load notice already explains the block", () => {
    expect(resolveComposerStatus({ ...blocked, historyLoadFailed: true })).toEqual([]);
  });

  it("still emits the generic hint when nothing else explains the block", () => {
    expect(resolveComposerStatus(blocked)).toEqual([
      { id: "blocked", tone: "hint", messageKey: "chat.status.preparing" },
    ]);
  });

  it("keeps run and attachment errors visible under every suppression", () => {
    expect(resolveComposerStatus({
      ...blocked,
      providerSelectionMissing: true,
      historyLoadFailed: true,
      runError: "run exploded",
      stagingError: "upload failed",
    })).toEqual([
      { id: "run", tone: "error", text: "run exploded" },
      { id: "staging", tone: "error", text: "upload failed" },
    ]);
  });

  it("keeps the specific model-unavailable hint, which is actionable", () => {
    expect(resolveComposerStatus({
      ...blocked,
      draftModelUnavailable: true,
      providerSelectionMissing: true,
    })).toEqual([
      { id: "blocked", tone: "hint", messageKey: "chat.status.modelUnavailable" },
    ]);
  });
});
