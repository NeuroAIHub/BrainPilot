export type WorkspaceFileTarget = {
  path: string;
  line?: number;
};

const EXTERNAL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const MANAGED_ROOTS = ["/workspace", "/data"] as const;

/**
 * Resolve a Markdown href into a Files-panel target. Relative links are rooted
 * in the active session workspace; explicit managed paths may address either
 * the session workspace or persistent library. Web URLs and unsafe paths are
 * deliberately left to the browser/markdown renderer.
 */
export function parseWorkspaceFileHref(href: string): WorkspaceFileTarget | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//")) return null;

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

  const rooted = decoded.startsWith("/") ? decoded : `/workspace/${decoded}`;
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
  if (!MANAGED_ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`))) {
    return null;
  }
  if (normalized === "/workspace" || normalized === "/data") return null;

  const lineMatch = /^(?:L|line-?)(\d+)$/i.exec(hash);
  const line = lineMatch ? Number(lineMatch[1]) : undefined;
  return { path: normalized, ...(line && line > 0 ? { line } : {}) };
}
