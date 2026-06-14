/* --------------------------------------------------------------------------
 * GlobalOverview — the Detail tab's "nothing selected" state. Replaces the old
 * EmptyDetail with an at-a-glance session summary so the panel is informative
 * even before the user clicks a node or edge.
 * ------------------------------------------------------------------------ */
import { Activity, Inbox, Network, Timer, Users } from "lucide-react";
import { AgentStatus, ChatMessage } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { AgentEdge, relativeTime } from "./agentNetworkShared";
import {
  computeResponseLatencies,
  formatDuration,
  summarizeLatencies,
} from "./agentAnalytics";

interface GlobalOverviewProps {
  agents: AgentStatus[];
  edges: AgentEdge[];
  messages: ChatMessage[];
  totalNodes: number;
  liveCount: number;
  now: number;
}

export function GlobalOverview({
  agents,
  edges,
  messages,
  totalNodes,
  liveCount,
  now,
}: GlobalOverviewProps) {
  const t = useT();
  const totalMessages = edges.reduce((sum, e) => sum + e.messages.length, 0);
  const dormantCount = Math.max(0, totalNodes - liveCount);
  const runningCount = agents.filter(
    (a) => a.status === "running" || a.status === "in_progress",
  ).length;

  const lastActivityIso = edges.reduce<string>((latest, e) => {
    return e.lastTimestamp > latest ? e.lastTimestamp : latest;
  }, "");

  const latencyStats = summarizeLatencies(computeResponseLatencies(messages));

  return (
    <div className="agent-network__overview">
      <header className="agent-network__overview-head">
        <span className="agent-network__overview-icon">
          <Network size={16} />
        </span>
        <h3>{t("overview.title")}</h3>
      </header>

      <dl className="agent-network__overview-stats">
        <div>
          <dt>
            <Users size={13} /> {t("overview.agents")}
          </dt>
          <dd>
            {t("overview.liveDormant", { live: liveCount, dormant: dormantCount })}
            <span className="agent-network__overview-sub">{t("overview.total", { total: totalNodes })}</span>
          </dd>
        </div>
        <div>
          <dt>
            <Activity size={13} /> {t("overview.runningNow")}
          </dt>
          <dd>{runningCount}</dd>
        </div>
        <div>
          <dt>
            <Inbox size={13} /> {t("overview.messages")}
          </dt>
          <dd>
            {totalMessages}
            <span className="agent-network__overview-sub">{t("overview.acrossLinks", { count: edges.length })}</span>
          </dd>
        </div>
        <div>
          <dt>
            <Timer size={13} /> {t("overview.avgResponse")}
          </dt>
          <dd>
            {latencyStats ? formatDuration(latencyStats.mean) : "—"}
            {latencyStats ? (
              <span className="agent-network__overview-sub">
                {t("overview.median", { value: formatDuration(latencyStats.median) })}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>
            <Activity size={13} /> {t("overview.lastActivity")}
          </dt>
          <dd>{lastActivityIso ? relativeTime(lastActivityIso, now) : "—"}</dd>
        </div>
      </dl>

      <p className="agent-network__overview-tip">
        {t("overview.tipPrefix")}
        <strong>{t("network.tab.analytics")}</strong> / <strong>{t("network.tab.timeline")}</strong>
        {t("overview.tipSuffix")}
      </p>
    </div>
  );
}
