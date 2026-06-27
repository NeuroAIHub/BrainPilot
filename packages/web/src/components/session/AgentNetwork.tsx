import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  EyeOff,
  Filter,
  Inbox,
  MessageSquare,
  Network,
  Plus,
  Send,
  Webhook,
  Wrench,
  X,
} from "lucide-react";
import { AgentStatus, ChatMessage } from "../../contracts/backend";
import {
  AgentEdge,
  AgentEdgeMessage,
  BUILTIN_AGENT_NAMES,
  buildEdges,
  countMessagesFor,
  getAgentAccentVar,
  getAgentIcon,
  getAgentProfile,
  msgTypeKind,
  relativeTime,
  statusKind,
} from "./agentNetworkShared";
import {
  computeAgentActivity,
  computeAllAgentActivities,
  type AgentActivity,
} from "./agentAnalytics";
import { NodeTooltip, NodeTooltipData } from "./NodeTooltip";
import { GlobalOverview } from "./GlobalOverview";
import { AnalyticsTab } from "./AnalyticsTab";
import { TimelineTab } from "./TimelineTab";
import { useT } from "../../i18n/useT";

type AgentTab = "detail" | "analytics" | "timeline";
const TAB_STORAGE_KEY = "agent-network-active-tab";

function loadActiveTab(): AgentTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    if (v === "detail" || v === "analytics" || v === "timeline") return v;
  } catch {
    /* ignore */
  }
  return "detail";
}

type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; key: string }
  | null;

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

const ACTIVE_EDGE_WINDOW_MS = 5_000;

/** Translation key for a `statusKind` value, used as a display label. */
function statusLabelKey(status: "running" | "idle" | "error" | "stopped"): string {
  return `network.status.${status}`;
}

function looksIdleTask(task?: string): boolean {
  const normalized = (task ?? "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "ready" ||
    normalized === "idle" ||
    normalized.includes("waiting for instructions") ||
    normalized.includes("空闲") ||
    normalized.includes("等待指令")
  );
}

function taskLabelFor(agent: AgentStatus, status: "running" | "idle" | "error" | "stopped", t: (key: string) => string): string {
  const task = agent.task?.trim();
  if (status === "running" && looksIdleTask(task)) {
    return t("network.detail.runningTask");
  }
  return task || t("network.detail.idleWaiting");
}

/* --------------------------------------------------------------------------
 * Layout: deterministic concentric ring placement (no force layout, no jitter).
 * ------------------------------------------------------------------------ */

interface PositionedNode {
  name: string;
  x: number;
  y: number;
}

const VIEWBOX_WIDTH = 760;
const VIEWBOX_HEIGHT = 480;
const NODE_RADIUS = 30;

