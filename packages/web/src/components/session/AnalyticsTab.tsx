/* --------------------------------------------------------------------------
 * AnalyticsTab — session-level statistics rendered as hand-rolled SVG (the
 * house style; no chart library). Always global: not affected by node
 * selection. Kept intentionally compact for end users: traffic, average
 * message length, and lifecycle heatmap.
 * ------------------------------------------------------------------------ */
import { useMemo } from "react";
import { Inbox } from "lucide-react";
import { AgentStatus, ChatMessage, TokenUsage } from "../../contracts/backend";
import { AgentEdge, getAgentAccentVar } from "./agentNetworkShared";
import {
  computeAgentLoad,
  computeLifecycleHeatmap,
  estimateTokens,
} from "./agentAnalytics";
import { useSessions } from "../../contexts/SessionContext";
import { useT } from "../../i18n/useT";

interface AnalyticsTabProps {
  agents: AgentStatus[];
  messages: ChatMessage[];
  edges: AgentEdge[];
  now: number;
}

/** Compact number formatting for token counts (1.2k, 3.4M). */
function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function AnalyticsTab({ agents, messages, edges, now }: AnalyticsTabProps) {
  const t = useT();
  const { tokenUsage } = useSessions();
  const load = useMemo(() => computeAgentLoad(edges), [edges]);
  const lengthRows = useMemo(() => estimateTokens(messages), [messages]);
  const heatmap = useMemo(
    () => computeLifecycleHeatmap(messages, agents.map((a) => a.name), now),
    [messages, agents, now],
  );

  // Per-agent real-usage rows, sorted by total desc. Empty when no provider
  // usage has been reported yet (e.g. a freshly restored session pre-turn).
  const usageRows = useMemo(() => {
    if (!tokenUsage) return [] as Array<{ name: string } & TokenUsage>;
    return Object.entries(tokenUsage.byAgent)
      .map(([name, u]) => ({ name, ...u }))
      .sort((a, b) => b.total - a.total);
  }, [tokenUsage]);

  const totalMessages = edges.reduce((s, e) => s + e.messages.length, 0);

  if (totalMessages === 0) {
    return (
      <div className="agent-analytics__empty">
        <Inbox size={20} />
        <p>{t("analytics.empty")}</p>
      </div>
    );
  }

  return (
    <div className="agent-analytics">
      {tokenUsage && tokenUsage.total.total > 0 ? (
        <section className="agent-analytics__chart">
          <h4 className="agent-analytics__chart-title">{t("analytics.chart.tokens")}</h4>
          <div className="agent-analytics__token-total">
            {fmtTokens(tokenUsage.total.total)}{" "}
            <span className="agent-analytics__token-total-label">
              {t("analytics.tokens.total")}
            </span>
          </div>
          <table className="agent-analytics__table">
            <thead>
              <tr>
                <th>{t("analytics.table.agent")}</th>
                <th>{t("analytics.tokens.input")}</th>
                <th>{t("analytics.tokens.output")}</th>
                <th>{t("analytics.tokens.cache")}</th>
                <th>{t("analytics.tokens.total")}</th>
              </tr>
            </thead>
            <tbody>
              {usageRows.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td>{fmtTokens(row.input)}</td>
                  <td>{fmtTokens(row.output)}</td>
                  <td>{fmtTokens(row.cacheRead + row.cacheWrite)}</td>
                  <td>{fmtTokens(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="agent-analytics__chart">
        <h4 className="agent-analytics__chart-title">{t("analytics.chart.load")}</h4>
        <BarChart rows={load} />
      </section>

      <section className="agent-analytics__chart">
        <h4 className="agent-analytics__chart-title">{t("analytics.chart.avgLength")}</h4>
        <table className="agent-analytics__table">
          <thead>
            <tr>
              <th>{t("analytics.table.agent")}</th>
              <th>{t("analytics.table.msgs")}</th>
              <th>{t("analytics.table.avgLen")}</th>
            </tr>
          </thead>
          <tbody>
            {lengthRows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.sentMsgs}</td>
                <td>{row.avgLen}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {heatmap.agents.length > 0 ? (
        <section className="agent-analytics__chart">
          <h4 className="agent-analytics__chart-title">{t("analytics.chart.heatmap")}</h4>
          <HeatmapGrid heatmap={heatmap} />
        </section>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------------------
 * Hand-rolled SVG primitives
 * ------------------------------------------------------------------------ */

function BarChart({ rows }: { rows: { name: string; total: number }[] }) {
  const t = useT();
  if (rows.length === 0) return <p className="agent-analytics__hint">No traffic yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.total));
  const rowH = 22;
  const labelW = 96;
  const w = 320;
  const barMax = w - labelW - 36;
  const h = rows.length * rowH + 4;
  return (
    <svg className="agent-analytics__svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("analytics.aria.load")}>
      {rows.map((r, i) => {
        const y = i * rowH + 4;
        const bw = (r.total / max) * barMax;
        return (
          <g key={r.name}>
            <text x={0} y={y + 11} className="agent-analytics__bar-label">
              {r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name}
            </text>
            <rect
              x={labelW}
              y={y + 2}
              width={Math.max(2, bw)}
              height={rowH - 8}
              rx={2}
              fill={getAgentAccentVar(r.name)}
              opacity={0.85}
            />
            <text x={labelW + bw + 6} y={y + 11} className="agent-analytics__bar-value">
              {r.total}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HeatmapGrid({
  heatmap,
}: {
  heatmap: { agents: string[]; buckets: number; counts: number[][]; max: number };
}) {
  const t = useT();
  const cell = 14;
  const gap = 2;
  const labelW = 90;
  const w = labelW + heatmap.buckets * (cell + gap);
  const h = heatmap.agents.length * (cell + gap) + 2;
  return (
    <svg className="agent-analytics__svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("analytics.aria.heatmap")}>
      {heatmap.agents.map((name, ai) => (
        <g key={name}>
          <text x={0} y={ai * (cell + gap) + cell - 2} className="agent-analytics__bar-label">
            {name.length > 11 ? `${name.slice(0, 10)}…` : name}
          </text>
          {heatmap.counts[ai].map((count, bi) => {
            const intensity = heatmap.max > 0 ? count / heatmap.max : 0;
            return (
              <rect
                key={bi}
                x={labelW + bi * (cell + gap)}
                y={ai * (cell + gap)}
                width={cell}
                height={cell}
                rx={2}
                fill={
                  count === 0
                    ? "var(--color-surface-soft)"
                    : `color-mix(in srgb, var(--color-info) ${Math.round(15 + intensity * 75)}%, transparent)`
                }
              >
                <title>{`${name} · bucket ${bi + 1}: ${count} msg`}</title>
              </rect>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
