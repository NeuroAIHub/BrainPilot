import { Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TraceNode } from "../../contracts/backend";
import {
  TraceLayoutDirection,
  buildTraceLayout,
  getNodeKind,
  normalizeStatus,
  relationLabels,
  truncateNodeTitle,
} from "./traceLayout";

interface TraceGraphViewProps {
  /** Nodes already filtered / sliced / edge-pruned by the host. */
  nodes: TraceNode[];
  direction: TraceLayoutDirection;
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /**
   * Bumping this re-fits and recenters the viewport on the current content.
   * The host bumps it when the graph advances (e.g. playback auto-advance) so
   * newly revealed nodes scroll into view; manual scrubbing leaves it alone.
   */
  fitToken?: number | string;
  /** Shown when there are no nodes to display. */
  emptyLabel?: string;
  formatKind?: (kind: string) => string;
  zoomLabels?: {
    controls?: string;
    zoomIn?: string;
    zoomOut?: string;
    reset?: string;
  };
}

/**
 * Presentational reasoning-trace graph: the SVG DAG, zoom controls, viewport
 * pan/drag, wheel-zoom, and per-node drag offsets. Owns only view-local state
 * (node offsets, drag). Extracted from TracePanel so the live trace view and
 * the demo replay render the same graph.
 */
export function TraceGraphView({
  nodes,
  direction,
  selectedNodeId,
  onSelectNode,
  zoom,
  onZoomChange,
  fitToken,
  emptyLabel,
  formatKind,
  zoomLabels,
}: TraceGraphViewProps) {
  const [nodeOffsets, setNodeOffsets] = useState<Map<string, { dx: number; dy: number }>>(new Map());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const layoutRef = useRef<ReturnType<typeof buildTraceLayout> | null>(null);
  const draggingNodeRef = useRef<{
    nodeId: string;
    startClientX: number;
    startClientY: number;
    startDx: number;
    startDy: number;
  } | null>(null);
  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    hasPanned: boolean;
  }>({ isDragging: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0, hasPanned: false });

  const layout = useMemo(() => buildTraceLayout(nodes, direction), [direction, nodes]);
  const adjustedLayout = useMemo(() => {
    if (nodeOffsets.size === 0) return layout;
    const adjustedPositioned = layout.positioned.map((p) => {
      const offset = nodeOffsets.get(p.node.id);
      if (!offset) return p;
      return { ...p, x: p.x + offset.dx, y: p.y + offset.dy };
    });
    const adjustedById = new Map(adjustedPositioned.map((p) => [p.node.id, p]));
    return { ...layout, positioned: adjustedPositioned, byId: adjustedById };
  }, [layout, nodeOffsets]);
  layoutRef.current = adjustedLayout;
  const zoomPercent = Math.round(zoom * 100);

  const zoomIn = () => onZoomChange(Math.min(2, Number((zoom + 0.1).toFixed(2))));
  const zoomOut = () => onZoomChange(Math.max(0.05, Number((zoom - 0.1).toFixed(2))));
  const resetZoom = () => onZoomChange(1);

  // Re-fit + recenter on fitToken change (host signals an advance).
  useEffect(() => {
    if (fitToken === undefined || !viewportRef.current) {
      return;
    }
    const l = layoutRef.current;
    if (!l || l.positioned.length === 0) {
      return;
    }
    const viewport = viewportRef.current;
    const padding = 80;
    const xs = l.positioned.map((p) => p.x);
    const ys = l.positioned.map((p) => p.y);
    const minX = Math.min(...xs) - padding;
    const minY = Math.min(...ys) - padding;
    const maxX = Math.max(...xs.map((x) => x + l.nodeWidth)) + padding;
    const maxY = Math.max(...ys.map((y) => y + l.nodeHeight)) + padding;
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const viewportWidth = viewport.clientWidth;
    const viewportHeight = viewport.clientHeight;
    const fitZoom = Math.min(viewportWidth / contentWidth, viewportHeight / contentHeight, 1.5);
    const nextZoom = Math.max(0.05, Number(fitZoom.toFixed(2)));
    // Avoid micro-rescales on every reveal — only re-zoom on a meaningful change,
    // so the graph doesn't visibly "breathe" as nodes stream in.
    if (Math.abs(nextZoom - zoom) > 0.06) {
      onZoomChange(nextZoom);
    }
    const effectiveZoom = Math.abs(nextZoom - zoom) > 0.06 ? nextZoom : zoom;
    requestAnimationFrame(() => {
      if (!viewportRef.current) {
        return;
      }
      const vp = viewportRef.current;
      const centerScrollLeft = ((minX + maxX) / 2) * effectiveZoom - viewportWidth / 2;
      const centerScrollTop = ((minY + maxY) / 2) * effectiveZoom - viewportHeight / 2;
      vp.scrollTo({
        left: Math.max(0, centerScrollLeft),
        top: Math.max(0, centerScrollTop),
        behavior: "smooth",
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  // Per-node drag.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingNodeRef.current) return;
      const { nodeId, startClientX, startClientY, startDx, startDy } = draggingNodeRef.current;
      const dx = startDx + (e.clientX - startClientX) / zoom;
      const dy = startDy + (e.clientY - startClientY) / zoom;
      setNodeOffsets((prev) => {
        const next = new Map(prev);
        next.set(nodeId, { dx, dy });
        return next;
      });
    };
    const handleMouseUp = () => {
      draggingNodeRef.current = null;
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [zoom]);

  if (nodes.length === 0) {
    return <p className="trace-empty">{emptyLabel ?? ""}</p>;
  }

  return (
    <>
      <div className="trace-zoom-controls" aria-label={zoomLabels?.controls}>
        <button disabled={zoom <= 0.05} onClick={zoomOut} type="button" aria-label={zoomLabels?.zoomOut}>
          <Minus size={13} />
        </button>
        <span>{zoomPercent}%</span>
        <button disabled={zoom >= 2} onClick={zoomIn} type="button" aria-label={zoomLabels?.zoomIn}>
          <Plus size={13} />
        </button>
        <button disabled={zoom === 1} onClick={resetZoom} type="button" aria-label={zoomLabels?.reset}>
          <RotateCcw size={11} />
        </button>
      </div>
      <div
        ref={viewportRef}
        className="trace-map__viewport"
        onMouseDown={(event) => {
          const viewport = event.currentTarget;
          dragRef.current = {
            isDragging: true,
            startX: event.clientX,
            startY: event.clientY,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
            hasPanned: false,
          };
        }}
        onMouseMove={(event) => {
          if (!dragRef.current.isDragging) {
            return;
          }
          const dx = event.clientX - dragRef.current.startX;
          const dy = event.clientY - dragRef.current.startY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
            dragRef.current.hasPanned = true;
          }
          const viewport = event.currentTarget;
          viewport.scrollLeft = dragRef.current.scrollLeft - dx;
          viewport.scrollTop = dragRef.current.scrollTop - dy;
        }}
        onMouseUp={() => {
          dragRef.current.isDragging = false;
          // hasPanned guards the same mouseup's onClick (fires synchronously
          // right after this handler) from selecting a node when the user was
          // actually panning. Clear it on the next tick so the guard still
          // fires for this interaction, but doesn't linger and swallow node
          // clicks in the NEXT interaction — the node's own onMouseDown
          // stopPropagation() means viewport.onMouseDown never runs to reset
          // it, so without this the flag stays true forever after one pan.
          window.setTimeout(() => {
            dragRef.current.hasPanned = false;
          }, 0);
        }}
        onMouseLeave={() => {
          dragRef.current.isDragging = false;
          window.setTimeout(() => {
            dragRef.current.hasPanned = false;
          }, 0);
        }}
        onWheel={(event) => {
          event.preventDefault();
          if (event.deltaY === 0) return;
          const step = event.deltaY > 0 ? -0.1 : 0.1;
          onZoomChange(Math.max(0.05, Math.min(2, Number((zoom + step).toFixed(2)))));
        }}
      >
        <svg
          height={adjustedLayout.height * zoom}
          viewBox={`0 0 ${adjustedLayout.width} ${adjustedLayout.height}`}
          width={adjustedLayout.width * zoom}
          role="img"
        >
          <defs>
            <marker id="trace-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M 0 0 L 8 4 L 0 8 z" />
            </marker>
          </defs>
          {adjustedLayout.positioned.flatMap(({ node }) =>
            node.parents.map((parentRef) => {
              const parent = adjustedLayout.byId.get(parentRef.id);
              const child = adjustedLayout.byId.get(node.id);
              if (!parent || !child) {
                return null;
              }
              const isHorizontal = direction === "LR";
              const startX = parent.x + (isHorizontal ? adjustedLayout.nodeWidth : adjustedLayout.nodeWidth / 2);
              const startY = parent.y + (isHorizontal ? adjustedLayout.nodeHeight / 2 : adjustedLayout.nodeHeight);
              const endX = child.x + (isHorizontal ? 0 : adjustedLayout.nodeWidth / 2);
              const endY = child.y + (isHorizontal ? adjustedLayout.nodeHeight / 2 : 0);
              const path = isHorizontal
                ? `M ${startX} ${startY} C ${startX + 54} ${startY}, ${endX - 54} ${endY}, ${endX} ${endY}`
                : `M ${startX} ${startY} C ${startX} ${startY + 42}, ${endX} ${endY - 42}, ${endX} ${endY}`;
              const midX = (startX + endX) / 2;
              const midY = (startY + endY) / 2;
              const labelText = parentRef.relation ? (relationLabels[parentRef.relation] || parentRef.relation) : "";
              const labelWidth = Math.max(48, labelText.length * 5.5 + 10);
              return (
                <g className={`trace-edge trace-edge--${parentRef.relation || "necessitated_by"}`} key={`${parentRef.id}-${node.id}`}>
                  <path d={path} />
                  {parentRef.relation ? (
                    <g className="trace-edge-label">
                      <rect
                        x={midX - labelWidth / 2}
                        y={midY - 14}
                        width={labelWidth}
                        height={13}
                        rx={4}
                      />
                      <text x={midX} y={midY - 7}>{labelText}</text>
                    </g>
                  ) : null}
                </g>
              );
            }),
          )}
          {adjustedLayout.positioned.map(({ node, x, y }) => {
            const kind = getNodeKind(node);
            const kindLabel = formatKind?.(kind) ?? kind;
            return (
              <g
                className={`trace-map-node trace-map-node--${kind} trace-map-node--${normalizeStatus(node.status)} ${selectedNodeId === node.id ? "is-selected" : ""} ${draggingNodeRef.current?.nodeId === node.id ? "is-dragging" : ""}`}
                key={node.id}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const offset = nodeOffsets.get(node.id) || { dx: 0, dy: 0 };
                  draggingNodeRef.current = {
                    nodeId: node.id,
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    startDx: offset.dx,
                    startDy: offset.dy,
                  };
                }}
                onClick={() => {
                  if (dragRef.current.hasPanned || draggingNodeRef.current) {
                    return;
                  }
                  onSelectNode(node.id);
                }}
                style={{ transform: `translate(${x}px, ${y}px)` }}
              >
                <rect height={adjustedLayout.nodeHeight} rx="8" width={adjustedLayout.nodeWidth} />
                <circle className={`trace-node__dot--${normalizeStatus(node.status)}`} cx="16" cy="24" r="4" />
                <text className="trace-map-node__title" x="28" y="26">{truncateNodeTitle(node.title)}</text>
                <text className="trace-map-node__meta" x="28" y="44">{node.agent || kindLabel}</text>
                <text className="trace-map-node__kind" x="28" y="58">{kindLabel}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </>
  );
}
