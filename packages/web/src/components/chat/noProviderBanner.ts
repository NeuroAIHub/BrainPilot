/**
 * Decide whether the composer should show the "no provider configured" banner.
 *
 * Extracted as a pure function so the gating logic (the actual risk — flashing
 * during load, or showing with no CTA wired) is unit-testable without rendering
 * the whole PromptComposer (the monorepo has no jsdom/testing-library).
 *
 * Show only when ALL hold:
 *  - the provider load has resolved (`providersLoaded`) — otherwise the banner
 *    flashes on first paint before getActive() returns;
 *  - there is no active provider (`hasActiveProvider === false`);
 *  - a CTA handler is wired (`hasCta`) — a banner with a dead button is worse
 *    than none, and standalone renders (tests) pass no handler.
 */
export function shouldShowNoProviderBanner(input: {
  providersLoaded: boolean;
  hasActiveProvider: boolean;
  hasCta: boolean;
}): boolean {
  return input.providersLoaded && !input.hasActiveProvider && input.hasCta;
}
