import { describe, expect, it } from "vitest";
import type { ProviderProfile } from "../contracts/backend";
import {
  initialProviderList,
  providerErrorMessage,
  providerListPhase,
  resolveComposerProviderNotice,
  type ComposerProviderList,
} from "../components/chat/noProviderBanner";

const profile = (id: string, overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
  id,
  name: id,
  baseUrl: "https://api.anthropic.com",
  api: "anthropic-messages",
  adapter: "auto",
  isShared: false,
  models: ["m"],
  reasoningModels: [],
  icon: "circle",
  iconColor: "#111111",
  notes: "",
  isActive: false,
  apiKeyMasked: "sk-1••••2345",
  createdAt: 0,
  updatedAt: 0,
  healthStatus: "unknown",
  modelHealth: [],
  ...overrides,
});

const ready = (profiles: ProviderProfile[]): ComposerProviderList => ({
  status: "ready",
  profiles,
  error: null,
});

const notice = (list: ComposerProviderList, overrides: Partial<{
  hasActiveProvider: boolean;
  hasSelectedModel: boolean;
  isPinnedSession: boolean;
  hasCta: boolean;
}> = {}) =>
  resolveComposerProviderNotice({
    list,
    hasActiveProvider: true,
    hasSelectedModel: true,
    isPinnedSession: false,
    hasCta: true,
    ...overrides,
  });

describe("providerListPhase", () => {
  it("reads as pending before the first response", () => {
    expect(providerListPhase(initialProviderList())).toBe("pending");
  });

  it("reads an empty successful response as confirmed-empty", () => {
    expect(providerListPhase(ready([]))).toBe("empty");
  });

  it("does not read an empty *unsettled* list as confirmed-empty", () => {
    expect(providerListPhase({ status: "loading", profiles: [], error: null })).toBe("pending");
  });

  it("reads a failure as failed even while cached profiles are still shown", () => {
    expect(providerListPhase({ status: "error", profiles: [profile("p1")], error: "boom" }))
      .toBe("failed");
    expect(providerListPhase({ status: "error", profiles: null, error: "boom" })).toBe("failed");
  });

  it("keeps a retry-in-flight failure classified as failed", () => {
    expect(providerListPhase({ status: "loading", profiles: [profile("p1")], error: "boom" }))
      .toBe("failed");
  });
});

describe("resolveComposerProviderNotice", () => {
  it("says nothing while the first load is in flight", () => {
    expect(notice(initialProviderList(), { hasActiveProvider: false, hasSelectedModel: false }))
      .toEqual({ kind: "none" });
  });

  it("offers Add Provider only for a confirmed empty list", () => {
    expect(notice(ready([]), { hasActiveProvider: false, hasSelectedModel: false }))
      .toEqual({ kind: "add-provider" });
  });

  it("does not offer Add Provider without a CTA handler (a dead button is worse)", () => {
    expect(notice(ready([]), {
      hasActiveProvider: false,
      hasSelectedModel: false,
      hasCta: false,
    })).toEqual({ kind: "none" });
  });

  it("never shows Add Provider for a load failure — not even with nothing cached", () => {
    const failed: ComposerProviderList = { status: "error", profiles: null, error: "500" };
    expect(notice(failed, { hasActiveProvider: false, hasSelectedModel: false })).toEqual({
      kind: "load-failed",
      hasCachedList: false,
      detail: "500",
      busy: false,
    });
  });

  it("reports a refresh failure over a cached list, with the retry idle", () => {
    expect(notice({ status: "error", profiles: [profile("p1")], error: "offline" })).toEqual({
      kind: "load-failed",
      hasCachedList: true,
      detail: "offline",
      busy: false,
    });
  });

  it("keeps the failure notice (busy) while a retry is running", () => {
    const result = notice({ status: "loading", profiles: [profile("p1")], error: "offline" });
    expect(result).toEqual({
      kind: "load-failed",
      hasCachedList: true,
      detail: "offline",
      busy: true,
    });
  });

  it("invites choosing a model when providers exist but none is active", () => {
    expect(notice(ready([profile("p1")]), { hasActiveProvider: false, hasSelectedModel: false }))
      .toEqual({ kind: "choose-model" });
  });

  it("invites choosing a model when a provider is active but no model is selected", () => {
    expect(notice(ready([profile("p1", { isActive: true })]), { hasSelectedModel: false }))
      .toEqual({ kind: "choose-model" });
  });

  it("says nothing for a pinned conversation — its model cannot be changed here", () => {
    expect(notice(ready([profile("p1")]), {
      hasActiveProvider: false,
      hasSelectedModel: false,
      isPinnedSession: true,
    })).toEqual({ kind: "none" });
  });

  it("still offers Add Provider in a pinned conversation with no providers at all", () => {
    expect(notice(ready([]), {
      hasActiveProvider: false,
      hasSelectedModel: false,
      isPinnedSession: true,
    })).toEqual({ kind: "add-provider" });
  });

  it("says nothing once a provider and model are selected", () => {
    expect(notice(ready([profile("p1", { isActive: true })]))).toEqual({ kind: "none" });
  });
});

describe("providerErrorMessage", () => {
  it("prefers the rejection's own message", () => {
    expect(providerErrorMessage(new Error("404 Not Found"), "FALLBACK")).toBe("404 Not Found");
    expect(providerErrorMessage("timeout", "FALLBACK")).toBe("timeout");
  });

  it("falls back to the localized copy for an empty or exotic rejection", () => {
    expect(providerErrorMessage(new Error("   "), "FALLBACK")).toBe("FALLBACK");
    expect(providerErrorMessage(undefined, "FALLBACK")).toBe("FALLBACK");
  });
});
