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

describe("file preview optional restore notice layout", () => {
  it("uses a column layout whose preview body consumes the remaining height", () => {
    const panel = ruleBody(css, ".file-preview-panel");
    const body = ruleBody(css, ".file-preview__body");

    // The restore notice is an optional fourth child between the header and
    // metadata. A fixed three-row grid lets the body fall into an implicit row
    // and overlap the metadata until another interaction forces a reflow.
    expect(panel).toMatch(/display:\s*flex/);
    expect(panel).toMatch(/flex-direction:\s*column/);
    expect(panel).not.toMatch(/grid-template-rows/);
    expect(body).toMatch(/flex:\s*1\s+1\s+auto/);
    expect(body).toMatch(/min-height:\s*0/);
  });
});