function layoutNodes(names: string[]): PositionedNode[] {
  const cx = VIEWBOX_WIDTH / 2;
  const cy = VIEWBOX_HEIGHT / 2;
  if (names.length === 0) return [];

  // Always anchor `principal` at the center if present.
  const principalIdx = names.indexOf("principal");
  const center = principalIdx >= 0 ? names[principalIdx] : null;
  const ring = center ? names.filter((n) => n !== center) : [...names];

  const positioned: PositionedNode[] = [];
  if (center) {
    positioned.push({ name: center, x: cx, y: cy });
  }

  const ringCount = ring.length;
  if (ringCount === 0) {
    if (!center) {
      // Single non-principal node -> place at center
      positioned.push({ name: names[0], x: cx, y: cy });
    }
    return positioned;
  }

  // One ring up to 6, otherwise split into inner/outer.
  if (ringCount <= 6 || !center) {
    const radius = Math.min(VIEWBOX_WIDTH, VIEWBOX_HEIGHT) * 0.34;
    const angleOffset = -Math.PI / 2; // start at top
    ring.forEach((name, idx) => {
      const angle = angleOffset + (idx * 2 * Math.PI) / ringCount;
      positioned.push({
        name,
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
    return positioned;
  }

  // Two rings: half on inner, half on outer.
  const innerCount = Math.ceil(ringCount / 2);
  const outerCount = ringCount - innerCount;
  const innerRadius = Math.min(VIEWBOX_WIDTH, VIEWBOX_HEIGHT) * 0.22;
  const outerRadius = Math.min(VIEWBOX_WIDTH, VIEWBOX_HEIGHT) * 0.4;
  const offsetInner = -Math.PI / 2;
  const offsetOuter = -Math.PI / 2 + Math.PI / outerCount;
  ring.slice(0, innerCount).forEach((name, idx) => {
    const angle = offsetInner + (idx * 2 * Math.PI) / innerCount;
    positioned.push({
      name,
      x: cx + innerRadius * Math.cos(angle),
      y: cy + innerRadius * Math.sin(angle),
    });
  });
  ring.slice(innerCount).forEach((name, idx) => {
    const angle = offsetOuter + (idx * 2 * Math.PI) / outerCount;
    positioned.push({
      name,
      x: cx + outerRadius * Math.cos(angle),
      y: cy + outerRadius * Math.sin(angle),
    });
  });
  return positioned;
}

/** Curve from p1 to p2, offset perpendicular by `bend` so two-way edges don't overlap. */
function buildEdgePath(p1: PositionedNode, p2: PositionedNode, bend: number) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  // Shorten endpoints so arrow doesn't touch the node.
  const ux = dx / distance;
  const uy = dy / distance;
  const startX = p1.x + ux * NODE_RADIUS;
  const startY = p1.y + uy * NODE_RADIUS;
  const endX = p2.x - ux * (NODE_RADIUS + 4);
  const endY = p2.y - uy * (NODE_RADIUS + 4);
  // Perpendicular control point for slight curvature.
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  const px = -uy * bend;
  const py = ux * bend;
  return {
    d: `M ${startX} ${startY} Q ${midX + px} ${midY + py} ${endX} ${endY}`,
    midX: midX + px * 0.6,
    midY: midY + py * 0.6,
  };
}

/* --------------------------------------------------------------------------
 * Component
 * ------------------------------------------------------------------------ */

export interface AgentMessageFilter {
  hideMessages: boolean;
  hideTools: boolean;
  hideHooks: boolean;
}

interface AgentNetworkProps {
  agents: AgentStatus[];
  messages: ChatMessage[];
  agentFilters: Record<string, AgentMessageFilter>;
  onSetAgentFilter: (
    agentName: string,
    hideMessages: boolean,
    hideTools: boolean,
    hideHooks?: boolean,
  ) => void;
}

export function AgentNetwork({ agents, messages, agentFilters, onSetAgentFilter }: AgentNetworkProps) {
  const t = useT();
  const [selection, setSelection] = useState<Selection>(null);
  const [hoverEdgeKey, setHoverEdgeKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AgentTab>(loadActiveTab);

  // Persist active tab across reloads (same pattern as PreferencesContext).
  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [activeTab]);

  // Selecting a node/edge always brings the Detail tab forward so the user
  // sees what they clicked (Analytics/Timeline are global, not per-selection).
  const selectNode = (id: string) => {
    setSelection({ kind: "node", id });
    setActiveTab("detail");
  };
  const selectEdge = (key: string) => {
    setSelection({ kind: "edge", key });
    setActiveTab("detail");
  };

  // Node hover tooltip: a short delay on show (avoid flicker on quick passes)
  // and a short delay on hide (so the mouse can travel onto the tooltip).
  const [hovered, setHovered] = useState<{
    name: string;
    anchor: { left: number; top: number; width: number; height: number };
  } | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const showTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  const clearHoverTimers = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const handleNodeEnter = (name: string, nodeEl: SVGGElement) => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
    }
    showTimerRef.current = window.setTimeout(() => {
      const container = viewportRef.current;
      if (!container) return;
      const nodeRect = nodeEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      setHovered({
        name,
        anchor: {
          left: nodeRect.left - containerRect.left,
          top: nodeRect.top - containerRect.top,
          width: nodeRect.width,
          height: nodeRect.height,
        },
      });
    }, 300);
  };

  const handleNodeLeave = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => setHovered(null), 200);
  };

  // Clean up any pending timers on unmount.
  useEffect(() => clearHoverTimers, []);

  const edges = useMemo(() => buildEdges(messages), [messages]);

  // Default view: only agents that actually participated in this session.
  // Built-in agents that were not used are listed below as available, rather
  // than drawn as equally important dormant graph nodes.
  const activeNames = useMemo(() => {
    const set = new Set<string>();
    agents.forEach((a) => set.add(a.name));
    edges.forEach((e) => {
      set.add(e.from);
      set.add(e.to);
    });
    return set;
  }, [agents, edges]);

  const nodeNames = useMemo(() => {
    const builtinSet = new Set<string>(BUILTIN_AGENT_NAMES);
    const builtins = BUILTIN_AGENT_NAMES.filter((n) => activeNames.has(n));
    const customs = Array.from(activeNames).filter((n) => !builtinSet.has(n)).sort();
    return [...builtins, ...customs];
  }, [activeNames]);

  const availableNames = useMemo(
    () => BUILTIN_AGENT_NAMES.filter((name) => !activeNames.has(name)),
    [activeNames],
  );

  const positioned = useMemo(() => layoutNodes(nodeNames), [nodeNames]);
  const positionByName = useMemo(() => {
    const map = new Map<string, PositionedNode>();
    positioned.forEach((p) => map.set(p.name, p));
    return map;
  }, [positioned]);

  const agentByName = useMemo(() => {
    const map = new Map<string, AgentStatus>();
    agents.forEach((a) => map.set(a.name, a));
    return map;
  }, [agents]);

  // Bend edges so opposite-direction pairs don't overlap.
  const edgesWithGeometry = useMemo(() => {
    const seen = new Set<string>();
    return edges
      .map((edge) => {
        const reverseKey = `${edge.to}->${edge.from}`;
        // First-seen edge of a pair gets +bend; reverse gets -bend.
        const bend = seen.has(reverseKey) ? -22 : edges.some((e) => e.key === reverseKey) ? 22 : 0;
        seen.add(edge.key);
        return { edge, bend };
      })
      .map(({ edge, bend }) => {
        const p1 = positionByName.get(edge.from);
        const p2 = positionByName.get(edge.to);
        if (!p1 || !p2) return null;
        const geometry = buildEdgePath(p1, p2, bend);
        return { edge, geometry };
      })
      .filter((item): item is { edge: AgentEdge; geometry: ReturnType<typeof buildEdgePath> } => item !== null);
  }, [edges, positionByName]);

  const now = Date.now();
  const totalMessages = edges.reduce((sum, edge) => sum + edge.messages.length, 0);
  const liveCount = nodeNames.length;
  const runningCount = agents.filter((a) => statusKind(a.status) === "running").length;

  // Keep relative times / the Timeline "now" marker moving. Only tick while a
  // time-sensitive tab is open or an agent is running, so we don't force a
  // re-render every few seconds when the user is just reading detail text.
  const [, setTick] = useState(0);
  const needsTick = activeTab !== "detail" || runningCount > 0;
  useEffect(() => {
    if (!needsTick) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 5000);
    return () => window.clearInterval(id);
  }, [needsTick]);

  // Selected entity for the side panel.
  const selectedAgent = useMemo<AgentStatus | null>(() => {
    if (!selection || selection.kind !== "node") return null;
    return agentByName.get(selection.id) ?? { name: selection.id, status: "idle", task: "" };
  }, [selection, agentByName]);

  const selectedEdge = useMemo<AgentEdge | null>(() => {
    if (!selection || selection.kind !== "edge") return null;
    return edges.find((e) => e.key === selection.key) ?? null;
  }, [selection, edges]);

  const messagesForAgent = useMemo(() => {
    if (!selectedAgent) return { sent: [] as AgentEdgeMessage[], received: [] as AgentEdgeMessage[] };
    const sent: AgentEdgeMessage[] = [];
    const received: AgentEdgeMessage[] = [];
    edges.forEach((edge) => {
      edge.messages.forEach((m) => {
        if (m.from === selectedAgent.name) sent.push(m);
        if (m.to === selectedAgent.name) received.push(m);
      });
    });
    sent.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    received.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return { sent, received };
  }, [selectedAgent, edges]);

  // Compute comprehensive activity stats for all agents
  const allActivities = useMemo(() => computeAllAgentActivities(messages, edges), [messages, edges]);

  // Activity stats for the selected agent
  const selectedAgentActivity = useMemo<AgentActivity | null>(() => {
    if (!selectedAgent) return null;
    return allActivities.get(selectedAgent.name) ?? null;
  }, [selectedAgent, allActivities]);

  if (nodeNames.length === 0) {
    return (
      <div className="agent-network agent-network--empty">
        <div className="agent-network__empty-state">
          <Network size={28} />
          <p>{t("network.empty")}</p>
        </div>
      </div>
    );
  }

  const principalPos = positionByName.get("principal");

  // Tooltip data for the currently-hovered node (if any).
  const hoveredData: NodeTooltipData | null = hovered
    ? (() => {
        const agent = agentByName.get(hovered.name);
        const isLive = activeNames.has(hovered.name);
        const counts = countMessagesFor(hovered.name, edges);
        return {
          name: hovered.name,
          isLive,
          status: agent?.status ?? "idle",
          task: agent?.task ?? "",
          updatedAt: agent?.updatedAt,
          sent: counts.sent,
          received: counts.received,
        };
      })()
    : null;

  return (
    <div className="agent-network">
      <div className="agent-network__viewport-shell">
        <div className="agent-network__legend" aria-label={t("network.aria.legend")}>
          <span className="agent-network__legend-item">
            <i className="agent-network__legend-dot agent-network__legend-dot--running" /> {t("network.legend.running")}
          </span>
          <span className="agent-network__legend-item">
            <i className="agent-network__legend-dot agent-network__legend-dot--idle" /> {t("network.legend.live")}
          </span>
          <span className="agent-network__legend-item">
            <i className="agent-network__legend-dot agent-network__legend-dot--error" /> {t("network.legend.error")}
          </span>
          <span className="agent-network__legend-divider" aria-hidden="true" />
          <span className="agent-network__legend-item">
            <i className="agent-network__legend-line agent-network__legend-line--delegate" /> {t("network.legend.delegate")}
          </span>
          <span className="agent-network__legend-item">
            <i className="agent-network__legend-line agent-network__legend-line--result" /> {t("network.legend.result")}
          </span>
          <span className="agent-network__legend-counter">
            {t("network.legend.counter", { live: liveCount, total: nodeNames.length, running: runningCount, edges: edges.length, msgs: totalMessages })}
          </span>
        </div>
        {availableNames.length > 0 ? (
          <details className="agent-network__available">
            <summary>{t("network.available.summary", { count: availableNames.length })}</summary>
            <ul>
              {availableNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="agent-network__viewport" aria-label={t("network.aria.viewport")} ref={viewportRef}>
          <svg
            className="agent-network__svg"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          >
            <defs>
              {/* Engineering-paper backdrop: a fine 32px grid nested inside a
                   heavier 160px (5×) major grid. Very low opacity, hidden from
                   the a11y tree (purely decorative). */}
              <pattern id="agent-net-grid" width="32" height="32" patternUnits="userSpaceOnUse">
                <path
                  className="agent-network__grid-line"
                  d="M 32 0 L 0 0 0 32"
                  fill="none"
                />
              </pattern>
              <pattern id="agent-net-grid-major" width="160" height="160" patternUnits="userSpaceOnUse">
                <path
                  className="agent-network__grid-line agent-network__grid-line--major"
                  d="M 160 0 L 0 0 0 160"
                  fill="none"
                />
              </pattern>
              {/* Soft radial vignette that draws the eye to PI. */}
              <radialGradient id="agent-net-glow" cx="50%" cy="50%" r="60%">
                <stop offset="0%" className="agent-network__glow-stop-inner" />
                <stop offset="55%" className="agent-network__glow-stop-mid" />
                <stop offset="100%" className="agent-network__glow-stop-outer" />
              </radialGradient>
              {/* Arrow markers for edges (stroke colors come from CSS). */}
              <marker id="agent-net-arrow-neutral" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
                <path d="M 0 0 L 6 3 L 0 6 z" />
              </marker>
              <marker id="agent-net-arrow-delegate" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
                <path d="M 0 0 L 6 3 L 0 6 z" />
              </marker>
              <marker id="agent-net-arrow-result" markerHeight="6" markerWidth="6" orient="auto" refX="5" refY="3">
                <path d="M 0 0 L 6 3 L 0 6 z" />
              </marker>
            </defs>

            {/* clear-selection background — must be FIRST so nodes/edges
                 above it receive clicks. (SVG hit-test goes top-down by
                 sibling order; transparent fill still captures events.) */}
            <rect
              className="agent-network__bg-hit"
              fill="transparent"
              height={VIEWBOX_HEIGHT}
              onClick={() => setSelection(null)}
              width={VIEWBOX_WIDTH}
            />

            {/* Decorative backdrop: grid + radial glow + concentric guide
                 rings. Pointer-events disabled so the bg-hit rect above
                 still catches clicks. Hidden from screen readers. */}
            <g className="agent-network__backdrop" aria-hidden="true">
              <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#agent-net-grid)" />
              <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#agent-net-grid-major)" />
              <rect width={VIEWBOX_WIDTH} height={VIEWBOX_HEIGHT} fill="url(#agent-net-glow)" />
              {principalPos ? (
                <>
                  <circle
                    className="agent-network__guide-ring"
                    cx={principalPos.x}
                    cy={principalPos.y}
                    r={Math.min(VIEWBOX_WIDTH, VIEWBOX_HEIGHT) * 0.22}
                  />
                  <circle
                    className="agent-network__guide-ring"
                    cx={principalPos.x}
                    cy={principalPos.y}
                    r={Math.min(VIEWBOX_WIDTH, VIEWBOX_HEIGHT) * 0.34}
                  />
                  <circle
                    className="agent-network__guide-ring agent-network__guide-ring--outer"
                    cx={principalPos.x}
                    cy={principalPos.y}
                    r={Math.min(VIEWBOX_WIDTH, VIEWBOX_HEIGHT) * 0.4}
                  />
                </>
              ) : null}
            </g>

            {/* Scaffold links: principal ↔ every other agent, drawn behind
                 message edges. Always-on so the team graph stays visible
                 even when no message has been sent yet. Dormant agents
                 use a lighter dasharray to read as "not yet activated". */}
            <g className="agent-network__scaffold" aria-hidden="true">
              {(() => {
                const principal = positionByName.get("principal");
                if (!principal) return null;
                return positioned
                  .filter((node) => node.name !== "principal" && node.name !== "user")
                  .map((node) => {
                    const dx = node.x - principal.x;
                    const dy = node.y - principal.y;
                    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                    const ux = dx / dist;
                    const uy = dy / dist;
                    const x1 = principal.x + ux * NODE_RADIUS;
                    const y1 = principal.y + uy * NODE_RADIUS;
                    const x2 = node.x - ux * NODE_RADIUS;
                    const y2 = node.y - uy * NODE_RADIUS;
                    const isLive = activeNames.has(node.name);
                    return (
                      <line
                        className={`agent-network__scaffold-line ${
                          isLive ? "agent-network__scaffold-line--live" : "agent-network__scaffold-line--dormant"
                        }`}
                        key={`scaffold-${node.name}`}
                        x1={x1}
                        y1={y1}
                        x2={x2}
                        y2={y2}
                      />
                    );
                  });
              })()}
            </g>

            {/* edges first so nodes draw on top */}
            <g className="agent-network__edges">
              {edgesWithGeometry.map(({ edge, geometry }) => {
                const lastMs = new Date(edge.lastTimestamp).getTime();
                const isActive = Number.isFinite(lastMs) && now - lastMs < ACTIVE_EDGE_WINDOW_MS;
                const lastMsg = edge.messages[edge.messages.length - 1];
                const kind = msgTypeKind(lastMsg?.msgType);
                const weight = edge.messages.length;
                const strokeWidth = weight <= 1 ? 1.5 : weight <= 5 ? 2 : 2.5;
                const isSelected = selection?.kind === "edge" && selection.key === edge.key;
                const isHover = hoverEdgeKey === edge.key;
                return (
                  <g
                    aria-label={t(weight === 1 ? "network.aria.edgeOne" : "network.aria.edgeMany", { from: edge.from, count: weight, to: edge.to })}
                    className={[
                      "agent-network__edge",
                      `agent-network__edge--${kind}`,
                      isActive ? "agent-network__edge--active" : "",
                      isSelected ? "is-selected" : "",
                      isHover ? "is-hover" : "",
                    ].filter(Boolean).join(" ")}
                    key={edge.key}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectEdge(edge.key);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectEdge(edge.key);
                      }
                    }}
                    onMouseEnter={() => setHoverEdgeKey(edge.key)}
                    onMouseLeave={() => setHoverEdgeKey((current) => (current === edge.key ? null : current))}
                    role="button"
                    tabIndex={0}
                  >
                    {/* invisible thick hitbox for easier clicking */}
                    <path className="agent-network__edge-hitbox" d={geometry.d} />
                    <path
                      className="agent-network__edge-line"
                      d={geometry.d}
                      markerEnd={`url(#agent-net-arrow-${kind})`}
                      style={{ strokeWidth }}
                    />
                    {weight > 1 ? (
                      <g className="agent-network__edge-badge" transform={`translate(${geometry.midX} ${geometry.midY})`}>
                        <circle r="9" />
                        <text dy="3" textAnchor="middle">{weight}</text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
            </g>

            <g className="agent-network__nodes">
              {positioned.map((node) => {
                const agent = agentByName.get(node.name);
                const isLive = activeNames.has(node.name);
                const status = agent ? statusKind(agent.status) : "idle";
                const presence = isLive ? "live" : "dormant";
                const isSelected = selection?.kind === "node" && selection.id === node.name;
                const Icon = getAgentIcon(node.name);
                const accent = getAgentAccentVar(node.name);
                const isPrincipal = node.name === "principal";
                const fallbackAgent = agent ?? { name: node.name, status: "idle", task: "" };
                const taskLabel = taskLabelFor(fallbackAgent, status, t);
                return (
                  <g
                    aria-label={t("network.aria.node", { name: node.name, status: t(isLive ? statusLabelKey(status) : "network.status.dormant") })}
                    className={[
                      "agent-network__node",
                      `agent-network__node--${status}`,
                      `agent-network__node--${presence}`,
                      isPrincipal ? "agent-network__node--principal" : "",
                      isSelected ? "is-selected" : "",
                    ].filter(Boolean).join(" ")}
                    key={node.name}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectNode(node.name);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        selectNode(node.name);
                      }
                    }}
                    onMouseEnter={(event) => handleNodeEnter(node.name, event.currentTarget)}
                    onMouseLeave={handleNodeLeave}
                    role="button"
                    style={{ ["--agent-accent" as string]: accent }}
                    tabIndex={0}
                    transform={`translate(${node.x} ${node.y})`}
                  >
                    {/* Pulse halo: only for running agents, gated on motion preference. */}
                    {status === "running" && isLive ? (
                      <circle className="agent-network__node-pulse" r={NODE_RADIUS + 6} />
                    ) : null}
                    {/* Outer ring — status border (solid when live, dashed when dormant). */}
                    <circle className="agent-network__node-ring" r={NODE_RADIUS} />
                    {/* Inner accent disc — agent brand color, low opacity. */}
                    <circle className="agent-network__node-disc" r={NODE_RADIUS - 6} />
                    {/* Tiny dormant badge: empty hollow circle in the corner so
                         dormant state is readable WITHOUT relying on color. */}
                    {!isLive ? (
                      <g className="agent-network__node-badge agent-network__node-badge--dormant">
                        <circle cx={NODE_RADIUS - 6} cy={-NODE_RADIUS + 6} r="5" />
                      </g>
                    ) : null}
                    {/* Running indicator dot. */}
                    {status === "running" && isLive ? (
                      <g className="agent-network__node-badge agent-network__node-badge--running">
                        <circle cx={NODE_RADIUS - 6} cy={-NODE_RADIUS + 6} r="5" />
                      </g>
                    ) : null}
                    {/* Error indicator. */}
                    {status === "error" && isLive ? (
                      <g className="agent-network__node-badge agent-network__node-badge--error">
                        <circle cx={NODE_RADIUS - 6} cy={-NODE_RADIUS + 6} r="5" />
                      </g>
                    ) : null}
                    <foreignObject x={-12} y={-12} width={24} height={24}>
                      <div className="agent-network__node-icon">
                        <Icon size={18} />
                      </div>
                    </foreignObject>
                    <text className="agent-network__node-label" textAnchor="middle" y={NODE_RADIUS + 18}>
                      {node.name}
                    </text>
                    {isLive && (agent?.task || status === "running") ? (
                      <text className="agent-network__node-sublabel" textAnchor="middle" y={NODE_RADIUS + 32}>
                        {taskLabel.length > 32 ? `${taskLabel.slice(0, 30)}…` : taskLabel}
                      </text>
                    ) : !isLive ? (
                      <text className="agent-network__node-sublabel agent-network__node-sublabel--dormant" textAnchor="middle" y={NODE_RADIUS + 32}>
                        {t("network.node.notSpawned")}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
          {hoveredData && hovered && viewportRef.current ? (
            <NodeTooltip
              data={hoveredData}
              now={now}
              anchor={hovered.anchor}
              container={{
                width: viewportRef.current.clientWidth,
                height: viewportRef.current.clientHeight,
              }}
            />
          ) : null}
        </div>
      </div>

      <aside className="agent-network__detail" aria-label={t("network.aria.detail")}>
        <div className="agent-network__tabs" role="tablist" aria-label={t("network.aria.tabs")}>
          {(["detail", "analytics", "timeline"] as AgentTab[]).map((tab) => (
            <button
              key={tab}
              role="tab"
              type="button"
              aria-selected={activeTab === tab}
              className={`agent-network__tab ${activeTab === tab ? "agent-network__tab--active" : ""}`}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(event) => {
                const order: AgentTab[] = ["detail", "analytics", "timeline"];
                const idx = order.indexOf(activeTab);
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  setActiveTab(order[(idx + 1) % order.length]);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  setActiveTab(order[(idx - 1 + order.length) % order.length]);
                }
              }}
            >
              {tab === "detail" ? t("network.tab.detail") : tab === "analytics" ? t("network.tab.analytics") : t("network.tab.timeline")}
            </button>
          ))}
        </div>

        <div className="agent-network__tabpanel" role="tabpanel">
          {activeTab === "detail" ? (
            selectedEdge ? (
              <EdgeDetail edge={selectedEdge} now={now} />
            ) : selectedAgent ? (
              <AgentDetail
                agent={selectedAgent}
                isLive={activeNames.has(selectedAgent.name)}
                filter={
                  agentFilters[selectedAgent.name] ?? {
                    hideMessages: false,
                    hideTools: false,
                    hideHooks: true,
                  }
                }
                now={now}
                onFilterChange={onSetAgentFilter}
                received={messagesForAgent.received}
                sent={messagesForAgent.sent}
                activity={selectedAgentActivity}
              />
            ) : (
              <GlobalOverview
                agents={agents}
                edges={edges}
                messages={messages}
                totalNodes={nodeNames.length}
                liveCount={liveCount}
                now={now}
              />
            )
          ) : activeTab === "analytics" ? (
            <AnalyticsTab agents={agents} messages={messages} edges={edges} now={now} />
          ) : (
            <TimelineTab
              messages={messages}
              now={now}
              isRunning={runningCount > 0}
              onSelectMessage={(agentName) => selectNode(agentName)}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Detail subviews
 * ------------------------------------------------------------------------ */

function AgentDetail({
  agent,
  isLive,
  filter,
  now,
  onFilterChange,
  sent,
  received,
  activity,
}: {
  agent: AgentStatus;
  isLive: boolean;
  filter: AgentMessageFilter;
  now: number;
  onFilterChange: (
    agentName: string,
    hideMessages: boolean,
    hideTools: boolean,
    hideHooks?: boolean,
  ) => void;
  sent: AgentEdgeMessage[];
  received: AgentEdgeMessage[];
  activity: AgentActivity | null;
}) {
  const Icon = getAgentIcon(agent.name);
  const status = statusKind(agent.status);
  const profile = getAgentProfile(agent.name);
  const presence = isLive ? "live" : "dormant";
  const t = useT();
  const statusLabel = isLive ? t(statusLabelKey(status)) : t("network.status.dormant");
  const currentTask = isLive ? taskLabelFor(agent, status, t) : t("network.detail.notSpawnedByPrincipal");

  return (
    <>
      <header className="agent-network__detail-title">
        <span
          className={`agent-network__detail-avatar agent-network__detail-avatar--${status} agent-network__detail-avatar--${presence}`}
          style={{ ["--agent-accent" as string]: getAgentAccentVar(agent.name) }}
        >
          <Icon size={16} />
        </span>
        <h3>{agent.name}</h3>
        <span className={`agent-network__status-pill agent-network__status-pill--${isLive ? status : "dormant"}`}>
          {statusLabel}
        </span>
      </header>
      <div className="agent-network__detail-badges">
        <span>{t(profile.role)}</span>
        {!isLive ? <span>{t("network.detail.notSpawned")}</span> : null}
        {agent.alive === false ? <span>{t("network.detail.notAlive")}</span> : null}
      </div>

      {/* ---- Profile ---- */}
      <section className="agent-network__detail-section">
        <h4><Bot size={13} /> {t("network.detail.responsibility")}</h4>
        <p className="agent-network__detail-text">{t(profile.description)}</p>
      </section>

      {/* ---- Live status ---- */}
      <section className="agent-network__detail-section">
        <h4><Activity size={13} /> {t("network.detail.status")}</h4>
        <dl className="agent-network__keyvals">
          <div>
            <dt>{t("network.detail.state")}</dt>
            <dd>
              <span className={`agent-network__status-pill agent-network__status-pill--${isLive ? status : "dormant"}`}>
                {statusLabel}
              </span>
            </dd>
          </div>
            <div>
              <dt>{t("network.detail.currentTask")}</dt>
              <dd className="agent-network__keyvals-wrap">
                {currentTask}
              </dd>
            </div>
          <div>
            <dt>{t("network.detail.updated")}</dt>
            <dd>{agent.updatedAt ? relativeTime(agent.updatedAt, now) : "—"}</dd>
          </div>
          <div>
            <dt>{t("network.detail.communication")}</dt>
            <dd>{t("network.detail.commCount", { sent: sent.length, received: received.length })}</dd>
          </div>
        </dl>
      </section>

      {/* ---- Activity Statistics ---- */}
      {activity ? (
        <section className="agent-network__detail-section">
          <h4><MessageSquare size={13} /> {t("network.detail.activityStats")}</h4>
          <dl className="agent-network__keyvals">
            <div>
              <dt>{t("network.detail.totalMessages")}</dt>
              <dd>{activity.totalMessages}</dd>
            </div>
            <div>
              <dt>{t("network.detail.messageBreakdown")}</dt>
              <dd className="agent-network__keyvals-wrap">
                {t("network.detail.breakdownValue", { assistant: activity.assistantMessages, reasoning: activity.reasoningMessages, tool: activity.toolMessages })}
              </dd>
            </div>
            {activity.toolCalls > 0 ? (
              <div>
                <dt>{t("network.detail.toolCalls")}</dt>
                <dd>{activity.toolCalls}</dd>
              </div>
            ) : null}
            {activity.communicationPartners.length > 0 && (
              <div>
                <dt>{t("network.detail.communicationPartners")}</dt>
                <dd className="agent-network__keyvals-wrap">
                  {activity.communicationPartners.join(", ")}
                </dd>
              </div>
            )}
          </dl>
        </section>
      ) : null}

      {/* ---- Available tools ---- */}
      <section className="agent-network__detail-section">
        <h4><Wrench size={13} /> {t("network.detail.availableTools")}</h4>
        <ul className="agent-network__tool-list">
          {profile.defaultTools.length === 0 ? (
            <li className="agent-network__tool-chip">{t("network.detail.noMcpTools")}</li>
          ) : (
            profile.defaultTools.map((tool) => (
              <li className="agent-network__tool-chip" key={tool}>{tool}</li>
            ))
          )}
        </ul>
      </section>

      {/* ---- Display filters ---- */}
      <section className="agent-network__detail-section">
        <h4><Filter size={13} /> {t("network.detail.displayFilters")}</h4>
        <FilterChipBar agentName={agent.name} filter={filter} onChange={onFilterChange} />
        <p className="agent-network__detail-text" style={{ fontSize: 11 }}>
          {t("network.detail.filtersNote")}
        </p>
      </section>

      {/* ---- Sent ---- */}
      <section className="agent-network__detail-section">
        <h4><Send size={13} /> {t("network.detail.sent", { count: sent.length })}</h4>
        <MessageList items={sent} now={now} dirField="to" emptyText={t("network.detail.noOutgoing")} />
      </section>

      {/* ---- Received ---- */}
      <section className="agent-network__detail-section">
        <h4><Inbox size={13} /> {t("network.detail.received", { count: received.length })}</h4>
        <MessageList items={received} now={now} dirField="from" emptyText={t("network.detail.noIncoming")} />
      </section>
    </>
  );
}

function EdgeDetail({ edge, now }: { edge: AgentEdge; now: number }) {
  const t = useT();
  return (
    <>
      <header className="agent-network__detail-title">
        <span className="agent-network__detail-avatar"><ArrowRight size={16} /></span>
        <h3>
          {edge.from} <ArrowRight size={14} className="agent-network__detail-arrow" /> {edge.to}
        </h3>
      </header>
      <div className="agent-network__detail-badges">
        <span>{t("network.edge.messages", { count: edge.messages.length })}</span>
        <span>{t("network.edge.last", { time: relativeTime(edge.lastTimestamp, now) })}</span>
      </div>
      <section className="agent-network__detail-section">
        <h4><MessageSquare size={13} /> {t("network.edge.conversation")}</h4>
        <ol className="agent-network__msg-list agent-network__msg-list--ordered">
          {edge.messages.map((m) => (
            <li className={`agent-network__msg agent-network__msg--${msgTypeKind(m.msgType)}`} key={m.id}>
              <header className="agent-network__msg-head">
                <span className="agent-network__msg-type">{m.msgType ?? t("network.msg.fallback")}</span>
                <time>{relativeTime(m.timestamp, now)}</time>
              </header>
              <p>{m.content || <em>{t("network.msg.empty")}</em>}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function MessageList({
  items,
  now,
  dirField,
  emptyText,
}: {
  items: AgentEdgeMessage[];
  now: number;
  dirField: "from" | "to";
  emptyText: string;
}) {
  const t = useT();
  if (items.length === 0) {
    return <p className="agent-network__detail-text">{emptyText}</p>;
  }
  return (
    <ul className="agent-network__msg-list">
      {items.slice(0, 20).map((m) => (
        <li className={`agent-network__msg agent-network__msg--${msgTypeKind(m.msgType)}`} key={m.id}>
          <header className="agent-network__msg-head">
            <span className="agent-network__msg-route">
              <strong>{m[dirField]}</strong>
            </span>
            <span className="agent-network__msg-type">{m.msgType ?? t("network.msg.fallback")}</span>
            <time>{relativeTime(m.timestamp, now)}</time>
          </header>
          <p>
            {m.content
              ? (m.content.length > 200 ? `${m.content.slice(0, 198)}…` : m.content)
              : <em>{t("network.msg.empty")}</em>}
          </p>
        </li>
      ))}
      {items.length > 20 ? (
        <li className="agent-network__msg">{t("network.msg.more", { count: items.length - 20 })}</li>
      ) : null}
    </ul>
  );
}

/* --------------------------------------------------------------------------
 * Filter chip bar — Linear/GitHub-style active-filter chips.
 *
 * Default state: "Hiding: nothing  [+ add filter]".
 * Each active rule is a removable chip; popover lets the user add more.
 * ------------------------------------------------------------------------ */

type FilterKey = "messages" | "tools" | "hooks";

const FILTER_KEYS: FilterKey[] = ["messages", "tools", "hooks"];

const FILTER_KEY_META: Record<
  FilterKey,
  { labelKey: string; descriptionKey: string; Icon: typeof MessageSquare }
> = {
  messages: { labelKey: "network.filter.messages.label", descriptionKey: "network.filter.messages.description", Icon: MessageSquare },
  tools: { labelKey: "network.filter.tools.label", descriptionKey: "network.filter.tools.description", Icon: Wrench },
  hooks: { labelKey: "network.filter.hooks.label", descriptionKey: "network.filter.hooks.description", Icon: Webhook },
};

function activeFilterKeys(filter: AgentMessageFilter): FilterKey[] {
  const out: FilterKey[] = [];
  if (filter.hideMessages) out.push("messages");
  if (filter.hideTools) out.push("tools");
  if (filter.hideHooks) out.push("hooks");
  return out;
}

function applyFilterKey(filter: AgentMessageFilter, key: FilterKey, value: boolean): AgentMessageFilter {
  if (key === "messages") return { ...filter, hideMessages: value };
  if (key === "tools") return { ...filter, hideTools: value };
  return { ...filter, hideHooks: value };
}

function FilterChipBar({
  agentName,
  filter,
  onChange,
}: {
  agentName: string;
  filter: AgentMessageFilter;
  onChange: (
    agentName: string,
    hideMessages: boolean,
    hideTools: boolean,
    hideHooks?: boolean,
  ) => void;
}) {
  const t = useT();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const active = activeFilterKeys(filter);
  const inactive = FILTER_KEYS.filter((key) => !active.includes(key));

  // Close popover if no choices remain.
  useEffect(() => {
    if (popoverOpen && inactive.length === 0) setPopoverOpen(false);
  }, [popoverOpen, inactive.length]);

  // Close on outside click + ESC.
  useEffect(() => {
    if (!popoverOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setPopoverOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopoverOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKey);
    };
  }, [popoverOpen]);

  const setKey = (key: FilterKey, value: boolean) => {
    const next = applyFilterKey(filter, key, value);
    onChange(agentName, next.hideMessages, next.hideTools, next.hideHooks);
  };

  return (
    <div className="filter-chips" role="group" aria-label={t("network.filter.ariaGroup")}>
      <div className="filter-chips__row">
        <span className="filter-chips__label">
          <EyeOff size={12} aria-hidden="true" /> {t("network.filter.hiding")}
        </span>

        {active.length === 0 ? (
          <span className="filter-chips__empty">{t("network.filter.nothing")}</span>
        ) : (
          active.map((key) => {
            const meta = FILTER_KEY_META[key];
            const Icon = meta.Icon;
            const label = t(meta.labelKey);
            return (
              <span className="filter-chips__chip" key={key}>
                <Icon size={11} aria-hidden="true" />
                <span>{label}</span>
                <button
                  aria-label={t("network.filter.stopHiding", { label })}
                  className="filter-chips__chip-remove"
                  onClick={() => setKey(key, false)}
                  type="button"
                >
                  <X size={10} aria-hidden="true" />
                </button>
              </span>
            );
          })
        )}

        <span className="filter-chips__add">
          <button
            aria-expanded={popoverOpen}
            aria-haspopup="menu"
            aria-label={t("network.filter.addRule")}
            className="filter-chips__add-trigger"
            disabled={inactive.length === 0}
            onClick={() => setPopoverOpen((current) => !current)}
            ref={triggerRef}
            type="button"
          >
            <Plus size={11} aria-hidden="true" />
            <span>{t("network.filter.addFilter")}</span>
          </button>
          {popoverOpen && inactive.length > 0 ? (
            <div className="filter-chips__popover" ref={popoverRef} role="menu">
              <div className="filter-chips__popover-header">{t("network.filter.popoverHeader")}</div>
              {inactive.map((key) => {
                const meta = FILTER_KEY_META[key];
                const Icon = meta.Icon;
                return (
                  <button
                    className="filter-chips__popover-item"
                    key={key}
                    onClick={() => {
                      setKey(key, true);
                      setPopoverOpen(false);
                      triggerRef.current?.focus();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Icon size={14} aria-hidden="true" />
                    <span className="filter-chips__popover-item-label">{t(meta.labelKey)}</span>
                    <small>{t(meta.descriptionKey)}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      </div>
    </div>
  );
}
