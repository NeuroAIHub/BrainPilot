/**
 * Provider list + model selection for the composer.
 *
 * The composer used to fetch `providers.list()`, `settings.get()` and
 * `providers.health()` in one `Promise.all`: a failure of *any* of them cleared
 * the profiles, dropped the active model and still reported "loaded", so an API
 * error rendered as "no provider configured". Health — an optional decoration —
 * could also hold the list back indefinitely.
 *
 * Guarantees here:
 *  - the three reads go out in parallel and settle independently; only the list
 *    gates what the picker shows;
 *  - a failed load/refresh keeps the last good list and records a scoped error a
 *    retry clears — it never degrades to `[]`;
 *  - health is overlaid when it arrives; a failure keeps each profile's own
 *    health fields, and it settles independently of the saved-model read so
 *    neither optional decoration can hold the other back or undo it;
 *  - the saved draft-model preference is applied when it arrives, but never over
 *    a manual pick or an existing conversation's pinned provider/model;
 *  - switching conversation re-resolves the selection from the cached list at
 *    once, so the previous conversation's model is never shown as this one's;
 *  - every reply is tagged with a generation (session change / unmount) and a
 *    sequence (newer request, or a local selection), so stale and out-of-order
 *    replies are discarded instead of overwriting the user's choice.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProviderProfile } from "../../contracts/backend";
import { api as defaultApi } from "../../utils/api";
import {
  initialProviderList,
  providerErrorMessage,
  providerListPhase,
  type ComposerProviderList,
  type ProviderListPhase,
} from "./noProviderBanner";
import { selectedModelStatus } from "./ProviderModelControl";

/** Overlay health onto profiles; a profile with no health row keeps its own fields. */
export function mergeProviderHealth(
  profiles: ProviderProfile[],
  healthProfiles: ProviderProfile[],
): ProviderProfile[] {
  const healthById = new Map(healthProfiles.map((profile) => [profile.id, profile]));
  return profiles.map((profile) => {
    const health = healthById.get(profile.id);
    return health
      ? {
          ...profile,
          healthStatus: health.healthStatus,
          healthCheckedAt: health.healthCheckedAt,
          modelHealth: health.modelHealth,
        }
      : profile;
  });
}

export function selectAvailableDraftModel(
  provider: ProviderProfile | null,
  candidates: Array<string | undefined>,
): string {
  if (!provider) return "";
  const configuredCandidates = candidates.filter(
    (model): model is string => Boolean(model && provider.models.includes(model)),
  );
  return configuredCandidates.find((model) => selectedModelStatus(provider, model) !== "unavailable")
    ?? provider.models.find((model) => selectedModelStatus(provider, model) !== "unavailable")
    ?? configuredCandidates[0]
    ?? provider.models[0]
    ?? "";
}

/**
 * Where the current selection came from. Only `manual` and `session` are
 * protected from a late preference reply; `auto` means we guessed and a saved
 * preference may still improve on it.
 */
export type ComposerSelectionSource = "none" | "auto" | "preference" | "manual" | "session";

export interface ComposerSelection {
  activeProvider: ProviderProfile | null;
  selectedModel: string;
  source: ComposerSelectionSource;
}

