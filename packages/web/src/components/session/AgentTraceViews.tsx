import { useEffect, useMemo, useRef, useState } from "react";
import { Network, Pause, Play, RefreshCw, Search, X } from "lucide-react";
import { TraceNode } from "../../contracts/backend";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";
import { CustomSelect } from "../primitives/CustomSelect";
import { IconButton } from "../primitives/IconButton";
import { SystemMessageBubble } from "../chat/SystemMessageBubble";
import { AgentNetwork } from "./AgentNetwork";
import { TraceGraphView } from "./TraceGraphView";
import { TraceNodeDetail } from "./TraceNodeDetail";
import { AuditReportsPanel } from "./AuditReportsPanel";
import {
  formatTime,
  getNodeKind,
  getNodeKindLabelKey,
  getStatusLabelKey,
  normalizeStatus,
  relationLabels,
} from "./traceLayout";
import {
  layoutToggleState,
  resolveTraceGraphEmpty,
  traceControlsEffective,
  traceEmptyLabelKey,
} from "./traceEmptyState";

/** Materialize collapsible V2 episode group nodes without mutating session state. */
export function withEpisodeGroups(nodes: TraceNode[], episodes: Array<{ id: string; title: string }> | undefined, collapsed: boolean): TraceNode[] {
  if (!collapsed || !episodes?.length) return nodes;
  const titleByEpisode = new Map(episodes.map((episode) => [episode.id, episode.title]));
  const members = new Map<string, TraceNode[]>();
  for (const node of nodes) {
    if (!node.primaryEpisodeId || !titleByEpisode.has(node.primaryEpisodeId)) continue;
    const group = members.get(node.primaryEpisodeId) ?? [];
    group.push(node);
    members.set(node.primaryEpisodeId, group);
  }
  if (members.size === 0) return nodes;
  const targetFor = (id: string): string => {
    const node = nodes.find((item) => item.id === id);
    return node?.primaryEpisodeId && members.has(node.primaryEpisodeId) ? `episode:${node.primaryEpisodeId}` : id;
  };
  const grouped = new Map<string, TraceNode>();
  for (const [episodeId, episodeNodes] of members) {
    const first = episodeNodes[0]!;
    grouped.set(`episode:${episodeId}`, {
      id: `episode:${episodeId}`,
      title: titleByEpisode.get(episodeId) ?? episodeId,
      type: "episode",
      status: "completed",
      summary: `${episodeNodes.length} grouped trace node${episodeNodes.length === 1 ? "" : "s"}`,
      parents: [],
      artifacts: [],
      parentIds: [],
      childIds: [],
      createdAt: first.createdAt,
      updatedAt: first.updatedAt,
      toolCalls: [],
      metadata: { syntheticEpisode: true, episodeId },
    });
  }
  for (const node of nodes) {
    if (node.primaryEpisodeId && members.has(node.primaryEpisodeId)) continue;
    grouped.set(node.id, { ...node, parents: [], parentIds: [], childIds: [] });
  }
  for (const node of nodes) {
    const targetId = targetFor(node.id);
    const target = grouped.get(targetId);
    if (!target) continue;
    for (const parent of node.parents) {
      const sourceId = targetFor(parent.id);
      if (sourceId === targetId || !grouped.has(sourceId)) continue;
      if (!target.parents.some((item) => item.id === sourceId && item.relation === parent.relation && item.edgeType === parent.edgeType)) {
        target.parents.push({ ...parent, id: sourceId });
      }
    }
  }
  const result = [...grouped.values()].map((node) => ({ ...node, parentIds: [...new Set(node.parents.map((parent) => parent.id))] }));
  const children = new Map<string, Set<string>>();
  for (const node of result) {
    for (const parentId of node.parentIds) {
      const set = children.get(parentId) ?? new Set<string>();
      set.add(node.id);
      children.set(parentId, set);
    }
  }
  return result.map((node) => ({ ...node, childIds: [...(children.get(node.id) ?? [])] }));
}
export function AgentsPanel() {
  const {
    agents,
    currentSession,
    agentFilters,
    setAgentFilter,
    messages,
    messageFilters,
    setMessageFilterEnabled,
    hiddenErrorsCount,
  } = useSessions();
  const t = useT();

  return (
    <section className="workspace-panel" aria-labelledby="agents-panel-heading">
      <div className="workspace-panel__inner workspace-panel__inner--trace">
        <header className="workspace-panel__header">
          <h2 id="agents-panel-heading" className="workspace-panel__title-icon">
            <Network size={18} />
            {t("trace.agents.eyebrow")}
          </h2>
        </header>

        {!currentSession ? (
          <p className="workspace-panel__empty">{t("trace.agents.emptyNoSession")}</p>
        ) : (
          <AgentNetwork
            agents={agents}
            agentFilters={agentFilters}
            messages={messages}
            onSetAgentFilter={setAgentFilter}
            messageFilters={messageFilters}
            onSetMessageFilterEnabled={setMessageFilterEnabled}
            hiddenErrorsCount={hiddenErrorsCount}
          />
        )}

        {currentSession && agents.length === 0 ? (
          <p className="workspace-panel__empty">{t("trace.agents.emptyNoEvents")}</p>
        ) : null}
      </div>
    </section>
  );
}

