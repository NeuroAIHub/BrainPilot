import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  ExternalLink,
  LayoutDashboard,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";
import type { MarketplaceEntry as MarketplaceSdkEntry, PluginMarketCapability, PluginSourceFormat } from "@brainpilot/plugin-sdk";
import { useT } from "../../i18n/useT";
import { api, type McpRuntimeStatus } from "../../utils/api";
import { trapFocusKeyDown } from "../settings/settingsModalStack";
import { DatasetMarketplace } from "./DatasetMarketplace";

export type MarketplaceCategory = "skills" | "knowledge" | "plugins" | "datasets";
type MarketplaceEntry = Awaited<ReturnType<typeof api.plugins.marketplace>>[number];
type InstalledEntry = Awaited<ReturnType<typeof api.plugins.installed>>[number];
type PluginUpdate = Awaited<ReturnType<typeof api.plugins.updates>>[number];
type RestartPrompt = { pluginName: string; enabled: boolean };
export type PluginMcpRuntimeSummary = { state: "ready" | "degraded" | "failed"; errors: string[] };

const CATEGORIES: MarketplaceCategory[] = ["skills", "knowledge", "datasets", "plugins"];
export type MarketplaceSourceFilter = "all" | PluginSourceFormat | "verified";
const SOURCE_FILTERS: MarketplaceSourceFilter[] = ["all", "brainpilot", "codex", "claude-code", "pi-package", "verified"];

export function sourceFormatForMarketplaceEntry(entry: Pick<MarketplaceSdkEntry, "sourceFormat">): PluginSourceFormat {
  return entry.sourceFormat ?? "brainpilot";
}

export function capabilitiesForMarketplaceEntry(entry: Pick<MarketplaceSdkEntry, "capabilities" | "manifest">): PluginMarketCapability[] {
  if (entry.capabilities?.length) return [...new Set(entry.capabilities)];
  return entry.manifest.contributes?.skills?.length ? ["skills"] : [];
}

export function marketplacePluginOffersRuntimeRefresh(entry: Pick<MarketplaceSdkEntry, "capabilities" | "manifest">): boolean {
  return capabilitiesForMarketplaceEntry(entry).includes("mcp");
}

export function restartPromptForMcpMutation(
  entry: Pick<MarketplaceSdkEntry, "capabilities" | "manifest">,
  wasEnabled: boolean,
  effect: "reload" | "remove",
): RestartPrompt | null {
  if (!wasEnabled || !marketplacePluginOffersRuntimeRefresh(entry)) return null;
  return {
    pluginName: entry.manifest.displayName,
    enabled: effect === "reload",
  };
}

export function shouldDismissMcpRestartPrompt(key: string, restarting: boolean): boolean {
  return !restarting && (key === "Escape" || key === "Esc");
}

export function mcpRuntimeSummaryForPlugin(status: McpRuntimeStatus | null, pluginId: string): PluginMcpRuntimeSummary | null {
  const servers = status?.servers.filter((server) => server.pluginId === pluginId) ?? [];
  if (servers.length === 0) return null;
  const failed = servers.filter((server) => server.state === "failed");
  return {
    state: failed.length === 0 ? "ready" : failed.length === servers.length ? "failed" : "degraded",
    errors: failed.map((server) => `${server.name}: ${server.error ?? "failed to start"}`),
  };
}

export function executesLocalCodeForMarketplaceEntry(entry: Pick<MarketplaceSdkEntry, "executesLocalCode" | "capabilities">): boolean {
  return entry.executesLocalCode ?? Boolean(entry.capabilities?.some((capability) => capability === "mcp" || capability === "hooks"));
}

export function matchesMarketplaceSource(entry: MarketplaceSdkEntry, filter: MarketplaceSourceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "verified") return entry.verified === true;
  return sourceFormatForMarketplaceEntry(entry) === filter;
}

export function categoryForPluginKind(kind: string): MarketplaceCategory {
  if (kind === "skill-pack") return "skills";
  if (kind === "knowledge-base" || kind === "literature-provider") return "knowledge";
  return "plugins";
}

export function categoryForMarketplaceEntry(entry: MarketplaceEntry): MarketplaceCategory {
  const contributions = entry.manifest.contributes;
  if (contributions?.skills?.length || entry.manifest.categories?.includes("skills")) return "skills";
  if (contributions?.knowledgeBases?.length || contributions?.literatureProviders?.length || entry.manifest.categories?.includes("knowledge")) return "knowledge";
  return categoryForPluginKind(entry.manifest.kind ?? "plugin");
}

