import { useMemo, useSyncExternalStore } from "react";
import { runtimeConfig } from "../../config";

const CHANGE_EVENT = "bp:workspace-navigation";
const MARKET_LOCATION_KEY = "bp.web.marketLocation";
const MARKET_PARAMS = ["page", "category", "q", "dataset", "scope", "plugin", "modality", "access", "topic", "sort", "compact"];
export type WorkspacePage = "workspace" | "demo" | "plugins";

function subscribe(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function useWorkspaceLocation() {
  const location = useSyncExternalStore(subscribe, () => window.location.href, () => "http://brainpilot.local/");
  return useMemo(() => new URL(location), [location]);
}

export function workspacePage(url: URL): WorkspacePage {
  const page = url.searchParams.get("page");
  return page === "plugins" || page === "demo" ? page : "workspace";
}

export function writeWorkspaceLocation(target: string, replace = false) {
  const url = new URL(target, window.location.href);
  if (url.origin !== window.location.origin) return;
  if (url.href === window.location.href) return;
  window.history[replace ? "replaceState" : "pushState"](window.history.state, "", url);
  if (workspacePage(url) === "plugins") {
    const search = new URLSearchParams();
    for (const key of MARKET_PARAMS) {
      const value = url.searchParams.get(key);
      if (value !== null) search.set(key, value);
    }
    try { sessionStorage.setItem(MARKET_LOCATION_KEY, search.toString()); } catch { /* Optional. */ }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function navigateWorkspace(page: WorkspacePage) {
  const url = new URL(runtimeConfig.localMode ? "/" : "/app", window.location.href);
  if (page === "plugins") {
    try { url.search = sessionStorage.getItem(MARKET_LOCATION_KEY) ?? ""; } catch { /* Optional. */ }
  }
  if (page !== "workspace") url.searchParams.set("page", page);
  writeWorkspaceLocation(url.href);
}

/** Search edits replace the current entry; opening a tab/detail adds a Back step. */
export function updateMarketplaceLocation(patch: Record<string, string | null>, replace = true) {
  const url = new URL(window.location.href);
  url.pathname = runtimeConfig.localMode ? "/" : "/app";
  url.hash = "";
  url.searchParams.delete("path");
  url.searchParams.set("page", "plugins");
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  writeWorkspaceLocation(url.href, replace);
}
