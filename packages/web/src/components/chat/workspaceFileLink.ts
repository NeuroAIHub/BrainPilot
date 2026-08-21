export type WorkspaceFileTarget = {
  path: string;
  line?: number;
};

export type SessionWorkspaceFileTarget = WorkspaceFileTarget & { sessionId: string };

export type WorkspaceFileLocation = Pick<Location, "pathname" | "search" | "hash">;

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MANAGED_ROOTS = ["/workspace", "/data"] as const;
const APPLICATION_ROUTE_ROOTS = new Set([
  "account",
  "api",
  "app",
  "assets",
  "bench",
  "demos",
  "feedback",
  "sessions",
]);

export function shouldResetWorkspaceFileLocation(input: {
  location: WorkspaceFileLocation;
  previousSessionId: string | null | undefined;
  nextSessionId: string | null | undefined;
  hasInitialTarget: boolean;
  initialTargetHandled: boolean;
}): boolean {
  if (input.previousSessionId === input.nextSessionId) return false;
  if (!/^\/sessions\/[^/]+\/files\/?$/.test(input.location.pathname)) return false;
  // Preserve a copied deep link until its owning session and file have been
  // selected once. Every later session/draft transition must leave that route
  // so Files state from the previous conversation cannot leak into the next.
  return !input.hasInitialTarget || input.initialTargetHandled;
}

function parseLineHash(hash: string): number | undefined {
  const lineMatch = /^(?:#)?(?:L|line-?)(\d+)$/i.exec(hash);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  return line && line > 0 ? line : undefined;
}

function normalizeManagedPath(decodedPath: string): string | null {
  const portablePath = decodedPath.replace(/\\/g, "/");
  if (portablePath.includes("\0")) return null;

  const rooted = portablePath.startsWith("/") ? portablePath : `/workspace/${portablePath}`;
  const parts: string[] = [];
  for (const part of rooted.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length <= 1) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  const normalized = `/${parts.join("/")}`;
  if (!MANAGED_ROOTS.some((root) => normalized.startsWith(`${root}/`))) return null;
  return normalized;
}

function parseCanonicalLocation(
  location: WorkspaceFileLocation,
): SessionWorkspaceFileTarget | null {
  const match = /^\/sessions\/([^/]+)\/files\/?$/.exec(location.pathname);
  if (!match) return null;

  let sessionId: string;
  try {
    sessionId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!sessionId) return null;

  const rawPath = new URLSearchParams(location.search).get("path");
  if (!rawPath) return null;
  const path = normalizeManagedPath(rawPath);
  if (!path) return null;

  const line = parseLineHash(location.hash);
  return { sessionId, path, ...(line ? { line } : {}) };
}

export function buildWorkspaceFileDeepLink(
  sessionId: string,
  target: WorkspaceFileTarget,
): string {
  if (!sessionId) throw new TypeError("A session id is required for a workspace file link");
  const path = normalizeManagedPath(target.path);
  if (!path) throw new TypeError("Workspace file links must stay under /workspace or /data");
  const hash = target.line && target.line > 0 ? `#L${Math.floor(target.line)}` : "";
  return `/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(path)}${hash}`;
}

export function parseWorkspaceFileLocation(
  location: WorkspaceFileLocation,
): SessionWorkspaceFileTarget | WorkspaceFileTarget | null {
  const canonical = parseCanonicalLocation(location);
  if (canonical) return canonical;
  if (location.pathname.startsWith("/sessions/")) return null;

  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(location.pathname).replace(/\\/g, "/");
  } catch {
    return null;
  }
  const firstSegment = decodedPathname.split("/").find(Boolean)?.toLowerCase();
  if (firstSegment && APPLICATION_ROUTE_ROOTS.has(firstSegment)) return null;
  const isExplicitManagedPath = MANAGED_ROOTS.some(
    (root) => decodedPathname === root || decodedPathname.startsWith(`${root}/`),
  );
  const legacyPath = isExplicitManagedPath
    ? location.pathname
    : location.pathname.replace(/^\/+/, "");
  return parseWorkspaceFileHref(`${legacyPath}${location.hash}`);
}

export function resolveWorkspaceFileSession(
  target: SessionWorkspaceFileTarget | WorkspaceFileTarget,
  availableSessionIds: readonly string[],
  currentSessionId: string | null | undefined,
): SessionWorkspaceFileTarget | null {
  if ("sessionId" in target) {
    return availableSessionIds.includes(target.sessionId) ? target : null;
  }
  const sessionId = currentSessionId && availableSessionIds.includes(currentSessionId)
    ? currentSessionId
    : availableSessionIds[0];
  return sessionId ? { ...target, sessionId } : null;
}

export function parseWorkspaceFileHref(href: string): WorkspaceFileTarget | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;

  if (trimmed.startsWith("/sessions/")) {
    try {
      const url = new URL(trimmed, "http://brainpilot.local");
      const canonical = parseCanonicalLocation(url);
      return canonical
        ? { path: canonical.path, ...(canonical.line ? { line: canonical.line } : {}) }
        : null;
    } catch {
      return null;
    }
  }

  let rawPath = trimmed;
  if (trimmed.toLowerCase().startsWith("brainpilot-file:")) {
    try {
      const url = new URL(trimmed);
      rawPath = url.pathname + url.hash;
    } catch {
      return null;
    }
  } else if (EXTERNAL_SCHEME.test(trimmed)) {
    return null;
  }

  const hashIndex = rawPath.indexOf("#");
  const hash = hashIndex >= 0 ? rawPath.slice(hashIndex + 1) : "";
  const pathWithQuery = hashIndex >= 0 ? rawPath.slice(0, hashIndex) : rawPath;
  const queryIndex = pathWithQuery.indexOf("?");
  const encodedPath = queryIndex >= 0 ? pathWithQuery.slice(0, queryIndex) : pathWithQuery;

  let decoded: string;
  try {
    decoded = decodeURIComponent(encodedPath).replace(/\\/g, "/");
  } catch {
    return null;
  }

  const normalized = normalizeManagedPath(decoded);
  if (!normalized) return null;
  const line = parseLineHash(hash);
  return { path: normalized, ...(line ? { line } : {}) };
}
