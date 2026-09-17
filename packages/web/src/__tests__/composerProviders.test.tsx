import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderProfile } from "../contracts/backend";
import { resolveComposerProviderNotice } from "../components/chat/noProviderBanner";
import {
  resolveComposerSelection,
  useComposerProviders,
  type ComposerProvidersApi,
  type UseComposerProvidersResult,
} from "../components/chat/useComposerProviders";

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

function makeApi(overrides: Partial<ComposerProvidersApi> = {}): ComposerProvidersApi {
  return {
    providers: {
      list: vi.fn(async () => [] as ProviderProfile[]),
      health: vi.fn(async () => [] as ProviderProfile[]),
    },
    settings: { get: vi.fn(async () => ({ model: "" })) },
    ...overrides,
  };
}

// The hook only needs these four window members; the package's vitest runs in
// the `node` env, so they are stubbed rather than pulled in with a DOM.
type WindowStub = {
  addEventListener: (type: string, handler: () => void) => void;
  removeEventListener: (type: string, handler: () => void) => void;
  setInterval: (handler: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
};

const listeners = new Map<string, Set<() => void>>();
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

const dispatch = (type: string) => {
  for (const handler of [...(listeners.get(type) ?? [])]) handler();
};

beforeEach(() => {
  listeners.clear();
  const windowStub: WindowStub = {
    addEventListener: (type, handler) => {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    removeEventListener: (type, handler) => {
      listeners.get(type)?.delete(handler);
    },
    setInterval: (handler, ms) => setInterval(handler, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: windowStub });
});

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
});

type ProbeProps = {
  isDraft: boolean;
  sessionKey: string | null;
  sessionProviderId?: string;
  sessionModelId?: string;
};

type Harness = {
  latest: () => UseComposerProvidersResult;
  render: (props: ProbeProps) => void;
  unmount: () => void;
  /** The notice the composer would render for the current state. */
  notice: (hasCta?: boolean) => ReturnType<typeof resolveComposerProviderNotice>;
};

function Probe({
  capture,
  api,
  refreshIntervalMs,
  ...props
}: ProbeProps & {
  capture: (value: UseComposerProvidersResult) => void;
  api: ComposerProvidersApi;
  refreshIntervalMs?: number;
}) {
  capture(useComposerProviders({ ...props, fallbackError: "FALLBACK", api, refreshIntervalMs }));
  return null;
}

const DRAFT: ProbeProps = { isDraft: true, sessionKey: "draft" };

function mount(api: ComposerProvidersApi, initial: ProbeProps = DRAFT, refreshIntervalMs?: number): Harness {
  let value: UseComposerProvidersResult | null = null;
  const capture = (next: UseComposerProvidersResult) => {
    value = next;
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(
      <Probe capture={capture} api={api} refreshIntervalMs={refreshIntervalMs} {...initial} />,
    );
  });
  const latest = () => {
    if (!value) throw new Error("hook never rendered");
    return value;
  };
  return {
    latest,
    render: (props) => {
      act(() => {
        renderer.update(
          <Probe capture={capture} api={api} refreshIntervalMs={refreshIntervalMs} {...props} />,
        );
      });
    },
    unmount: () => act(() => renderer.unmount()),
    notice: (hasCta = true) => resolveComposerProviderNotice({
      list: latest().list,
      hasActiveProvider: latest().activeProvider !== null,
      hasSelectedModel: latest().selectedModel !== "",
      isPinnedSession: false,
      hasCta,
    }),
  };
}

/** Lets every pending microtask/`await` in the hook run. */
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
};

