/**
 * Pure state model for the Settings dialog's independently-loaded resources.
 *
 * The dialog used to fetch providers / MCP servers / installed plugins / health
 * / BYOK in a single `Promise.all`. One endpoint the deployment does not
 * implement (hosted BrainPilot Cloud serves no `GET /api/plugins/installed`)
 * rejected the whole batch, so the successful provider and MCP responses were
 * thrown away, the still-empty initial arrays rendered as "no providers yet",
 * and the raw "404 Not Found" leaked into a dialog-wide error line.
 *
 * Each resource therefore settles on its own, and its state distinguishes four
 * situations the UI must render differently:
 *
 *   - `idle`    — never requested (dialog closed, or capability disabled)
 *   - `loading` — request in flight; previously-loaded `data` is kept visible
 *   - `ready`   — request succeeded; `data` is authoritative, `[]` means the
 *                 backend genuinely has none
 *   - `error`   — request failed; the last successful `data` (if any) is kept
 *
 * Failure never overwrites `data` with `[]`: an empty list is only ever shown
 * as "nothing configured" when a request actually came back empty.
 *
 * Kept free of React so it is testable in this package's `node` vitest env.
 */

export type SettingsResourceStatus = "idle" | "loading" | "ready" | "error";

export interface SettingsResource<T> {
  status: SettingsResourceStatus;
  /** Last successfully loaded value; `null` until the first success. */
  data: T | null;
  /** Message for the most recent failure; cleared by a later success. */
  error: string | null;
}

/**
 * What a list-shaped resource should render right now. `empty` is reserved for
 * a *confirmed* empty success, so the "no providers yet" / "no MCP servers" /
 * "no plugins installed" copy can never appear on a fresh open, while a request
 * is in flight, or after a failure.
 */
export type SettingsResourcePhase = "pending" | "failed" | "empty" | "present";

export function idleResource<T>(): SettingsResource<T> {
  return { status: "idle", data: null, error: null };
}

/** Begin a (re)load. Keeps any previously loaded data on screen. */
export function loadingResource<T>(current: SettingsResource<T>): SettingsResource<T> {
  return { status: "loading", data: current.data, error: null };
}

/** A success replaces the data and clears a previously-scoped error. */
export function readyResource<T>(data: T): SettingsResource<T> {
  return { status: "ready", data, error: null };
}

/** A failure keeps the last good data — it must not degrade to an empty list. */
export function failedResource<T>(
  current: SettingsResource<T>,
  error: string,
): SettingsResource<T> {
  return { status: "error", data: current.data, error };
}

/**
 * Close/unmount: forget the *outcome* but keep a last good non-empty list, so a
 * reopen can show it immediately while it refreshes. A confirmed-empty or
 * failed result is dropped — otherwise the reopened dialog would render "no
 * providers yet" (or a stale error) from the previous session before its new
 * request has even started.
 */
export function resetResourceForReopen<T>(
  current: SettingsResource<T[]>,
): SettingsResource<T[]> {
  if (current.status === "idle") return current;
  const keep = current.data !== null && current.data.length > 0 ? current.data : null;
  return { status: "idle", data: keep, error: null };
}

/** Convenience for rendering: the data to list, or `[]` when nothing loaded. */
export function resourceItems<T>(resource: SettingsResource<T[]>): T[] {
  return resource.data ?? [];
}

export function resourcePhase<T>(resource: SettingsResource<T[]>): SettingsResourcePhase {
  // A failure is reported as `failed` even when stale data is still shown, so
  // the caller can offer a retry alongside whatever it renders.
  if (resource.status === "error") return "failed";
  if (resource.data === null) return "pending";
  return resource.data.length === 0
    ? (resource.status === "ready" ? "empty" : "pending")
    : "present";
}

/** True only for a confirmed-empty successful response. */
export function isConfirmedEmpty<T>(resource: SettingsResource<T[]>): boolean {
  return resourcePhase(resource) === "empty";
}

/** Normalize a rejection into a message suitable for a scoped error line. */
export function resourceErrorMessage(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
  return message.trim().length > 0 ? message : fallback;
}
