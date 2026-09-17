import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import type { McpServerEntry, ProviderProfile } from "../contracts/backend";
import type { InstalledPluginApiEntry } from "../utils/api";
import {
  useSettingsResources,
  type SettingsResourcesApi,
  type UseSettingsResourcesResult,
} from "../components/settings/useSettingsResources";
import { isConfirmedEmpty, resourceItems } from "../components/settings/settingsResources";

/** A promise plus its resolvers, so a test can settle each endpoint by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Nothing observes the rejection until the hook awaits it.
  promise.catch(() => {});
  return { promise, resolve, reject };
}

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

const server = (name: string): McpServerEntry => ({ name, type: "stdio", command: "npx" });

type Harness = {
  latest: () => UseSettingsResourcesResult;
  render: (props: { isOpen: boolean; pluginsEnabled?: boolean }) => void;
  unmount: () => void;
};

function Probe({
  capture,
  isOpen,
  pluginsEnabled,
  api,
}: {
  capture: (value: UseSettingsResourcesResult) => void;
  isOpen: boolean;
  pluginsEnabled: boolean;
  api: SettingsResourcesApi;
}) {
  capture(
    useSettingsResources({
      isOpen,
      pluginsEnabled,
      fallbackError: "FALLBACK",
      api,
    }),
  );
  return null;
}

function mount(api: SettingsResourcesApi, isOpen = true, pluginsEnabled = true): Harness {
  let value: UseSettingsResourcesResult | null = null;
  const capture = (next: UseSettingsResourcesResult) => {
    value = next;
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Probe capture={capture} isOpen={isOpen} pluginsEnabled={pluginsEnabled} api={api} />,
    );
  });
  return {
    latest: () => {
      if (!value) throw new Error("hook never rendered");
      return value;
    },
    render: (props) => {
      act(() => {
        renderer.update(
          <Probe
            capture={capture}
            isOpen={props.isOpen}
            pluginsEnabled={props.pluginsEnabled ?? pluginsEnabled}
            api={api}
          />,
        );
      });
    },
    unmount: () => act(() => renderer.unmount()),
  };
}

/** Lets every pending microtask/`await` in the hook run. */
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
};

function makeApi(overrides: Partial<SettingsResourcesApi> = {}): SettingsResourcesApi {
  return {
    providers: {
      list: vi.fn(async () => [] as ProviderProfile[]),
      health: vi.fn(async () => [] as ProviderProfile[]),
    },
    mcpServers: { list: vi.fn(async () => [] as McpServerEntry[]) },
    plugins: { installed: vi.fn(async () => [] as InstalledPluginApiEntry[]) },
    mcpByok: { support: vi.fn(async () => null) },
    ...overrides,
  };
}

