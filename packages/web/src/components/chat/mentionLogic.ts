/**
 * Pure logic for composer `@` mentions (#316).
 *
 * Kept free of React so vitest (node env) can lock detection, filtering,
 * insertion, and placeholder matrix without a DOM.
 */

/** Active `@token` at the caret, if any. */
export type MentionQuery = {
  /** Inclusive index of the `@`. */
  start: number;
  /** Exclusive index of the end of the token (usually the caret). */
  end: number;
  /** Text after `@` (may be empty). */
  query: string;
};

export type MentionPlugin = { name: string };

export type MentionFile = {
  name: string;
  path: string;
  type: "file" | "folder" | "symlink";
};

export type SourceStatus<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; items: T[] }
  | { state: "unavailable"; reason: "no-sandbox" | "not-running" | "no-session" }
  | { state: "error"; message: string };

export type MentionItemKind = "mcp" | "file" | "status";

export type MentionItem = {
  id: string;
  kind: MentionItemKind;
  /** Primary label shown in the list. */
  label: string;
  /** Secondary label (e.g. path type, transport). Optional. */
  detail?: string;
  /** Text inserted into the draft when this item is chosen. Empty for status rows. */
  insertion: string;
  /** False for loading / empty / prerequisite rows. */
  selectable: boolean;
  /** Optional group header key for rendering sections. */
  group?: "mcp" | "files";
};

/**
 * Detect an active mention token at `caret` in `text`.
 *
 * Opens only when `@` is at start-of-string or preceded by whitespace.
 * Query runs from after `@` until whitespace (or end of string). The caret
 * must lie inside that token (`start <= caret <= end`).
 */
export function detectMention(text: string, caret: number): MentionQuery | null {
  if (caret < 0 || caret > text.length) return null;

  // Walk left from caret to find a candidate `@` that starts a token.
  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (ch === "@") {
      at = i;
      break;
    }
    // Whitespace means we left the token without finding `@`.
    if (/\s/.test(ch)) return null;
  }
  if (at < 0) return null;

  // Boundary: start of string or whitespace before `@`.
  if (at > 0 && !/\s/.test(text[at - 1]!)) return null;

  // Token end: first whitespace after `@`, or end of string.
  let end = at + 1;
  while (end < text.length && !/\s/.test(text[end]!)) {
    end += 1;
  }

  // Caret must be inside the token (including right after `@`, or at end).
  if (caret < at || caret > end) return null;

  return {
    start: at,
    end,
    query: text.slice(at + 1, end),
  };
}

/** Case-insensitive substring filter on label + detail + insertion. */
export function filterCandidates<T extends { label: string; detail?: string; insertion: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => {
    const hay = `${item.label} ${item.detail ?? ""} ${item.insertion}`.toLowerCase();
    return hay.includes(q);
  });
}

export type BuildMentionItemsInput = {
  plugins: SourceStatus<MentionPlugin>;
  files: SourceStatus<MentionFile>;
  query: string;
  /** Already-translated status strings. */
  labels: {
    loading: string;
    empty: string;
    mcpEmpty: string;
    mcpError: string;
    filesNeedSandbox: string;
    filesError: string;
  };
};

/**
 * Merge MCP + file sources into a flat list of selectable items and status rows.
 * Status rows guarantee the menu is never silently blank when open.
 */
