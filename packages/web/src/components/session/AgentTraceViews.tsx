import { useEffect, useMemo, useRef, useState } from "react";
import { Network, Pause, Play, RefreshCw, Search, UserRoundCog, X } from "lucide-react";
import { TraceGraph, TraceNode } from "../../contracts/backend";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";
import { api } from "../../utils/api";
import { CustomSelect } from "../primitives/CustomSelect";
import { IconButton } from "../primitives/IconButton";
import { AgentNetwork } from "./AgentNetwork";
import { TraceGraphView } from "./TraceGraphView";
import { TraceNodeDetail } from "./TraceNodeDetail";
import {
  formatTime,
  getNodeKind,
  getStatusLabelKey,
  normalizeStatus,
} from "./traceLayout";

export function AgentsPanel() {
  const { agents, currentSession, agentFilters, setAgentFilter, messages } = useSessions();
  const t = useT();

  return (
    <section className="workspace-panel" aria-labelledby="agents-panel-heading">
      <div className="workspace-panel__inner workspace-panel__inner--trace">
        <header className="workspace-panel__header">
          <div>
            <span className="workspace-panel__eyebrow">
              <Network size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />
              {t("trace.agents.eyebrow")}
            </span>
            <h2 id="agents-panel-heading">{t("trace.agents.title")}</h2>
          </div>
          <UserRoundCog size={18} />
        </header>

        {!currentSession ? (
          <p className="workspace-panel__empty">{t("trace.agents.emptyNoSession")}</p>
        ) : (
          <AgentNetwork
            agents={agents}
            agentFilters={agentFilters}
            messages={messages}
            onSetAgentFilter={setAgentFilter}
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
  const { currentSession } = useSessions();
  const t = useT();
  const [trace, setTrace] = useState<TraceGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [direction, setDirection] = useState<"LR" | "TB">("LR");
  const [zoom, setZoom] = useState(1);
  const [isAutoRefresh, setIsAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const wasUserAdjustedRef = useRef(false);
  const prevNodeCountRef = useRef(0);

  const allNodes = trace?.nodes ?? [];
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
        ...node.toolCalls,
        ...node.artifacts.map((artifact) => artifact.path),
      ].filter(Boolean).join(" ").toLowerCase();
      return matchesStatus && matchesType && (!normalizedQuery || searchText.includes(normalizedQuery));
    });
  }, [query, statusFilter, playbackNodes, typeFilter]);

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
    if (visibleNodes.length === 0) {
      return null;
    }
    return visibleNodes.find((node) => node.id === selectedNodeId) ?? visibleNodes[0] ?? null;
  }, [selectedNodeId, trace, visibleNodes]);

  const loadTrace = async (silent = false) => {
    if (!currentSession) {
      setTrace(null);
      setSelectedNodeId(null);
      return;
    }
    if (!silent) {
      setIsLoading(true);
    }
    setError(null);
    try {
      const nextTrace = await api.sessions.getTrace(currentSession.id);
      setTrace(nextTrace);
      if (!silent) {
        prevNodeCountRef.current = nextTrace.nodes.length;
        if (!wasUserAdjustedRef.current) {
          setPlaybackIndex(nextTrace.nodes.length);
        }
      }
      setSelectedNodeId((current) => {
        if (current && nextTrace.nodes.some((node) => node.id === current)) {
          return current;
        }
        return nextTrace.nodes[0]?.id ?? null;
      });
    } catch (err) {
      if (!silent) {
        setTrace(null);
        setError(err instanceof Error ? err.message : t("trace.loadFailed"));
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadTrace();
  }, [currentSession?.id]);

  useEffect(() => {
    if (!currentSession || !isAutoRefresh) {
      return;
    }
    const interval = window.setInterval(() => void loadTrace(true), 3000);
    return () => window.clearInterval(interval);
  }, [currentSession?.id, isAutoRefresh]);

  useEffect(() => {
    if (selectedNodeId && visibleNodes.length > 0 && !visibleNodeIds.has(selectedNodeId)) {
      setSelectedNodeId(visibleNodes[0].id);
    }
  }, [selectedNodeId, visibleNodeIds, visibleNodes]);

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
            <div className="trace-segmented" aria-label={t("trace.aria.layoutDir")}>
              <button className={direction === "LR" ? "is-active" : ""} onClick={() => setDirection("LR")} type="button">LR</button>
              <button className={direction === "TB" ? "is-active" : ""} onClick={() => setDirection("TB")} type="button">TB</button>
            </div>
            <div className="trace-refresh-group" aria-label={t("trace.aria.refreshControls")}>
              <IconButton className={isLoading ? "is-active" : ""} disabled={!currentSession} label={t("trace.aria.refresh")} onClick={() => void loadTrace()}>
                <RefreshCw size={15} />
              </IconButton>
              <button
                aria-pressed={isAutoRefresh}
                className={`trace-live-toggle ${isAutoRefresh ? "is-active" : ""}`}
                disabled={!currentSession}
                onClick={() => setIsAutoRefresh((current) => !current)}
                title={t("trace.autoRefreshTitle")}
                type="button"
              >
                <span aria-hidden="true" />
                {t("trace.live")}
              </button>
            </div>
          </div>
        </header>

        {error ? <p className="workspace-panel__empty workspace-panel__empty--error">{error}</p> : null}
        {!currentSession ? <p className="workspace-panel__empty">{t("trace.emptyNoSession")}</p> : null}

        {trace ? (
          <>
            <div className="trace-meta">
              <span>{trace.meta.projectName || currentSession?.title || t("trace.untitled")}</span>
              <span>{t("trace.focus", { focus: String(trace.meta.currentFocus || "-") })}</span>
              <span>{t("trace.nodes", { visible: visibleNodes.length, total: trace.nodes.length })}</span>
              <span>{t("trace.created", { time: formatTime(trace.meta.createdAt) })}</span>
            </div>

            <div className="trace-controls">
              <label className="trace-search">
                <Search size={14} />
                <input placeholder={t("trace.searchPlaceholder")} value={query} onChange={(event) => setQuery(event.target.value)} />
                {query ? (
                  <button aria-label={t("trace.aria.clearSearch")} onClick={() => setQuery("")} type="button">
                    <X size={13} />
                  </button>
                ) : null}
              </label>
              <div className="trace-control">
                <span>{t("trace.status")}</span>
                <CustomSelect
                  ariaLabel={t("trace.aria.statusFilter")}
                  className="trace-control__select"
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
                  onChange={setTypeFilter}
                  options={[
                    { label: t("trace.allTypes"), value: "all" },
                    ...typeOptions.map((type) => ({ label: type, value: type })),
                  ]}
                  value={typeFilter}
                />
              </div>
            </div>

            <div className="trace-layout">
              <div className="trace-map" aria-label={t("trace.aria.graph")}>
                <TraceGraphView
                  nodes={visibleNodes}
                  direction={direction}
                  selectedNodeId={selectedNode?.id ?? null}
                  onSelectNode={setSelectedNodeId}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  fitToken={fitToken}
                  emptyLabel={t("trace.noMatch")}
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
                <TraceNodeDetail node={selectedNode} onSelectNode={setSelectedNodeId} t={t} />
              </article>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
