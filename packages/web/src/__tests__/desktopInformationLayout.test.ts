import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cssPath = fileURLToPath(new URL("../styles/global.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`rule not found: ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

/** The cascade winner when a selector is declared more than once. */
function lastRuleBody(source: string, selector: string): string {
  const start = source.lastIndexOf(`${selector} {`);
  if (start < 0) throw new Error(`rule not found: ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

describe("conversation row title wrapping", () => {
  it("scopes the two-line title rule so it outranks the generic span nowrap", () => {
    // `.conversation-row span` (0,1,1) sets `white-space: nowrap`. A bare
    // `.conversation-row__title` (0,1,0) loses on specificity no matter how
    // late it appears, so the title must carry the row class too (0,2,0).
    expect(css).toContain(".conversation-row .conversation-row__title {");
    expect(css).not.toMatch(/(^|\n)\.conversation-row__title\s*\{/);

    const title = ruleBody(css, ".conversation-row .conversation-row__title");
    expect(title).toMatch(/white-space:\s*normal/);
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
    expect(title).toMatch(/line-clamp:\s*2/);
  });
});

describe("trace controls desktop grid", () => {
  it("gives the remaining controls two columns instead of three", () => {
    // AgentTraceViews renders a search field plus one details disclosure; the
    // third column squeezed the filters into a vertical strip.
    const controls = lastRuleBody(css, ".trace-controls");
    expect(controls).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/);
    expect(controls).toMatch(/align-items:\s*flex-start/);
    expect(controls).not.toMatch(/0\.22fr/);
  });

  it("lets an open filter disclosure span a full row while its body wraps", () => {
    const open = ruleBody(css, ".trace-filter-options[open]");
    expect(open).toMatch(/grid-column:\s*1\s*\/\s*-1/);

    const body = ruleBody(css, ".trace-filter-options .details-section__body");
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-wrap:\s*wrap/);
  });
});