export function buildMentionItems(input: BuildMentionItemsInput): MentionItem[] {
  const { plugins, files, query, labels } = input;
  const items: MentionItem[] = [];

  // --- MCP group ---
  const mcpSelectables = collectPluginItems(plugins, labels);
  const mcpFiltered = filterCandidates(mcpSelectables.selectables, query);
  if (mcpSelectables.status) {
    items.push(mcpSelectables.status);
  } else if (mcpFiltered.length === 0 && mcpSelectables.selectables.length > 0) {
    // Had candidates but query filtered them all out — handled globally below.
  } else {
    items.push(...mcpFiltered);
  }

  // --- Files group ---
  const fileSelectables = collectFileItems(files, labels);
  const fileFiltered = filterCandidates(fileSelectables.selectables, query);
  if (fileSelectables.status) {
    items.push(fileSelectables.status);
  } else if (fileFiltered.length === 0 && fileSelectables.selectables.length > 0) {
    // same — global empty
  } else {
    items.push(...fileFiltered);
  }

  const hasSelectable =
    items.some((i) => i.selectable) ||
    // if only status rows, that's fine
    false;

  const anySourceHadItems =
    mcpSelectables.selectables.length > 0 || fileSelectables.selectables.length > 0;
  const anySelectableShown = items.some((i) => i.selectable);

  // Query matched nothing across both groups, and at least one group had items.
  if (query.trim() && anySourceHadItems && !anySelectableShown) {
    // Drop pure status rows that are "empty catalog" style? Keep prerequisite/errors.
    // Replace filtered-out selectables with a single empty-match status.
    const nonFilterStatus = items.filter((i) => !i.selectable);
    return [
      ...nonFilterStatus.filter(
        (i) =>
          i.id === "mcp-loading" ||
          i.id === "mcp-error" ||
          i.id === "files-loading" ||
          i.id === "files-error" ||
          i.id === "files-unavailable",
      ),
      {
        id: "empty-match",
        kind: "status",
        label: labels.empty,
        insertion: "",
        selectable: false,
      },
    ];
  }

  // Both groups empty (no servers, no files, no status) — show empty.
  if (items.length === 0) {
    items.push({
      id: "empty-match",
      kind: "status",
      label: labels.empty,
      insertion: "",
      selectable: false,
    });
  }

  // Silence unused var if TS is strict about hasSelectable in some configs.
  void hasSelectable;

  return items;
}

function collectPluginItems(
  plugins: SourceStatus<MentionPlugin>,
  labels: BuildMentionItemsInput["labels"],
): { selectables: MentionItem[]; status: MentionItem | null } {
  switch (plugins.state) {
    case "idle":
    case "loading":
      return {
        selectables: [],
        status: {
          id: "mcp-loading",
          kind: "status",
          label: labels.loading,
          insertion: "",
          selectable: false,
          group: "mcp",
        },
      };
    case "error":
      return {
        selectables: [],
        status: {
          id: "mcp-error",
          kind: "status",
          label: labels.mcpError,
          detail: plugins.message,
          insertion: "",
          selectable: false,
          group: "mcp",
        },
      };
    case "unavailable":
      // Plugins are global; unavailable shouldn't normally apply. Treat as empty.
      return {
        selectables: [],
        status: {
          id: "mcp-empty",
          kind: "status",
          label: labels.mcpEmpty,
          insertion: "",
          selectable: false,
          group: "mcp",
        },
      };
    case "ready": {
      if (plugins.items.length === 0) {
        return {
          selectables: [],
          status: {
            id: "mcp-empty",
            kind: "status",
            label: labels.mcpEmpty,
            insertion: "",
            selectable: false,
            group: "mcp",
          },
        };
      }
      return {
        selectables: plugins.items.map((p) => ({
          id: `mcp:${p.name}`,
          kind: "mcp" as const,
          label: p.name,
          detail: "MCP",
          insertion: formatMcpInsertion(p.name),
          selectable: true,
          group: "mcp" as const,
        })),
        status: null,
      };
    }
  }
}

function collectFileItems(
  files: SourceStatus<MentionFile>,
  labels: BuildMentionItemsInput["labels"],
): { selectables: MentionItem[]; status: MentionItem | null } {
  switch (files.state) {
    case "idle":
    case "loading":
      return {
        selectables: [],
        status: {
          id: "files-loading",
          kind: "status",
          label: labels.loading,
          insertion: "",
          selectable: false,
          group: "files",
        },
      };
    case "error":
      return {
        selectables: [],
        status: {
          id: "files-error",
          kind: "status",
          label: labels.filesError,
          detail: files.message,
          insertion: "",
          selectable: false,
          group: "files",
        },
      };
    case "unavailable":
      return {
        selectables: [],
        status: {
          id: "files-unavailable",
          kind: "status",
          label: labels.filesNeedSandbox,
          insertion: "",
          selectable: false,
          group: "files",
        },
      };
    case "ready": {
      if (files.items.length === 0) {
        // Ready but empty workspace — not a hard error; show nothing selectable
        // and no loud status (empty match row appears only when query filters).
        return { selectables: [], status: null };
      }
      return {
        selectables: files.items.map((f) => {
          const path =
            f.type === "folder" && !f.path.endsWith("/")
              ? `${f.path}/`
              : f.path;
          return {
            id: `file:${f.path}`,
            kind: "file" as const,
            label: f.name,
            detail: path,
            insertion: formatFileInsertion(path),
            selectable: true,
            group: "files" as const,
          };
        }),
        status: null,
      };
    }
  }
}

