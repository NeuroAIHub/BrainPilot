/**
 * Agent panel subview (Detail / Analytics / Timeline) selection (#326).
 *
 * Global tab preference must not force an empty Analytics screen when the
 * destination conversation has no analytics content. Auto-correct is applied
 * on session entry; user clicks still work even when data is empty.
 */

export type AgentTab = "detail" | "analytics" | "timeline";

export const AGENT_TAB_STORAGE_KEY = "agent-network-active-tab";

/** Same emptiness rule as AnalyticsTab (`totalMessages === 0`). */
export function hasAnalyticsData(
  edges: ReadonlyArray<{ messages: readonly unknown[] }>,
): boolean {
  for (const e of edges) {
    if (e.messages.length > 0) return true;
  }
  return false;
}

/**
 * Resolve the tab to show when entering a conversation (session switch or
 * first paint for a session). Never defaults to Analytics when there is no
 * meaningful analytics content.
 */
export function resolveAgentTabForSession(
  preferred: AgentTab,
  hasAnalytics: boolean,
): AgentTab {
  if (preferred === "analytics" && !hasAnalytics) {
    return "detail";
  }
  return preferred;
}

export function parseAgentTab(value: string | null | undefined): AgentTab | null {
  if (value === "detail" || value === "analytics" || value === "timeline") {
    return value;
  }
  return null;
}

export function loadPreferredAgentTab(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): AgentTab {
  if (!storage) return "detail";
  try {
    return parseAgentTab(storage.getItem(AGENT_TAB_STORAGE_KEY)) ?? "detail";
  } catch {
    return "detail";
  }
}

/** Persist only user-initiated tab choices, not auto-corrections. */
export function savePreferredAgentTab(
  tab: AgentTab,
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(AGENT_TAB_STORAGE_KEY, tab);
  } catch {
    /* quota / privacy mode */
  }
}

function defaultStorage(): Storage | null {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return null;
  }
  return window.localStorage;
}
