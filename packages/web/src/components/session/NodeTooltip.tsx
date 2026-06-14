/* --------------------------------------------------------------------------
 * NodeTooltip — a small hover card shown beside an agent node in the network
 * graph. Rendered as an absolutely-positioned <div> INSIDE the viewport
 * container (NOT inside the SVG) so it isn't clipped by foreignObject and can
 * use normal DOM layout. The parent computes the anchor rect (node bounding
 * box, relative to the viewport container) and passes it in; the tooltip flips
 * to the left side when there isn't room on the right.
 * ------------------------------------------------------------------------ */
import { Inbox, Send } from "lucide-react";
import {
  getAgentIcon,
  getAgentProfile,
  relativeTime,
  statusKind,
} from "./agentNetworkShared";

export interface NodeTooltipData {
  name: string;
  isLive: boolean;
  status: string;
  task: string;
  updatedAt?: string;
  sent: number;
  received: number;
}

interface NodeTooltipProps {
  data: NodeTooltipData;
  now: number;
  /** Node bounding box, in pixels relative to the viewport container. */
  anchor: { left: number; top: number; width: number; height: number };
  /** Viewport container size, for collision detection. */
  container: { width: number; height: number };
}

const TOOLTIP_WIDTH = 240;
const GAP = 12;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function NodeTooltip({ data, now, anchor, container }: NodeTooltipProps) {
  const Icon = getAgentIcon(data.name);
  const profile = getAgentProfile(data.name);
  const kind = data.isLive ? statusKind(data.status) : "dormant";

  // Decide side: prefer right of the node; flip left if it would overflow.
  const wouldOverflowRight = anchor.left + anchor.width + GAP + TOOLTIP_WIDTH > container.width;
  const side: "left" | "right" = wouldOverflowRight ? "left" : "right";

  const left =
    side === "right"
      ? anchor.left + anchor.width + GAP
      : Math.max(GAP, anchor.left - GAP - TOOLTIP_WIDTH);

  // Vertically center on the node, clamped to the container.
  const rawTop = anchor.top + anchor.height / 2;
  const top = Math.min(Math.max(GAP, rawTop), container.height - GAP);

  return (
    <div
      className={`agent-network__tooltip agent-network__tooltip--${side}`}
      role="tooltip"
      style={{ left, top, width: TOOLTIP_WIDTH }}
    >
      <div className="agent-network__tooltip-head">
        <span
          className="agent-network__tooltip-avatar"
          style={{ ["--agent-accent" as string]: accentVar(profile.accent) }}
        >
          <Icon size={14} />
        </span>
        <div className="agent-network__tooltip-id">
          <strong>{data.name}</strong>
          <span>{profile.role}</span>
        </div>
      </div>

      <div className="agent-network__tooltip-row">
        <span className={`agent-network__tooltip-status agent-network__tooltip-status--${kind}`}>
          <i className={`agent-network__tooltip-dot agent-network__tooltip-dot--${kind}`} />
          {data.isLive ? data.status : "dormant"}
        </span>
      </div>

      {data.isLive ? (
        <p className="agent-network__tooltip-task">
          {data.task ? truncate(data.task, 60) : "Idle — waiting for instructions"}
        </p>
      ) : (
        <p className="agent-network__tooltip-task agent-network__tooltip-task--dormant">
          Not yet spawned by Principal
        </p>
      )}

      {data.isLive && data.updatedAt ? (
        <p className="agent-network__tooltip-meta">Updated {relativeTime(data.updatedAt, now)}</p>
      ) : null}

      <div className="agent-network__tooltip-counts">
        <span>
          <Send size={11} /> Sent {data.sent}
        </span>
        <span>
          <Inbox size={11} /> Received {data.received}
        </span>
      </div>
    </div>
  );
}

function accentVar(accent: string): string {
  switch (accent) {
    case "info":
      return "var(--color-info)";
    case "success":
      return "var(--color-success)";
    case "warning":
      return "var(--color-warning)";
    case "danger":
      return "var(--color-danger)";
    default:
      return "var(--color-text-subtle)";
  }
}