describe("useComposerProviders — truthful availability", () => {
  it("does not claim 'no provider' when the list request fails", async () => {
    const api = makeApi({
      providers: {
        list: vi.fn(async () => {
          throw new Error("500 Internal Server Error");
        }),
        health: vi.fn(async () => []),
      },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().phase).toBe("failed");
    expect(harness.latest().activeProvider).toBeNull();
    expect(harness.notice()).toEqual({
      kind: "load-failed",
      hasCachedList: false,
      detail: "500 Internal Server Error",
      busy: false,
    });
    harness.unmount();
  });

  it("shows the Add Provider CTA only for a genuinely empty list", async () => {
    const harness = mount(makeApi());
    await flush();
    expect(harness.latest().phase).toBe("empty");
    expect(harness.notice()).toEqual({ kind: "add-provider" });
    harness.unmount();
  });

  it("asks for a model — not another provider — when nothing is active", async () => {
    const api = makeApi({
      providers: { list: vi.fn(async () => [profile("p1")]), health: vi.fn(async () => []) },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().profiles.map((p) => p.id)).toEqual(["p1"]);
    expect(harness.latest().activeProvider).toBeNull();
    expect(harness.latest().selectedModel).toBe("");
    // The picker must stay usable in this state.
    expect(harness.latest().phase).toBe("present");
    expect(harness.notice()).toEqual({ kind: "choose-model" });
    harness.unmount();
  });

  it("keeps a usable list while the saved-model read hangs", async () => {
    const preference = deferred<{ model?: string }>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true, models: ["a", "b"] })]),
        health: vi.fn(async () => []),
      },
      settings: { get: vi.fn(() => preference.promise) },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().phase).toBe("present");
    expect(harness.latest().activeProvider?.id).toBe("p1");
    expect(harness.latest().selectedModel).toBe("a");
    expect(harness.notice()).toEqual({ kind: "none" });

    // The preference still applies when it finally answers.
    preference.resolve({ model: "b" });
    await flush();
    expect(harness.latest().selectedModel).toBe("b");
    expect(harness.latest().selectionSource).toBe("preference");
    harness.unmount();
  });

  it("keeps the list when the saved-model read fails outright", async () => {
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true })]),
        health: vi.fn(async () => []),
      },
      settings: {
        get: vi.fn(async () => {
          throw new Error("settings 404");
        }),
      },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().phase).toBe("present");
    expect(harness.latest().selectedModel).toBe("m");
    expect(harness.notice()).toEqual({ kind: "none" });
    harness.unmount();
  });

  it("never lets a late preference overwrite a manual model choice", async () => {
    const preference = deferred<{ model?: string }>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true, models: ["a", "b"] })]),
        health: vi.fn(async () => []),
      },
      settings: { get: vi.fn(() => preference.promise) },
    });
    const harness = mount(api);
    await flush();

    act(() => {
      const provider = harness.latest().profiles[0];
      harness.latest().selectProviderModel(provider, "a");
    });
    preference.resolve({ model: "b" });
    await flush();

    expect(harness.latest().selectedModel).toBe("a");
    expect(harness.latest().selectionSource).toBe("manual");
    harness.unmount();
  });

  it("keeps the list's own health when the health probe fails", async () => {
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true, healthStatus: "healthy" })]),
        health: vi.fn(async () => {
          throw new Error("health 500");
        }),
      },
    });
    const harness = mount(api);
    await flush();

    expect(harness.latest().phase).toBe("present");
    expect(harness.latest().profiles[0].healthStatus).toBe("healthy");
    harness.unmount();
  });

  it("overlays health onto the committed list when it arrives late", async () => {
    const health = deferred<ProviderProfile[]>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true }), profile("p2")]),
        health: vi.fn(() => health.promise),
      },
    });
    const harness = mount(api);
    await flush();
    expect(harness.latest().profiles[0].healthStatus).toBe("unknown");

    health.resolve([profile("p1", { healthStatus: "healthy", healthCheckedAt: 42 })]);
    await flush();
    const [p1, p2] = harness.latest().profiles;
    expect(p1.healthStatus).toBe("healthy");
    expect(p1.healthCheckedAt).toBe(42);
    // A profile with no health row keeps its own status.
    expect(p2.healthStatus).toBe("unknown");
    harness.unmount();
  });

  it("keeps the cached list through a refresh failure, and clears the error on a successful retry", async () => {
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockResolvedValueOnce([profile("p1", { isActive: true })])
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce([profile("p1", { isActive: true })]);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();

    await act(async () => {
      await harness.latest().retry();
    });
    expect(harness.latest().phase).toBe("failed");
    // Never replaced with []: the user keeps seeing their provider and model.
    expect(harness.latest().profiles.map((p) => p.id)).toEqual(["p1"]);
    expect(harness.latest().activeProvider?.id).toBe("p1");
    expect(harness.notice()).toMatchObject({ kind: "load-failed", hasCachedList: true });

    await act(async () => {
      await harness.latest().retry();
    });
    expect(harness.latest().phase).toBe("present");
    expect(harness.latest().list.error).toBeNull();
    expect(harness.notice()).toEqual({ kind: "none" });
    harness.unmount();
  });

  it("keeps the retry mounted and busy for the whole request", async () => {
    const slow = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce(() => slow.promise);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();
    expect(harness.notice()).toMatchObject({ kind: "load-failed", busy: false });

    act(() => {
      void harness.latest().retry();
    });
    // Still the same notice — the button must not unmount mid-request.
    expect(harness.notice()).toMatchObject({ kind: "load-failed", detail: "offline", busy: true });
    expect(harness.latest().refreshing).toBe(true);

    slow.resolve([profile("p1", { isActive: true })]);
    await flush();
    expect(harness.notice()).toEqual({ kind: "none" });
    expect(harness.latest().refreshing).toBe(false);
    harness.unmount();
  });

  it("ignores a superseded in-flight reply (out-of-order refresh)", async () => {
    const slow = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(() => slow.promise)
      .mockImplementationOnce(async () => [profile("fresh", { isActive: true })]);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));

    await act(async () => {
      await harness.latest().retry();
    });
    expect(harness.latest().profiles.map((p) => p.id)).toEqual(["fresh"]);

    slow.resolve([profile("stale", { isActive: true })]);
    await flush();
    expect(harness.latest().profiles.map((p) => p.id)).toEqual(["fresh"]);
    harness.unmount();
  });

  it("drops a reply from the previous conversation and pins the new one's provider/model", async () => {
    const first = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(async () => [
        profile("pA", { isActive: true }),
        profile("pB", { models: ["m9"] }),
      ]);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));

    harness.render({
      isDraft: false,
      sessionKey: "s1",
      sessionProviderId: "pB",
      sessionModelId: "m9",
    });
    first.resolve([profile("pA", { isActive: true })]);
    await flush();

    expect(harness.latest().activeProvider?.id).toBe("pB");
    expect(harness.latest().selectedModel).toBe("m9");
    expect(harness.latest().selectionSource).toBe("session");
    harness.unmount();
  });

  it("does not switch a pinned conversation when a provider-profiles-updated refresh lands", async () => {
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [
          profile("pA", { isActive: true }),
          profile("pB", { models: ["m9"] }),
        ]),
        health: vi.fn(async () => []),
      },
    });
    const harness = mount(api, {
      isDraft: false,
      sessionKey: "s1",
      sessionProviderId: "pB",
      sessionModelId: "m9",
    });
    await flush();
    expect(harness.latest().activeProvider?.id).toBe("pB");

    await act(async () => {
      dispatch("provider-profiles-updated");
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(api.providers.list).toHaveBeenCalledTimes(2);
    expect(harness.latest().activeProvider?.id).toBe("pB");
    expect(harness.latest().selectedModel).toBe("m9");
    harness.unmount();
  });

  it("discards a reply that lands after unmount", async () => {
    const slow = deferred<ProviderProfile[]>();
    const harness = mount(
      makeApi({ providers: { list: vi.fn(() => slow.promise), health: vi.fn(async () => []) } }),
    );
    harness.unmount();
    slow.resolve([profile("p1", { isActive: true })]);
    // No "update on an unmounted component" work should happen here.
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });
    expect(harness.latest().profiles).toEqual([]);
  });

  it("mirrors an active-provider switch locally without re-reading the list", async () => {
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true }), profile("p2")]),
        health: vi.fn(async () => []),
      },
    });
    const harness = mount(api);
    await flush();

    act(() => {
      harness.latest().selectProviderModel(harness.latest().profiles[1], "m");
      harness.latest().markProviderActive("p2");
    });
    expect(harness.latest().profiles.map((p) => p.isActive)).toEqual([false, true]);
    expect(harness.latest().activeProvider?.id).toBe("p2");
    expect(harness.latest().selectedModel).toBe("m");
    expect(api.providers.list).toHaveBeenCalledTimes(1);
    harness.unmount();
  });

  it("keeps a legacy session's model when it recorded no provider id", async () => {
    const preference = deferred<{ model?: string }>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("pA", { isActive: true, models: ["a", "b"] })]),
        health: vi.fn(async () => []),
      },
      settings: { get: vi.fn(() => preference.promise) },
    });
    const harness = mount(api, { isDraft: false, sessionKey: "s1", sessionModelId: "b" });
    await flush();

    // The provider falls back to the current default, but the conversation's own
    // model is what it recorded — not the provider's first model.
    expect(harness.latest().activeProvider?.id).toBe("pA");
    expect(harness.latest().selectedModel).toBe("b");
    expect(harness.latest().selectionSource).toBe("session");

    // A conflicting saved preference arriving late may not move it either.
    preference.resolve({ model: "a" });
    await flush();
    expect(harness.latest().selectedModel).toBe("b");
    expect(harness.latest().selectionSource).toBe("session");
    harness.unmount();
  });

  it("applies the saved model while the health probe hangs, and keeps it when health lands", async () => {
    const health = deferred<ProviderProfile[]>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true, models: ["a", "b"] })]),
        health: vi.fn(() => health.promise),
      },
      settings: { get: vi.fn(async () => ({ model: "b" })) },
    });
    const harness = mount(api);
    await flush();

    // The hung health probe must not hold the preference back.
    expect(harness.latest().selectedModel).toBe("b");
    expect(harness.latest().selectionSource).toBe("preference");

    health.resolve([profile("p1", { healthStatus: "healthy", healthCheckedAt: 7 })]);
    await flush();
    expect(harness.latest().profiles[0].healthStatus).toBe("healthy");
    // …and the late health reply must not erase the applied preference.
    expect(harness.latest().selectedModel).toBe("b");
    expect(harness.latest().selectionSource).toBe("preference");
    expect(harness.latest().activeProvider?.healthCheckedAt).toBe(7);
    harness.unmount();
  });

  it("shows health while the saved-model read hangs, and keeps health when the model lands", async () => {
    const health = deferred<ProviderProfile[]>();
    const preference = deferred<{ model?: string }>();
    const api = makeApi({
      providers: {
        list: vi.fn(async () => [profile("p1", { isActive: true, models: ["a", "b"] })]),
        health: vi.fn(() => health.promise),
      },
      settings: { get: vi.fn(() => preference.promise) },
    });
    const harness = mount(api);
    await flush();

    // Health arrives first: the still-pending preference read may not hide it.
    health.resolve([profile("p1", { healthStatus: "healthy", healthCheckedAt: 7 })]);
    await flush();
    expect(harness.latest().profiles[0].healthStatus).toBe("healthy");
    expect(harness.latest().selectedModel).toBe("a");

    preference.resolve({ model: "b" });
    await flush();
    expect(harness.latest().selectedModel).toBe("b");
    expect(harness.latest().selectionSource).toBe("preference");
    // The preference commit keeps the health the other decoration contributed.
    expect(harness.latest().profiles[0].healthCheckedAt).toBe(7);
    expect(harness.latest().activeProvider?.healthStatus).toBe("healthy");
    harness.unmount();
  });

  it("keeps a failed list failed when its decorations answer", async () => {
    const health = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockResolvedValueOnce([profile("p1", { isActive: true })])
      .mockRejectedValueOnce(new Error("refresh failed"));
    const api = makeApi({
      providers: { list, health: vi.fn(() => health.promise) },
      settings: { get: vi.fn(async () => ({ model: "m" })) },
    });
    const harness = mount(api);
    health.resolve([profile("p1", { healthStatus: "healthy" })]);
    await flush();
    expect(harness.latest().phase).toBe("present");

    await act(async () => {
      await harness.latest().retry();
    });
    await flush();
    expect(harness.latest().phase).toBe("failed");
    expect(harness.notice()).toMatchObject({ kind: "load-failed", detail: "refresh failed" });
    harness.unmount();
  });

  it("resolves the new conversation's pin from the cached list before its own request answers", async () => {
    const pending = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(async () => [
        profile("pA", { isActive: true, models: ["a"] }),
        profile("pB", { models: ["m9"] }),
      ])
      .mockImplementation(() => pending.promise);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();
    expect(harness.latest().selectedModel).toBe("a");

    // The next list is deferred: the state right after the switch is what the
    // user sees, so it must already be this conversation's pin.
    harness.render({ isDraft: false, sessionKey: "s1", sessionProviderId: "pB", sessionModelId: "m9" });
    expect(harness.latest().activeProvider?.id).toBe("pB");
    expect(harness.latest().selectedModel).toBe("m9");
    expect(harness.latest().selectionSource).toBe("session");

    // A pin the cached list cannot resolve clears the selection instead of
    // leaving the previous conversation's provider/model on screen.
    harness.render({ isDraft: false, sessionKey: "s2", sessionProviderId: "gone" });
    expect(harness.latest().activeProvider).toBeNull();
    expect(harness.latest().selectedModel).toBe("");
    harness.unmount();
  });

  it("resets a new draft to the cached default rather than the previous conversation's pick", async () => {
    const pending = deferred<ProviderProfile[]>();
    const list = vi
      .fn<() => Promise<ProviderProfile[]>>()
      .mockImplementationOnce(async () => [
        profile("pA", { isActive: true, models: ["a"] }),
        profile("pB", { models: ["m9"] }),
      ])
      .mockImplementation(() => pending.promise);
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }));
    await flush();

    act(() => {
      harness.latest().selectProviderModel(harness.latest().profiles[1], "m9");
    });
    expect(harness.latest().selectedModel).toBe("m9");

    harness.render({ isDraft: true, sessionKey: "draft-2" });
    expect(harness.latest().activeProvider?.id).toBe("pA");
    expect(harness.latest().selectedModel).toBe("a");
    expect(harness.latest().selectionSource).toBe("auto");
    harness.unmount();
  });

  it("reports a background refresh failure over the cached list, and clears it on the next success", async () => {
    let failing = false;
    const list = vi.fn(async () => {
      if (failing) throw new Error("network blip");
      return [profile("p1", { isActive: true })];
    });
    // A 5ms cadence stands in for the real 30s one; real timers keep this free of
    // fake-timer/act interactions.
    const harness = mount(makeApi({ providers: { list, health: vi.fn(async () => []) } }), DRAFT, 5);
    await flush();
    expect(harness.latest().phase).toBe("present");

    failing = true;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(list.mock.calls.length).toBeGreaterThan(1);
    // The failure is recorded — an initial success must not hide a stale list —
    // but the cached profiles and the selection stay put, and nothing looks busy.
    expect(harness.latest().profiles.map((p) => p.id)).toEqual(["p1"]);
    expect(harness.latest().activeProvider?.id).toBe("p1");
    expect(harness.latest().refreshing).toBe(false);
    expect(harness.notice()).toEqual({
      kind: "load-failed",
      hasCachedList: true,
      detail: "network blip",
      busy: false,
    });

    failing = false;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    expect(harness.latest().list.error).toBeNull();
    expect(harness.latest().phase).toBe("present");
    expect(harness.notice()).toEqual({ kind: "none" });
    harness.unmount();
  });
});