/** Insertion text for an MCP server mention. */
export function formatMcpInsertion(name: string): string {
  return `@mcp:${name} `;
}

/** Insertion text for a workspace file path. */
export function formatFileInsertion(path: string): string {
  return `\`${path}\` `;
}

/**
 * Replace the mention token range with `insertion`.
 * Returns the new draft text and the caret position after the inserted text.
 */
export function applyMention(
  text: string,
  range: { start: number; end: number },
  insertion: string,
): { text: string; caret: number } {
  const next = text.slice(0, range.start) + insertion + text.slice(range.end);
  return {
    text: next,
    caret: range.start + insertion.length,
  };
}

/** Indices of selectable items in a built list. */
export function selectableIndices(items: MentionItem[]): number[] {
  return items.reduce<number[]>((acc, item, index) => {
    if (item.selectable) acc.push(index);
    return acc;
  }, []);
}

/**
 * Move highlight among selectable items. Returns the new absolute index into
 * `items`, or the previous index if nothing is selectable.
 */
export function moveActiveIndex(
  items: MentionItem[],
  current: number,
  direction: 1 | -1,
): number {
  const indices = selectableIndices(items);
  if (indices.length === 0) return current;
  const pos = indices.indexOf(current);
  if (pos < 0) {
    return direction === 1 ? indices[0]! : indices[indices.length - 1]!;
  }
  const next = (pos + direction + indices.length) % indices.length;
  return indices[next]!;
}

/** First selectable index, or -1 if none. */
export function firstSelectableIndex(items: MentionItem[]): number {
  const indices = selectableIndices(items);
  return indices.length > 0 ? indices[0]! : -1;
}

export type PlaceholderAvailability = {
  /** MCP source resolved successfully (ready — even if the list is empty). */
  pluginsReady: boolean;
  /** File listing is possible (sandbox running with an id). */
  filesReady: boolean;
};

/**
 * i18n key for the composer placeholder based on what `@` can actually offer.
 *
 * - both: advertise MCP + files
 * - mcp only: advertise MCP; files need sandbox
 * - neither: plain prompt — do not claim `@` works
 *
 * Note: empty MCP catalog still counts as "ready" (user can open the menu and
 * see the empty state). Only load failure / idle without success keeps pluginsReady false.
 */
export function composerPlaceholderKey(
  state: PlaceholderAvailability,
):
  | "chat.placeholder.withMcpAndFiles"
  | "chat.placeholder.withMcpOnly"
  | "chat.placeholder.withFilesOnly"
  | "chat.placeholder.plain" {
  if (state.pluginsReady && state.filesReady) return "chat.placeholder.withMcpAndFiles";
  if (state.pluginsReady) return "chat.placeholder.withMcpOnly";
  if (state.filesReady) return "chat.placeholder.withFilesOnly";
  return "chat.placeholder.plain";
}

/**
 * Whether the `@` feature is available enough that the placeholder may mention it.
 * Used when plugins are still loading: prefer not to claim until ready, unless
 * files are already available.
 */
export function placeholderAvailabilityFromSources(
  plugins: SourceStatus<unknown>,
  files: SourceStatus<unknown>,
): PlaceholderAvailability {
  const pluginsReady = plugins.state === "ready";
  const filesReady = files.state === "ready";
  return { pluginsReady, filesReady };
}
