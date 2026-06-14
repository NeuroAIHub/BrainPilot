import { AlertTriangle, ArrowRight, Box, Clock3, FileText, GitBranch, Timer, Wrench } from "lucide-react";
import { TraceNode } from "../../contracts/backend";
import { TranslateVars } from "../../i18n/translate";
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
  onSelectNode: (id: string) => void;
  /** When provided, artifact rows become buttons that focus that file. */
  onSelectArtifact?: (path: string) => void;
  /** Currently focused artifact path (for highlight). */
  activeArtifactPath?: string | null;
  t: (key: string, vars?: TranslateVars) => string;
}

/**
 * Presentational detail pane for a single reasoning-trace node. Extracted from
 * TracePanel so the live trace view and the demo replay share it. In the demo
 * an `onSelectArtifact` handler wires artifact rows to the file preview.
 */
export function TraceNodeDetail({ node, onSelectNode, onSelectArtifact, activeArtifactPath, t }: TraceNodeDetailProps) {
  if (!node) {
    return <p>No trace node selected.</p>;
  }
  const statusKey = getStatusLabelKey(node.status);
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
        <span>{node.id}</span>
        <span>{getNodeKind(node)}</span>
        <span>{node.agent || "agent unknown"}</span>
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
      <div className="trace-detail__metrics">
        <span><Timer size={13} /> {formatDuration(node.durationMs)}</span>
        <span><Wrench size={13} /> {node.toolCalls.length} tools</span>
        <span><Box size={13} /> {node.artifacts.length} artifacts</span>
      </div>
      {node.parents.length > 0 ? (
        <section className="trace-detail__section">
          <h4><GitBranch size={13} /> Dependencies</h4>
          <div className="trace-relation-list">
            {node.parents.map((parent) => (
              <button key={parent.id} onClick={() => onSelectNode(parent.id)} type="button">
                <strong>{parent.id}</strong>
                <span>{relationLabels[parent.relation || ""] || parent.relation || "parent"}{parent.edgeType ? ` · ${parent.edgeType}` : ""}</span>
                {parent.explanation ? <small>{parent.explanation}</small> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {node.toolCalls.length > 0 ? (
        <section className="trace-detail__section">
          <h4><Wrench size={13} /> Tool Calls</h4>
          <div className="trace-chip-list">
            {node.toolCalls.map((tool) => <span key={tool}>{tool}</span>)}
          </div>
        </section>
      ) : null}
      {node.errorMessage ? (
        <section className="trace-detail__section trace-detail__section--error">
          <h4><AlertTriangle size={13} /> Error</h4>
          <p>{node.errorMessage}</p>
        </section>
      ) : null}
      {node.artifacts.length > 0 ? (
        <section className="trace-detail__section">
          <h4><Box size={13} /> Artifacts</h4>
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
        <h4><Clock3 size={13} /> Timeline</h4>
        <dl>
          <div>
            <dt>Created</dt>
            <dd>{formatTime(node.timestamp?.createdAt || node.createdAt)}</dd>
          </div>
          <div>
            <dt>Children</dt>
            <dd>{node.childIds.join(", ") || "-"}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
