import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PreferencesProvider } from "../contexts/PreferencesContext";
import { McpByokCard } from "../components/settings/McpByokCard";

// #377 — no jsdom in this package; assert presentational markup via
// renderToStaticMarkup (same convention as mentionPicker.test.tsx). The card needs
// PreferencesProvider for the i18n locale, which reads localStorage on mount — so
// stub the minimum the provider touches, as api.test.ts does.

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(configured: boolean, kind = "tavily") {
  return renderToStaticMarkup(
    <PreferencesProvider>
      <McpByokCard configured={configured} kind={kind} onChanged={() => {}} />
    </PreferencesProvider>,
  );
}

describe("McpByokCard — markup", () => {
  it("renders a masked credential input, never a text one", () => {
    const html = render(false);
    expect(html).toContain('type="password"');
    expect(html).not.toContain('type="text"');
  });

  it("disables submit until a key is typed (empty initial state)", () => {
    expect(render(false)).toContain("disabled");
  });

  it("offers no Remove action when the user has no key on file", () => {
    const html = render(false);
    expect(html).not.toContain("移除我的 Key");
  });

  it("shows the configured badge and a Remove action once a key is on file", () => {
    const html = render(true);
    expect(html).toContain("已配置");
    expect(html).toContain("移除我的 Key");
  });

  it("scopes the input id by kind so multiple presets can coexist", () => {
    expect(render(false)).toContain('id="mcp-byok-tavily"');
  });

  it("labels the input (htmlFor/id pair) for a11y", () => {
    const html = render(false);
    expect(html).toContain('for="mcp-byok-tavily"');
  });

  // `kind` is hosted-supplied and guarantees nothing about DOM safety. An id
  // containing whitespace is invalid HTML and silently breaks label-click
  // focusing, so it's sanitized — while the API path keeps `kind` verbatim
  // (see api.test.ts, which asserts the percent-encoded PUT/DELETE path).
  it("sanitizes an unsafe kind into a valid id, keeping label and input in sync", () => {
    const html = render(false, "weird kind/x");
    expect(html).toContain('id="mcp-byok-weird_kind_x"');
    expect(html).toContain('for="mcp-byok-weird_kind_x"');
    // No whitespace or slash leaked into either attribute.
    expect(html).not.toMatch(/(id|for)="[^"]*[\s/][^"]*"/);
  });
});
