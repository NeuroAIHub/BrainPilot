import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// No jsdom/@testing-library in the monorepo (see vitest.config.ts), so we render
// the Sidebar to static markup and assert on the output. This guards #250: in
// hosted multi-user deployments the web app is mounted under a subpath (/app)
// while the marketing/home page lives at the site root, so the sidebar must
// expose a "return home" entry pointing at runtimeConfig.homeUrl. In single-user
// local mode (localMode=true) the web app IS the whole surface, so no such entry
// is shown.
//
// SessionContext.useSessions throws outside a provider, and SessionList/useT pull
// in unrelated trees, so we stub them. runtimeConfig is mocked with a mutable
// object we flip per test (Sidebar reads the properties fresh on each render).
vi.mock("../i18n/useT", () => ({
  useT: () => (k: string) => k,
}));
vi.mock("../components/sidebar/SessionList", () => ({
  SessionList: () => null,
}));
vi.mock("../contexts/SessionContext", () => ({
  useSessions: () => ({
    sessions: [],
    currentSession: undefined,
    isLoading: false,
    startDraftSession: vi.fn(),
    selectSession: vi.fn(),
    updateSessionTitle: vi.fn(),
    deleteSession: vi.fn(),
  }),
}));
vi.mock("../config", () => ({
  runtimeConfig: {
    useMockBackend: false,
    localMode: true,
    knowledgeBaseSettingsEnabled: true,
    homeUrl: "/",
  },
}));

import { Sidebar } from "../components/sidebar/Sidebar";
import { runtimeConfig } from "../config";

const noop = () => {};

function render() {
  return renderToStaticMarkup(
    <Sidebar
      isCollapsed={false}
      activePage="workspace"
      onOpenDemo={noop}
      onGoWorkspace={noop}
      onOpenPlugins={noop}
      onOpenSettings={noop}
      onOpenSearch={noop}
      onResizeStart={noop}
      onToggle={noop}
    />,
  );
}

describe("Sidebar — #250 return-home entry", () => {
  it("renders the marketplace entry directly below Live Demo", () => {
    const html = render();
    expect(html.indexOf("sidebar.demo")).toBeLessThan(html.indexOf("sidebar.plugins"));
  });

  it("renders a home link to runtimeConfig.homeUrl in hosted mode", () => {
    runtimeConfig.localMode = false;
    runtimeConfig.homeUrl = "https://brainpilot.example/";

    const html = render();

    expect(html).toContain('href="https://brainpilot.example/"');
    expect(html).toContain("sidebar.home");
  });

  it("renders no home link in single-user local mode", () => {
    runtimeConfig.localMode = true;
    runtimeConfig.homeUrl = "https://brainpilot.example/";

    const html = render();

    expect(html).not.toContain('href="https://brainpilot.example/"');
    expect(html).not.toContain("sidebar.home");
  });
});
