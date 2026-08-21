import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cssPath = fileURLToPath(new URL("../styles/global.css", import.meta.url));
const css = readFileSync(cssPath, "utf8");

const START = "/* #487 demo-mobile-start";
const END = "/* #487 demo-mobile-end */";

function mobileBlock(): string {
  const start = css.indexOf(START);
  const end = css.indexOf(END);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("missing #487 demo-mobile fence in global.css");
  }
  return css.slice(start, end);
}

describe("#487 Live Demo mobile layout CSS contract", () => {
  it("targets the 390px-class viewport", () => {
    expect(mobileBlock()).toMatch(/@media\s*\(\s*max-width:\s*600px\s*\)/);
  });

  it("fits the landing page inside the shell content column", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.demo-landing\s*\{[^}]*width:\s*100%/s);
    expect(block).toMatch(/\.demo-landing\s*\{[^}]*max-width:\s*100%/s);
    expect(block).toMatch(/\.demo-landing\s*\{[^}]*overflow-x:\s*hidden/s);
    expect(block).toMatch(/padding:\s*24px 16px 32px/);
  });

  it("removes the desktop card minimum and keeps rows shrinkable", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.demo-landing__cards\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    expect(block).toMatch(/\.demo-card\s*\{[^}]*min-width:\s*0/s);
    expect(block).toContain(".demo-session-row span");
    expect(block).toContain(".demo-dropzone");
  });

  it("stacks player header controls within the viewport", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.demo-header\s*\{[^}]*flex-direction:\s*column/s);
    expect(block).toMatch(/\.demo-header__actions\s*\{[^}]*flex-wrap:\s*wrap/s);
  });
});
