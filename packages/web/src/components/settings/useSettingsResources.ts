/**
 * Settings resource loading, extracted from SettingsDialog so the lifecycle is
 * testable without a DOM (this package's vitest runs in the `node` env).
 *
 * Guarantees, each of which the previous single `Promise.all` broke:
 *
 *  - every resource is requested in parallel and settles independently, so a
 *    deployment without `/api/plugins/installed` still shows its providers;
 *  - health and BYOK are optional decorations — the provider list is committed
 *    as soon as it resolves and health is overlaid later if/when it arrives, so
 *    a hung or failing health probe can neither hide the profiles nor downgrade
 *    a successful list to an error;
 *  - a failed (re)load keeps the last good data and records a *scoped* error
 *    that a retry clears;
 *  - results are tagged with an open-generation and a per-resource sequence, so
 *    a response that arrives after the dialog closed — or after a newer request
 *    or a local mutation of the same resource — is discarded instead of
 *    overwriting fresher state.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  McpByokStatus,
  McpServerEntry,
  ProviderProfile,
} from "../../contracts/backend";
import { api as defaultApi, type InstalledPluginApiEntry } from "../../utils/api";
import {
  failedResource,
  idleResource,
  loadingResource,
  readyResource,
  resetResourceForReopen,
  resourceErrorMessage,
  type SettingsResource,
} from "./settingsResources";

/** The slice of `utils/api` this hook needs; narrowed so tests can substitute it. */
export interface SettingsResourcesApi {
  providers: {
    list: () => Promise<ProviderProfile[]>;
    health: () => Promise<ProviderProfile[]>;
  };
  mcpServers: { list: () => Promise<McpServerEntry[]> };
  plugins: { installed: () => Promise<InstalledPluginApiEntry[]> };
  mcpByok: { support: () => Promise<McpByokStatus[] | null> };
}

export interface UseSettingsResourcesOptions {
  isOpen: boolean;
  /** Deployment capability; when false the installed-plugin API is never called. */
  pluginsEnabled: boolean;
  /** Localized fallback when a rejection carries no usable message. */
  fallbackError: string;
  /** Background provider refresh runs only while this is true (Providers tab). */
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
  api?: SettingsResourcesApi;
}

export interface UseSettingsResourcesResult {
  providers: SettingsResource<ProviderProfile[]>;
  mcpServers: SettingsResource<McpServerEntry[]>;
  installedPlugins: SettingsResource<InstalledPluginApiEntry[]>;
  /** `null` = deployment has no BYOK endpoint (see api.mcpByok.support). */
  mcpByok: McpByokStatus[] | null;
  reloadProviders: () => Promise<void>;
  reloadMcpServers: () => Promise<void>;
  reloadPlugins: () => Promise<void>;
  /** Re-probe BYOK support and the server list after a key save/clear. */
  refreshMcpByok: () => Promise<void>;
  /** Apply a local mutation result without a round-trip. */
  updateProviders: (updater: (current: ProviderProfile[]) => ProviderProfile[]) => void;
  updateMcpServers: (updater: (current: McpServerEntry[]) => McpServerEntry[]) => void;
}

/** Overlay health onto profiles; profiles with no health row keep their own status. */
export function mergeProviderHealth(
  profiles: ProviderProfile[],
  healthProfiles: ProviderProfile[],
): ProviderProfile[] {
  const healthById = new Map(healthProfiles.map((profile) => [profile.id, profile]));
  return profiles.map((profile) => {
    const health = healthById.get(profile.id);
    if (!health) return profile;
    return {
      ...profile,
      healthStatus: health.healthStatus,
      healthCheckedAt: health.healthCheckedAt,
      modelHealth: health.modelHealth,
    };
  });
}

/**
 * A resource's rendered state plus a *stable* controller over it. The
 * controller keeps a synchronously-updated mirror (`ref`), which lets the
 * loaders decide outside a `setState` updater whether a mutation interrupted a
 * load, without depending on when React flushes. Its identity never changes, so
 * the loaders below stay stable and the open-effect does not refetch on every
 * render.
 */
interface ResourceController<T> {
  ref: { current: SettingsResource<T> };
  apply: (update: (current: SettingsResource<T>) => SettingsResource<T>) => void;
}