describe("resolveComposerSelection", () => {
  const current = { activeProvider: null, selectedModel: "", source: "none" as const };

  it("pins an existing conversation to what it recorded", () => {
    const result = resolveComposerSelection({
      profiles: [profile("pA", { isActive: true }), profile("pB", { models: ["m9"] })],
      isDraft: false,
      sessionProviderId: "pB",
      sessionModelId: "m9",
      current: { activeProvider: null, selectedModel: "", source: "auto" },
      preferredModel: "m",
    });
    expect(result).toMatchObject({ selectedModel: "m9", source: "session" });
    expect(result.activeProvider?.id).toBe("pB");
  });

  it("keeps a legacy conversation's model and only defaults its provider", () => {
    const result = resolveComposerSelection({
      profiles: [profile("pA", { isActive: true, models: ["a", "b"] }), profile("pB")],
      isDraft: false,
      // Recorded before the composer stored a provider id.
      sessionModelId: "b",
      current: { activeProvider: null, selectedModel: "", source: "auto" },
      preferredModel: "a",
    });
    expect(result).toMatchObject({ selectedModel: "b", source: "session" });
    expect(result.activeProvider?.id).toBe("pA");
  });

  it("re-points a manual pick at the freshly loaded profile", () => {
    const stale = profile("p1", { models: ["a", "b"] });
    const fresh = profile("p1", { models: ["a", "b"], healthStatus: "healthy" });
    const result = resolveComposerSelection({
      profiles: [fresh, profile("p2", { isActive: true })],
      isDraft: true,
      current: { activeProvider: stale, selectedModel: "b", source: "manual" },
      preferredModel: "a",
    });
    expect(result).toMatchObject({ selectedModel: "b", source: "manual" });
    expect(result.activeProvider).toBe(fresh);
  });

  it("falls back to the default when a manual pick disappears server-side", () => {
    const result = resolveComposerSelection({
      profiles: [profile("p2", { isActive: true, models: ["z"] })],
      isDraft: true,
      current: { activeProvider: profile("gone"), selectedModel: "m", source: "manual" },
    });
    expect(result).toMatchObject({ selectedModel: "z", source: "auto" });
    expect(result.activeProvider?.id).toBe("p2");
  });

  it("prefers the saved model over an auto-pick, and skips an unavailable one", () => {
    const provider = profile("p1", {
      isActive: true,
      models: ["a", "b"],
      modelHealth: [{ model: "b", status: "unavailable" }],
    });
    expect(resolveComposerSelection({
      profiles: [provider],
      isDraft: true,
      current,
      preferredModel: "b",
    })).toMatchObject({ selectedModel: "a", source: "auto" });
  });

  it("selects nothing when the list has no active provider", () => {
    expect(resolveComposerSelection({
      profiles: [profile("p1"), profile("p2")],
      isDraft: true,
      current,
    })).toMatchObject({ activeProvider: null, selectedModel: "" });
  });
});