export function TracePanel() {
  // #79: trace is now live — seeded + kept current by SessionContext via SSE
  // (CUSTOM:trace_node), so this panel reads it instead of polling.
  const { currentSession, currentTrace, refreshTrace, workActive, messages } = useSessions();
  const t = useT();
  const trace = currentTrace;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [zoom, setZoom] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [showProposedDependencies, setShowProposedDependencies] = useState(true);
  const [collapseEpisodes, setCollapseEpisodes] = useState(false);
  const latestWorkspaceRestore = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.systemMessage?.code === "workspace_restored") return message.systemMessage;
    }
    return null;
  }, [messages]);
  const wasUserAdjustedRef = useRef(false);
  const prevNodeCountRef = useRef(0);

  // A live trace_node delta can arrive before the Host attaches its checkpoint
  // and artifact metadata. Refresh once when the user opens Trace so the detail
  // panel never requires a second manual Refresh to expose restore controls.
  useEffect(() => {
    if (!currentSession) return;
    void refreshTrace(currentSession.id);
  }, [currentSession?.id, refreshTrace]);

  const formatNodeKind = (kind: string) => {
    const key = getNodeKindLabelKey(kind);
    return key ? t(key) : kind;
  };

  const allNodes = trace?.nodes ?? [];
  const episodeTitles = useMemo(
    () => new Map((trace?.episodes ?? []).map((episode) => [episode.id, episode.title])),
    [trace?.episodes],
  );
  const playbackNodes = useMemo(() => allNodes.slice(0, playbackIndex), [allNodes, playbackIndex]);

  const filteredNodes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return playbackNodes.filter((node) => {
      const status = normalizeStatus(node.status);
      const nodeKind = getNodeKind(node);
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesType = typeFilter === "all" || nodeKind === typeFilter;
      const searchText = [
        node.id,
        node.title,
        node.description,
        node.summary,
        node.reason,
        node.context,
        node.agent,
        nodeKind,
        node.primaryEpisodeId ? episodeTitles.get(node.primaryEpisodeId) : undefined,
        ...node.toolCalls,
        ...node.artifacts.map((artifact) => artifact.path),
      ].filter(Boolean).join(" ").toLowerCase();
      return matchesStatus && matchesType && (!normalizedQuery || searchText.includes(normalizedQuery));
    });
  }, [query, statusFilter, playbackNodes, typeFilter, episodeTitles]);

  const visibleNodeIds = useMemo(() => new Set(filteredNodes.map((node) => node.id)), [filteredNodes]);
  const visibleNodes = useMemo(
    () => filteredNodes.map((node) => ({
      ...node,
      parentIds: node.parentIds.filter((parentId) => visibleNodeIds.has(parentId)),
      parents: node.parents.filter((parent) => visibleNodeIds.has(parent.id)),
      childIds: node.childIds.filter((childId) => visibleNodeIds.has(childId)),
    })),
    [filteredNodes, visibleNodeIds],
  );
  const graphNodes = useMemo(
    () => withEpisodeGroups(visibleNodes, trace?.episodes, collapseEpisodes),
    [visibleNodes, trace?.episodes, collapseEpisodes],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set((trace?.nodes ?? []).map((node) => normalizeStatus(node.status)).filter(Boolean))).sort(),
    [trace?.nodes],
  );
  const typeOptions = useMemo(
    () => Array.from(new Set((trace?.nodes ?? []).map(getNodeKind).filter(Boolean))).sort(),
    [trace?.nodes],
  );
  const selectedNode = useMemo<TraceNode | null>(() => {
    if (!trace) {
      return null;
    }
    if (graphNodes.length === 0) {
      return null;
    }
    return graphNodes.find((node) => node.id === selectedNodeId) ?? graphNodes[0] ?? null;
  }, [graphNodes, selectedNodeId, trace]);

  // #317: distinguish empty corpus (0/0) from filter/playback zero-results.
  const controlsEffective = traceControlsEffective(allNodes.length);
  const emptyReason = resolveTraceGraphEmpty(allNodes.length, visibleNodes.length);
  const emptyLabelKey = traceEmptyLabelKey(emptyReason);
  const emptyLabel = emptyLabelKey ? t(emptyLabelKey) : undefined;
  const layoutToggle = layoutToggleState(direction, controlsEffective);

  const handleRefresh = async () => {
    if (!currentSession) return;
    setIsRefreshing(true);
    try {
      await refreshTrace(currentSession.id);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Keep a selection valid as nodes stream in: default to the first node, and
  // hold the current selection while it still exists.
  useEffect(() => {
    setSelectedNodeId((current) => {
      if (current && allNodes.some((node) => node.id === current)) return current;
      return allNodes[0]?.id ?? null;
    });
  }, [allNodes]);

  useEffect(() => {
    if (selectedNodeId && graphNodes.length > 0 && !graphNodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(graphNodes[0].id);
    }
  }, [graphNodes, selectedNodeId]);

  useEffect(() => {
    setPlaybackIndex(allNodes.length);
    prevNodeCountRef.current = allNodes.length;
    wasUserAdjustedRef.current = false;
    setIsPlaying(false);
  }, [currentSession?.id]);

  useEffect(() => {
    if (allNodes.length === 0) {
      setPlaybackIndex(0);
      prevNodeCountRef.current = 0;
      return;
    }
    if (!wasUserAdjustedRef.current) {
      if (allNodes.length > prevNodeCountRef.current) {
        if (playbackIndex >= prevNodeCountRef.current || prevNodeCountRef.current === 0) {
          setPlaybackIndex(allNodes.length);
        }
      } else if (allNodes.length < playbackIndex) {
        setPlaybackIndex(allNodes.length);
      }
    }
    prevNodeCountRef.current = allNodes.length;
  }, [allNodes.length, playbackIndex]);

  useEffect(() => {
    if (!isPlaying || allNodes.length === 0) {
      return;
    }
    const interval = window.setInterval(() => {
      setPlaybackIndex((current) => {
        if (current >= allNodes.length) {
          setIsPlaying(false);
          return current;
        }
        return current + 1;
      });
      setFitToken((token) => token + 1);
    }, 800);
    return () => window.clearInterval(interval);
  }, [isPlaying, allNodes.length]);

  const togglePlayback = () => {
    if (allNodes.length === 0) {
      return;
    }
    if (playbackIndex >= allNodes.length) {
      setPlaybackIndex(0);
    }
    wasUserAdjustedRef.current = false;
    setIsPlaying((current) => !current);
  };

  const handleSliderChange = (value: number) => {
    setIsPlaying(false);
    wasUserAdjustedRef.current = true;
    setPlaybackIndex(value);
  };

  return (
    <section className="workspace-panel" aria-labelledby="trace-panel-heading">
      <div className="workspace-panel__inner workspace-panel__inner--trace">
        <header className="workspace-panel__header trace-header">
          <div>
            <span className="workspace-panel__eyebrow">{t("trace.eyebrow")}</span>
            <h2 id="trace-panel-heading">{t("trace.title")}</h2>
          </div>
          <div className="trace-toolbar">
            <div className="trace-segmented" role="group" aria-label={t("trace.aria.layoutDir")}>
              <button
                type="button"
                className={layoutToggle.lr.pressed ? "is-active" : ""}
                aria-pressed={layoutToggle.lr.pressed}
                disabled={layoutToggle.lr.disabled}
                onClick={() => setDirection("LR")}
              >
                {t("trace.layout.horizontal")}
              </button>
              <button
                type="button"
                className={layoutToggle.tb.pressed ? "is-active" : ""}
                aria-pressed={layoutToggle.tb.pressed}
                disabled={layoutToggle.tb.disabled}
                onClick={() => setDirection("TB")}
              >
                {t("trace.layout.vertical")}
              </button>
            </div>
            <IconButton className={isRefreshing ? "is-active" : ""} disabled={!currentSession} label={t("trace.aria.refresh")} onClick={() => void handleRefresh()}>
              <RefreshCw size={15} />
            </IconButton>
          </div>
        </header>

        {latestWorkspaceRestore ? (
          <div className="trace-restore-banner">
            <SystemMessageBubble view={latestWorkspaceRestore} />
          </div>
        ) : null}

        {!currentSession ? <p className="workspace-panel__empty">{t("trace.emptyNoSession")}</p> : null}

        {trace ? (
          <>
            <div className="trace-meta">
              <span>{trace.meta.projectName || currentSession?.title || t("trace.untitled")}</span>
              {trace.meta.currentFocus ? <span>{t("trace.focus", { focus: String(trace.meta.currentFocus) })}</span> : null}
              <span>{t("trace.nodes", { visible: visibleNodes.length, total: trace.nodes.length })}</span>
              <span>{t("trace.created", { time: formatTime(trace.meta.createdAt) })}</span>
            </div>

            <div className={`trace-controls ${controlsEffective ? "" : "is-inert"}`.trim()}>
              <label className="trace-search">
                <Search size={14} />
                <input
                  placeholder={t("trace.searchPlaceholder")}
                  value={query}
                  disabled={!controlsEffective}
                  onChange={(event) => setQuery(event.target.value)}
                />
                {query ? (
                  <button
                    aria-label={t("trace.aria.clearSearch")}
                    onClick={() => setQuery("")}
                    type="button"
                    disabled={!controlsEffective}
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </label>
              <div className="trace-control">
                <span>{t("trace.status")}</span>
                <CustomSelect
                  ariaLabel={t("trace.aria.statusFilter")}
                  className="trace-control__select"
                  disabled={!controlsEffective}
                  onChange={setStatusFilter}
                  options={[
                    { label: t("trace.allStatus"), value: "all" },
                    ...statusOptions.map((status) => {
                      const key = getStatusLabelKey(status);
                      return { label: key ? t(key) : status, value: status };
                    }),
                  ]}
                  value={statusFilter}
                />
              </div>
              <div className="trace-control">
                <span>{t("trace.type")}</span>
                <CustomSelect
                  ariaLabel={t("trace.aria.typeFilter")}
                  className="trace-control__select"
                  disabled={!controlsEffective}
                  onChange={setTypeFilter}
                  options={[
                    { label: t("trace.allTypes"), value: "all" },
                    ...typeOptions.map((type) => ({ label: formatNodeKind(type), value: type })),
                  ]}
                  value={typeFilter}
                />
              </div>
              <label className="trace-control trace-control--toggle">
                <input checked={showProposedDependencies} onChange={(event) => setShowProposedDependencies(event.target.checked)} type="checkbox" />
                <span>{t("trace.toggle.candidates")}</span>
              </label>
              <label className="trace-control trace-control--toggle">
                <input checked={collapseEpisodes} onChange={(event) => setCollapseEpisodes(event.target.checked)} type="checkbox" />
                <span>{t("trace.toggle.episodes")}</span>
              </label>
            </div>

            <div className="trace-layout">
              <div className="trace-map" aria-label={t("trace.aria.graph")}>
                <TraceGraphView
                  nodes={graphNodes}
                  direction={direction}
                  selectedNodeId={selectedNode?.id ?? null}
                  onSelectNode={setSelectedNodeId}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  fitToken={fitToken}
                  emptyLabel={emptyLabel}
                  formatKind={formatNodeKind}
                  formatRelation={(relation) => relationLabels[relation] ? t(`trace.relation.${relation}`) : relation}
                  revokedLabel={t("trace.node.revoked")}
                  episodeTitles={episodeTitles}
                  showProposedDependencies={showProposedDependencies}
                  zoomLabels={{
                    controls: t("trace.aria.zoomControls"),
                    zoomIn: t("trace.aria.zoomIn"),
                    zoomOut: t("trace.aria.zoomOut"),
                    reset: t("trace.aria.resetZoom"),
                  }}
                />
                {allNodes.length > 0 ? (
                  <div className="trace-playback-bar" aria-label={t("trace.aria.playbackControls")}>
                    <button
                      aria-label={isPlaying ? t("trace.aria.pause") : t("trace.aria.play")}
                      className="trace-playback-bar__button"
                      onClick={togglePlayback}
                      type="button"
                    >
                      {isPlaying ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <input
                      aria-label={t("trace.aria.playbackProgress")}
                      className="trace-playback-bar__slider"
                      max={allNodes.length}
                      min={0}
                      onChange={(e) => handleSliderChange(Number(e.target.value))}
                      type="range"
                      value={playbackIndex}
                    />
                    <span className="trace-playback-bar__count">
                      {playbackIndex} / {allNodes.length}
                    </span>
                  </div>
                ) : null}
              </div>

              <article className="trace-detail">
                <TraceNodeDetail
                  node={selectedNode}
                  nodes={allNodes}
                  graph={trace}
                  onSelectNode={setSelectedNodeId}
                  formatKind={formatNodeKind}
                  t={t}
                  sessionId={currentSession?.id}
                  restoreDisabled={workActive?.active === true}
                  onRestored={() => currentSession ? refreshTrace(currentSession.id) : undefined}
                  onDependencyDecision={async (dependencyId, decision) => {
                    if (!currentSession) return;
                    await api.sessions.decideTraceDependency(currentSession.id, dependencyId, decision);
                    await refreshTrace(currentSession.id);
                  }}
                />
                <AuditReportsPanel sessionId={currentSession?.id} revision={trace?.revision} t={t} />
              </article>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
