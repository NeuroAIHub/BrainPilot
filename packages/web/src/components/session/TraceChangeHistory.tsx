import { History } from "lucide-react";
import { useEffect, useState } from "react";
import type { TraceChange } from "../../contracts/backend";
import { api } from "../../utils/api";

export function TraceChangeHistory({ sessionId, nodeId }: { sessionId?: string; nodeId: string }) {
  const [changes, setChanges] = useState<TraceChange[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void api.sessions.getTraceChanges(sessionId, 500)
      .then((items) => {
        if (!cancelled) setChanges(items.filter((item) => item.target.nodeId === nodeId).reverse());
      })
      .catch(() => { if (!cancelled) setChanges([]); });
    return () => { cancelled = true; };
  }, [sessionId, nodeId]);

  if (changes.length === 0) return null;
  return (
    <details className="trace-detail__section trace-change-history">
      <summary><History size={13} /> Modification history ({changes.length})</summary>
      <div className="trace-relation-list">
        {changes.map((change) => (
          <div key={change.id}>
            <strong>{change.action}</strong>
            <small>{change.actor.name ?? change.actor.type} · {change.createdAt}</small>
            {confidenceChange(change.before, change.after) ? <small>{confidenceChange(change.before, change.after)}</small> : null}
            {change.reason ? <small>{change.reason}</small> : null}
          </div>
        ))}
      </div>
    </details>
  );
}
function confidenceChange(before: unknown, after: unknown): string | undefined {
  const previous = before && typeof before === "object" ? (before as Record<string, unknown>).confidence : undefined;
  const next = after && typeof after === "object" ? (after as Record<string, unknown>).confidence : undefined;
  if (typeof next !== "string") return undefined;
  return `Confidence: ${typeof previous === "string" ? previous : "not assessed"} → ${next}`;
}
