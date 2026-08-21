import { TraceNode } from "../../contracts/backend";

/**
 * Pure layout & formatting helpers for the reasoning-trace graph. Shared by the
 * live TracePanel, the presentational TraceGraphView / TraceNodeDetail, and the
 * demo player. No React, no side effects.
 */

export function formatTime(value?: string): string {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}
export function getStatusLabelKey(status: string): string | null {
  if (status === "done" || status === "completed") {
    return "trace.status.done";
  }
  if (status === "in_progress") {
    return "trace.status.running";
  }
  return null;
}

export function normalizeStatus(status: string): string {
  return status === "completed" ? "done" : status;
}

export function getNodeKind(node: TraceNode): string {
  return node.nodeType || node.type || "step";
}

export function getNodeKindLabelKey(kind: string): string | null {
  switch (kind) {
    case "task":
      return "trace.kind.task";
    case "trace":
      return "trace.kind.trace";
    case "action":
      return "trace.kind.action";
    case "observation":
      return "trace.kind.observation";
    case "decision":
      return "trace.kind.decision";
    case "milestone":
      return "trace.kind.milestone";
    case "validation":
      return "trace.kind.validation";
    case "audit":
      return "trace.kind.audit";
    case "writing":
      return "trace.kind.writing";
    case "research":
      return "trace.kind.research";
    case "step":
      return "trace.kind.step";
    case "session_start":
      return "trace.kind.sessionStart";
    default:
      return null;
  }
}

export function truncateNodeTitle(title?: string, maxUnits = 26): string {
  if (!title) {
    return "";
  }
  let units = 0;
  let index = 0;
  for (const char of title) {
    units += char.charCodeAt(0) > 127 ? 2 : 1;
    if (units > maxUnits) {
      return title.slice(0, index) + "…";
    }
    index++;
  }
  return title;
}

export function formatDuration(ms?: number): string {
  if (ms === undefined) {
    return "-";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

export const relationLabels: Record<string, string> = {
  necessitated_by: "needed by",
  used: "used",
  produced: "produced",
  comparison_with: "compared with",
  follows: "then",
  depends_on: "depends on",
  parent: "parent",
};

export const artifactLabels: Record<string, string> = {
  file: "file",
  data: "data",
  code: "code",
  text: "text",
  image: "image",
  figure: "figure",
  result: "result",
  doc: "doc",
  config: "config",
  dir: "dir",
  model: "model",
  log: "log",
  report: "report",
  paper: "paper",
};

export type TraceLayoutDirection = "LR" | "TB";

export type PositionedTraceNode = { node: TraceNode; x: number; y: number };

export interface TraceLayout {
  positioned: PositionedTraceNode[];
  byId: Map<string, PositionedTraceNode>;
  nodeWidth: number;
  nodeHeight: number;
  width: number;
  height: number;
}

export function buildTraceLayout(nodes: TraceNode[], direction: TraceLayoutDirection): TraceLayout {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const levelCache = new Map<string, number>();
  const inProgress = new Set<string>();
  const layoutParents = (node: TraceNode): string[] => node.parents.map((parent) => parent.id);
  const getLevel = (node: TraceNode): number => {
    if (levelCache.has(node.id)) {
      return levelCache.get(node.id) as number;
    }
    // The Host guarantees one DAG across every parent conclusion. Keep this
    // guard for malformed legacy/external payloads so a bad graph degrades to
    // a root-level rank instead of crashing the entire Trace panel.
    if (inProgress.has(node.id)) return 0;
    inProgress.add(node.id);
    const parents = layoutParents(node);
    if (parents.length === 0) {
      inProgress.delete(node.id);
      levelCache.set(node.id, 0);
      return 0;
    }
    const level = 1 + Math.max(...parents.map((parentId) => {
      const parent = byId.get(parentId);
      return parent ? getLevel(parent) : 0;
    }));
    inProgress.delete(node.id);
    levelCache.set(node.id, level);
    return level;
  };
  const grouped = new Map<number, TraceNode[]>();
  for (const node of nodes) {
    const level = getLevel(node);
    grouped.set(level, [...(grouped.get(level) ?? []), node]);
  }
  const nodeWidth = direction === "LR" ? 200 : 214;
  const nodeHeight = 72;
  const levelGap = direction === "LR" ? 300 : 170;
  const siblingGap = direction === "LR" ? 140 : 260;
  // Center each level around a shared axis: the widest level defines the span,
  // and every other level is offset so its midpoint lines up with that axis.
  const maxSiblingCount = Math.max(1, ...Array.from(grouped.values()).map((s) => s.length));
  const baseOffset = direction === "LR" ? 62 : 80;
  const positioned = nodes.map((node) => {
    const level = getLevel(node);
    const siblings = grouped.get(level) ?? [];
    const index = siblings.findIndex((item) => item.id === node.id);
    const centeringShift = ((maxSiblingCount - siblings.length) * siblingGap) / 2;
    const crossPos = baseOffset + centeringShift + index * siblingGap;
    const x = direction === "LR" ? 72 + level * levelGap : crossPos;
    const y = direction === "LR" ? crossPos : 62 + level * levelGap;
    return { node, x, y };
  });
  const maxX = Math.max(220, ...positioned.map((item) => item.x + nodeWidth));
  const maxY = Math.max(180, ...positioned.map((item) => item.y + nodeHeight));
  return {
    positioned,
    byId: new Map(positioned.map((item) => [item.node.id, item])),
    nodeWidth,
    nodeHeight,
    width: Math.max(720, maxX + 96),
    height: Math.max(360, maxY + 76),
  };
}
