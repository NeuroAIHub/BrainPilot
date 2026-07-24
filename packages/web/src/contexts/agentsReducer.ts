import type { AgentStatus, WebSocketEvent } from "../contracts/backend";

/**
 * #70: merge a single `agent_status_update` event into the Agents-panel list.
 *
 * The runtime emits `agent_status_update` on every agent status transition
 * (idle/running/error/stopped). The panel's authoritative source is the
 * wholesale `CUSTOM:session_state` snapshot, but those arrive only on
 * transitions too — between them, and on the very first run, this incremental
 * merge keeps the panel live without a reload/reselect.
 *
 * Merge rules:
 *  - non-`agent_status_update` events return the same reference (no-op);
 *  - the agent key is the event's top-level `name` (schema field; camelize
 *    leaves the single word `name`/`status` untouched);
 *  - a name not in the list is appended (task="" — the event carries no task);
 *  - a known name has its status/updatedAt/alive updated but its **task
 *    preserved** (only session_state / a /state poll carry task);
 *  - a no-op status change returns the same reference to avoid a re-render;
 *  - `retrying`/`auto_retry*` is normalized to `running` so the panel never
 *    shows a non-canonical status (the auto-retry chat card is produced
 *    independently by the message reducer).
 */
const RETRY_STATUSES = new Set(["retrying", "auto_retry", "auto_retry_start"]);

function retryFromEvent(e: Record<string, unknown>): AgentStatus["retry"] {
  if (!e.retry || typeof e.retry !== "object") return undefined;
  const retry = e.retry as Record<string, unknown>;
  const attempt = Number(retry.attempt);
  const maxAttempts = Number(retry.maxAttempts ?? retry.max_attempts);
  const delayMs = Number(retry.delayMs ?? retry.delay_ms);
  if (![attempt, maxAttempts, delayMs].every(Number.isFinite)) return undefined;
  return { attempt, maxAttempts, delayMs };
}

export function reduceAgentsForEvent(
  agents: AgentStatus[],
  event: WebSocketEvent,
): AgentStatus[] {
  const e = event as Record<string, unknown>;
  if (e.type !== "agent_status_update") return agents;

  const name = String(e.name ?? "");
  if (!name) return agents;

  const rawStatus = String(e.status ?? "idle");
  const status = RETRY_STATUSES.has(rawStatus.toLowerCase()) ? "running" : rawStatus;
  const retry = retryFromEvent(e);
  const updatedAt = typeof e.updatedAt === "string" ? e.updatedAt : new Date().toISOString();
  const alive = status !== "stopped";

  const idx = agents.findIndex((a) => a.name === name);
  if (idx === -1) {
    return [...agents, { name, status, task: "", updatedAt, alive, retry }];
  }
  const previousRetry = agents[idx]!.retry;
  const retryUnchanged =
    previousRetry?.attempt === retry?.attempt &&
    previousRetry?.maxAttempts === retry?.maxAttempts &&
    previousRetry?.delayMs === retry?.delayMs;
  if (agents[idx]!.status === status && retryUnchanged) return agents; // no-op → stable reference
  const next = agents.slice();
  next[idx] = { ...agents[idx]!, status, updatedAt, alive, retry };
  return next;
}
