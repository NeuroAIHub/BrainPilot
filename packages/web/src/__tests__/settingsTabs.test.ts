import { describe, expect, it } from "vitest";
import { getSettingsTabs, resolveInitialTab } from "../components/settings/SettingsDialog";

const ids = (
  localMode: boolean,
  knowledgeBaseSettingsEnabled: boolean,
  pluginsSettingsEnabled?: boolean,
) =>
  getSettingsTabs({ localMode, knowledgeBaseSettingsEnabled, pluginsSettingsEnabled }).map(
    (tab) => tab.id,
  );

describe("Settings tabs — deployment capabilities", () => {
  it("shows downloaded plugin management by default", () => {
    // Omitted flag = enabled, so hosts that predate VITE_PLUGINS_SETTINGS_ENABLED
    // keep the tab they serve today.
    expect(ids(true, false)).toContain("plugins");
    expect(ids(false, true)).toContain("plugins");
    expect(ids(true, true, true)).toContain("plugins");
  });

  it("hides downloaded plugin management when the build flag is disabled", () => {
    // A runtime-only backend (BrainPilot Cloud) serves no /api/plugins/*.
    expect(ids(true, true, false)).not.toContain("plugins");
    expect(ids(false, false, false)).not.toContain("plugins");
  });

  it("shows knowledge-base management by default", () => {
    expect(ids(true, true)).toContain("knowledgeBase");
  });

  it("hides knowledge-base management when the build flag is disabled", () => {
    expect(ids(false, false)).not.toContain("knowledgeBase");
  });

  it("keeps account and knowledge-base visibility independent", () => {
    expect(ids(true, false)).not.toContain("account");
    expect(ids(true, false)).not.toContain("knowledgeBase");
    expect(ids(false, true)).toContain("account");
    expect(ids(false, true)).toContain("knowledgeBase");
  });

  it("keeps the plugin capability independent of localMode and the knowledge base", () => {
    // A self-hosted non-local server can still serve the plugin API, and
    // disabling plugins must not disturb the other sections.
    expect(ids(false, true, true)).toContain("plugins");
    expect(ids(true, true, false)).toContain("knowledgeBase");
    expect(ids(false, true, false)).toContain("account");
    expect(ids(false, true, false)).toContain("knowledgeBase");
    expect(ids(true, false, false)).toEqual(["providers", "mcp", "preferences"]);
  });
});

describe("Settings deep-link fallback", () => {
  const available = [{ id: "providers" as const }, { id: "mcp" as const }];

  it("honours a requested tab that this deployment shows", () => {
    expect(resolveInitialTab("mcp", available)).toBe("mcp");
  });

  it("falls back to the first visible tab when the request is hidden", () => {
    // e.g. deep-linking to "plugins" on a deployment that hides it must not
    // activate a tab missing from the nav.
    expect(resolveInitialTab("plugins", available)).toBe("providers");
    expect(resolveInitialTab("knowledgeBase", available)).toBe("providers");
  });

  it("falls back when nothing was requested", () => {
    expect(resolveInitialTab(undefined, available)).toBe("providers");
  });

  it("degrades to preferences when no tab is available at all", () => {
    expect(resolveInitialTab("providers", [])).toBe("preferences");
  });
});
