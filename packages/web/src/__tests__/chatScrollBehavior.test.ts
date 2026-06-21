import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// #133 — chat restore must land at the bottom instantly when the user was
// pinned, with NO visible top-to-bottom smooth-scroll replay.
//
// MessageStream restores scroll position imperatively (`scrollTop = …`) on
// tab-switch remount and on pinned-bottom live append. A global
// `scroll-behavior: smooth` on the scroll container turns those instant jumps
// into an animation through the history — exactly the jumpiness this guards.
//
// The repo has no jsdom/happy-dom (see vitest.config.ts), so we can't drive a
// real scroll. Instead we assert the *intent* at its two sources of truth:
//   1. the container CSS does not opt the stack into smooth scrolling, and
//   2. the component pins `scroll-behavior: auto` locally before each
//      imperative scroll write (belt-and-suspenders against an inherited rule).
const cssPath = fileURLToPath(new URL("../styles/global.css", import.meta.url));
const streamPath = fileURLToPath(
  new URL("../components/chat/MessageStream.tsx", import.meta.url),
);
const css = readFileSync(cssPath, "utf8");
const stream = readFileSync(streamPath, "utf8");

/** Extract the body of a top-level `.selector { … }` rule from a stylesheet. */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`rule not found: ${selector}`);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

describe("#133 chat scroll restore is instant, not smooth", () => {
  it(".message-stack does not declare smooth scrolling", () => {
    // Strip CSS comments first — the rule deliberately documents WHY smooth is
    // absent, and that prose mentions the property name.
    const body = ruleBody(css, ".message-stack").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(body).not.toMatch(/scroll-behavior\s*:\s*smooth/);
  });

  it("MessageStream forces scroll-behavior auto before imperative restore", () => {
    // The mount-restore effect and the pinned-bottom append effect both set
    // scrollTop; each must pin auto first so neither animates.
    const autoWrites = stream.match(/scrollBehavior\s*=\s*["']auto["']/g) ?? [];
    expect(autoWrites.length).toBeGreaterThanOrEqual(2);
  });
});