export function resolveComposerSelection(input: {
  profiles: ProviderProfile[];
  isDraft: boolean;
  sessionProviderId?: string;
  sessionModelId?: string;
  current: ComposerSelection;
  /** Saved `settings.model`, when that read has answered. */
  preferredModel?: string;
}): ComposerSelection {
  const { profiles, current } = input;
  // An existing conversation is pinned to what it recorded; a refresh must never
  // move it to another provider/model. Legacy sessions recorded a model without a
  // provider id: their model is still theirs, so it is kept as-is (never replaced
  // by the saved settings model or the provider's first model) and only the
  // provider falls back to the current default.
  if (!input.isDraft && (input.sessionProviderId || input.sessionModelId)) {
    const provider = input.sessionProviderId
      ? profiles.find((item) => item.id === input.sessionProviderId) ?? null
      : profiles.find((item) => item.isActive) ?? null;
    return {
      activeProvider: provider,
      selectedModel: input.sessionModelId
        ?? selectAvailableDraftModel(provider, [current.selectedModel]),
      source: "session",
    };
  }
  const picked = current.source === "manual" ? current.activeProvider : null;
  if (picked) {
    const provider = profiles.find((item) => item.id === picked.id) ?? null;
    // Keep the pick, but re-point it at the freshly loaded profile so health and
    // model metadata stay current. Only fall through when the server no longer
    // offers that provider/model.
    if (provider && provider.models.includes(current.selectedModel)) {
      return { activeProvider: provider, selectedModel: current.selectedModel, source: "manual" };
    }
  }
  const provider = profiles.find((item) => item.isActive) ?? null;
  const preferred = input.preferredModel?.trim() ? input.preferredModel : undefined;
  const selectedModel = selectAvailableDraftModel(
    provider,
    preferred ? [preferred, current.selectedModel] : [current.selectedModel],
  );
  return {
    activeProvider: provider,
    selectedModel,
    source: preferred && selectedModel === preferred ? "preference" : "auto",
  };
}

function sameSelection(a: ComposerSelection, b: ComposerSelection): boolean {
  return a.activeProvider === b.activeProvider
    && a.selectedModel === b.selectedModel
    && a.source === b.source;
}

/** The slice of `utils/api` this hook needs, narrowed so tests can substitute it. */
export interface ComposerProvidersApi {
  providers: {
    list: () => Promise<ProviderProfile[]>;
    health: () => Promise<ProviderProfile[]>;
  };
  /** Only `model` is read — no credential field is ever touched. */
  settings: { get: () => Promise<{ model?: string }> };
}

export interface UseComposerProvidersOptions {
  isDraft: boolean;
  /** Session identity; a change re-resolves the selection for that conversation. */
  sessionKey: string | null;
  sessionProviderId?: string;
  sessionModelId?: string;
  /** Localized fallback when a rejection carries no usable message. */
  fallbackError: string;
  api?: ComposerProvidersApi;
  refreshIntervalMs?: number;
}

export interface UseComposerProvidersResult {
  list: ComposerProviderList;
  /** What the picker renders: the cached list, or `[]` before the first success. */
  profiles: ProviderProfile[];
  activeProvider: ProviderProfile | null;
  selectedModel: string;
  selectionSource: ComposerSelectionSource;
  phase: ProviderListPhase;
  /** A (re)load is in flight — the retry stays mounted and busy. */
  refreshing: boolean;
  retry: () => Promise<void>;
  /**
   * Record a selection. `manual` (the default) protects it from later
   * preference/health replies; a rollback passes `manual: false` so the saved
   * preference can still apply.
   */
  selectProviderModel: (
    provider: ProviderProfile | null,
    modelId: string,
    options?: { manual?: boolean },
  ) => void;
  /** Mirror a server-side active-profile switch (or its rollback) locally. */
  markProviderActive: (providerId: string) => void;
}

type Settled<T> = { ok: true; value: T } | { ok: false };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then((value) => ({ ok: true as const, value }), () => ({ ok: false as const }));
}

/** State plus a synchronously-updated mirror, so loaders can read the latest value. */
interface StateMirror<T> {
  ref: { current: T };
  apply: (update: (current: T) => T) => void;
}

function useMirroredState<T>(initial: T): [T, StateMirror<T>] {
  const ref = useRef<T>(initial);
  const [state, setState] = useState<T>(ref.current);
  // Identity never changes, so callbacks depending on it stay stable and the
  // load effect below does not refetch on every render.
  const mirrorRef = useRef<StateMirror<T> | null>(null);
  if (mirrorRef.current === null) {
    mirrorRef.current = {
      ref,
      apply: (update) => {
        const next = update(ref.current);
        if (next === ref.current) return;
        ref.current = next;
        setState(next);
      },
    };
  }
  return [state, mirrorRef.current];
}

