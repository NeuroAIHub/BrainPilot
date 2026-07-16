import { describe, it, expect } from "vitest";
import {
  detectMention,
  filterCandidates,
  buildMentionItems,
  applyMention,
  formatMcpInsertion,
  formatFileInsertion,
  moveActiveIndex,
  firstSelectableIndex,
  composerPlaceholderKey,
  placeholderAvailabilityFromSources,
  type MentionItem,
  type SourceStatus,
  type MentionPlugin,
  type MentionFile,
} from "../components/chat/mentionLogic";

const LABELS = {
  loading: "Loading…",
  empty: "No matches",
  mcpEmpty: "No MCP servers",
  mcpError: "Failed to load MCP",
  filesNeedSandbox: "Start sandbox for files",
  filesError: "Failed to load files",
};

describe("detectMention", () => {
  it("detects bare @ at start with empty query", () => {
    expect(detectMention("@", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("detects @query at start", () => {
    expect(detectMention("@foo", 4)).toEqual({ start: 0, end: 4, query: "foo" });
  });

  it("detects mid-query caret", () => {
    expect(detectMention("@foobar", 4)).toEqual({ start: 0, end: 7, query: "foobar" });
  });

  it("detects after whitespace", () => {
    expect(detectMention("see @bar", 8)).toEqual({ start: 4, end: 8, query: "bar" });
  });

  it("detects after newline", () => {
    expect(detectMention("a\n@x", 4)).toEqual({ start: 2, end: 4, query: "x" });
  });

  it("does not open for mid-word @ (email)", () => {
    expect(detectMention("a@b.com", 3)).toBeNull();
    expect(detectMention("a@b.com", 7)).toBeNull();
  });

  it("returns null when caret is outside the token", () => {
    // caret after trailing space leaves the token
    expect(detectMention("@foo ", 5)).toBeNull();
  });

  it("returns null with no @", () => {
    expect(detectMention("hello", 3)).toBeNull();
  });
});

describe("filterCandidates", () => {
  const items = [
    { label: "filesystem", detail: "MCP", insertion: "@mcp:filesystem " },
    { label: "readme.md", detail: "/workspace/readme.md", insertion: "`/workspace/readme.md` " },
  ];

  it("returns all when query empty", () => {
    expect(filterCandidates(items, "")).toHaveLength(2);
  });

  it("filters case-insensitively", () => {
    expect(filterCandidates(items, "FILE").map((i) => i.label)).toEqual(["filesystem"]);
  });

  it("matches detail paths", () => {
    expect(filterCandidates(items, "workspace").map((i) => i.label)).toEqual(["readme.md"]);
  });
});

describe("applyMention", () => {
  it("replaces the token and places caret after insertion", () => {
    const { text, caret } = applyMention("see @fo", { start: 4, end: 7 }, "@mcp:foo ");
    expect(text).toBe("see @mcp:foo ");
    expect(caret).toBe("see @mcp:foo ".length);
  });

  it("preserves text after the token", () => {
    // end is exclusive at token end before space
    const { text } = applyMention("x @a y", { start: 2, end: 4 }, "`/workspace/a` ");
    expect(text).toBe("x `/workspace/a`  y");
  });
});

describe("format insertions", () => {
  it("formats MCP as @mcp:name with trailing space", () => {
    expect(formatMcpInsertion("fs")).toBe("@mcp:fs ");
  });

  it("formats file path with backticks", () => {
    expect(formatFileInsertion("/workspace/a.py")).toBe("`/workspace/a.py` ");
  });
});

describe("buildMentionItems", () => {
  const pluginsReady: SourceStatus<MentionPlugin> = {
    state: "ready",
    items: [{ name: "filesystem" }, { name: "search" }],
  };
  const filesReady: SourceStatus<MentionFile> = {
    state: "ready",
    items: [
      { name: "a.py", path: "/workspace/a.py", type: "file" },
      { name: "src", path: "/workspace/src", type: "folder" },
    ],
  };

  it("merges selectable MCP and file items", () => {
    const items = buildMentionItems({
      plugins: pluginsReady,
      files: filesReady,
      query: "",
      labels: LABELS,
    });
    expect(items.filter((i) => i.selectable)).toHaveLength(4);
    expect(items.find((i) => i.id === "mcp:filesystem")?.insertion).toBe("@mcp:filesystem ");
    expect(items.find((i) => i.id === "file:/workspace/src")?.insertion).toBe("`/workspace/src/` ");
  });

  it("shows MCP empty status while still listing files", () => {
    const items = buildMentionItems({
      plugins: { state: "ready", items: [] },
      files: filesReady,
      query: "",
      labels: LABELS,
    });
    expect(items.some((i) => i.id === "mcp-empty")).toBe(true);
    expect(items.filter((i) => i.kind === "file")).toHaveLength(2);
  });

  it("shows files-need-sandbox while listing MCP", () => {
    const items = buildMentionItems({
      plugins: pluginsReady,
      files: { state: "unavailable", reason: "not-running" },
      query: "",
      labels: LABELS,
    });
    expect(items.some((i) => i.id === "files-unavailable")).toBe(true);
    expect(items.filter((i) => i.kind === "mcp")).toHaveLength(2);
  });

  it("shows explicit empty state when query matches nothing", () => {
    const items = buildMentionItems({
      plugins: pluginsReady,
      files: filesReady,
      query: "zzz",
      labels: LABELS,
    });
    expect(items.some((i) => i.id === "empty-match")).toBe(true);
    expect(items.every((i) => !i.selectable || i.id === "empty-match")).toBe(true);
  });

  it("filters by subsequent characters", () => {
    const items = buildMentionItems({
      plugins: pluginsReady,
      files: filesReady,
      query: "sear",
      labels: LABELS,
    });
    expect(items.filter((i) => i.selectable).map((i) => i.label)).toEqual(["search"]);
  });

  it("shows loading status for plugins", () => {
    const items = buildMentionItems({
      plugins: { state: "loading" },
      files: { state: "unavailable", reason: "no-sandbox" },
      query: "",
      labels: LABELS,
    });
    expect(items.some((i) => i.id === "mcp-loading")).toBe(true);
    expect(items.some((i) => i.id === "files-unavailable")).toBe(true);
  });
});

describe("keyboard index helpers", () => {
  const items: MentionItem[] = [
    { id: "s", kind: "status", label: "x", insertion: "", selectable: false },
    { id: "a", kind: "mcp", label: "a", insertion: "@mcp:a ", selectable: true },
    { id: "b", kind: "mcp", label: "b", insertion: "@mcp:b ", selectable: true },
  ];

  it("finds first selectable", () => {
    expect(firstSelectableIndex(items)).toBe(1);
  });

  it("moves down and wraps", () => {
    expect(moveActiveIndex(items, 1, 1)).toBe(2);
    expect(moveActiveIndex(items, 2, 1)).toBe(1);
  });

  it("moves up and wraps", () => {
    expect(moveActiveIndex(items, 1, -1)).toBe(2);
  });
});

describe("composerPlaceholderKey", () => {
  it("advertises both when MCP and files are ready", () => {
    expect(composerPlaceholderKey({ pluginsReady: true, filesReady: true })).toBe(
      "chat.placeholder.withMcpAndFiles",
    );
  });

  it("advertises MCP only when files are gated", () => {
    expect(composerPlaceholderKey({ pluginsReady: true, filesReady: false })).toBe(
      "chat.placeholder.withMcpOnly",
    );
  });

  it("uses plain when nothing is ready", () => {
    expect(composerPlaceholderKey({ pluginsReady: false, filesReady: false })).toBe(
      "chat.placeholder.plain",
    );
  });

  it("advertises files-only when only files are ready", () => {
    expect(composerPlaceholderKey({ pluginsReady: false, filesReady: true })).toBe(
      "chat.placeholder.withFilesOnly",
    );
  });
});

describe("placeholderAvailabilityFromSources", () => {
  it("maps ready states", () => {
    expect(
      placeholderAvailabilityFromSources({ state: "ready", items: [] }, { state: "ready", items: [] }),
    ).toEqual({ pluginsReady: true, filesReady: true });
  });

  it("treats unavailable files as not ready", () => {
    expect(
      placeholderAvailabilityFromSources(
        { state: "ready", items: [{ name: "x" }] },
        { state: "unavailable", reason: "not-running" },
      ),
    ).toEqual({ pluginsReady: true, filesReady: false });
  });
});
