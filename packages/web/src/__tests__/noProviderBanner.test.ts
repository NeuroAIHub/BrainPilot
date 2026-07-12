import { describe, it, expect } from "vitest";
import { shouldShowNoProviderBanner } from "../components/chat/noProviderBanner";

describe("shouldShowNoProviderBanner", () => {
  it("shows when loaded, no active provider, and a CTA is wired", () => {
    expect(
      shouldShowNoProviderBanner({ providersLoaded: true, hasActiveProvider: false, hasCta: true }),
    ).toBe(true);
  });

  it("does NOT show before the provider load resolves (avoids first-paint flash)", () => {
    expect(
      shouldShowNoProviderBanner({ providersLoaded: false, hasActiveProvider: false, hasCta: true }),
    ).toBe(false);
  });

  it("does NOT show when a provider is active", () => {
    expect(
      shouldShowNoProviderBanner({ providersLoaded: true, hasActiveProvider: true, hasCta: true }),
    ).toBe(false);
  });

  it("does NOT show without a CTA handler (a dead button is worse than none)", () => {
    expect(
      shouldShowNoProviderBanner({ providersLoaded: true, hasActiveProvider: false, hasCta: false }),
    ).toBe(false);
  });
});
