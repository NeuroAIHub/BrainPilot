import { AlertTriangle, ArrowRight, Box, Clock3, FileText, GitBranch, Timer, Wrench } from "lucide-react";
import { TraceNode } from "../../contracts/backend";
import { TranslateVars } from "../../i18n/translate";
import { formatToolName } from "../../utils/toolDisplay";
import {
  artifactLabels,
  formatDuration,
  formatTime,
  getNodeKind,
  getStatusLabelKey,
  normalizeStatus,
  relationLabels,
} from "./traceLayout";

interface TraceNodeDetailProps {
  node: TraceNode | null;
  nodes?: TraceNode[];
  onSelectNode: (id: string) => void;
  /** When provided, artifact rows become buttons that focus that file. */
  onSelectArtifact?: (path: string) => void;
  /** Currently focused artifact path (for highlight). */
  activeArtifactPath?: string | null;
  formatKind?: (kind: string) => string;
  t: (key: string, vars?: TranslateVars) => string;
}

/**
 * Presentational detail pane for a single reasoning-trace node. Extracted from
 * TracePanel so the live trace view and the demo replay share it. In the demo
 * an `onSelectArtifact` handler wires artifact rows to the file preview.
 */
export function TraceNodeDetail({ node, nodes, onSelectNode, onSelectArtifact, activeArtifactPath, formatKind, t }: TraceNodeDetailProps) {
  if (!node) {
    return <p>{t("trace.node.noneSelected")}</p>;
  }
  const statusKey = getStatusLabelKey(node.status);
  const nodeById = new Map((nodes ?? []).map((item) => [item.id, item]));
  const kind = getNodeKind(node);
  const kindLabel = formatKind?.(kind) ?? kind;
  const parentLabel = (id: string) =>
    nodeById.get(id)?.title || t("trace.node.parentFallback");
  const childNodes = node.childIds
    .map((id) => ({ id, title: nodeById.get(id)?.title }))
    .filter((item) => item.title);
  const metrics = [
    node.durationMs !== undefined
      ? { key: "duration", icon: <Timer size={13} />, label: formatDuration(node.durationMs) }
      : null,
    node.toolCalls.length > 0
      ? { key: "tools", icon: <Wrench size={13} />, label: t("trace.node.tools", { count: node.toolCalls.length }) }
      : null,
    node.artifacts.length > 0
      ? { key: "artifacts", icon: <Box size={13} />, label: t("trace.node.artifacts", { count: node.artifacts.length }) }
      : null,
  ].filter((item): item is { key: string; icon: JSX.Element; label: string } => item !== null);

  return (
    <>
      <div className="trace-detail__title">
        <GitBranch size={17} />
        <h3>{node.title}</h3>
        <span className={`trace-detail__status trace-detail__status--${normalizeStatus(node.status)}`}>
          {statusKey ? t(statusKey) : node.status}
        </span>
      </div>
      <div className="trace-detail__badges">
        <span title={kind}>{kindLabel}</span>
        {node.agent ? <span>{node.agent}</span> : null}
        {node.metadata?.auto ? (
          <span className="trace-detail__badge--auto" title={t("trace.node.autoTitle")}>
            {t("trace.node.auto")}
          </span>
        ) : null}
      </div>
      <p>{node.summary || node.description || node.content || "No summary recorded."}</p>
      {node.reason ? (
        <section className="trace-detail__section">
          <h4><ArrowRight size={13} /> Reason</h4>
          <p>{node.reason}</p>
        </section>
      ) : null}
      {node.context ? (
        <section className="trace-detail__section">
          <h4><FileText size={13} /> Context</h4>
          <p>{node.context}</p>
        </section>
      ) : null}
      {metrics.length > 0 ? (
        <div className="trace-detail__metrics">
          {metrics.map((metric) => (
            <span key={metric.key}>{metric.icon} {metric.label}</span>
          ))}
        </div>
      ) : null}
      {node.parents.length > 0 ? (
        <section className="trace-detail__section">
          <h4><GitBranch size={13} /> {t("trace.node.dependencies")}</h4>
          <div className="trace-relation-list">
            {node.parents.map((parent) => (
              <button key={parent.id} onClick={() => onSelectNode(parent.id)} title={parent.id} type="button">
                <strong>{parentLabel(parent.id)}</strong>
                <span>{relationLabels[parent.relation || ""] || parent.relation || "parent"}</span>
                {parent.explanation ? <small>{parent.explanation}</small> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {node.toolCalls.length > 0 ? (
        <section className="trace-detail__section">
          <h4><Wrench size={13} /> {t("trace.node.toolCalls")}</h4>
          <div className="trace-chip-list">
            {node.toolCalls.map((tool) => <span key={tool} title={tool}>{formatToolName(tool)}</span>)}
          </div>
        </section>
      ) : null}
      {node.errorMessage ? (
        <section className="trace-detail__section trace-detail__section--error">
          <h4><AlertTriangle size={13} /> {t("trace.node.error")}</h4>
          <p>{node.errorMessage}</p>
        </section>
      ) : null}
      {node.artifacts.length > 0 ? (
        <section className="trace-detail__section">
          <h4><Box size={13} /> {t("trace.node.artifactsTitle")}</h4>
          <div className="trace-artifact-list">
            {node.artifacts.map((artifact) => {
              const label = artifactLabels[artifact.type || ""] || artifact.type || "file";
              const name = artifact.path.split("/").pop() || artifact.path;
              if (onSelectArtifact) {
                return (
                  <button
                    key={`${artifact.path}-${artifact.type || ""}`}
                    type="button"
                    className={`trace-artifact-row ${activeArtifactPath === artifact.path ? "is-active" : ""}`}
                    title={artifact.path}
                    onClick={() => onSelectArtifact(artifact.path)}
                  >
                    <FileText size={13} />
                    <span>{name}</span>
                    <small>{label}</small>
                  </button>
                );
              }
              return (
                <div key={`${artifact.path}-${artifact.type || ""}`} title={artifact.path}>
                  <FileText size={13} />
                  <span>{name}</span>
                  <small>{label}</small>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}
      <section className="trace-detail__section">
        <h4><Clock3 size={13} /> {t("trace.node.timeline")}</h4>
        <dl>
          <div>
            <dt>{t("trace.node.created")}</dt>
            <dd>{formatTime(node.timestamp?.createdAt || node.createdAt)}</dd>
          </div>
          {childNodes.length > 0 ? (
            <div>
              <dt>{t("trace.node.children")}</dt>
              <dd className="trace-detail__children">
                {childNodes.map((child) => (
                  <button key={child.id} onClick={() => onSelectNode(child.id)} title={child.id} type="button">
                    {child.title}
                  </button>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>
    </>
  );
}
