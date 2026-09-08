import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Database, Download, ExternalLink, HardDrive, Loader2, X, Copy, List, LayoutGrid } from "lucide-react";
import { useMarketplaceDialog } from "./useMarketplaceDialog";
import { useT } from "../../i18n/useT";
import { usePreferences } from "../../contexts/PreferencesContext";
import { api, type DatasetCatalogEntry, type DatasetDownloadJob } from "../../utils/api";
import { DATASET_DOMAINS, domainLabel, matchesDataset } from "./datasetDiscovery";
import { updateMarketplaceLocation, useWorkspaceLocation } from "../shell/workspaceNavigation";
import { datasetErrorKey, datasetWorkspacePath } from "./datasetFeedback";
export { matchesDataset } from "./datasetDiscovery";

interface Props { query: string; onCount: (count: number) => void; onQueryChange?: (query: string) => void; refreshSignal?: number; onOpenDataset?: (path: string) => void; onUseDataset?: (path: string) => void; }
export type DatasetCardAction = "download" | "details";

export function canStartDatasetDownload(job?: DatasetDownloadJob): boolean {
  return job?.status !== "completed";
}

export function datasetCardAction(
  entry: DatasetCatalogEntry,
  job?: DatasetDownloadJob,
): DatasetCardAction {
  if (!canStartDatasetDownload(job) || job?.status === "queued" || job?.status === "downloading") return "details";
  return entry.downloadAvailable && !entry.downloadOptions?.length && !entry.downloadReviewRequired && !entry.credentialFields?.length ? "download" : "details";
}

export function handleDatasetCardAction(
  entry: DatasetCatalogEntry,
  actions: { download: (entry: DatasetCatalogEntry) => void; showDetails: (id: string) => void },
  job?: DatasetDownloadJob,
): DatasetCardAction {
  const action = datasetCardAction(entry, job);
  if (action === "download") actions.download(entry);
  else actions.showDetails(entry.id);
  return action;
}

export function hasRequiredDatasetCredentials(entry: DatasetCatalogEntry, credentials: Record<string, string>): boolean {
  return (entry.credentialFields ?? []).filter((field) => field.required).every((field) => Boolean(credentials[field.id]?.trim()));
}

/** Index a newest-first download list without letting older retries overwrite it. */
export function latestDatasetJobsByDataset(jobs: DatasetDownloadJob[]): Map<string, DatasetDownloadJob> {
  const latest = new Map<string, DatasetDownloadJob>();
  for (const job of jobs) {
    if (!latest.has(job.datasetId)) latest.set(job.datasetId, job);
  }
  return latest;
}

