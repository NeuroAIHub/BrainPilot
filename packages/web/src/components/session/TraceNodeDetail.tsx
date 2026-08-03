import { AlertTriangle, ArrowRight, Box, Clock3, FileText, GitBranch, Timer, Wrench } from "lucide-react";
import { TraceDependency, TraceGraph, TraceNode } from "../../contracts/backend";
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
import { TraceCheckpointDetail } from "./TraceCheckpointDetail";
import { TraceChangeHistory } from "./TraceChangeHistory";

interface TraceNodeDetailProps {
  node: TraceNode | null;
  nodes?: TraceNode[];
  /** V2 collections supplied alongside the legacy materialized node view. */
  graph?: TraceGraph | null;
  onSelectNode: (id: string) => void;
  /** When provided, artifact rows become buttons that focus that file. */
  onSelectArtifact?: (path: string) => void;
  /** Currently focused artifact path (for highlight). */
  activeArtifactPath?: string | null;
  formatKind?: (kind: string) => string;
  t: (key: string, vars?: TranslateVars) => string;
  sessionId?: string;
  restoreDisabled?: boolean;
  onRestored?: () => Promise<void> | void;
  onDependencyDecision?: (dependencyId: string, decision: "accept" | "reject") => Promise<void> | void;
}
/**
 * Presentational detail pane for a single reasoning-trace node. Extracted from
 * TracePanel so the live trace view and the demo replay share it. In the demo
 * an `onSelectArtifact` handler wires artifact rows to the file preview.
 */
export function TraceNodeDetail({ node, nodes, graph, onSelectNode, onSelectArtifact, activeArtifactPath, formatKind, t, sessionId, restoreDisabled, onRestored, onDependencyDecision }: TraceNodeDetailProps) {
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
  const isSemanticParent = (parent: TraceNode["parents"][number]) =>
    parent.edgeType === "semantic" || [
      "follows", "restored_from", "supports", "contradicts", "supersedes", "references", "legacy",
    ].includes(parent.relation ?? "");
  const v2Dependencies = graph?.dependencies?.filter((edge) => edge.dependentId === node.id) ?? [];
  const officialDependencies = v2Dependencies.length
    ? v2Dependencies.filter((edge) => edge.state === "active")
    : node.parents.filter((parent) => !isSemanticParent(parent) && parent.edgeType !== "proposed" && parent.edgeType !== "candidate");
  const candidateDependencies = v2Dependencies.filter((edge) => edge.state === "proposed");
  const semanticLinks = graph?.semanticLinks?.filter((link) => link.fromId === node.id || link.toId === node.id)
    ?? node.parents.filter(isSemanticParent).map((parent) => ({ id: `legacy-${parent.id}-${node.id}`, fromId: parent.id, toId: node.id, type: parent.relation || "legacy", reason: parent.explanation }));
  const episode = node.primaryEpisodeId ? graph?.episodes?.find((item) => item.id === node.primaryEpisodeId) : undefined;
  const renderDependency = (dependency: TraceDependency | { prerequisiteId: string; reason?: string; confidence?: string; origin?: string }) => {
    const prerequisiteId = dependency.prerequisiteId;
    return (
      <button key={"id" in dependency ? dependency.id : prerequisiteId} onClick={() => onSelectNode(prerequisiteId)} title={prerequisiteId} type="button">
        <strong>{parentLabel(prerequisiteId)}</strong>
        {dependency.reason ? <small>{dependency.reason}</small> : null}
        {"confidence" in dependency && dependency.confidence ? <span>{dependency.confidence}</span> : null}
      </button>
    );
  };
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
        {node.revoked ? <span className="trace-detail__badge--revoked">Revoked</span> : null}
        <span>{t("trace.node.confidence", { level: node.confidence ?? t("trace.node.unassessed") })}</span>
        {node.reviewConclusion && node.reviewConclusion !== "unreviewed" ? <span>{node.reviewConclusion}</span> : null}
        {node.agent ? <span>{node.agent}</span> : null}
        {node.metadata?.auto ? (
          <span className="trace-detail__badge--auto" title={t("trace.node.autoTitle")}>
            {t("trace.node.auto")}
          </span>
        ) : null}
      </div>
      <p>{node.summary || node.description || node.content || "No summary recorded."}</p>
      {node.confidenceReason ? (
        <section className="trace-detail__section">
          <h4><AlertTriangle size={13} /> {t("trace.node.confidenceTitle")}</h4>
          <p>{node.confidenceReason}</p>
        </section>
      ) : null}
      {node.reviewReason ? (
        <section className="trace-detail__section">
          <h4><AlertTriangle size={13} /> Review</h4>
          <p>{node.reviewReason}</p>
        </section>
      ) : null}
      {node.records?.length ? (
        <section className="trace-detail__section">
          <h4><FileText size={13} /> Source records</h4>
          <div className="trace-relation-list">
            {node.records.map((record, index) => (
              <div key={`${record.createdAt}-${index}`}>
                <strong>{record.sourceAgent}</strong>
                <small>{record.description}</small>
                <small>{formatTime(record.createdAt)}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}
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
      {officialDependencies.length > 0 ? (
        <section className="trace-detail__section">
          <h4><GitBranch size={13} /> {t("trace.node.dependencies")}</h4>
          <div className="trace-relation-list">
            {officialDependencies.map((dependency) => "prerequisiteId" in dependency
              ? renderDependency(dependency)
              : <button key={dependency.id} onClick={() => onSelectNode(dependency.id)} title={dependency.id} type="button"><strong>{parentLabel(dependency.id)}</strong><span>{relationLabels[dependency.relation || ""] || dependency.relation || "parent"}</span>{dependency.explanation ? <small>{dependency.explanation}</small> : null}</button>)}
          </div>
        </section>
      ) : null}
      {candidateDependencies.length > 0 ? (
        <section className="trace-detail__section">
          <h4><GitBranch size={13} /> Candidate dependencies / evidence</h4>
          <div className="trace-relation-list">
            {candidateDependencies.map((dependency) => (
              <div key={dependency.id} className="trace-dependency-candidate">
                {renderDependency(dependency)}
                <small>{dependency.origin} · {dependency.evidence.length} evidence item{dependency.evidence.length === 1 ? "" : "s"}</small>
                {onDependencyDecision ? (
                  <span className="trace-dependency-candidate__actions">
                    <button type="button" onClick={() => void onDependencyDecision(dependency.id, "accept")}>Accept</button>
                    <button type="button" onClick={() => void onDependencyDecision(dependency.id, "reject")}>Reject</button>
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {semanticLinks.length > 0 ? (
        <section className="trace-detail__section">
          <h4><ArrowRight size={13} /> Semantic links</h4>
          <div className="trace-relation-list">
            {semanticLinks.map((link) => {
              const peer = link.fromId === node.id ? link.toId : link.fromId;
              return <button key={link.id} onClick={() => onSelectNode(peer)} title={peer} type="button"><strong>{parentLabel(peer)}</strong><span>{link.type}</span>{link.reason ? <small>{link.reason}</small> : null}</button>;
            })}
          </div>
        </section>
      ) : null}
      {episode ? (
        <section className="trace-detail__section">
          <h4><GitBranch size={13} /> Episode</h4>
          <p>{episode.title}{node.episodeTags?.length ? ` · tags: ${node.episodeTags.join(", ")}` : ""}</p>
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
      <TraceCheckpointDetail node={node} sessionId={sessionId} restoreDisabled={restoreDisabled} onRestored={onRestored} t={t} />
      <TraceChangeHistory sessionId={sessionId} nodeId={node.id} />
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
