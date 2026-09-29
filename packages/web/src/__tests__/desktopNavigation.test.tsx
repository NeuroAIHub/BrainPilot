import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourcesUnavailablePage } from "../components/shell/DesktopShell";
import {
  pluginMarketplaceSurface,
  showsResourcesNavItem,
} from "../components/plugins/pluginMarketplaceAvailability";
import marketplaceMessages from "../i18n/messages/marketplace";

// No jsdom in this monorepo (see vitest.config.ts): components are rendered to
// static markup, and the wiring that needs the real DesktopShell tree is
// asserted against its source instead of being mounted.
//
// The aggregate Resources surface used to be gated on `runtimeConfig.localMode`,
// which conflated "not a local build" with "cannot serve the catalogue": hosted
// deployments that *do* have the capability lost the nav entry, while a local
// build with the capability off still routed ?page=plugins to a page promising a
// future launch. The capability flag is the single authority now.

const DESKTOP_SHELL_SOURCE = readFileSync(
  new URL("../components/shell/DesktopShell.tsx", import.meta.url),
  "utf8",
);
const SIDEBAR_SOURCE = readFileSync(
  new URL("../components/sidebar/Sidebar.tsx", import.meta.url),
  "utf8",
);

describe("Resources nav visibility follows the capability", () => {
  it("hides the nav entry only where the capability is off", () => {
    expect(showsResourcesNavItem(false)).toBe(false);
    expect(showsResourcesNavItem(true)).toBe(true);
  });

  it("keeps a capable hosted deployment on the real catalogue route", () => {
    // Same capability, both deployment shapes: `localMode` is not consulted.
    expect(pluginMarketplaceSurface(true)).toBe("marketplace");
  });

  it("serves the unavailable surface for a direct URL to a disabled page", () => {
    // The route stays addressable so bookmarked/copied links resolve to truthful
    // copy instead of a blank or missing page.
    expect(pluginMarketplaceSurface(false)).toBe("unavailable");
  });

  it("derives both call sites from the capability flag, not localMode", () => {
    expect(SIDEBAR_SOURCE).toContain("showsResourcesNavItem(runtimeConfig.pluginsSettingsEnabled)");
    expect(DESKTOP_SHELL_SOURCE).toContain(
      "pluginMarketplaceSurface(runtimeConfig.pluginsSettingsEnabled)",
    );
  });
});

describe("ResourcesUnavailablePage", () => {
  function render(onReturn = vi.fn()) {
    return renderToStaticMarkup(
      <ResourcesUnavailablePage onReturnToWorkspace={onReturn} t={(k: string) => k} />,
    );
  }

  it("states the deployment fact and offers a return control", () => {
    const html = render();
    expect(html).toContain("marketplace.unavailable.title");
    expect(html).toContain("marketplace.unavailable.description");
    expect(html).toContain("marketplace.unavailable.returnToWorkspace");
    expect(html).toContain('data-testid="resources-unavailable-return"');
  });

  it("wires the return button to the workspace page", () => {
    // renderToStaticMarkup drops handlers, so the callback is checked by
    // invoking what the shell passes: setActivePage("workspace").
    expect(DESKTOP_SHELL_SOURCE).toContain(
      'onReturnToWorkspace={() => setActivePage("workspace")}',
    );
  });

  it("promises no future launch in either locale", () => {
    const zh = marketplaceMessages["zh-CN"];
    const en = marketplaceMessages["en-US"];
    const copy = [
      zh["marketplace.unavailable.title"],
      zh["marketplace.unavailable.description"],
      en["marketplace.unavailable.title"],
      en["marketplace.unavailable.description"],
    ];
    for (const text of copy) {
      expect(text).toBeTruthy();
      expect(text.toLowerCase()).not.toContain("coming soon");
      expect(text.toLowerCase()).not.toContain("soon");
      expect(text).not.toContain("敬请期待");
      expect(text).not.toContain("即将");
    }
    // ...and it says what is actually true of this deployment.
    expect(en["marketplace.unavailable.description"]).toContain("switched off");
  });
});

describe("workspace toolbar and view tabs", () => {
  it("keeps the raw short session id out of the toolbar but in its tooltip", () => {
    expect(DESKTOP_SHELL_SOURCE).not.toContain('className="session-title__id"');
    expect(DESKTOP_SHELL_SOURCE).toContain("title={currentSession?.id ?? undefined}");
  });

  it("labels the aggregate entry Resources, not Plugins, in both locales", () => {
    const zh = marketplaceMessages["zh-CN"];
    const en = marketplaceMessages["en-US"];
    expect(zh["marketplace.title"]).toBe("资源");
    expect(en["marketplace.title"]).toBe("Resources");
    expect(zh["marketplace.summary.available"]).toBe("可用资源");
    expect(en["marketplace.summary.available"]).toBe("Available resources");
  });
});