function statusClass(status: DatasetDownloadJob["status"]): string {
  return status === "failed" ? "is-incompatible" : status === "completed" ? "is-enabled" : "is-update";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let unit = "B";
  for (const candidate of units) {
    size /= 1024;
    unit = candidate;
    if (size < 1024) break;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${unit}`;
}


export function DatasetMarketplace({ query, onCount, onQueryChange, refreshSignal, onOpenDataset, onUseDataset }: Props) {
  const t = useT();
  const { language } = usePreferences();
  const chinese = language === "zh-CN";
  const [catalog, setCatalog] = useState<DatasetCatalogEntry[]>([]);
  const [jobs, setJobs] = useState<DatasetDownloadJob[]>([]);
  const { searchParams } = useWorkspaceLocation();
  const selectedId = searchParams.get("dataset");
  const setSelectedId = (id: string | null) => updateMarketplaceLocation({ dataset: id });
  const selectionId = searchParams.get("scope") ?? catalog.find((entry) => entry.id === selectedId)?.downloadOptions?.[0]?.id ?? "full";
  const setSelectionId = (scope: string) => updateMarketplaceLocation({ scope });
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const startingRef = useRef(false);
  const modality = searchParams.get("modality") ?? "all";
  const setModality = (value: string) => updateMarketplaceLocation({ modality: value });
  const access = searchParams.get("access") ?? "all";
  const setAccess = (value: string) => updateMarketplaceLocation({ access: value });
  const domain = searchParams.get("topic") ?? "all";
  const setDomain = (value: string) => updateMarketplaceLocation({ topic: value });
  const sort = searchParams.get("sort") ?? "catalog";
  const setSort = (value: string) => updateMarketplaceLocation({ sort: value });
  const compact = searchParams.get("compact") === "1";
  const setCompact = (value: boolean) => updateMarketplaceLocation({ compact: value ? "1" : null });
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const [showJobs, setShowJobs] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadGeneration = useRef(0);
  const closeDetails = useCallback(() => { updateMarketplaceLocation({ dataset: null, scope: null }); setComparing(false); setCredentials({}); }, []);
  const dialogRef = useMarketplaceDialog(comparing ? "compare" : selectedId, closeDetails);
  const selected = catalog.find((entry) => entry.id === selectedId) ?? null;
  const selectedOption = selected?.downloadOptions?.find((option) => option.id === selectionId);
  const selectedJob = jobs.find((job) => job.datasetId === selectedId && (job.selectionId ?? "full") === selectionId);
  const [requirements, setRequirements] = useState<{ key: string; tools: string[]; missing: string[]; error?: string } | null>(null);
  const [requirementsRefresh, setRequirementsRefresh] = useState(0);
  const requirementsKey = `${selectedId}:${selectionId}`;
  const checkedRequirements = requirements?.key === requirementsKey ? requirements : null;
  useEffect(() => {
    setCredentials({}); setError(null);
  }, [selectedId, selectionId]);
  useEffect(() => {
    if (!selected?.downloadAvailable) return;
    let cancelled = false;
    setRequirements(null);
    void api.datasets.requirements(selected.id, selectionId).then((result) => {
      if (!cancelled) setRequirements({ key: requirementsKey, ...result });
    }).catch((reason) => {
      if (!cancelled) setRequirements({ key: requirementsKey, tools: [], missing: [], error: String(reason) });
    });
    return () => { cancelled = true; };
  }, [selected?.id, selected?.downloadAvailable, selectionId, requirementsKey, requirementsRefresh]);
  const errorMessage = (message: string) => message === t("datasets.copyFailed") ? message : t(datasetErrorKey(message));
  const datasetActions = (job: DatasetDownloadJob) => job.status === "completed" ? <>
    {onOpenDataset ? <button className="plugin-card__button plugin-card__button--ghost" type="button" onClick={() => onOpenDataset(datasetWorkspacePath(job))}>{t("datasets.openFiles")}</button> : null}
    {onUseDataset ? <button className="plugin-card__button" type="button" onClick={() => onUseDataset(datasetWorkspacePath(job))}>{t("datasets.useInResearch")}</button> : null}
  </> : null;
  const jobsByDataset = useMemo(() => latestDatasetJobsByDataset(jobs), [jobs]);
  const activeCount = jobs.filter((job) => job.status === "queued" || job.status === "downloading").length;
  const scopeLabel = (job: DatasetDownloadJob) => {
    const option = catalog.find((entry) => entry.id === job.datasetId)?.downloadOptions?.find((item) => item.id === job.selectionId);
    return option ? chinese ? option.labelZh : option.label : job.selectionLabel ?? t(job.selectionId && job.selectionId !== "full" ? "datasets.subset" : "datasets.fullDataset");
  };
  const summary = (entry: DatasetCatalogEntry) => chinese ? entry.summaryZh ?? entry.summary : entry.summary;

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setError(null);
    try {
      const [entries, downloads] = await Promise.all([api.datasets.catalog(), api.datasets.downloads()]);
      if (generation !== loadGeneration.current) return;
      setCatalog(entries); setJobs(downloads); onCount(entries.length);
    } catch (reason) {
      if (generation === loadGeneration.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [onCount]);
  useEffect(() => { void load(); return () => { ++loadGeneration.current; }; }, [load, refreshSignal]);
  const downloading = activeCount > 0;
  useEffect(() => {
    if (!downloading) return;
    let disposed = false;
    let timer: number;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try { const next = await api.datasets.downloads(); if (!disposed) setJobs(next); }
        catch (reason) { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); }
      }
      if (!disposed) timer = window.setTimeout(poll, 2_000);
    };
    timer = window.setTimeout(poll, 2_000);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [downloading]);

  const modalities = useMemo(() => [...new Set(catalog.flatMap((entry) => entry.modalities))].sort(), [catalog]);
  const visible = useMemo(() => {
    const entries = catalog.filter((entry) => matchesDataset(entry, query)
      && (modality === "all" || entry.modalities.includes(modality))
      && (domain === "all" || entry.domains?.includes(domain))
      && (access === "all" || (access === "automatic" ? entry.downloadAvailable && entry.access === "direct" : access === "provider" ? !entry.downloadAvailable : entry.access === access)));
    if (sort === "name") entries.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "samples") entries.sort((a, b) => Number(Boolean(b.downloadOptions?.length)) - Number(Boolean(a.downloadOptions?.length)));
    return entries;
  }, [catalog, query, modality, domain, access, sort]);
  const filtered = Boolean(query || modality !== "all" || access !== "all" || domain !== "all");
  const reset = () => { updateMarketplaceLocation({ modality: null, access: null, topic: null }); onQueryChange?.(""); };
  const showDetails = (id: string, option?: string) => {
    updateMarketplaceLocation({ dataset: id, scope: option ?? catalog.find((entry) => entry.id === id)?.downloadOptions?.[0]?.id ?? "full" }, false);
    setComparing(false); setCredentials({}); setError(null); setCopied(null);
  };
  const updateJob = (job: DatasetDownloadJob) => setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
  const start = async (entry: DatasetCatalogEntry) => {
    if (startingRef.current) return;
    startingRef.current = true; setBusy(true); setError(null);
    try {
      const scope = entry.id === selectedId ? selectionId : "full";
      const check = await api.datasets.requirements(entry.id, scope);
      if (check.missing.length) { showDetails(entry.id, scope); return; }
      updateJob(await api.datasets.download(entry.id, entry.id === selectedId ? credentials : {}, scope));
      setCredentials({}); setShowJobs(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { startingRef.current = false; setBusy(false); }
  };
  const cancel = async (id: string) => {
    setBusy(true); setError(null);
    try { updateJob(await api.datasets.cancel(id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const copyPath = async (job: DatasetDownloadJob) => {
    try { await navigator.clipboard.writeText(job.targetDir); setCopied(job.id); }
    catch { setError(t("datasets.copyFailed")); }
  };

  if (loading && catalog.length === 0) return <div className="plugin-market__empty" role="status"><Loader2 className="is-spinning" size={24} /><strong>{t("datasets.loading")}</strong></div>;
  return <>
    <div className="dataset-discovery">
      <div><h2>{t("datasets.discoverTitle")}</h2><p>{t("datasets.discoverHint")}</p></div>
      <button className="plugin-card__button plugin-card__button--ghost" aria-expanded={showJobs} onClick={() => setShowJobs((value) => !value)} type="button"><HardDrive size={15} />{t("datasets.myDownloads")} <span>{activeCount || jobs.length}</span></button>
    </div>
    <div className="dataset-toolbar">
      <label><span>{t("datasets.domain")}</span><select value={domain} onChange={(event) => setDomain(event.target.value)}><option value="all">{t("datasets.allDomains")}</option>{Object.keys(DATASET_DOMAINS).map((item) => <option key={item} value={item}>{domainLabel(item, chinese)} ({catalog.filter((entry) => entry.domains?.includes(item)).length})</option>)}</select></label>
      <label><span>{t("datasets.modalities")}</span><select value={modality} onChange={(event) => setModality(event.target.value)}><option value="all">{t("datasets.allModalities")}</option>{modalities.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>{t("datasets.accessLabel")}</span><select value={access} onChange={(event) => setAccess(event.target.value)}><option value="all">{t("datasets.allAccess")}</option><option value="automatic">{t("datasets.automatic")}</option><option value="provider">{t("datasets.providerSelection")}</option><option value="credentials">{t("datasets.access.credentials")}</option><option value="application">{t("datasets.access.application")}</option></select></label>
      <label><span>{t("datasets.sort")}</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value="catalog">{t("datasets.sortCatalog")}</option><option value="samples">{t("datasets.sortSamples")}</option><option value="name">{t("datasets.sortName")}</option></select></label>
      <button className="plugin-card__button plugin-card__button--ghost" aria-pressed={compact} onClick={() => setCompact(!compact)} type="button">{compact ? <LayoutGrid size={15} /> : <List size={15} />}{t(compact ? "datasets.cards" : "datasets.compact")}</button>
    </div>
    <div className="dataset-results"><span role="status">{visible.length} / {catalog.length} {t("marketplace.category.datasets")}</span>{filtered ? <button onClick={reset} type="button">{t("datasets.resetFilters")}</button> : null}</div>
    {error && !selected ? <div role="alert" className="plugin-market__notice plugin-market__notice--error"><span>{errorMessage(error)}</span><button onClick={() => void load()} type="button">{t("marketplace.retry")}</button></div> : null}
    {showJobs ? <section className="dataset-downloads" aria-label={t("datasets.myDownloads")}>
      <header><h3>{t("datasets.myDownloads")}</h3><span>{t("datasets.queueHint")}</span></header>
      {jobs.length === 0 ? <p>{t("datasets.noDownloads")}</p> : <div className="dataset-downloads__list">{jobs.map((job) => <article key={job.id}>
        <div><button className="dataset-title-button" onClick={() => showDetails(job.datasetId, job.selectionId ?? "full")} type="button">{job.datasetName}</button><small>{scopeLabel(job)}</small><span className={`plugin-card__state ${statusClass(job.status)}`}>{t(`datasets.job.${job.status}`)}</span>{job.bytesDownloaded !== undefined ? <span>{formatBytes(job.bytesDownloaded)}{job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""}</span> : null}{job.error ? <p className="dataset-job-error">{errorMessage(job.error)}</p> : null}</div>
        <div>{datasetActions(job)}<button className="plugin-card__button plugin-card__button--ghost" onClick={() => void copyPath(job)} type="button"><Copy size={14} />{t(copied === job.id ? "datasets.copied" : "datasets.copyPath")}</button>{job.status === "queued" || job.status === "downloading" ? <button className="plugin-card__button plugin-card__button--ghost" disabled={busy} onClick={() => void cancel(job.id)} type="button">{t("datasets.cancel")}</button> : job.status === "failed" || job.status === "cancelled" ? <button className="plugin-card__button" onClick={() => showDetails(job.datasetId, job.selectionId ?? "full")} type="button">{t("marketplace.retry")}</button> : null}</div>
      </article>)}</div>}
    </section> : null}
    {!loading && visible.length === 0 ? <div className="plugin-market__empty"><Database size={24} /><strong>{t("datasets.empty")}</strong><p>{t("datasets.emptyHint")}</p>{filtered ? <button className="plugin-card__button" onClick={reset} type="button">{t("datasets.resetFilters")}</button> : null}</div> : null}
    <div className={`plugin-market__grid ${compact ? "dataset-grid--compact" : ""}`}>
      {visible.map((entry) => {
        const job = jobsByDataset.get(entry.id);
        const primaryAction = datasetCardAction(entry, job);
        const question = entry.researchQuestions?.[0];
        return <article className="plugin-card dataset-card" key={entry.id}>
          <div className="plugin-card__head"><div className="plugin-card__icon plugin-card__icon--datasets"><Database size={22} /></div><div className="plugin-card__identity"><h2><button className="dataset-title-button" onClick={() => showDetails(entry.id)} type="button">{entry.name}</button></h2><span className="plugin-source-badge">{entry.provider}</span></div></div>
          <p className="plugin-card__description">{summary(entry)}</p>
          {question ? <p className="dataset-question">{chinese ? question.zh : question.en}</p> : null}
          <div className="plugin-card__capabilities">{entry.modalities.map((item) => <span key={item}>{item}</span>)}</div>
          <div className="plugin-card__meta"><span>{entry.size ?? entry.subjects ?? entry.license}</span><span className={`plugin-card__state ${job ? statusClass(job.status) : ""}`}>{job ? `${job.selectionId && job.selectionId !== "full" ? `${t("datasets.subset")} · ` : ""}${t(`datasets.job.${job.status}`)}` : t(`datasets.access.${entry.access}`)}</span></div>
          <div className="dataset-card__facts"><span>{entry.formats?.join(" · ") ?? entry.license}</span><span>{entry.downloadOptions?.length ? t("datasets.sampleAvailable") : entry.subjects}</span></div>
          {job?.bytesDownloaded !== undefined ? <div className="dataset-progress"><progress aria-label={t("datasets.downloadStatus")} max={job.totalBytes || undefined} value={job.totalBytes ? Math.min(job.bytesDownloaded, job.totalBytes) : undefined} /><span>{formatBytes(job.bytesDownloaded)}{job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""}</span></div> : null}
          <div className="plugin-card__actions"><label className="dataset-compare-check"><input type="checkbox" checked={compareIds.includes(entry.id)} disabled={compareIds.length >= 3 && !compareIds.includes(entry.id)} onChange={() => setCompareIds((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id])} />{t("datasets.compare")}</label><button className="plugin-card__button" disabled={busy && primaryAction === "download"} onClick={() => handleDatasetCardAction(entry, { download: (target) => void start(target), showDetails }, job)} type="button">{primaryAction === "download" ? <><Download size={14} />{t("datasets.download")}</> : t(entry.downloadOptions?.length ? "datasets.chooseDownload" : "marketplace.details")}</button></div>
        </article>;
      })}
    </div>
    {compareIds.length && !comparing ? <div className="dataset-compare-bar"><span>{compareIds.map((id) => catalog.find((entry) => entry.id === id)?.name).join(" · ")}</span><button className="plugin-card__button" type="button" onClick={() => { setSelectedId(null); setComparing(true); }}>{t("datasets.compare")} ({compareIds.length}/3)</button><button className="plugin-card__button plugin-card__button--ghost" type="button" onClick={() => setCompareIds([])}>{t("datasets.clearCompare")}</button></div> : null}
    {selected || comparing ? <div className="plugin-detail-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) closeDetails(); }}>
      <section ref={dialogRef} tabIndex={-1} aria-labelledby="dataset-detail-title" aria-modal="true" className={`plugin-detail ${comparing ? "dataset-comparison" : ""}`} role="dialog">
        <header className="plugin-detail__header"><div className="plugin-card__icon plugin-card__icon--datasets"><Database size={24} /></div><div><span>{selected?.provider}</span><h2 id="dataset-detail-title">{selected?.name ?? t("datasets.compare")}</h2></div><button className="plugin-detail__close" onClick={closeDetails} title={t("marketplace.close")} type="button"><X size={17} /></button></header>
        <div className="plugin-detail__body">
          {comparing ? <div className="dataset-comparison__scroll"><table><thead><tr><th>{t("datasets.about")}</th>{compareIds.map((id) => <th key={id}>{catalog.find((entry) => entry.id === id)?.name}</th>)}</tr></thead><tbody>{["question", "modalities", "size", "license", "access", "version"].map((field) => <tr key={field}><th>{t(`datasets.${field === "question" ? "researchQuestion" : field === "access" ? "accessLabel" : field}`)}</th>{compareIds.map((id) => { const entry = catalog.find((item) => item.id === id)!; return <td key={id}>{field === "question" ? entry.researchQuestions?.map((q) => chinese ? q.zh : q.en).join(" ") : field === "modalities" ? entry.modalities.join(" · ") : field === "access" ? t(`datasets.access.${entry.access}`) : entry[field as "size" | "license" | "version"] ?? t("datasets.notReported")}</td>; })}</tr>)}</tbody></table></div> : selected ? <>
            {error ? <p role="alert" className="dataset-job-error">{error}</p> : null}
            <section><h3>{t("datasets.about")}</h3>{chinese ? <><p>{summary(selected)}</p><details><summary>{t("datasets.englishNotes")}</summary><p>{selected.description}</p></details></> : <p>{selected.description}</p>}</section>
            {selected.researchQuestions?.length ? <section><h3>{t("datasets.researchQuestion")}</h3>{selected.researchQuestions.map((question) => <p key={question.en}>{chinese ? question.zh : question.en}</p>)}</section> : null}
            {selected.downloadOptions?.length ? <section className="dataset-selection"><h3>{t("datasets.downloadScope")}</h3><label><span className="sr-only">{t("datasets.downloadScope")}</span><select value={selectionId} onChange={(event) => setSelectionId(event.target.value)}>{selected.downloadOptions.map((option) => <option key={option.id} value={option.id}>{chinese ? option.labelZh : option.label}</option>)}<option value="full">{t("datasets.fullDataset")}{selected.size ? ` · ${selected.size}` : ""}</option></select></label><p>{selectedOption ? chinese ? selectedOption.descriptionZh : selectedOption.description : t("datasets.fullHint")}</p></section> : null}
            <dl className="plugin-detail__facts">
              <div><dt>{t("datasets.provider")}</dt><dd>{selected.provider}</dd></div><div><dt>{t("datasets.accessLabel")}</dt><dd>{t(`datasets.access.${selected.access}`)}</dd></div>
              {selected.subjects ? <div><dt>{t("datasets.subjects")}</dt><dd>{selected.subjects}</dd></div> : null}
              {selected.size ? <div><dt>{t(selected.downloadOptions?.length ? "datasets.fullSize" : "datasets.size")}</dt><dd>{selected.size}</dd></div> : null}
              <div><dt>{t("datasets.license")}</dt><dd>{selected.license}</dd></div>
              {selected.version ? <div><dt>{t("datasets.version")}</dt><dd>{selected.version}</dd></div> : null}
              {selected.formats?.length ? <div><dt>{t("datasets.formats")}</dt><dd>{selected.formats.join(" · ")}</dd></div> : null}
              {selected.reviewedAt ? <div><dt>{t("datasets.reviewedAt")}</dt><dd>{selected.reviewedAt}</dd></div> : null}
              <div><dt>{t("datasets.modalities")}</dt><dd>{selected.modalities.join(" · ")}</dd></div>
              {selected.tool ? <div><dt>{t("datasets.tool")}</dt><dd>{selectedOption?.tool ?? selected.tool}</dd></div> : null}
            </dl>
            {selected.downloadAvailable ? <section aria-live="polite">
              <h3>{t("datasets.requirementsTitle")}</h3>
              <p>{!checkedRequirements ? t("datasets.checkingTools") : checkedRequirements.error ? errorMessage(checkedRequirements.error) : checkedRequirements.missing.length ? t("datasets.missingTools", { tools: checkedRequirements.missing.join(", ") }) : t("datasets.toolsReady")}</p>
              {checkedRequirements?.missing.length ? <>
                <p>{t("datasets.installToolsHint")}</p>
                {checkedRequirements.tools.includes("datalad") ? <a href="https://handbook.datalad.org/en/latest/intro/installation.html" target="_blank" rel="noreferrer">{t("datasets.installHelp")} (DataLad / git-annex)</a> : <a href={selected.homepage} target="_blank" rel="noreferrer">{t("datasets.providerInstructions")}</a>}
              </> : null}
              <button className="plugin-card__button plugin-card__button--ghost" type="button" onClick={() => setRequirementsRefresh((value) => value + 1)} disabled={!checkedRequirements}>{t("datasets.recheckTools")}</button>
            </section> : null}
            <div className="plugin-detail__warning"><AlertTriangle size={16} /><span>{chinese ? selected.accessNoteZh ?? selected.accessNote : selected.accessNote}</span></div>
            {selected.checksumUrl ? <a href={selected.checksumUrl} rel="noreferrer" target="_blank">{t("datasets.checksums")} <ExternalLink size={12} /></a> : null}
            {selected.citation ? <section><h3>{t("datasets.citation")}</h3><p>{selected.citation}</p></section> : null}
            {selected.downloadCommand ? <details><summary>{t("datasets.downloadCommand")}</summary><p>{t("datasets.commandHint")}</p><code className="dataset-download-command">{selected.downloadCommand}</code></details> : null}
            {selected.credentialFields?.length ? <section className="dataset-credentials"><h3>{t("datasets.credentials")}</h3><p>{t("datasets.credentialsHint")}</p>{selected.credentialFields.map((field) => <label key={field.id}><span>{field.label}{field.required ? " *" : ""}</span><input autoComplete="off" onChange={(event) => setCredentials((current) => ({ ...current, [field.id]: event.target.value }))} type={field.secret ? "password" : "text"} value={credentials[field.id] ?? ""} />{field.help ? <small>{field.help}</small> : null}</label>)}</section> : null}
            {selectedJob ? <section><h3>{t("datasets.downloadStatus")}</h3><p className={`plugin-card__state ${statusClass(selectedJob.status)}`}>{t(`datasets.job.${selectedJob.status}`)}</p>{selectedJob.bytesDownloaded !== undefined ? <p>{formatBytes(selectedJob.bytesDownloaded)}{selectedJob.totalBytes ? ` / ${formatBytes(selectedJob.totalBytes)}` : ""}</p> : null}{selectedJob.error ? <p className="dataset-job-error">{errorMessage(selectedJob.error)}</p> : null}<p>{selectedJob.targetDir}</p>{datasetActions(selectedJob)}<button className="plugin-card__button plugin-card__button--ghost" onClick={() => void copyPath(selectedJob)} type="button"><Copy size={14} />{t(copied === selectedJob.id ? "datasets.copied" : "datasets.copyPath")}</button></section> : null}
          </> : null}
        </div>
        <footer className="plugin-detail__actions">{selected ? <><a className="plugin-card__button plugin-card__button--ghost" href={selected.homepage} rel="noreferrer" target="_blank">{t("datasets.openProvider")} <ExternalLink size={13} /></a>{selectedJob?.status === "queued" || selectedJob?.status === "downloading" ? <button className="plugin-card__button" disabled={busy} onClick={() => void cancel(selectedJob.id)} type="button">{t("datasets.cancel")}</button> : selected.downloadAvailable ? <button className="plugin-card__button" disabled={busy || !checkedRequirements || Boolean(checkedRequirements.error) || checkedRequirements.missing.length > 0 || !hasRequiredDatasetCredentials(selected, credentials)} onClick={() => void start(selected)} type="button"><Download size={14} />{t(selectedJob?.status === "completed" ? "datasets.runAgain" : "datasets.startDownload")}</button> : null}</> : <button className="plugin-card__button" onClick={closeDetails} type="button">{t("marketplace.close")}</button>}</footer>
      </section>
    </div> : null}
  </>;
}
