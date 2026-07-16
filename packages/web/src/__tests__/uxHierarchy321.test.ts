import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { preferredDemoWidths, DEMO_COMPACT_RIGHT, DEMO_DEFAULT_RIGHT } from "../components/demo/demoLayout";

const css = readFileSync(join(__dirname, "../styles/global.css"), "utf8");
const tokens = readFileSync(join(__dirname, "../styles/tokens.css"), "utf8");
const filesI18n = readFileSync(join(__dirname, "../i18n/messages/files.ts"), "utf8");

describe("UX hierarchy / responsive / empty guidance (#321)", () => {
  it("settings panel uses adaptive max-height instead of fixed 16:9 canvas", () => {
    const panel = css.slice(css.indexOf(".settings-modal__panel {"), css.indexOf(".settings-modal__panel {") + 500);
    expect(panel).toMatch(/max-height:/);
    expect(panel).not.toMatch(/aspect-ratio:\s*16\s*\/\s*9/);
  });

  it("settings content has a scroll affordance (overflow + edge fade)", () => {
    expect(css).toMatch(/\.settings-content\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.settings-content\s*\{[^}]*mask-image:/s);
  });

  it("prompt heading uses balanced wrapping for narrow viewports", () => {
    expect(css).toMatch(/\.prompt-home h1\s*\{[^}]*text-wrap:\s*balance/s);
  });

  it("files not-running state has next-step copy", () => {
    expect(filesI18n).toContain("files.error.notRunningHint");
    expect(filesI18n).toContain("files.error.notRunningCta");
  });

  it("secondary text tokens remain defined for light and dark", () => {
    expect(tokens).toMatch(/--color-text-muted:/);
    expect(tokens).toMatch(/--color-text-subtle:/);
  });

  it("demo layout prefers compact right when empty", () => {
    expect(preferredDemoWidths({ hasTraceNodes: false, hasFiles: false }).right).toBe(
      DEMO_COMPACT_RIGHT,
    );
    expect(preferredDemoWidths({ hasTraceNodes: true, hasFiles: false }).right).toBe(
      DEMO_DEFAULT_RIGHT,
    );
  });
});
