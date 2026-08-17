import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Download, ExternalLink, HardDrive, Loader2, LockKeyhole, X } from "lucide-react";
import { useT } from "../../i18n/useT";
import { api, type DatasetCatalogEntry, type DatasetDownloadJob } from "../../utils/api";

interface Props {
  query: string;
  onCount: (count: number) => void;
}

export type DatasetCardAction = "download" | "details";

export function canStartDatasetDownload(job?: DatasetDownloadJob): boolean {
  return job?.status !== "completed";
}

export function datasetCardAction(
  entry: DatasetCatalogEntry,
  job?: DatasetDownloadJob,
): DatasetCardAction {
  if (!canStartDatasetDownload(job)) return "details";
  return entry.downloadAvailable && !entry.credentialFields?.length ? "download" : "details";
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

function matches(entry: DatasetCatalogEntry, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || [entry.name, entry.summary, entry.description, entry.provider, entry.license, ...entry.modalities]
    .some((value) => value.toLocaleLowerCase().includes(normalized));
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

export function DatasetMarketplace({ query, onCount }: Props) {
  const t = useT();
  const [catalog, setCatalog] = useState<DatasetCatalogEntry[]>([]);
  const [jobs, setJobs] = useState<DatasetDownloadJob[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextCatalog, nextJobs] = await Promise.all([api.datasets.catalog(), api.datasets.downloads()]);
      setCatalog(nextCatalog);
      setJobs(nextJobs);
      onCount(nextCatalog.length);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [onCount]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!jobs.some((job) => job.status === "queued" || job.status === "downloading")) return;
    const timer = window.setInterval(() => void load(), 2_000);
    return () => window.clearInterval(timer);
  }, [jobs, load]);

  const visible = useMemo(() => catalog.filter((entry) => matches(entry, query)), [catalog, query]);
  const selected = catalog.find((entry) => entry.id === selectedId) ?? null;
  const jobsByDataset = useMemo(() => new Map(jobs.map((job) => [job.datasetId, job])), [jobs]);

  const start = async (entry: DatasetCatalogEntry) => {
    setBusy(true);
    setError(null);
    try {
      const job = await api.datasets.download(entry.id, credentials);
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setCredentials({});
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const showDetails = (id: string) => {
    setSelectedId(id);
    setCredentials({});
  };

  if (loading && catalog.length === 0) return <div className="plugin-market__empty"><Loader2 className="is-spinning" size={24} /><strong>{t("datasets.loading")}</strong></div>;
  return <>
    {error ? <div className="plugin-market__notice plugin-market__notice--error"><span>{error}</span><button onClick={() => void load()} type="button">{t("marketplace.retry")}</button></div> : null}
    {!loading && visible.length === 0 ? <div className="plugin-market__empty"><Database size={24} /><strong>{t("datasets.empty")}</strong></div> : null}
    <div className="plugin-market__grid">
      {visible.map((entry) => {
        const job = jobsByDataset.get(entry.id);
        const primaryAction = datasetCardAction(entry, job);
        return <article className="plugin-card dataset-card" key={entry.id}>
          <button className="plugin-card__details-trigger" onClick={() => showDetails(entry.id)} title={t("marketplace.details")} type="button"><span className="sr-only">{entry.name}</span></button>
          <div className="plugin-card__head">
            <div className="plugin-card__icon plugin-card__icon--datasets"><Database size={22} /></div>
            <div className="plugin-card__identity"><div><h2>{entry.name}</h2></div><span className="plugin-source-badge">{entry.provider}</span></div>
          </div>
          <p className="plugin-card__description">{entry.summary}</p>
          <div className="plugin-card__capabilities">{entry.modalities.map((item) => <span key={item}>{item}</span>)}</div>
          <div className="plugin-card__meta">
            <span>{entry.size ?? entry.subjects ?? entry.license}</span>
            <span className={`plugin-card__state ${job ? statusClass(job.status) : ""}`}>{job ? t(`datasets.job.${job.status}`) : t(`datasets.access.${entry.access}`)}</span>
          </div>
          <div className="plugin-card__actions">
            <button className="plugin-card__button" disabled={busy || job?.status === "queued" || job?.status === "downloading"} onClick={() => handleDatasetCardAction(entry, { download: (target) => void start(target), showDetails }, job)} type="button">{primaryAction === "download" ? <><Download size={14} />{t("datasets.download")}</> : t("marketplace.details")}</button>
          </div>
        </article>;
      })}
    </div>
    {selected ? (() => {
      const job = jobsByDataset.get(selected.id);
      const canDownload = selected.downloadAvailable === true;
      const credentialsComplete = hasRequiredDatasetCredentials(selected, credentials);
      return <div className="plugin-detail-layer" onMouseDown={(event) => { if (event.currentTarget === event.target) setSelectedId(null); }}>
        <section aria-labelledby="dataset-detail-title" aria-modal="true" className="plugin-detail" role="dialog">
          <header className="plugin-detail__header">
            <div className="plugin-card__icon plugin-card__icon--datasets"><Database size={24} /></div>
            <div><span>{selected.provider}</span><h2 id="dataset-detail-title">{selected.name}</h2></div>
            <div className="plugin-detail__badges"><span className={selected.access === "direct" ? "plugin-detail__verified" : "plugin-detail__test"}>{selected.access === "direct" ? <CheckCircle2 size={15} /> : <LockKeyhole size={15} />}{t(`datasets.access.${selected.access}`)}</span></div>
            <button className="plugin-detail__close" onClick={() => setSelectedId(null)} title={t("marketplace.close")} type="button"><X size={17} /></button>
          </header>
          <div className="plugin-detail__body">
            <section><h3>{t("datasets.about")}</h3><p>{selected.description}</p></section>
            <dl className="plugin-detail__facts">
              <div><dt>{t("datasets.provider")}</dt><dd>{selected.provider}</dd></div>
              {selected.subjects ? <div><dt>{t("datasets.subjects")}</dt><dd>{selected.subjects}</dd></div> : null}
              {selected.size ? <div><dt>{t("datasets.size")}</dt><dd>{selected.size}</dd></div> : null}
              <div><dt>{t("datasets.license")}</dt><dd>{selected.license}</dd></div>
              <div><dt>{t("datasets.modalities")}</dt><dd>{selected.modalities.join(" · ")}</dd></div>
              {selected.tool ? <div><dt>{t("datasets.tool")}</dt><dd>{selected.tool}</dd></div> : null}
              <div><dt>{t("datasets.homepage")}</dt><dd><a href={selected.homepage} rel="noreferrer" target="_blank">{selected.homepage.replace(/^https?:\/\//, "")} <ExternalLink size={12} /></a></dd></div>
            </dl>
            <div className="plugin-detail__warning"><AlertTriangle size={16} /><span>{selected.accessNote}</span></div>
            {selected.citation ? <section><h3>{t("datasets.citation")}</h3><p>{selected.citation}</p></section> : null}
            {selected.downloadCommand ? <section><h3>{t("datasets.downloadCommand")}</h3><code className="dataset-download-command">{selected.downloadCommand}</code></section> : null}
            {selected.credentialFields?.length ? <section className="dataset-credentials"><h3>{t("datasets.credentials")}</h3><p>{t("datasets.credentialsHint")}</p>{selected.credentialFields.map((field) => <label key={field.id}><span>{field.label}{field.required ? " *" : ""}</span><input autoComplete="off" onChange={(event) => setCredentials((current) => ({ ...current, [field.id]: event.target.value }))} type={field.secret ? "password" : "text"} value={credentials[field.id] ?? ""} />{field.help ? <small>{field.help}</small> : null}</label>)}</section> : null}
            {job ? <section><h3>{t("datasets.downloadStatus")}</h3><p className={`plugin-card__state ${statusClass(job.status)}`}>{job.status === "downloading" ? <Loader2 className="is-spinning" size={14} /> : job.status === "completed" ? <CheckCircle2 size={14} /> : null}{t(`datasets.job.${job.status}`)}</p>{job.bytesDownloaded !== undefined ? <p>{formatBytes(job.bytesDownloaded)}{job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ""}</p> : null}{job.error ? <p className="dataset-job-error">{job.error}</p> : null}<p><HardDrive size={14} /> {job.targetDir}</p></section> : null}
          </div>
          <footer className="plugin-detail__actions">
            <a className="plugin-card__button plugin-card__button--ghost" href={selected.homepage} rel="noreferrer" target="_blank">{t("datasets.openProvider")} <ExternalLink size={13} /></a>
            {canDownload && canStartDatasetDownload(job) ? <button className="plugin-card__button" disabled={busy || !credentialsComplete || job?.status === "queued" || job?.status === "downloading"} onClick={() => void start(selected)} type="button">{busy || job?.status === "downloading" ? <Loader2 className="is-spinning" size={14} /> : <Download size={14} />}{t("datasets.startDownload")}</button> : null}
          </footer>
        </section>
      </div>;
    })() : null}
  </>;
}
