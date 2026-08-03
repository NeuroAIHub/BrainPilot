import { AlertTriangle, FileDiff, GitCommit, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TraceCausalRollbackPreview, TraceChange, TraceCheckpointDetail, TraceCheckpointRef, TraceNode, TraceRestorePreview } from "../../contracts/backend";
import { api } from "../../utils/api";

interface Props {
  node: TraceNode;
  sessionId?: string;
  restoreDisabled?: boolean;
  onRestored?: () => Promise<void> | void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

/** Latest causal rollback for this node that has not been consumed by Undo. */
export function findPendingCausalRollback(changes: TraceChange[], nodeId: string): string | null {
  const undone = new Set(changes.flatMap((change) =>
    change.action === "causal_rollback_undo" && typeof change.metadata?.rollbackChangeId === "string"
      ? [change.metadata.rollbackChangeId]
      : [],
  ));
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index]!;
    if (change.action !== "causal_rollback" || change.target.nodeId !== nodeId || undone.has(change.id)) continue;
    if (typeof change.metadata?.recoveryCheckpointId === "string") return change.metadata.recoveryCheckpointId;
  }
  return null;
}

export function TraceCheckpointDetail({ node, sessionId, restoreDisabled, onRestored, t }: Props) {
  const embedded = node.checkpoints ?? [];
  const [details, setDetails] = useState<TraceCheckpointDetail[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(embedded.at(-1)?.id ?? null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TraceRestorePreview | null>(null);
  const [causalPreview, setCausalPreview] = useState<TraceCausalRollbackPreview | null>(null);
  const [recoveryId, setRecoveryId] = useState<string | null>(
    typeof node.metadata?.recoveryCheckpointId === "string" ? node.metadata.recoveryCheckpointId : null,
  );

  useEffect(() => {
    setSelectedId(embedded.at(-1)?.id ?? null);
    setSelectedPath(null);
    setDiff("");
    setPreview(null);
    setCausalPreview(null);
    setError(null);
    setRecoveryId(typeof node.metadata?.recoveryCheckpointId === "string" ? node.metadata.recoveryCheckpointId : null);
    if (!sessionId) {
      setDetails([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const detailRequest = embedded.length > 0
      ? api.sessions.getTraceNodeCheckpoints(sessionId, node.id)
      : Promise.resolve([] as TraceCheckpointDetail[]);
    void Promise.all([detailRequest, api.sessions.getTraceChanges(sessionId, 500)])
      .then(([value, changes]) => {
        if (cancelled) return;
        setDetails(value);
        setRecoveryId(findPendingCausalRollback(changes, node.id));
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [node.id, sessionId, embedded.length]);

  const selectedRef: TraceCheckpointRef | undefined = useMemo(
    () => embedded.find((item) => item.id === selectedId) ?? embedded.at(-1),
    [embedded, selectedId],
  );
  const selectedDetail = details.find((item) => item.checkpoint.id === selectedRef?.id);

  // A causal rollback belongs to the graph node, not to the node's own
  // checkpoint. A branch point may have no snapshot while its descendants do,
  // and rollback audit nodes need to expose their recovery checkpoint.
  if (embedded.length === 0 && !sessionId && !recoveryId) return null;

  const loadDiff = async (path: string) => {
    if (!sessionId || !selectedRef) return;
    setSelectedPath(path);
    setLoading(true);
    setError(null);
    try {
      setDiff(await api.sessions.getTraceCheckpointDiff(sessionId, selectedRef.id, path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const beginRestore = async (checkpointId: string) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      setPreview(await api.sessions.getTraceRestorePreview(sessionId, checkpointId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const executeRestore = async (value: TraceRestorePreview) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.sessions.restoreTraceCheckpoint(sessionId, value.checkpointId, value.stateToken);
      setRecoveryId(result.recoveryCheckpointId);
      setPreview(null);
      window.dispatchEvent(new CustomEvent("brainpilot:workspace-restored", { detail: { sessionId } }));
      await onRestored?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const beginCausalRollback = async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      setCausalPreview(await api.sessions.getTraceCausalRollbackPreview(sessionId, node.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const executeCausalRollback = async (value: TraceCausalRollbackPreview) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.sessions.rollbackTraceNode(sessionId, node.id, value.stateToken);
      setRecoveryId(result.recoveryCheckpointId);
      setCausalPreview(null);
      window.dispatchEvent(new CustomEvent("brainpilot:workspace-restored", { detail: { sessionId } }));
      await onRestored?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setCausalPreview(null);
    } finally {
      setLoading(false);
    }
  };

  const undo = async () => {
    if (!sessionId || !recoveryId) return;
    setLoading(true);
    setError(null);
    try {
      const value = await api.sessions.getTraceRestorePreview(sessionId, recoveryId);
      const result = await api.sessions.restoreTraceCheckpoint(sessionId, recoveryId, value.stateToken);
      setRecoveryId(result.recoveryCheckpointId);
      window.dispatchEvent(new CustomEvent("brainpilot:workspace-restored", { detail: { sessionId } }));
      await onRestored?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  };

  const statusText = selectedRef?.status === "partial"
    ? t("trace.checkpoint.partial")
    : selectedRef?.status === "ready"
      ? t("trace.checkpoint.ready")
      : t("trace.checkpoint.failed");

  return (
    <section className="trace-detail__section trace-checkpoint">
      <h4><GitCommit size={13} /> {t("trace.checkpoint.title")}</h4>
      {selectedRef ? <div className="trace-checkpoint__toolbar">
        <select
          aria-label={t("trace.checkpoint.version")}
          value={selectedRef?.id ?? ""}
          onChange={(event) => { setSelectedId(event.target.value); setSelectedPath(null); setDiff(""); setPreview(null); }}
        >
          {embedded.map((item, index) => <option key={item.id} value={item.id}>{embedded.length - index}. {item.capturedAt}</option>)}
        </select>
        <span className={`trace-checkpoint__status is-${selectedRef?.status}`}>{statusText}</span>
      </div> : null}
      {selectedRef?.stats ? (
        <p className="trace-checkpoint__summary">
          {t("trace.checkpoint.summary", {
            files: selectedRef.stats.files,
            added: selectedRef.stats.added,
            modified: selectedRef.stats.modified,
            deleted: selectedRef.stats.deleted,
          })}
        </p>
      ) : null}
      {selectedRef?.error ? <p className="trace-checkpoint__error"><AlertTriangle size={13} /> {selectedRef.error}</p> : null}
      {loading ? <p className="trace-checkpoint__loading"><Loader2 size={13} /> {t("trace.checkpoint.loading")}</p> : null}
      {error ? <p className="trace-checkpoint__error"><AlertTriangle size={13} /> {error}</p> : null}
      {selectedDetail?.files.length ? (
        <div className="trace-checkpoint__files">
          {selectedDetail.files.map((file) => (
            <button key={`${file.status}:${file.path}`} type="button" className={selectedPath === file.path ? "is-active" : ""} onClick={() => void loadDiff(file.path)}>
              <span className={`trace-checkpoint__code is-${file.status}`}>{file.status[0]?.toUpperCase()}</span>
              <span>{file.path}</span>
              <small>{file.binary ? t("trace.checkpoint.binary") : `+${file.additions ?? 0} −${file.deletions ?? 0}`}</small>
            </button>
          ))}
        </div>
      ) : selectedDetail ? <p>{t("trace.checkpoint.noChanges")}</p> : null}
      {selectedDetail?.skipped.length ? (
        <details className="trace-checkpoint__skipped">
          <summary>{t("trace.checkpoint.skipped", { count: selectedDetail.skipped.length })}</summary>
          {selectedDetail.skipped.map((item) => <div key={`${item.reason}:${item.path}`}>{item.path} <small>{item.reason}</small></div>)}
        </details>
      ) : null}
      {selectedPath && diff ? <pre className="trace-checkpoint__diff"><FileDiff size={13} />{diff}</pre> : null}
      {sessionId ? (
        <div className="trace-checkpoint__actions">
          {!recoveryId ? <button type="button" disabled={loading || restoreDisabled} onClick={() => void beginCausalRollback()}>
            <RotateCcw size={13} /> {t("trace.checkpoint.causalRollback")}
          </button> : null}
          {selectedRef?.commitId ? <button type="button" disabled={loading || restoreDisabled} onClick={() => void beginRestore(selectedRef.id)}>
            {t("trace.checkpoint.restoreSnapshot")}
          </button> : null}
          {recoveryId ? <button type="button" disabled={loading || restoreDisabled} onClick={() => void undo()}>{t("trace.checkpoint.undo")}</button> : null}
        </div>
      ) : null}
      {restoreDisabled ? <small>{t("trace.checkpoint.activeBlocked")}</small> : null}
      {preview ? (
        <div className="trace-checkpoint__confirm" role="alertdialog" aria-label={t("trace.checkpoint.confirmTitle")}>
          <strong>{t("trace.checkpoint.confirmTitle")}</strong>
          <p>{t("trace.checkpoint.confirmBody", { count: preview.files.length })}</p>
          <div>
            <button type="button" onClick={() => setPreview(null)}>{t("trace.checkpoint.cancel")}</button>
            <button type="button" onClick={() => void executeRestore(preview)}>{t("trace.checkpoint.confirm")}</button>
          </div>
        </div>
      ) : null}
      {causalPreview ? (
        <div className="trace-checkpoint__confirm" role="alertdialog" aria-label={t("trace.checkpoint.causalConfirmTitle")}>
          <strong>{t("trace.checkpoint.causalConfirmTitle")}</strong>
          <p>{t("trace.checkpoint.causalConfirmBody", {
            nodes: causalPreview.affectedNodeIds.length,
            files: causalPreview.files.length,
          })}</p>
          {causalPreview.conflicts.length ? (
            <p className="trace-checkpoint__error">
              <AlertTriangle size={13} /> {t("trace.checkpoint.causalConflicts", { count: causalPreview.conflicts.length })}
            </p>
          ) : null}
          <div>
            <button type="button" onClick={() => setCausalPreview(null)}>{t("trace.checkpoint.cancel")}</button>
            <button type="button" disabled={causalPreview.conflicts.length > 0} onClick={() => void executeCausalRollback(causalPreview)}>
              {t("trace.checkpoint.confirm")}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