export function useComposerProviders(
  options: UseComposerProvidersOptions,
): UseComposerProvidersResult {
  const {
    isDraft,
    sessionKey,
    sessionProviderId,
    sessionModelId,
    fallbackError,
    api = defaultApi,
    refreshIntervalMs = 30_000,
  } = options;

  const [listState, list] = useMirroredState<ComposerProviderList>(initialProviderList());
  const [selectionState, selection] = useMirroredState<ComposerSelection>({
    activeProvider: null,
    selectedModel: "",
    source: "none",
  });

  // Latest values behind refs so the loader keeps a stable identity and the
  // effects below neither re-subscribe nor refetch on unrelated renders.
  const apiRef = useRef(api);
  apiRef.current = api;
  const fallbackRef = useRef(fallbackError);
  fallbackRef.current = fallbackError;
  const sessionRef = useRef({ isDraft, sessionProviderId, sessionModelId });
  sessionRef.current = { isDraft, sessionProviderId, sessionModelId };

  /** Bumped on session change and on unmount — stale replies compare unequal. */
  const generationRef = useRef(0);
  /** Bumped per request and by every local selection/mutation. */
  const seqRef = useRef(0);

  const commitSelection = useCallback((profiles: ProviderProfile[], preferredModel?: string) => {
    selection.apply((current) => {
      const next = resolveComposerSelection({
        profiles,
        isDraft: sessionRef.current.isDraft,
        sessionProviderId: sessionRef.current.sessionProviderId,
        sessionModelId: sessionRef.current.sessionModelId,
        current,
        preferredModel,
      });
      return sameSelection(next, current) ? current : next;
    });
  }, [selection]);

  /**
   * Re-resolve for the conversation that just became current, against whatever
   * profiles are already cached. Resolved from an empty selection on purpose: the
   * previous conversation's pin (manual or session) must not be shown as this
   * one's model while its own list request is still in flight — a session pin
   * missing from the cache clears the selection, and a fresh draft falls back to
   * the cached default rather than the last conversation's pick.
   */
  const resetSelectionForSession = useCallback(() => {
    const profiles = list.ref.current.profiles ?? [];
    selection.apply((current) => {
      const next = resolveComposerSelection({
        profiles,
        isDraft: sessionRef.current.isDraft,
        sessionProviderId: sessionRef.current.sessionProviderId,
        sessionModelId: sessionRef.current.sessionModelId,
        current: { activeProvider: null, selectedModel: "", source: "none" },
      });
      return sameSelection(next, current) ? current : next;
    });
  }, [list, selection]);

  const load = useCallback(async (mode: "load" | "silent") => {
    const generation = generationRef.current;
    const seq = ++seqRef.current;
    const isCurrent = () => generation === generationRef.current && seq === seqRef.current;
    // A background refresh keeps the last outcome on screen; only a foreground
    // load/retry switches to the busy state (and keeps its error, so the retry
    // button does not disappear while the request runs).
    if (mode === "load") {
      list.apply((current) => ({ status: "loading", profiles: current.profiles, error: current.error }));
    }
    // All three go out together. Health and the saved model are optional: a hung
    // or failing one may neither hide the list nor turn its success into an error.
    const listPromise = apiRef.current.providers.list();
    const healthPromise = settle(apiRef.current.providers.health());
    // The saved model is only relevant to a foreground load: a background
    // refresh must not re-read (or re-apply) a preference behind the user.
    const preferencePromise: Promise<Settled<{ model?: string }>> = mode === "load"
      ? settle(apiRef.current.settings.get())
      : Promise.resolve<Settled<{ model?: string }>>({ ok: false });

    let profiles: ProviderProfile[];
    try {
      profiles = await listPromise;
    } catch (reason) {
      if (!isCurrent()) return;
      const message = providerErrorMessage(reason, fallbackRef.current);
      list.apply((current) => ({
        status: "error",
        // Never replaced with `[]`: the user keeps seeing their providers, and
        // this can never read as "the server confirmed there is none". The real
        // failure is recorded even for a background refresh, so the notice can
        // say "refresh failed" over the cached list; the next success clears it.
        profiles: current.profiles,
        error: message,
      }));
      return;
    }
    if (!isCurrent()) return;
    list.apply(() => ({ status: "ready", profiles, error: null }));
    commitSelection(profiles);

    // The two decorations are independent: each is committed as soon as it
    // answers, so a hung health probe cannot hold back a saved preference (or
    // vice versa). Both commits go through the same request/scope guard and
    // re-apply what the other already contributed — health onto the committed
    // list, the saved model into the selection — so neither discards the other,
    // and neither can turn a list failure into a success.
    let healthProfiles: ProviderProfile[] | null = null;
    let preferredModel: string | undefined;
    const commitDecorations = () => {
      const decorated = healthProfiles ? mergeProviderHealth(profiles, healthProfiles) : profiles;
      if (healthProfiles) {
        list.apply((current) => (current.profiles === null ? current : { ...current, profiles: decorated }));
      }
      commitSelection(decorated, preferredModel);
    };
    await Promise.all([
      healthPromise.then((health) => {
        if (!isCurrent() || !health.ok) return;
        healthProfiles = health.value;
        commitDecorations();
      }),
      preferencePromise.then((preference) => {
        if (!isCurrent() || !preference.ok) return;
        preferredModel = preference.value.model;
        commitDecorations();
      }),
    ]);
  }, [commitSelection, list]);

  const loadRef = useRef(load);
  loadRef.current = load;

  /** A local change outdates anything still in flight for the same data. */
  const supersedePendingLoad = useCallback(() => {
    seqRef.current += 1;
    // The interrupted foreground load left the list busy; drop the busy state and
    // re-read in the background so the rest of the list still converges.
    if (list.ref.current.status === "loading") {
      if (list.ref.current.profiles !== null) {
        list.apply((current) => ({ ...current, status: "ready" }));
      }
      void loadRef.current("silent");
    }
  }, [list]);

  const selectProviderModel = useCallback((
    provider: ProviderProfile | null,
    modelId: string,
    selectOptions?: { manual?: boolean },
  ) => {
    supersedePendingLoad();
    const source: ComposerSelectionSource = selectOptions?.manual === false ? "auto" : "manual";
    selection.apply(() => ({ activeProvider: provider, selectedModel: modelId, source }));
  }, [selection, supersedePendingLoad]);

  const markProviderActive = useCallback((providerId: string) => {
    supersedePendingLoad();
    list.apply((current) => (current.profiles === null ? current : {
      ...current,
      profiles: current.profiles.map((profile) => ({ ...profile, isActive: profile.id === providerId })),
    }));
    selection.apply((current) => {
      const provider = list.ref.current.profiles?.find((item) => item.id === providerId);
      return provider && provider !== current.activeProvider
        ? { ...current, activeProvider: provider }
        : current;
    });
  }, [list, selection, supersedePendingLoad]);

  const retry = useCallback(() => loadRef.current("load"), []);

  // One foreground load per conversation, plus the existing
  // `provider-profiles-updated` refresh. The cleanup invalidates whatever is in
  // flight so a reply that lands after a session change or unmount is dropped.
  useEffect(() => {
    generationRef.current += 1;
    // The previous conversation's selection does not carry over: resolve this
    // one's pinned or default provider/model from the cached list right away, so
    // the picker never shows the other conversation's model while this one's
    // request is in flight. Cached profiles stay visible meanwhile.
    resetSelectionForSession();
    const reload = () => void loadRef.current("load");
    void loadRef.current("load");
    window.addEventListener("provider-profiles-updated", reload);
    return () => {
      generationRef.current += 1;
      window.removeEventListener("provider-profiles-updated", reload);
    };
  }, [isDraft, resetSelectionForSession, sessionKey, sessionModelId, sessionProviderId]);

  // Background refresh at the existing 30s cadence, held in a ref so the
  // interval is not torn down and recreated on unrelated renders.
  const silentRefreshRef = useRef<() => void>(() => {});
  silentRefreshRef.current = () => void loadRef.current("silent");
  useEffect(() => {
    const id = window.setInterval(() => silentRefreshRef.current(), refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [refreshIntervalMs]);

  return {
    list: listState,
    profiles: listState.profiles ?? [],
    activeProvider: selectionState.activeProvider,
    selectedModel: selectionState.selectedModel,
    selectionSource: selectionState.source,
    phase: providerListPhase(listState),
    refreshing: listState.status === "loading",
    retry,
    selectProviderModel,
    markProviderActive,
  };
}
