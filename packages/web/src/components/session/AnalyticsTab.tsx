/* --------------------------------------------------------------------------
 * AnalyticsTab — session-level statistics rendered as hand-rolled SVG (the
 * house style; no chart library). Always global: not affected by node
 * selection. Three groups: overview cards, trends/distribution, advanced.
 * ------------------------------------------------------------------------ */
import { useMemo } from "react";
import {
  AlertTriangle,
  Inbox,
  Timer,
  TrendingUp,
  Users,
} from "lucide-react";
import { AgentStatus, ChatMessage } from "../../contracts/backend";
import { AgentEdge, getAgentAccentVar } from "./agentNetworkShared";
import {
  computeAgentLoad,
  computeErrorCount,
  computeLifecycleHeatmap,
  computeMessageTrend,
  computeResponseLatencies,
  computeTypeDistribution,
  estimateTokens,
  formatDuration,
  summarizeLatencies,
} from "./agentAnalytics";
import { useT } from "../../i18n/useT";

interface AnalyticsTabProps {
  agents: AgentStatus[];
  messages: ChatMessage[];
  edges: AgentEdge[];
  now: number;
}

export function AnalyticsTab({ agents, messages, edges, now }: AnalyticsTabProps) {
  const t = useT();
  const trend = useMemo(() => computeMessageTrend(messages, now), [messages, now]);
  const load = useMemo(() => computeAgentLoad(edges), [edges]);
  const typeDist = useMemo(() => computeTypeDistribution(messages), [messages]);
  const latencyStats = useMemo(
    () => summarizeLatencies(computeResponseLatencies(messages)),
    [messages],
  );
  const tokens = useMemo(() => estimateTokens(messages), [messages]);
  const heatmap = useMemo(
    () => computeLifecycleHeatmap(messages, agents.map((a) => a.name), now),
    [messages, agents, now],
  );
  const errorCount = useMemo(() => computeErrorCount(messages), [messages]);

  const totalMessages = edges.reduce((s, e) => s + e.messages.length, 0);
  const liveCount = agents.length;
  const runningCount = agents.filter(
    (a) => a.status === "running" || a.status === "in_progress",
  ).length;

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
      {/* ---- Group 1: overview cards ---- */}
      <div className="agent-analytics__cards">
        <div className="agent-analytics__card">
          <span className="agent-analytics__card-label">
            <Inbox size={12} /> {t("analytics.card.totalMessages")}
          </span>
          <span className="agent-analytics__card-value">{totalMessages}</span>
          <Sparkline values={trend.map((t) => t.count)} />
        </div>

        <div className="agent-analytics__card">
          <span className="agent-analytics__card-label">
            <Users size={12} /> {t("analytics.card.activeAgents")}
          </span>
          <span className="agent-analytics__card-value">
            {liveCount}
          </span>
          <span className="agent-analytics__card-sub">{t("analytics.card.runningNow", { count: runningCount })}</span>
        </div>

        <div className="agent-analytics__card">
          <span className="agent-analytics__card-label">
            <Timer size={12} /> {t("analytics.card.avgLatency")}
          </span>
          <span className="agent-analytics__card-value">
            {latencyStats ? formatDuration(latencyStats.mean) : "—"}
          </span>
          <span className="agent-analytics__card-sub">
            {latencyStats ? t("analytics.card.median", { value: formatDuration(latencyStats.median) }) : t("analytics.card.noPairs")}
          </span>
        </div>

        <div
          className={`agent-analytics__card ${errorCount > 0 ? "agent-analytics__card--danger" : "agent-analytics__card--ok"}`}
        >
          <span className="agent-analytics__card-label">
            <AlertTriangle size={12} /> {t("analytics.card.errors")}
          </span>
          <span className="agent-analytics__card-value">{errorCount}</span>
          <span className="agent-analytics__card-sub">{errorCount === 0 ? t("analytics.card.allClear") : t("analytics.card.needsAttention")}</span>
        </div>
      </div>

      {/* ---- Group 2: trends & distribution ---- */}
      <section className="agent-analytics__chart">
        <h4 className="agent-analytics__chart-title">
          <TrendingUp size={13} /> {t("analytics.chart.volume")}
        </h4>
        <LineChart values={trend.map((t) => t.count)} />
      </section>

      <section className="agent-analytics__chart">
        <h4 className="agent-analytics__chart-title">{t("analytics.chart.load")}</h4>
        <BarChart rows={load} />
      </section>

      <section className="agent-analytics__chart">
        <h4 className="agent-analytics__chart-title">{t("analytics.chart.types")}</h4>
        <PieChart dist={typeDist} />
      </section>

      {/* ---- Group 3: advanced ---- */}
      {latencyStats ? (
        <section className="agent-analytics__chart">
          <h4 className="agent-analytics__chart-title">{t("analytics.chart.latency")}</h4>
          <BoxPlot stats={latencyStats} />
        </section>
      ) : null}

      <section className="agent-analytics__chart">
        <h4 className="agent-analytics__chart-title">{t("analytics.chart.tokens")}</h4>
        <table className="agent-analytics__table">
          <thead>
            <tr>
              <th>{t("analytics.table.agent")}</th>
              <th>{t("analytics.table.msgs")}</th>
              <th>{t("analytics.table.avgLen")}</th>
              <th>{t("analytics.table.tokens")}</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.sentMsgs}</td>
                <td>{row.avgLen}</td>
                <td>{row.tokens.toLocaleString()}</td>
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

