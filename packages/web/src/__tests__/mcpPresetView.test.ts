import { describe, it, expect } from "vitest";
import { resolveMcpEntryView } from "../components/settings/mcpPresetView";
import { translate } from "../i18n/translate";
import type { McpByokStatus, McpServerEntry } from "../contracts/backend";

// #377 — Settings → MCP must treat hosted presets differently from a user's own
// entries: read-only (no Edit / Delete, no raw URL) and optionally BYOK-capable.
// No jsdom in this package, so the decision lives in a pure helper we test here.

const preset: McpServerEntry = {
  name: "tavily",
  type: "http",
  url: "https://mcp.tavily.com/mcp/?tavilyApiKey=PLATFORM_SHARED_KEY",
  readOnly: true,
  byok: { kind: "tavily", keyParam: "tavilyApiKey" },
};

const own: McpServerEntry = { name: "my-api", type: "http", url: "https://host/mcp?token=mine" };

const hosted: McpByokStatus[] = [{ kind: "tavily", presetName: "tavily", configured: false }];

describe("resolveMcpEntryView — read-only presets", () => {
  it("marks a readOnly entry as managed", () => {
    expect(resolveMcpEntryView(preset, hosted).managed).toBe(true);
  });

  it("leaves a user's own entry editable", () => {
    const view = resolveMcpEntryView(own, hosted);
    expect(view.managed).toBe(false);
    expect(view.byok).toBeNull();
  });

  it("never leaks a managed preset's query string — host only", () => {
    const view = resolveMcpEntryView(preset, hosted);
    expect(view.subtitle).toBe("mcp.tavily.com");
    expect(view.subtitle).not.toContain("PLATFORM_SHARED_KEY");
    expect(view.subtitle).not.toContain("?");
  });

  it("still shows a user's own URL in full — it's their own secret", () => {
    expect(resolveMcpEntryView(own, hosted).subtitle).toBe("https://host/mcp?token=mine");
  });

  it("returns null (→ localized stand-in) for a managed entry with an unparseable URL", () => {
    const broken: McpServerEntry = { ...preset, url: "not a url" };
    expect(resolveMcpEntryView(broken, hosted).subtitle).toBeNull();
  });

  it("renders a stdio entry's command line unchanged", () => {
    const stdio: McpServerEntry = { name: "fs", type: "stdio", command: "npx", args: ["-y", "server-fs"] };
    expect(resolveMcpEntryView(stdio, hosted).subtitle).toBe("npx -y server-fs");
  });

  it("tolerates an http entry with no url at all", () => {
    expect(resolveMcpEntryView({ name: "x", type: "http" }, hosted).subtitle).toBe("");
  });
});

describe("resolveMcpEntryView — BYOK card gating", () => {
  it("offers a card when the deployment advertises the entry's kind", () => {
    expect(resolveMcpEntryView(preset, hosted).byok).toEqual({
      kind: "tavily",
      presetName: "tavily",
      configured: false,
    });
  });

  it("passes `configured` through so the card can show the badge", () => {
    const configured = [{ kind: "tavily", presetName: "tavily", configured: true }];
    expect(resolveMcpEntryView(preset, configured).byok?.configured).toBe(true);
  });

  // The self-hosted contract: no endpoint → no card, and the preset still renders.
  it("offers no card when the deployment has no BYOK endpoint (null)", () => {
    const view = resolveMcpEntryView(preset, null);
    expect(view.byok).toBeNull();
    expect(view.managed).toBe(true);
  });

  it("offers no card when the deployment advertises no matching kind", () => {
    expect(resolveMcpEntryView(preset, []).byok).toBeNull();
    expect(resolveMcpEntryView(preset, [{ kind: "exa", presetName: "exa", configured: true }]).byok).toBeNull();
  });

  it("offers no card for an entry with no byok annotation, even on a hosted backend", () => {
    const readOnlyNoByok: McpServerEntry = { name: "internal", type: "http", url: "https://h/mcp", readOnly: true };
    const view = resolveMcpEntryView(readOnlyNoByok, hosted);
    expect(view.byok).toBeNull();
    expect(view.managed).toBe(true); // readOnly is independent of byok
  });
});

// `translate` falls back to the raw key when a locale is missing an entry, so an
// untranslated string is invisible in the UI but caught here.
describe("#377 BYOK strings exist in both locales", () => {
  const keys = [
    "settings.mcp.presetChip",
    "settings.mcp.presetManaged",
    "settings.mcp.presetHiddenUrl",
    "settings.mcp.removeFailed",
    "settings.mcp.byok.title",
    "settings.mcp.byok.desc",
    "settings.mcp.byok.descConfigured",
    "settings.mcp.byok.configured",
    "settings.mcp.byok.keyLabel",
    "settings.mcp.byok.placeholder",
    "settings.mcp.byok.placeholderReplace",
    "settings.mcp.byok.save",
    "settings.mcp.byok.replace",
    "settings.mcp.byok.clear",
    "settings.mcp.byok.saved",
    "settings.mcp.byok.cleared",
    "settings.mcp.byok.saveFailed",
    "settings.mcp.byok.clearFailed",
  ];

  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`resolves every key in ${locale}`, () => {
      for (const key of keys) {
        expect(translate(locale, key), key).not.toBe(key);
      }
    });
  }
});
