import { describe, it, expect } from "vitest";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MentionPicker } from "../components/chat/MentionPicker";
import type { MentionItem } from "../components/chat/mentionLogic";

// No jsdom — assert presentational markup via renderToStaticMarkup (#316).

const groupLabels = { mcp: "MCP", files: "Files" };
const anchorRef = createRef<HTMLElement>();

function render(items: MentionItem[], activeIndex = 0) {
  return renderToStaticMarkup(
    <MentionPicker
      items={items}
      activeIndex={activeIndex}
      listboxId="mention-list"
      ariaLabel="Mention candidates"
      anchorRef={anchorRef}
      groupLabels={groupLabels}
      onHover={() => {}}
      onPick={() => {}}
    />,
  );
}

describe("MentionPicker — #316 markup", () => {
  it("renders a listbox with selectable options and group headers", () => {
    const items: MentionItem[] = [
      {
        id: "mcp:fs",
        kind: "mcp",
        label: "filesystem",
        detail: "MCP",
        insertion: "@mcp:filesystem ",
        selectable: true,
        group: "mcp",
      },
      {
        id: "file:/workspace/a.py",
        kind: "file",
        label: "a.py",
        detail: "/workspace/a.py",
        insertion: "`/workspace/a.py` ",
        selectable: true,
        group: "files",
      },
    ];
    const html = render(items, 0);
    expect(html).toContain('role="listbox"');
    expect(html).toContain("mention-picker");
    expect(html).toContain("MCP");
    expect(html).toContain("Files");
    expect(html).toContain("filesystem");
    expect(html).toContain("a.py");
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('role="option"');
  });

  it("renders status rows for empty / prerequisite states", () => {
    const items: MentionItem[] = [
      {
        id: "mcp-empty",
        kind: "status",
        label: "No MCP servers configured",
        insertion: "",
        selectable: false,
        group: "mcp",
      },
      {
        id: "files-unavailable",
        kind: "status",
        label: "Start the Sandbox to mention files",
        insertion: "",
        selectable: false,
        group: "files",
      },
    ];
    const html = render(items, -1);
    expect(html).toContain("mention-picker__status");
    expect(html).toContain("No MCP servers configured");
    expect(html).toContain("Start the Sandbox to mention files");
    expect(html).toContain('aria-disabled="true"');
  });

  it("marks the active option", () => {
    const items: MentionItem[] = [
      {
        id: "mcp:a",
        kind: "mcp",
        label: "a",
        insertion: "@mcp:a ",
        selectable: true,
        group: "mcp",
      },
      {
        id: "mcp:b",
        kind: "mcp",
        label: "b",
        insertion: "@mcp:b ",
        selectable: true,
        group: "mcp",
      },
    ];
    const html = render(items, 1);
    expect(html).toContain("is-active");
    // Second option selected
    expect(html).toMatch(/aria-selected="true"[\s\S]*\bb\b|is-active[\s\S]*\bb\b/);
  });
});
