/* --------------------------------------------------------------------------
 * TimelineTab — message chronology as horizontal swimlanes (one row per
 * agent). Hand-rolled SVG. Supports horizontal zoom (wheel), pan (drag),
 * Fit All, per-agent + per-type filtering, and PNG export (html-to-image).
 *
 * Always global: shows every inter-agent message in the session.
 * ------------------------------------------------------------------------ */
import { useMemo, useRef, useState } from "react";
import { Download, Filter, Maximize2, Inbox } from "lucide-react";
import { toPng } from "html-to-image";
import { ChatMessage } from "../../contracts/backend";
import { useT } from "../../i18n/useT";
import { getMessageEdge, msgTypeKind } from "./agentNetworkShared";

interface TimelineTabProps {
  messages: ChatMessage[];
  now: number;
  /** Click a dot → caller selects that agent (and flips to Detail tab). */
  onSelectMessage: (agentName: string) => void;
}

interface TimelineDot {
  id: string;
  agent: string; // swimlane owner = sender
  to: string;
  ts: number;
  kind: "delegate" | "result" | "neutral";
  content: string;
}

const ROW_H = 36;
const LABEL_W = 88;
const PAD_TOP = 28;
const TICK_COUNT = 6;

export function TimelineTab({ messages, now, onSelectMessage }: TimelineTabProps) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [hideDelegate, setHideDelegate] = useState(false);
  const [hideResult, setHideResult] = useState(false);
  const [hideOther, setHideOther] = useState(false);
  const [hovered, setHovered] = useState<TimelineDot | null>(null);
  const dragRef = useRef<{ startX: number; startPan: number } | null>(null);

  const dots = useMemo<TimelineDot[]>(() => {
    const out: TimelineDot[] = [];
    for (const m of messages) {
      const e = getMessageEdge(m);
      if (!e) continue;
      const ts = new Date(e.timestamp).getTime();
      if (!Number.isFinite(ts)) continue;
      out.push({
        id: e.id,
        agent: e.from,
        to: e.to,
        ts,
        kind: msgTypeKind(e.msgType),
        content: e.content,
      });
    }
    return out.sort((a, b) => a.ts - b.ts);
  }, [messages]);

  // Swimlane order: by first activity; "principal" pinned first if present.
  const lanes = useMemo(() => {
    const firstSeen = new Map<string, number>();
    for (const d of dots) {
      if (!firstSeen.has(d.agent)) firstSeen.set(d.agent, d.ts);
    }
    const names = Array.from(firstSeen.keys());
    names.sort((a, b) => {
      if (a === "principal") return -1;
      if (b === "principal") return 1;
      return (firstSeen.get(a) ?? 0) - (firstSeen.get(b) ?? 0);
    });
    return names;
  }, [dots]);

  const timeBounds = useMemo(() => {
    if (dots.length === 0) return { start: now - 60_000, end: now };
    const start = dots[0].ts;
    const end = Math.max(now, dots[dots.length - 1].ts);
    return { start, end: end === start ? start + 60_000 : end };
  }, [dots, now]);

  if (dots.length === 0) {
    return (
      <div className="agent-timeline__empty">
        <Inbox size={20} />
        <p>{t("timeline.empty")}</p>
      </div>
    );
  }

  const laneAreaW = 760; // base virtual width (before zoom)
  const plotW = laneAreaW * zoom;
  const svgW = LABEL_W + plotW;
  const svgH = PAD_TOP + lanes.length * ROW_H + 8;
  const span = timeBounds.end - timeBounds.start;

  const xOf = (ts: number) => LABEL_W + panX + ((ts - timeBounds.start) / span) * plotW;
  const laneIndex = (name: string) => lanes.indexOf(name);
  const yOf = (name: string) => PAD_TOP + laneIndex(name) * ROW_H + ROW_H / 2;

  const isHidden = (kind: TimelineDot["kind"]) =>
    (kind === "delegate" && hideDelegate) ||
    (kind === "result" && hideResult) ||
    (kind === "neutral" && hideOther);

  // Tick labels: adaptive granularity.
  const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => {
    const ts = timeBounds.start + (span * i) / TICK_COUNT;
    return { ts, x: xOf(ts) };
  });
  const formatTick = (ts: number) => {
    const d = new Date(ts);
    if (span < 60_000) return `${d.getSeconds()}s`;
    if (span < 3_600_000) return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  // delegate→result arcs (pair each delegate with the next result the target sends).
  const arcs: { x1: number; y1: number; x2: number; y2: number; id: string }[] = [];
  const usedResult = new Set<string>();
  for (const d of dots) {
    if (d.kind !== "delegate") continue;
    const match = dots.find(
      (r) => r.kind === "result" && r.agent === d.to && r.ts > d.ts && !usedResult.has(r.id),
    );
    if (match) {
      usedResult.add(match.id);
      arcs.push({
        id: `${d.id}->${match.id}`,
        x1: xOf(d.ts),
        y1: yOf(d.agent),
        x2: xOf(match.ts),
        y2: yOf(match.agent),
      });
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    setZoom((z) => Math.min(8, Math.max(1, z * factor)));
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { startX: e.clientX, startPan: panX };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPanX(dragRef.current.startPan + (e.clientX - dragRef.current.startX));
  };
  const endDrag = () => {
    dragRef.current = null;
  };
  const fitAll = () => {
    setZoom(1);
    setPanX(0);
  };

  const exportPng = async () => {
    if (!containerRef.current) return;
    try {
      const dataUrl = await toPng(containerRef.current, {
        backgroundColor:
          getComputedStyle(document.documentElement)
            .getPropertyValue("--color-surface")
            .trim() || "#ffffff",
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `agent-timeline-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      /* export is best-effort; ignore failures */
    }
  };

  return (
    <div className="agent-timeline">
      <div className="agent-timeline__controls">
        <button type="button" className="agent-timeline__btn" onClick={fitAll}>
          <Maximize2 size={12} /> {t("timeline.fit")}
        </button>
        <span className="agent-timeline__filters">
          <Filter size={12} />
          <FilterToggle label={t("timeline.filter.delegate")} active={!hideDelegate} onClick={() => setHideDelegate((v) => !v)} dotClass="delegate" />
          <FilterToggle label={t("timeline.filter.result")} active={!hideResult} onClick={() => setHideResult((v) => !v)} dotClass="result" />
          <FilterToggle label={t("timeline.filter.other")} active={!hideOther} onClick={() => setHideOther((v) => !v)} dotClass="neutral" />
        </span>
        <button type="button" className="agent-timeline__btn" onClick={exportPng}>
          <Download size={12} /> PNG
        </button>
      </div>

      <div
        className="agent-timeline__scroll"
        ref={containerRef}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={() => {
          endDrag();
          setHovered(null);
        }}
      >
        <svg
          className="agent-timeline__svg"
          width={svgW}
          height={svgH}
          viewBox={`0 0 ${svgW} ${svgH}`}
          role="img"
          aria-label={t("timeline.aria")}
        >
          {/* zebra lanes + labels */}
          {lanes.map((name, i) => (
            <g key={name}>
              <rect
                x={0}
                y={PAD_TOP + i * ROW_H}
                width={svgW}
                height={ROW_H}
                className={i % 2 === 0 ? "agent-timeline__lane agent-timeline__lane--even" : "agent-timeline__lane agent-timeline__lane--odd"}
              />
              <text x={6} y={PAD_TOP + i * ROW_H + ROW_H / 2 + 4} className="agent-timeline__lane-label">
                {name.length > 11 ? `${name.slice(0, 10)}…` : name}
              </text>
            </g>
          ))}

          {/* time ticks */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={t.x} x2={t.x} y1={PAD_TOP - 6} y2={svgH - 4} className="agent-timeline__tick" />
              <text x={t.x} y={14} textAnchor="middle" className="agent-timeline__tick-label">
                {formatTick(t.ts)}
              </text>
            </g>
          ))}

          {/* "now" marker */}
          <line x1={xOf(now)} x2={xOf(now)} y1={PAD_TOP - 6} y2={svgH - 4} className="agent-timeline__now" />

          {/* delegate→result arcs */}
          {arcs.map((a) => {
            const midY = Math.min(a.y1, a.y2) - 10;
            return (
              <path
                key={a.id}
                className="agent-timeline__arc"
                d={`M ${a.x1} ${a.y1} Q ${(a.x1 + a.x2) / 2} ${midY} ${a.x2} ${a.y2}`}
                fill="none"
              />
            );
          })}

          {/* dots */}
          {dots.map((d) => {
            if (isHidden(d.kind)) return null;
            return (
              <circle
                key={d.id}
                className={`agent-timeline__dot agent-timeline__dot--${d.kind}`}
                cx={xOf(d.ts)}
                cy={yOf(d.agent)}
                r={5}
                onClick={() => onSelectMessage(d.agent)}
                onMouseEnter={() => setHovered(d)}
                onMouseLeave={() => setHovered((cur) => (cur?.id === d.id ? null : cur))}
              >
                <title>{`${d.agent} → ${d.to}\n${d.content.slice(0, 100)}`}</title>
              </circle>
            );
          })}
        </svg>
      </div>

      {hovered ? (
        <div className="agent-timeline__hint-card">
          <strong>
            {hovered.agent} → {hovered.to}
          </strong>
          <span className={`agent-timeline__hint-type agent-timeline__hint-type--${hovered.kind}`}>
            {hovered.kind}
          </span>
          <p>{hovered.content ? `${hovered.content.slice(0, 120)}${hovered.content.length > 120 ? "…" : ""}` : "(empty)"}</p>
        </div>
      ) : null}
    </div>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
  dotClass,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  dotClass: string;
}) {
  return (
    <button
      type="button"
      className={`agent-timeline__filter ${active ? "is-active" : ""}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <i className={`agent-timeline__filter-dot agent-timeline__dot--${dotClass}`} />
      {label}
    </button>
  );
}
