import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { McpServerEntry, ProviderProfile } from "../contracts/backend";
import type { SettingsResource } from "../components/settings/settingsResources";

// No jsdom in this package, so the dialog is rendered with react-dom/server
// (same convention as mcpByokCard.test.tsx). Effects don't run under SSR, which
// is exactly what we want here: the resource hook is stubbed so each load state
// can be asserted directly. Keys are echoed verbatim by the i18n stub.
vi.mock("../i18n/useT", () => ({ useT: () => (k: string) => k }));
vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", username: "u1", createdAt: "1970-01-01" }, isAuthReady: true }),
}));
vi.mock("../contexts/PreferencesContext", () => ({
  usePreferences: () => ({
    theme: "system",
    language: "zh-CN",
    security: { confirmDangerousActions: true },
    notifications: { agentDone: true },
    setTheme: () => {},
    setLanguage: () => {},
    setSecurity: () => {},
    setNotifications: () => {},
  }),
}));
vi.mock("../components/settings/KnowledgeBasePanel", () => ({ KnowledgeBasePanel: () => null }));
vi.mock("../components/settings/BuiltinToolsSection", () => ({ BuiltinToolsSection: () => null }));
// Pin the deployment capabilities the nav derives from (tabs are computed at
// module load), so these assertions don't depend on the ambient build flags.
vi.mock("../config", () => ({
  runtimeConfig: {
    useMockBackend: false,
    localMode: false,
    knowledgeBaseSettingsEnabled: true,
    pluginsSettingsEnabled: true,
    homeUrl: "/",
  },
}));

const resources = vi.hoisted(() => ({
  current: null as unknown,
}));
vi.mock("../components/settings/useSettingsResources", () => ({
  useSettingsResources: () => resources.current,
}));

import { SettingsDialog, type SettingsTab } from "../components/settings/SettingsDialog";

const idle = <T,>(): SettingsResource<T[]> => ({ status: "idle", data: null, error: null });
const loading = <T,>(): SettingsResource<T[]> => ({ status: "loading", data: null, error: null });
const ready = <T,>(data: T[]): SettingsResource<T[]> => ({ status: "ready", data, error: null });
const failed = <T,>(error: string, data: T[] | null = null): SettingsResource<T[]> => ({
  status: "error",
  data,
  error,
});

const profile = (id: string, overrides: Partial<ProviderProfile> = {}): ProviderProfile => ({
  id,
  name: id,
  baseUrl: "https://api.anthropic.com",
  api: "anthropic-messages",
  adapter: "auto",
  isShared: false,
  models: ["m"],
  reasoningModels: [],
  icon: "circle",
  iconColor: "#111111",
  notes: "",
  isActive: false,
  apiKeyMasked: "sk-1••••2345",
  createdAt: 0,
  updatedAt: 0,
  healthStatus: "unknown",
  modelHealth: [],
  ...overrides,
});

function render(
  state: {
    providers?: SettingsResource<ProviderProfile[]>;
    mcpServers?: SettingsResource<McpServerEntry[]>;
    installedPlugins?: SettingsResource<unknown[]>;
  },
  initialTab: SettingsTab = "providers",
) {
  resources.current = {
    providers: state.providers ?? ready<ProviderProfile>([]),
    mcpServers: state.mcpServers ?? ready<McpServerEntry>([]),
    installedPlugins: state.installedPlugins ?? ready<unknown>([]),
    mcpByok: null,
    reloadProviders: async () => {},
    reloadMcpServers: async () => {},
    reloadPlugins: async () => {},
    refreshMcpByok: async () => {},
    updateProviders: () => {},
    updateMcpServers: () => {},
  };
  return renderToStaticMarkup(
    <SettingsDialog isOpen onClose={() => {}} initialTab={initialTab} />,
  );
}

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("SettingsDialog — section load states (#556 follow-up)", () => {
  it("never claims 'no providers' while the request is in flight", () => {
    const html = render({ providers: loading<ProviderProfile>() });
    expect(html).not.toContain("settings.providers.empty");
    expect(html).toContain("settings.loading");
  });

  it("never claims 'no providers' on a fresh open before the request starts", () => {
    const html = render({ providers: idle<ProviderProfile>() });
    expect(html).not.toContain("settings.providers.empty");
  });

  it("shows friendly copy plus a retry on failure — not the raw 404, not an empty state", () => {
    const html = render({ providers: failed<ProviderProfile>("404 Not Found") });
    expect(html).toContain("settings.providers.loadFailed");
    expect(html).toContain("settings.section.retry");
    expect(html).not.toContain("settings.providers.empty");
    // The transport detail stays as a tooltip rather than the dialog's state.
    expect(html).toContain('title="404 Not Found"');
  });

  it("shows the empty state only for a confirmed empty success", () => {
    const html = render({ providers: ready<ProviderProfile>([]) });
    expect(html).toContain("settings.providers.empty");
    expect(html).not.toContain("settings.providers.loadFailed");
  });

  it("keeps cached providers on screen next to a refresh error", () => {
    const html = render({ providers: failed("boom", [profile("kept")]) });
    expect(html).toContain("kept");
    expect(html).toContain("settings.providers.loadFailed");
    expect(html).not.toContain("settings.providers.empty");
  });

  it("does not leak a provider load error onto other tabs", () => {
    const state = { providers: failed<ProviderProfile>("404 Not Found") };
    const preferences = render(state, "preferences");
    expect(preferences).not.toContain("settings.providers.loadFailed");
    expect(preferences).toContain("settings.prefs.title");

    const account = render(state, "account");
    expect(account).not.toContain("settings.providers.loadFailed");
  });

  it("keeps an MCP failure out of the providers tab and vice versa", () => {
    const providersTab = render(
      { providers: ready([profile("p1")]), mcpServers: failed<McpServerEntry>("mcp down") },
      "providers",
    );
    expect(providersTab).toContain("p1");
    expect(providersTab).not.toContain("settings.mcp.loadFailed");

    const mcpTab = render(
      { providers: ready([profile("p1")]), mcpServers: failed<McpServerEntry>("mcp down") },
      "mcp",
    );
    expect(mcpTab).toContain("settings.mcp.loadFailed");
    expect(mcpTab).not.toContain("settings.mcp.empty");
  });

  it("renders the plugin section's own failure without an empty state", () => {
    const html = render({ installedPlugins: failed<unknown>("404 Not Found") }, "plugins");
    expect(html).toContain("settings.plugins.loadFailed");
    expect(html).not.toContain("settings.plugins.empty");
  });
});

describe("SettingsDialog — shared provider affordances", () => {
  it("offers no Edit/Remove for a shared profile with an arbitrary id", () => {
    // Cloud preset ids look like "preset-1"; only isShared is authoritative.
    const html = render({ providers: ready([profile("preset-1", { isShared: true })]) });
    expect(html).toContain("settings.providers.shared");
    expect(html).not.toContain("settings.providers.edit");
    expect(html).not.toContain("settings.providers.remove");
    // Use and Test remain available — the backend allows both.
    expect(html).toContain("settings.providers.test");
    expect(html).toContain("settings.providers.use");
  });

  it("keeps full actions for a private profile whose id merely looks shared", () => {
    const html = render({ providers: ready([profile("shared_legacy", { isShared: false })]) });
    expect(html).toContain("settings.providers.private");
    expect(html).toContain("settings.providers.edit");
    expect(html).toContain("settings.providers.remove");
  });
});