function useResourceState<T>(): [SettingsResource<T>, ResourceController<T>] {
  const ref = useRef<SettingsResource<T>>(idleResource<T>());
  const [state, setState] = useState<SettingsResource<T>>(ref.current);
  const controllerRef = useRef<ResourceController<T> | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = {
      ref,
      apply: (update) => {
        const next = update(ref.current);
        if (next === ref.current) return;
        ref.current = next;
        setState(next);
      },
    };
  }
  return [state, controllerRef.current];
}

export function useSettingsResources(
  options: UseSettingsResourcesOptions,
): UseSettingsResourcesResult {
  const {
    isOpen,
    pluginsEnabled,
    fallbackError,
    autoRefresh = false,
    refreshIntervalMs = 30_000,
    api = defaultApi,
  } = options;

  const [providerState, providers] = useResourceState<ProviderProfile[]>();
  const [mcpState, mcpServers] = useResourceState<McpServerEntry[]>();
  const [pluginState, installedPlugins] = useResourceState<InstalledPluginApiEntry[]>();
  const [mcpByok, setMcpByok] = useState<McpByokStatus[] | null>(null);

  // Latest values, so the loaders keep a stable identity and effects below do
  // not re-subscribe (and re-fetch) on every render.
  const apiRef = useRef(api);
  apiRef.current = api;
  const fallbackRef = useRef(fallbackError);
  fallbackRef.current = fallbackError;
  const pluginsEnabledRef = useRef(pluginsEnabled);
  pluginsEnabledRef.current = pluginsEnabled;

  /** Bumped on every open and on every close/unmount — stale replies compare unequal. */
  const generationRef = useRef(0);
  const providerSeqRef = useRef(0);
  const mcpSeqRef = useRef(0);
  const pluginSeqRef = useRef(0);
  const byokSeqRef = useRef(0);

  const isCurrent = (generation: number, seq: number, seqRef: { current: number }) =>
    generation === generationRef.current && seq === seqRef.current;

  const loadProviders = useCallback(async (mode: "load" | "silent") => {
    const generation = generationRef.current;
    const seq = ++providerSeqRef.current;
    if (mode === "load") providers.apply(loadingResource);
    // Both requests go out together, but the list is committed on its own: a
    // health probe that hangs (or 500s) must never keep the profiles the user
    // came for off screen, and must never turn their success into an error.
    const listPromise = apiRef.current.providers.list();
    const healthPromise = apiRef.current.providers.health().then(
      (value) => ({ ok: true as const, value }),
      () => ({ ok: false as const }),
    );

    let listed: ProviderProfile[];
    try {
      listed = await listPromise;
    } catch (reason) {
      if (!isCurrent(generation, seq, providerSeqRef)) return;
      providers.apply((current) =>
        failedResource(current, resourceErrorMessage(reason, fallbackRef.current)),
      );
      return;
    }
    if (!isCurrent(generation, seq, providerSeqRef)) return;
    providers.apply(() => readyResource(listed));

    // Optional overlay, guarded by the same generation/sequence: a mutation or a
    // newer request that landed meanwhile owns the state now.
    const health = await healthPromise;
    if (!health.ok || !isCurrent(generation, seq, providerSeqRef)) return;
    providers.apply((current) =>
      current.data ? readyResource(mergeProviderHealth(current.data, health.value)) : current,
    );
  }, [providers]);

  const loadMcpServers = useCallback(async (mode: "load" | "silent") => {
    const generation = generationRef.current;
    const seq = ++mcpSeqRef.current;
    if (mode === "load") mcpServers.apply(loadingResource);
    try {
      const servers = await apiRef.current.mcpServers.list();
      if (!isCurrent(generation, seq, mcpSeqRef)) return;
      mcpServers.apply(() => readyResource(servers));
    } catch (reason) {
      if (!isCurrent(generation, seq, mcpSeqRef)) return;
      mcpServers.apply((current) =>
        failedResource(current, resourceErrorMessage(reason, fallbackRef.current)),
      );
    }
  }, [mcpServers]);

  const loadPlugins = useCallback(async (mode: "load" | "silent") => {
    // Capability off: the endpoint does not exist on this deployment, so the
    // tab is hidden and nothing is requested.
    if (!pluginsEnabledRef.current) return;
    const generation = generationRef.current;
    const seq = ++pluginSeqRef.current;
    if (mode === "load") installedPlugins.apply(loadingResource);
    try {
      const plugins = await apiRef.current.plugins.installed();
      if (!isCurrent(generation, seq, pluginSeqRef)) return;
      installedPlugins.apply(() => readyResource(plugins));
    } catch (reason) {
      if (!isCurrent(generation, seq, pluginSeqRef)) return;
      installedPlugins.apply((current) =>
        failedResource(current, resourceErrorMessage(reason, fallbackRef.current)),
      );
    }
  }, [installedPlugins]);

  /** The probe resolves to null when unsupported and never rejects (#377). */
  const loadByok = useCallback(async () => {
    const generation = generationRef.current;
    const seq = ++byokSeqRef.current;
    const status = await apiRef.current.mcpByok.support();
    if (!isCurrent(generation, seq, byokSeqRef)) return;
    setMcpByok(status);
  }, []);

  const reloadProviders = useCallback(() => loadProviders("load"), [loadProviders]);
  const reloadMcpServers = useCallback(() => loadMcpServers("load"), [loadMcpServers]);
  const reloadPlugins = useCallback(() => loadPlugins("load"), [loadPlugins]);

  const refreshMcpByok = useCallback(async () => {
    // The hosted layer rewrites the preset URL as part of the same write, so the
    // server list is re-read too.
    await Promise.all([loadByok(), loadMcpServers("silent")]);
  }, [loadByok, loadMcpServers]);

  // Loader refs so a mutation can re-sync its resource without the callbacks
  // forming a dependency cycle.
  const loadProvidersRef = useRef(loadProviders);
  loadProvidersRef.current = loadProviders;
  const loadMcpServersRef = useRef(loadMcpServers);
  loadMcpServersRef.current = loadMcpServers;

  const updateProviders = useCallback(
    (updater: (current: ProviderProfile[]) => ProviderProfile[]) => {
      // The write already happened server-side, so any response still in flight
      // is older than what we know: bumping the sequence stops it resurrecting a
      // removed row or un-activating the profile just activated.
      const wasLoading = providers.ref.current.status === "loading";
      providerSeqRef.current += 1;
      providers.apply((current) => {
        const next = updater(current.data ?? []);
        // Never invent a "confirmed empty" success out of a list we never loaded.
        if (current.data === null && next.length === 0) return current;
        return readyResource(next);
      });
      // A load was interrupted above; re-read so the rest of the list converges.
      if (wasLoading) void loadProvidersRef.current("silent");
    },
    [providers],
  );

  const updateMcpServers = useCallback(
    (updater: (current: McpServerEntry[]) => McpServerEntry[]) => {
      const wasLoading = mcpServers.ref.current.status === "loading";
      mcpSeqRef.current += 1;
      mcpServers.apply((current) => {
        const next = updater(current.data ?? []);
        if (current.data === null && next.length === 0) return current;
        return readyResource(next);
      });
      if (wasLoading) void loadMcpServersRef.current("silent");
    },
    [mcpServers],
  );

  // One initial fetch per open. The cleanup invalidates anything still in
  // flight and drops "confirmed empty"/failed outcomes, so neither a late reply
  // nor a stale empty result can render "nothing configured" on the next open
  // before its own request has started. A last good non-empty list is kept so a
  // reopen shows it immediately while refreshing.
  useEffect(() => {
    if (!isOpen) return;
    generationRef.current += 1;
    void loadProviders("load");
    void loadMcpServers("load");
    void loadPlugins("load");
    void loadByok();
    return () => {
      generationRef.current += 1;
      providers.apply(resetResourceForReopen);
      mcpServers.apply(resetResourceForReopen);
      installedPlugins.apply(resetResourceForReopen);
    };
  }, [
    isOpen,
    loadProviders,
    loadMcpServers,
    loadPlugins,
    loadByok,
    providers,
    mcpServers,
    installedPlugins,
  ]);

  // Background provider refresh (kept at the existing 30s cadence). Held in a
  // ref so the interval is not torn down and recreated on unrelated renders.
  const silentRefreshRef = useRef<() => void>(() => {});
  silentRefreshRef.current = () => {
    void loadProviders("silent");
    void loadMcpServers("silent");
    void loadByok();
  };

  useEffect(() => {
    if (!isOpen || !autoRefresh) return;
    const id = setInterval(() => silentRefreshRef.current(), refreshIntervalMs);
    return () => clearInterval(id);
  }, [isOpen, autoRefresh, refreshIntervalMs]);

  return {
    providers: providerState,
    mcpServers: mcpState,
    installedPlugins: pluginState,
    mcpByok,
    reloadProviders,
    reloadMcpServers,
    reloadPlugins,
    refreshMcpByok,
    updateProviders,
    updateMcpServers,
  };
}