export function matchesMarketplaceQuery(entry: MarketplaceEntry, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [entry.manifest.displayName, entry.manifest.description, entry.manifest.id, entry.publisher, entry.manifest.kind, entry.sourceFormat, entry.repositoryUrl, ...(entry.manifest.categories ?? [])]
    .some((value) => value?.toLocaleLowerCase().includes(normalized));
}

function kindIcon(kind: string): LucideIcon {
  if (kind === "skill-pack") return Sparkles;
  if (kind === "knowledge-base") return Database;
  if (kind === "literature-provider") return BookOpen;
  if (kind === "ui-panel") return LayoutDashboard;
  if (kind === "workflow") return Workflow;
  return Package;
}

function kindLabelKey(kind: string): string {
  const supported = ["skill-pack", "knowledge-base", "literature-provider", "previewer", "ui-panel", "workflow"];
  return `marketplace.kind.${supported.includes(kind) ? kind : "plugin"}`;
}

function sourceLabelKey(format: PluginSourceFormat): string {
  return `marketplace.sourceFormat.${format}`;
}

function capabilityLabelKey(capability: PluginMarketCapability): string {
  return `marketplace.capability.${capability}`;
}

export function PluginMarketplace() {
  const t = useT();
  const [marketplace, setMarketplace] = useState<MarketplaceEntry[]>([]);
  const [installed, setInstalled] = useState<InstalledEntry[]>([]);
  const [updates, setUpdates] = useState<PluginUpdate[]>([]);
  const [category, setCategory] = useState<MarketplaceCategory>("plugins");
  const [sourceFilter, setSourceFilter] = useState<MarketplaceSourceFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [datasetCount, setDatasetCount] = useState(0);
  const [restartPrompt, setRestartPrompt] = useState<RestartPrompt | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);
  const [mcpStatus, setMcpStatus] = useState<McpRuntimeStatus | null>(null);
  const restartDialogRef = useRef<HTMLElement>(null);
  const restartDismissRef = useRef<HTMLButtonElement>(null);
  const restartReturnFocusRef = useRef<HTMLElement | null>(null);
  const marketplaceSurfaceRef = useRef<HTMLDivElement>(null);
  const restartingRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextMarketplace, nextInstalled, nextUpdates, nextMcpStatus] = await Promise.all([
        api.plugins.marketplace(),
        api.plugins.installed(),
        api.plugins.updates(),
        api.mcpRuntime.status().catch(() => null),
      ]);
      setMarketplace(nextMarketplace);
      setInstalled(nextInstalled);
      setUpdates(nextUpdates);
      setMcpStatus(nextMcpStatus);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => void load();
    window.addEventListener("brainpilot:plugins-changed", refresh);
    return () => window.removeEventListener("brainpilot:plugins-changed", refresh);
  }, [load]);

  useEffect(() => {
    restartingRef.current = restarting;
  }, [restarting]);

  const closeRestartPrompt = useCallback(() => {
    if (!restartingRef.current) setRestartPrompt(null);
  }, []);

  useEffect(() => {
    if (!restartPrompt) return;
    restartReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => restartDismissRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = restartDialogRef.current;
      if (dialog && trapFocusKeyDown(dialog, event)) return;
      if (shouldDismissMcpRestartPrompt(event.key, restartingRef.current)) {
        event.preventDefault();
        closeRestartPrompt();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleKeyDown, true);
      const target = restartReturnFocusRef.current;
      window.setTimeout(() => {
        if (target?.isConnected) target.focus();
      }, 0);
    };
  }, [closeRestartPrompt, restartPrompt]);

  useEffect(() => {
    const surface = marketplaceSurfaceRef.current;
    if (!surface) return;
    if (restartPrompt) surface.setAttribute("inert", "");
    else surface.removeAttribute("inert");
  }, [restartPrompt]);

  const installedById = useMemo(() => new Map(installed.map((entry) => [entry.manifest.id, entry])), [installed]);
  const updatesById = useMemo(() => new Map(updates.map((entry) => [entry.pluginId, entry])), [updates]);
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((item) => [item, item === "datasets" ? datasetCount : marketplace.filter((entry) => categoryForMarketplaceEntry(entry) === item).length])) as Record<MarketplaceCategory, number>, [datasetCount, marketplace]);
  const visible = useMemo(() => marketplace.filter((entry) => categoryForMarketplaceEntry(entry) === category && matchesMarketplaceSource(entry, sourceFilter) && matchesMarketplaceQuery(entry, query)), [category, marketplace, query, sourceFilter]);
  const enabledCount = installed.filter((entry) => entry.enabled).length;
  const selectedEntry = marketplace.find((entry) => entry.manifest.id === selectedPluginId) ?? null;
  const selectedInstalled = selectedEntry ? installedById.get(selectedEntry.manifest.id) : undefined;
  const selectedUpdate = selectedEntry ? updatesById.get(selectedEntry.manifest.id) : undefined;
  const selectedCompatibility = selectedInstalled?.compatibility ?? selectedEntry?.compatibility;

  const promptForEnabledMcpMutation = (id: string, effect: "reload" | "remove") => {
    const entry = marketplace.find((candidate) => candidate.manifest.id === id);
    if (!entry) return;
    const prompt = restartPromptForMcpMutation(entry, installedById.get(id)?.enabled === true, effect);
    if (!prompt) return;
    setSelectedPluginId(null);
    setRestartError(null);
    setRestartPrompt(prompt);
  };

  useEffect(() => {
    if (!selectedEntry) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedPluginId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedEntry]);

  const install = async (id: string) => {
    setBusyPluginId(id);
    setError(null);
    try {
      await api.plugins.install(id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyPluginId(null);
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    setBusyPluginId(id);
    setError(null);
    try {
      await api.plugins.setEnabled(id, enabled);
      await load();
      const entry = marketplace.find((candidate) => candidate.manifest.id === id);
      if (entry && marketplacePluginOffersRuntimeRefresh(entry)) {
        setSelectedPluginId(null);
        setRestartError(null);
        setRestartPrompt({ pluginName: entry.manifest.displayName, enabled });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyPluginId(null);
    }
  };

  const restartRuntime = async () => {
    setRestarting(true);
    setRestartError(null);
    try {
      await api.runtime.restart();
      await load();
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("brainpilot:runtime-restarted"));
      setRestartPrompt(null);
    } catch (reason) {
      setRestartError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRestarting(false);
    }
  };

  const update = async (id: string) => {
    setBusyPluginId(id);
    setError(null);
    try {
      await api.plugins.update(id);
      await load();
      promptForEnabledMcpMutation(id, "reload");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyPluginId(null);
    }
  };

  const rollback = async (id: string) => {
    setBusyPluginId(id);
    setError(null);
    try {
      await api.plugins.rollback(id);
      await load();
      promptForEnabledMcpMutation(id, "reload");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyPluginId(null);
    }
  };

  const uninstall = async (id: string) => {
    if (!window.confirm(t("marketplace.uninstallConfirm"))) return;
    setBusyPluginId(id);
    setError(null);
    try {
      await api.plugins.remove(id);
      setSelectedPluginId(null);
      await load();
      promptForEnabledMcpMutation(id, "remove");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyPluginId(null);
    }
  };

  return (
    <main className="plugin-market" aria-labelledby="plugin-market-title">
      <div
        ref={marketplaceSurfaceRef}
        className="plugin-market__surface"
        aria-hidden={restartPrompt ? true : undefined}
      >
      <header className="plugin-market__hero">
        <div>
          <span className="plugin-market__eyebrow">{t("marketplace.eyebrow")}</span>
          <h1 id="plugin-market-title">{t("marketplace.title")}</h1>
          <p>{t("marketplace.subtitle")}</p>
        </div>
        <button className="plugin-market__refresh" disabled={loading} onClick={() => void load()} title={t("marketplace.refresh")} type="button">
          <RefreshCw className={loading ? "is-spinning" : ""} size={16} />
          <span>{t("marketplace.refresh")}</span>
        </button>
      </header>

      <section className="plugin-market__summary" aria-label={t("marketplace.title")}>
        <div><span>{t("marketplace.summary.available")}</span><strong>{marketplace.length + datasetCount}</strong></div>
        <div><span>{t("marketplace.summary.installed")}</span><strong>{installed.length}</strong></div>
        <div><span>{t("marketplace.summary.enabled")}</span><strong>{enabledCount}</strong></div>
      </section>

      <section className="plugin-market__catalog">
        <div className="plugin-market__toolbar">
          <div className="plugin-market__categories" role="tablist" aria-label={t("marketplace.title")}>
            {CATEGORIES.map((item) => (
              <button aria-selected={category === item} className={category === item ? "is-active" : ""} key={item} onClick={() => setCategory(item)} role="tab" type="button">
                <span>{t(`marketplace.category.${item}`)}</span><small>{counts[item]}</small>
              </button>
            ))}
          </div>
          <label className="plugin-market__search">
            <Search size={16} />
            <input aria-label={t("marketplace.search")} onChange={(event) => setQuery(event.target.value)} placeholder={t("marketplace.search")} type="search" value={query} />
          </label>
        </div>
        {category === "datasets" ? <DatasetMarketplace onCount={setDatasetCount} query={query} /> : <>
        <div className="plugin-market__source-filters" aria-label={t("marketplace.sourceFilter.label")}>
          {SOURCE_FILTERS.map((item) => (
            <button className={sourceFilter === item ? "is-active" : ""} key={item} onClick={() => setSourceFilter(item)} type="button">
              {t(`marketplace.sourceFilter.${item}`)}
            </button>
          ))}
        </div>

        {error ? <div className="plugin-market__notice plugin-market__notice--error"><span>{error}</span><button onClick={() => void load()} type="button">{t("marketplace.retry")}</button></div> : null}
        {loading && marketplace.length === 0 ? <div className="plugin-market__empty"><Loader2 className="is-spinning" size={24} /><strong>{t("marketplace.loading")}</strong></div> : null}
        {!loading && visible.length === 0 ? <div className="plugin-market__empty"><Package size={24} /><strong>{t("marketplace.empty")}</strong><p>{t("marketplace.emptyHint")}</p></div> : null}

        <div className="plugin-market__grid">
          {visible.map((entry) => {
            const kind = entry.manifest.kind ?? "plugin";
            const Icon = kindIcon(kind);
            const installedEntry = installedById.get(entry.manifest.id);
            const pluginUpdate = updatesById.get(entry.manifest.id);
            const compatibility = installedEntry?.compatibility ?? entry.compatibility;
            const incompatible = !compatibility.compatible;
            const compatibilityWarning = compatibility.status === "warning";
            const busy = busyPluginId === entry.manifest.id;
            const sourceFormat = sourceFormatForMarketplaceEntry(entry);
            const capabilities = capabilitiesForMarketplaceEntry(entry);
            const mcpRuntime = installedEntry?.enabled ? mcpRuntimeSummaryForPlugin(mcpStatus, entry.manifest.id) : null;
            const runtimeLabel = mcpRuntime ? t(`marketplace.mcp.${mcpRuntime.state}`) : null;
            return (
              <article className="plugin-card" key={entry.manifest.id}>
                <button className="plugin-card__details-trigger" onClick={() => setSelectedPluginId(entry.manifest.id)} title={t("marketplace.details")} type="button">
                  <span className="sr-only">{entry.manifest.displayName} · {t("marketplace.details")}</span>
                </button>
                <div className="plugin-card__head">
                  <div className={`plugin-card__icon plugin-card__icon--${category}`}><Icon size={22} /></div>
                  <div className="plugin-card__identity">
                    <div><h2>{entry.manifest.displayName}</h2>{entry.verified ? <ShieldCheck aria-label={t("marketplace.verified")} className="plugin-card__verified" size={16} /> : null}</div>
                    <span className={`plugin-source-badge plugin-source-badge--${sourceFormat}`}>{t(sourceLabelKey(sourceFormat))}</span>
                  </div>
                </div>
                <p className="plugin-card__description">{entry.manifest.description}</p>
                {capabilities.length ? <div className="plugin-card__capabilities">{capabilities.map((capability) => <span key={capability}>{t(capabilityLabelKey(capability))}</span>)}</div> : null}
                <div className="plugin-card__meta">
                  <span>{installedEntry ? `v${installedEntry.activeVersion}` : t(kindLabelKey(kind))}</span>
                  {installedEntry || incompatible || compatibilityWarning ? <span className={`plugin-card__state ${incompatible ? "is-incompatible" : compatibilityWarning || mcpRuntime?.state === "degraded" ? "is-warning" : mcpRuntime?.state === "failed" ? "is-incompatible" : pluginUpdate?.updateAvailable ? "is-update" : installedEntry?.enabled || mcpRuntime?.state === "ready" ? "is-enabled" : ""}`} title={mcpRuntime?.errors.join("; ")}>
                    {installedEntry?.enabled && !pluginUpdate?.updateAvailable && !incompatible && !compatibilityWarning && mcpRuntime?.state !== "failed" ? <CheckCircle2 size={13} /> : null}{runtimeLabel ?? t(incompatible ? "marketplace.incompatible" : compatibilityWarning ? "marketplace.compatibilityWarning" : pluginUpdate?.updateAvailable ? "marketplace.updateAvailable" : installedEntry?.enabled ? "marketplace.enabled" : "marketplace.disabled")}
                  </span> : null}
                </div>
                <div className="plugin-card__actions">
                  {pluginUpdate?.updateAvailable ? <button className="plugin-card__button" disabled={busy} onClick={() => void update(entry.manifest.id)} type="button">{busy ? <Loader2 className="is-spinning" size={14} /> : null}{t("marketplace.update")}</button> : null}
                  {installedEntry ? (
                    <button className={`plugin-card__button ${pluginUpdate?.updateAvailable ? "plugin-card__button--ghost" : ""}`} disabled={busy || (incompatible && !installedEntry.enabled)} onClick={() => void toggle(entry.manifest.id, !installedEntry.enabled)} type="button">
                      {busy ? <Loader2 className="is-spinning" size={14} /> : null}{t(installedEntry.enabled ? "marketplace.disable" : "marketplace.enable")}
                    </button>
                  ) : (
                    <button className="plugin-card__button" disabled={busy || !entry.latestCompatibleVersion} onClick={() => void install(entry.manifest.id)} type="button" title={!entry.latestCompatibleVersion ? t("marketplace.requiresBrainPilot", { range: compatibility.requiredRange ?? "?" }) : undefined}>
                      {busy ? <Loader2 className="is-spinning" size={14} /> : null}{t("marketplace.install")}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        </>}
      </section>

      {selectedEntry ? (() => {
        const kind = selectedEntry.manifest.kind ?? "plugin";
        const Icon = kindIcon(kind);
        const busy = busyPluginId === selectedEntry.manifest.id;
        const sourceFormat = sourceFormatForMarketplaceEntry(selectedEntry);
        const capabilities = capabilitiesForMarketplaceEntry(selectedEntry);
        const repositoryUrl = selectedEntry.repositoryUrl ?? selectedEntry.homepage;
        const unsupported = selectedInstalled?.unsupported ?? selectedEntry.unsupported ?? [];
        const executesLocalCode = selectedInstalled?.executesLocalCode ?? executesLocalCodeForMarketplaceEntry(selectedEntry);
        const mcpRuntime = selectedInstalled?.enabled ? mcpRuntimeSummaryForPlugin(mcpStatus, selectedEntry.manifest.id) : null;
        return (
          <div className="plugin-detail-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedPluginId(null); }}>
            <section aria-labelledby="plugin-detail-title" aria-modal="true" className="plugin-detail" role="dialog">
              <header className="plugin-detail__header">
                <div className={`plugin-card__icon plugin-card__icon--${category}`}><Icon size={24} /></div>
                <div><span>{t(sourceLabelKey(sourceFormat))}</span><h2 id="plugin-detail-title">{selectedEntry.manifest.displayName}</h2></div>
                <div className="plugin-detail__badges">{selectedEntry.status === "test" ? <span className="plugin-detail__test">{t("marketplace.testPlugin")}</span> : null}{selectedEntry.verified ? <span className="plugin-detail__verified"><ShieldCheck size={15} />{t("marketplace.verified")}</span> : null}</div>
                <button className="plugin-detail__close" onClick={() => setSelectedPluginId(null)} title={t("marketplace.close")} type="button"><X size={17} /><span className="sr-only">{t("marketplace.close")}</span></button>
              </header>
              <div className="plugin-detail__body">
                <section><h3>{t("marketplace.details.about")}</h3><p>{selectedEntry.manifest.description}</p></section>
                <dl className="plugin-detail__facts">
                  <div><dt>{t("marketplace.details.sourceFormat")}</dt><dd>{t(sourceLabelKey(sourceFormat))}</dd></div>
                  <div><dt>{t("marketplace.details.publisher")}</dt><dd>{selectedEntry.publisher}</dd></div>
                  <div><dt>{t("marketplace.details.currentVersion")}</dt><dd>{selectedInstalled?.activeVersion ?? t("marketplace.details.notInstalled")}</dd></div>
                  <div><dt>{t("marketplace.details.latestVersion")}</dt><dd>{selectedEntry.manifest.version}</dd></div>
                  <div><dt>{t("marketplace.details.status")}</dt><dd>{mcpRuntime ? t(`marketplace.mcp.${mcpRuntime.state}`) : t(selectedCompatibility?.compatible === false ? "marketplace.incompatible" : selectedInstalled ? selectedInstalled.enabled ? "marketplace.enabled" : "marketplace.disabled" : "marketplace.details.notInstalled")}</dd></div>
                  <div><dt>{t("marketplace.details.compatibility")}</dt><dd>{t(selectedCompatibility?.compatible === false ? "marketplace.incompatible" : selectedCompatibility?.status === "warning" ? "marketplace.compatibilityWarning" : "marketplace.compatible")}</dd></div>
                  {selectedEntry.license ? <div><dt>{t("marketplace.details.license")}</dt><dd>{selectedEntry.license}</dd></div> : null}
                  {repositoryUrl ? <div><dt>{t("marketplace.details.repository")}</dt><dd><a href={repositoryUrl} rel="noreferrer" target="_blank">{repositoryUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ExternalLink size={12} /></a></dd></div> : null}
                </dl>
                {capabilities.length ? <section><h3>{t("marketplace.details.capabilities")}</h3><div className="plugin-detail__capabilities">{capabilities.map((capability) => <span key={capability}><CheckCircle2 size={14} />{t(capabilityLabelKey(capability))}</span>)}</div></section> : null}
                {executesLocalCode ? <div className="plugin-detail__warning"><AlertTriangle size={16} /><span>{t("marketplace.details.localCodeWarning")}</span></div> : null}
                {mcpRuntime?.errors.length ? <div className="plugin-detail__warning"><AlertTriangle size={16} /><span>{t(`marketplace.mcp.${mcpRuntime.state}`)}: {mcpRuntime.errors.join("; ")}</span></div> : null}
                {(selectedEntry.manifest.environments?.length || selectedEntry.requirements?.length || selectedCompatibility?.issues.length) ? <section><h3>{t("marketplace.details.runtime")}</h3>
                  {selectedEntry.manifest.environments?.length ? <div className="plugin-detail__chips">{selectedEntry.manifest.environments.map((environment) => <span key={environment}>{environment}</span>)}</div> : null}
                  {selectedEntry.requirements?.length ? <ul>{selectedEntry.requirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul> : null}
                  {selectedCompatibility?.issues.length ? <ul>{selectedCompatibility.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
                </section> : null}
                {unsupported.length ? <details className="plugin-detail__disclosure plugin-detail__disclosure--warning"><summary>{t("marketplace.details.unsupportedCount", { count: unsupported.length })}</summary><div className="plugin-detail__chips">{unsupported.map((item) => <span key={item}>{item}</span>)}</div></details> : null}
                {selectedUpdate?.releaseNotes ? <section><h3>{t("marketplace.details.releaseNotes")}</h3><p>{selectedUpdate.releaseNotes}</p></section> : null}
                <details className="plugin-detail__disclosure">
                  <summary>{t("marketplace.details.advanced")}</summary>
                  <dl className="plugin-detail__facts">
                    <div><dt>{t("marketplace.details.identifier")}</dt><dd>{selectedEntry.manifest.id}</dd></div>
                    <div><dt>{t("marketplace.details.type")}</dt><dd>{t(kindLabelKey(kind))}</dd></div>
                    <div><dt>{t("marketplace.details.compatibility")}</dt><dd>{selectedCompatibility?.requiredRange ?? t("marketplace.compatibilityUndeclared")}</dd></div>
                    <div><dt>{t("marketplace.currentBrainPilot")}</dt><dd>{selectedCompatibility?.brainpilotVersion ?? "-"}</dd></div>
                    <div><dt>{t("marketplace.details.source")}</dt><dd>{selectedEntry.source ? `${selectedEntry.source.type}:${selectedEntry.source.id}` : "-"}</dd></div>
                    {selectedEntry.upstreamRef ? <div><dt>{t("marketplace.details.upstreamRef")}</dt><dd>{selectedEntry.upstreamRef}</dd></div> : null}
                    {selectedEntry.upstreamCommit ? <div><dt>{t("marketplace.details.upstreamCommit")}</dt><dd><code>{selectedEntry.upstreamCommit}</code></dd></div> : null}
                  </dl>
                  {selectedEntry.manifest.protocols ? <div className="plugin-detail__chips">{Object.entries(selectedEntry.manifest.protocols).map(([name, version]) => <span key={name}>{name} v{version}</span>)}</div> : null}
                  {selectedEntry.manifest.permissions?.length ? <div className="plugin-detail__chips">{selectedEntry.manifest.permissions.map((item) => <span key={item}>{item}</span>)}</div> : null}
                  {selectedEntry.releases?.length ? <div className="plugin-detail__releases">{selectedEntry.releases.map((release) => <article key={release.version}><div><strong>v{release.version}</strong><time dateTime={release.publishedAt}>{release.publishedAt ? new Date(release.publishedAt).toLocaleDateString() : ""}</time></div><p>{release.releaseNotes}</p></article>)}</div> : null}
                </details>
              </div>
              <footer className="plugin-detail__actions">
                {selectedInstalled ? <button className="plugin-card__button plugin-card__button--danger" disabled={busy} onClick={() => void uninstall(selectedEntry.manifest.id)} type="button">{t("marketplace.uninstall")}</button> : null}
                {selectedUpdate?.previousVersion ? <button className="plugin-card__button plugin-card__button--ghost" disabled={busy} onClick={() => void rollback(selectedEntry.manifest.id)} type="button">{t("marketplace.rollback")} · v{selectedUpdate.previousVersion}</button> : null}
                {selectedInstalled ? <button className="plugin-card__button plugin-card__button--ghost" disabled={busy || (selectedCompatibility?.compatible === false && !selectedInstalled.enabled)} onClick={() => void toggle(selectedEntry.manifest.id, !selectedInstalled.enabled)} type="button">{t(selectedInstalled.enabled ? "marketplace.disable" : "marketplace.enable")}</button> : null}
                {selectedUpdate?.updateAvailable ? <button className="plugin-card__button" disabled={busy} onClick={() => void update(selectedEntry.manifest.id)} type="button">{busy ? <Loader2 className="is-spinning" size={14} /> : null}{t("marketplace.update")} · v{selectedUpdate.latestVersion}</button> : !selectedInstalled ? <button className="plugin-card__button" disabled={busy || !selectedEntry.latestCompatibleVersion} onClick={() => void install(selectedEntry.manifest.id)} type="button">{busy ? <Loader2 className="is-spinning" size={14} /> : null}{t("marketplace.install")}</button> : null}
              </footer>
            </section>
          </div>
        );
      })() : null}
      </div>

      {restartPrompt ? (
        <div className="plugin-detail-layer plugin-restart-layer">
          <section ref={restartDialogRef} aria-labelledby="plugin-restart-title" aria-modal="true" className="plugin-restart-dialog" role="dialog">
            <div className="plugin-restart-dialog__header">
              <span className="plugin-restart-dialog__icon"><RefreshCw className={restarting ? "is-spinning" : ""} size={19} /></span>
              <div>
                <h2 id="plugin-restart-title">{t("marketplace.restart.title")}</h2>
                <p>{t(restartPrompt.enabled ? "marketplace.restart.enabledBody" : "marketplace.restart.disabledBody", { plugin: restartPrompt.pluginName })}</p>
              </div>
            </div>
            {restartError ? <div className="plugin-restart-dialog__error">{restartError}</div> : null}
            <div className="plugin-restart-dialog__actions">
              <button ref={restartDismissRef} className="plugin-card__button plugin-card__button--ghost" disabled={restarting} onClick={closeRestartPrompt} type="button">{t("marketplace.restart.later")}</button>
              <button className="plugin-card__button" disabled={restarting} onClick={() => void restartRuntime()} type="button">
                {restarting ? <Loader2 className="is-spinning" size={14} /> : null}{t(restarting ? "marketplace.restart.restarting" : "marketplace.restart.now")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

    </main>
  );
}
