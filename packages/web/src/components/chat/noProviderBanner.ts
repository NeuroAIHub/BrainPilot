/**
 * What the composer should say about model availability.
 *
 * The previous rule was `providersLoaded && !hasActiveProvider` — a single
 * boolean that could not tell three very different situations apart, so both of
 * the following rendered the first-run "no provider configured / Add provider"
 * CTA:
 *
 *  - `GET /provider/profiles` (or the saved-settings read batched with it)
 *    failed, and the catch replaced the profiles with `[]`;
 *  - the backend really does have profiles, but none is marked active/default.
 *
 * The state below keeps those apart: a failure never becomes a confirmed-empty
 * list, and a list that exists but has nothing selected asks the user to pick a
 * model instead of adding a second provider.
 *
 * Kept free of React so it is unit-testable in this package's `node` vitest env.
 */
import type { ProviderProfile } from "../../contracts/backend";

export type ComposerProviderStatus = "loading" | "ready" | "error";

export interface ComposerProviderList {
  status: ComposerProviderStatus;
  /** Last successfully loaded list; `null` until the first success. */
  profiles: ProviderProfile[] | null;
  /**
   * Most recent load failure. Kept across a retry's "loading" phase so the
   * retry button stays mounted (busy) instead of vanishing mid-request.
   */
  error: string | null;
}

/**
 * The four situations the composer must render differently. `empty` is only ever
 * a *confirmed* empty success, so "no provider configured" can never come from a
 * failure or from a request that has not answered yet.
 */
export type ProviderListPhase = "pending" | "failed" | "empty" | "present";

export function initialProviderList(): ComposerProviderList {
  return { status: "loading", profiles: null, error: null };
}

export function providerListPhase(list: ComposerProviderList): ProviderListPhase {
  // Reported as failed even while cached profiles are still on screen, so the
  // caller can offer a retry next to them.
  if (list.error !== null) return "failed";
  if (list.profiles === null) return "pending";
  if (list.profiles.length > 0) return "present";
  return list.status === "ready" ? "empty" : "pending";
}

export type ComposerProviderNotice =
  | { kind: "none" }
  /** Confirmed empty list: the first-run Add Provider CTA. */
  | { kind: "add-provider" }
  /** Providers exist but nothing is selected — pick a model, don't add another provider. */
  | { kind: "choose-model" }
  | {
      kind: "load-failed";
      /** Cached profiles are still shown, so the copy is "refresh failed", not "load failed". */
      hasCachedList: boolean;
      /** Raw technical message for an optional <details> block; may be `null`. */
      detail: string | null;
      /** A retry is in flight: keep the button mounted and busy. */
      busy: boolean;
    };

export function resolveComposerProviderNotice(input: {
  list: ComposerProviderList;
  hasActiveProvider: boolean;
  hasSelectedModel: boolean;
  /** An existing conversation's provider/model are pinned; there is nothing to choose. */
  isPinnedSession: boolean;
  /** A CTA handler is wired; a banner with a dead button is worse than none. */
  hasCta: boolean;
}): ComposerProviderNotice {
  const phase = providerListPhase(input.list);
  if (phase === "failed") {
    return {
      kind: "load-failed",
      hasCachedList: (input.list.profiles?.length ?? 0) > 0,
      detail: input.list.error,
      busy: input.list.status === "loading",
    };
  }
  if (phase === "pending") return { kind: "none" };
  if (phase === "empty") return input.hasCta ? { kind: "add-provider" } : { kind: "none" };
  // A nonempty list: the only thing that can be missing is a selection.
  if (input.isPinnedSession) return { kind: "none" };
  if (!input.hasActiveProvider || !input.hasSelectedModel) return { kind: "choose-model" };
  return { kind: "none" };
}

/** Normalize a rejection into a message for the notice's technical details. */
export function providerErrorMessage(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return message.trim().length > 0 ? message.trim() : fallback;
}
