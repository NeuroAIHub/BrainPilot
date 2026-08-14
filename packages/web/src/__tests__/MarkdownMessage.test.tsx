import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownMessage } from "../components/chat/MarkdownMessage";
import {
  normalizeMarkdownTables,
  protectCurrencyDollars,
} from "../components/chat/normalizeMarkdown";

describe("MarkdownMessage", () => {
  it("renders inline and display LaTeX with KaTeX", () => {
    const html = render("Inline: $E = mc^2$\n\n$$\n\\sum_{i=1}^{n} i\n$$");

    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('encoding="application/x-tex">E = mc^2</annotation>');
    expect(html).toContain("\\sum_{i=1}^{n} i</annotation>");
  });

  it("leaves LaTeX delimiters inside code untouched", () => {
    const html = render("`$E = mc^2$`\n\n```tex\n$E = mc^2$\n```");

    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$E = mc^2$");
  });

  it("renders a collapsed model-generated table", () => {
    const html = render(
      "| 数据集 | 被试数 | 通道数 | 类别 | 采样率 | 试次/类 | 说明 ||------------|------------|------------|------------|------------|------------| **BCI III IVa** | 5 | 118 | 右手 vs 脚（2类） | 100 Hz | 140 | 全头蒙太奇 |",
    );

    expect(html).toContain("<table>");
    expect(html).toContain("<th>数据集</th>");
    expect(html).toContain("<strong>BCI III IVa</strong>");
    expect(html).toContain("<td>全头蒙太奇</td>");
  });

  it("preserves existing GFM features", () => {
    const html = render("[link](https://example.com)\n\n~~removed~~\n\n```ts\nconst x = 1;\n```");

    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<del>removed</del>");
    expect(html).toContain("hljs-keyword");
  });

  it("marks safe file links without changing external links", () => {
    const html = render("[report](docs/report.md) [web](https://example.com)");

    expect(html).toContain('data-workspace-file="/workspace/docs/report.md"');
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain('data-workspace-file="https://example.com"');
  });

  it("renders a copyable session-aware file URL when a session is known", () => {
    const html = renderToStaticMarkup(
      <MarkdownMessage
        content="[report](docs/report.md)"
        workspaceFileSessionId="session-a"
      />,
    );

    expect(html).toContain(
      'href="/sessions/session-a/files?path=%2Fworkspace%2Fdocs%2Freport.md"',
    );
    expect(html).toContain('data-workspace-file="/workspace/docs/report.md"');
  });

  it("does not render unsafe URL schemes", () => {
    const html = render("[unsafe](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});

describe("normalizeMarkdownTables", () => {
  it("leaves valid multiline tables unchanged", () => {
    const markdown = "| A | B |\n|---|---|\n| 1 | 2 |";
    expect(normalizeMarkdownTables(markdown)).toBe(markdown);
  });

  it("recovers multiple collapsed rows", () => {
    expect(normalizeMarkdownTables("| A | B ||---|---| 1 | 2 || 3 | 4 |")).toBe(
      "| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |",
    );
  });

  it("does not split escaped pipes, inline code, or fenced code", () => {
    expect(normalizeMarkdownTables("| A | B ||---|---| left \\| right | `x|y` |")).toBe(
      "| A | B |\n| --- | --- |\n| left \\| right | `x|y` |",
    );

    const fenced = "```md\n| A | B ||---|---| 1 | 2 |\n```";
    expect(normalizeMarkdownTables(fenced)).toBe(fenced);
  });

  it("leaves ambiguous pipe-delimited prose untouched", () => {
    const prose = "Compare A | B ||---|---| without treating this as a table.";
    expect(normalizeMarkdownTables(prose)).toBe(prose);
  });
});

describe("protectCurrencyDollars", () => {
  it("protects paired prices without changing numeric math", () => {
    expect(protectCurrencyDollars("Costs $5 and $10 today; math is $5$."))
      .toBe("Costs \\$5 and \\$10 today; math is $5$.");
  });

  it("does not alter currency-like text inside code", () => {
    expect(protectCurrencyDollars("`Costs $5 and $10`"))
      .toBe("`Costs $5 and $10`");
  });

  it("handles surrogate pairs before currency markers", () => {
    expect(protectCurrencyDollars("🧠 costs $5 or $10"))
      .toBe("🧠 costs \\$5 or \\$10");
  });
});

function render(content: string): string {
  return renderToStaticMarkup(<MarkdownMessage content={content} />);
}