describe("useSettingsResources — independent section loads (#556 follow-up)", () => {
  it("shows providers even though the plugin endpoint 404s (the Cloud defect)", async () => {
    const plugins = deferred<InstalledPluginApiEntry[]>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1")]),
        health: vi.fn(async () => []),
      },
      plugins: { installed: vi.fn(() => plugins.promise) },
    });
    const harness = mount(api);

    plugins.reject(new Error("404 Not Found"));
    await flush();

    // Providers loaded; the plugin failure is scoped to its own section.
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["p1"]);
    expect(harness.latest().providers.status).toBe("ready");
    expect(harness.latest().providers.error).toBeNull();
    expect(isConfirmedEmpty(harness.latest().providers)).toBe(false);
    expect(harness.latest().installedPlugins.status).toBe("error");
    expect(harness.latest().installedPlugins.error).toBe("404 Not Found");
    harness.unmount();
  });

  it("shows providers while the plugin request is still pending", async () => {
    const plugins = deferred<InstalledPluginApiEntry[]>();
    const api = makeApi({
      providers: { list: vi.fn(async () => [profile("p1")]), health: vi.fn(async () => []) },
      plugins: { installed: vi.fn(() => plugins.promise) },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().providers.status).toBe("ready");
    expect(resourceItems(harness.latest().providers)).toHaveLength(1);
    expect(harness.latest().installedPlugins.status).toBe("loading");
    harness.unmount();
  });

  it("commits the provider list while health is still hanging", async () => {
    const health = deferred<ProviderProfile[]>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { healthStatus: "healthy" })]),
        health: vi.fn(() => health.promise),
      },
    });
    const harness = mount(api);
    await flush();

    // Health is a decoration: a hung probe must not hide a successful list.
    expect(harness.latest().providers.status).toBe("ready");
    expect(resourceItems(harness.latest().providers)[0].healthStatus).toBe("healthy");
    harness.unmount();
  });

  it("keeps the provider list (and its own health) when the health probe fails", async () => {
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { healthStatus: "healthy" })]),
        health: vi.fn(async () => {
          throw new Error("health 500");
        }),
      },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().providers.status).toBe("ready");
    expect(harness.latest().providers.error).toBeNull();
    expect(resourceItems(harness.latest().providers)[0].healthStatus).toBe("healthy");
    harness.unmount();
  });

  it("overlays health onto the committed list when it arrives late", async () => {
    const health = deferred<ProviderProfile[]>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1"), profile("p2")]),
        health: vi.fn(() => health.promise),
      },
    });
    const harness = mount(api);
    await flush();
    expect(resourceItems(harness.latest().providers)[0].healthStatus).toBe("unknown");

    health.resolve([profile("p1", { healthStatus: "healthy", healthCheckedAt: 42 })]);
    await flush();

    const [p1, p2] = resourceItems(harness.latest().providers);
    expect(p1.healthStatus).toBe("healthy");
    expect(p1.healthCheckedAt).toBe(42);
    // A profile with no health row keeps its own status rather than "unhealthy".
    expect(p2.healthStatus).toBe("unknown");
    harness.unmount();
  });

  it("keeps an MCP failure from touching providers and plugins", async () => {
    const api = makeApi({
      providers: { list: vi.fn(async () => [profile("p1")]), health: vi.fn(async () => []) },
      mcpServers: {
        list: vi.fn(async () => {
          throw new Error("mcp down");
        }),
      },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().providers.status).toBe("ready");
    expect(harness.latest().installedPlugins.status).toBe("ready");
    expect(harness.latest().mcpServers.status).toBe("error");
    expect(harness.latest().mcpServers.error).toBe("mcp down");
    expect(isConfirmedEmpty(harness.latest().mcpServers)).toBe(false);
    harness.unmount();
  });

  it("marks a genuine empty response as confirmed-empty", async () => {
    const harness = mount(makeApi());
    await flush();
    expect(isConfirmedEmpty(harness.latest().providers)).toBe(true);
    expect(isConfirmedEmpty(harness.latest().mcpServers)).toBe(true);
    harness.unmount();
  });

  it("uses the localized fallback when a rejection has no message", async () => {
    const api = makeApi({
      providers: {
        list: vi.fn(async () => {
          throw new Error("");
        }),
        health: vi.fn(async () => []),
      },
    });
    const harness = mount(api);
    await flush();
    expect(harness.latest().providers.error).toBe("FALLBACK");
    harness.unmount();
  });

  it("clears the scoped error when a retry succeeds", async () => {
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([profile("p1")]);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();
    expect(harness.latest().providers.status).toBe("error");

    await act(async () => {
      await harness.latest().reloadProviders();
    });
    expect(harness.latest().providers.status).toBe("ready");
    expect(harness.latest().providers.error).toBeNull();
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["p1"]);
    harness.unmount();
  });

  it("keeps the cached list visible when a refresh fails", async () => {
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockResolvedValueOnce([profile("p1")])
      .mockRejectedValueOnce(new Error("refresh failed"));
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();

    await act(async () => {
      await harness.latest().reloadProviders();
    });
    expect(harness.latest().providers.status).toBe("error");
    expect(harness.latest().providers.error).toBe("refresh failed");
    // Never replaced with [] — the user keeps seeing their provider.
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["p1"]);
    expect(isConfirmedEmpty(harness.latest().providers)).toBe(false);
    harness.unmount();
  });

  it("ignores a superseded in-flight response (out-of-order retry)", async () => {
    const slow = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => [profile("fresh")]);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));

    await act(async () => {
      await harness.latest().reloadProviders();
    });
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["fresh"]);

    // The original request finally answers with stale data.
    slow.resolve([profile("stale")]);
    await flush();
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["fresh"]);
    harness.unmount();
  });

  it("discards a response that lands after close, and re-requests on reopen", async () => {
    const first = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => [profile("second-open")]);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));

    harness.render({ isOpen: false });
    first.resolve([profile("first-open")]);
    await flush();
    expect(harness.latest().providers.data).toBeNull();

    harness.render({ isOpen: true });
    await flush();
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["second-open"]);
    expect(list).toHaveBeenCalledTimes(2);
    harness.unmount();
  });

  it("does not render a previous session's confirmed-empty result on reopen", async () => {
    const second = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(async () => [])
      .mockImplementationOnce(() => second.promise);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();
    expect(isConfirmedEmpty(harness.latest().providers)).toBe(true);

    harness.render({ isOpen: false });
    harness.render({ isOpen: true });
    // The reopen's request has not answered yet: it must read as pending, not
    // as "no providers yet".
    expect(isConfirmedEmpty(harness.latest().providers)).toBe(false);

    second.resolve([profile("p1")]);
    await flush();
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["p1"]);
    harness.unmount();
  });

  it("lets a mutation defeat a pending stale refresh instead of resurrecting a row", async () => {
    const slow = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(async () => [profile("keep"), profile("doomed")])
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => [profile("keep")]);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();

    // A refresh is in flight when the user removes a profile.
    act(() => {
      void harness.latest().reloadProviders();
    });
    act(() => {
      harness.latest().updateProviders((current) => current.filter((p) => p.id !== "doomed"));
    });
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["keep"]);

    slow.resolve([profile("keep"), profile("doomed")]);
    await flush();
    // The stale in-flight answer must not bring "doomed" back.
    expect(resourceItems(harness.latest().providers).map((p) => p.id)).toEqual(["keep"]);
    harness.unmount();
  });

  it("does not turn a never-loaded resource into a confirmed empty via a mutation", async () => {
    const never = deferred<ProviderProfile[]>();
    const harness = mount(
      makeApi({ providers: { list: vi.fn(() => never.promise), health: vi.fn(async () => []) } }),
    );

    act(() => {
      // e.g. a remove applied before the first list ever answered.
      harness.latest().updateProviders((current) => current.filter(() => false));
    });
    expect(harness.latest().providers.data).toBeNull();
    expect(isConfirmedEmpty(harness.latest().providers)).toBe(false);
    harness.unmount();
  });

  it("applies MCP mutations and keeps them through a superseded refresh", async () => {
    const slow = deferred<McpServerEntry[]>();
    const list = vi
      .fn<() => Promise<McpServerEntry[]>>()
      .mockImplementationOnce(async () => [server("a"), server("b")])
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => [server("a")]);
    const harness = mount(makeApi({ mcpServers: { list } }));
    await flush();

    act(() => {
      void harness.latest().reloadMcpServers();
    });
    act(() => {
      harness.latest().updateMcpServers((current) => current.filter((s) => s.name !== "b"));
    });
    slow.resolve([server("a"), server("b")]);
    await flush();
    expect(resourceItems(harness.latest().mcpServers).map((s) => s.name)).toEqual(["a"]);
    harness.unmount();
  });

  it("never calls the installed-plugin API when the capability is disabled", async () => {
    const installed = vi.fn(async () => [] as InstalledPluginApiEntry[]);
    const harness = mount(makeApi({ plugins: { installed } }), true, false);
    await flush();

    expect(installed).not.toHaveBeenCalled();
    // Stays idle rather than rendering "no plugins installed".
    expect(harness.latest().installedPlugins.status).toBe("idle");
    expect(isConfirmedEmpty(harness.latest().installedPlugins)).toBe(false);
    // Providers are unaffected.
    expect(harness.latest().providers.status).toBe("ready");

    await act(async () => {
      await harness.latest().reloadPlugins();
    });
    expect(installed).not.toHaveBeenCalled();
    harness.unmount();
  });

  it("fetches plugins when the capability is enabled (local default)", async () => {
    const installed = vi.fn(async () => [] as InstalledPluginApiEntry[]);
    const harness = mount(makeApi({ plugins: { installed } }), true, true);
    await flush();
    expect(installed).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("requests nothing while the dialog is closed and does not refetch on rerender", async () => {
    const api = makeApi();
    const harness = mount(api, false);
    await flush();
    expect(api.providers.list).not.toHaveBeenCalled();

    harness.render({ isOpen: true });
    await flush();
    expect(api.providers.list).toHaveBeenCalledTimes(1);

    // Re-rendering with unchanged props must not start another load.
    harness.render({ isOpen: true });
    harness.render({ isOpen: true });
    await flush();
    expect(api.providers.list).toHaveBeenCalledTimes(1);
    harness.unmount();
  });
});