function Sparkline({ values }: { values: number[] }) {
  const w = 200;
  const h = 28;
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg className="agent-analytics__sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--color-info)" strokeWidth="1.5" />
    </svg>
  );
}

function LineChart({ values }: { values: number[] }) {
  const t = useT();
  const w = 320;
  const h = 110;
  const pad = 6;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : w;
  const pts = values.map((v, i) => ({
    x: pad + i * step,
    y: h - pad - (v / max) * (h - pad * 2),
  }));
  const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${pad + (values.length - 1) * step},${h - pad}`;
  return (
    <svg className="agent-analytics__svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("analytics.aria.volume")}>
      <polygon points={area} fill="color-mix(in srgb, var(--color-info) 16%, transparent)" stroke="none" />
      <polyline points={line} fill="none" stroke="var(--color-info)" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

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

function PieChart({ dist }: { dist: { delegate: number; result: number; other: number } }) {
  const t = useT();
  const segments = [
    { key: "delegate", value: dist.delegate, color: "var(--color-info)" },
    { key: "result", value: dist.result, color: "var(--color-success)" },
    { key: "other", value: dist.other, color: "var(--color-text-subtle)" },
  ].filter((s) => s.value > 0);
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) return <p className="agent-analytics__hint">No typed messages.</p>;

  const cx = 55;
  const cy = 55;
  const r = 48;
  let angle = -Math.PI / 2;
  const arcs = segments.map((seg) => {
    const frac = seg.value / total;
    const start = angle;
    const end = angle + frac * Math.PI * 2;
    angle = end;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const large = end - start > Math.PI ? 1 : 0;
    // Full-circle guard (single segment = 100%).
    const d =
      segments.length === 1
        ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return { d, color: seg.color, key: seg.key };
  });

  return (
    <div className="agent-analytics__pie-wrap">
      <svg className="agent-analytics__pie" viewBox="0 0 110 110" role="img" aria-label={t("analytics.aria.types")}>
        {arcs.map((a) => (
          <path key={a.key} d={a.d} fill={a.color} stroke="var(--color-surface)" strokeWidth="1" />
        ))}
        <circle cx={cx} cy={cy} r={22} fill="var(--color-surface-raised)" />
        <text x={cx} y={cy + 4} textAnchor="middle" className="agent-analytics__pie-total">
          {total}
        </text>
      </svg>
      <ul className="agent-analytics__legend">
        {segments.map((s) => (
          <li key={s.key}>
            <i style={{ background: s.color }} /> {s.key} ({s.value})
          </li>
        ))}
      </ul>
    </div>
  );
}

function BoxPlot({
  stats,
}: {
  stats: { min: number; q1: number; median: number; q3: number; max: number };
}) {
  const t = useT();
  const w = 320;
  const h = 56;
  const pad = 14;
  const span = Math.max(1, stats.max - stats.min);
  const scale = (v: number) => pad + ((v - stats.min) / span) * (w - pad * 2);
  const midY = h / 2;
  return (
    <div>
      <svg className="agent-analytics__svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={t("analytics.aria.latency")}>
        {/* whisker */}
        <line x1={scale(stats.min)} x2={scale(stats.max)} y1={midY} y2={midY} stroke="var(--color-border-strong)" strokeWidth="1.5" />
        <line x1={scale(stats.min)} x2={scale(stats.min)} y1={midY - 8} y2={midY + 8} stroke="var(--color-border-strong)" />
        <line x1={scale(stats.max)} x2={scale(stats.max)} y1={midY - 8} y2={midY + 8} stroke="var(--color-border-strong)" />
        {/* box */}
        <rect
          x={scale(stats.q1)}
          y={midY - 12}
          width={Math.max(2, scale(stats.q3) - scale(stats.q1))}
          height={24}
          rx={3}
          fill="color-mix(in srgb, var(--color-info) 20%, transparent)"
          stroke="var(--color-info)"
        />
        {/* median */}
        <line x1={scale(stats.median)} x2={scale(stats.median)} y1={midY - 12} y2={midY + 12} stroke="var(--color-info)" strokeWidth="2" />
      </svg>
      <div className="agent-analytics__boxplot-legend">
        <span>min {formatDuration(stats.min)}</span>
        <span>med {formatDuration(stats.median)}</span>
        <span>max {formatDuration(stats.max)}</span>
      </div>
    </div>
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
