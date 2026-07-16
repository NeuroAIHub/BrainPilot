import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// #318 — Settings must leave the fixed 190px side nav on narrow viewports so
// the content pane is not crushed (~134px at 390×844). There is no screenshot
// harness (node vitest, no Playwright UI suite), so we contract-test the
// fenced mobile CSS block in global.css.

const cssPath = fileURLToPath(new URL("../styles/global.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

const START = "/* #318 settings-mobile-start";
const END = "/* #318 settings-mobile-end */";

function mobileBlock(): string {
  const start = css.indexOf(START);
  const end = css.indexOf(END);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("missing #318 settings-mobile fence in global.css");
  }
  return css.slice(start, end);
}

describe("#318 Settings mobile layout CSS contract", () => {
  it("fences a max-width 860px media query for Settings", () => {
    const block = mobileBlock();
    expect(block).toMatch(/@media\s*\(\s*max-width:\s*860px\s*\)/);
  });

  it("stacks the body and drops the fixed side-nav column", () => {
    const block = mobileBlock();
    expect(block).toContain(".settings-modal__body");
    // Single full-width column (not 190px + content).
    expect(block).toMatch(
      /\.settings-modal__body\s*\{[^}]*grid-template-columns:\s*1fr/s,
    );
  });

  it("drops the desktop 16/9 aspect-ratio on the panel", () => {
    const block = mobileBlock();
    expect(block).toContain(".settings-modal__panel");
    expect(block).toMatch(/aspect-ratio:\s*auto/);
  });

  it("turns section tabs into a horizontal scroll strip", () => {
    const block = mobileBlock();
    expect(block).toContain(".settings-tabs");
    expect(block).toMatch(/\.settings-tabs\s*\{[^}]*display:\s*flex/s);
    expect(block).toMatch(/overflow-x:\s*auto/);
  });

  it("reflows provider/MCP action grids so fixed 82px columns do not clip", () => {
    const block = mobileBlock();
    expect(block).toContain(".provider-actions");
    expect(block).toContain(".mcp-actions");
    expect(block).toMatch(/repeat\(\s*auto-fill/);
  });

  it("stacks split preference fields and list items", () => {
    const block = mobileBlock();
    expect(block).toContain(".settings-field--split");
    expect(block).toContain(".settings-list-item");
    expect(block).toMatch(
      /\.settings-list-item\s*\{[^}]*grid-template-columns:\s*1fr/s,
    );
  });
});
