import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../contracts/backend";

// A transcript that cannot be read is a reportable failure, not an empty
// conversation: SessionContext records a per-session history error, keeps the
// messages already on screen, and leaves the generic run/action `error` alone.
//
// The provider is mounted for real (react-test-renderer, node env) with its
// sibling contexts and the session endpoints stubbed.

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  getHistory: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("../contexts/AuthContext", () => ({ useAuth: () => ({ isAuthReady: true }) }));
vi.mock("../contexts/SandboxContext", () => ({ useSandbox: () => ({ currentSandbox: null }) }));
vi.mock("../contexts/SSEContext", () => ({
  useSSE: () => ({
    connectSession: mocks.connect,
    disconnectSession: mocks.disconnect,
    queueRef: { current: new Map() },
    tick: 0,
    connections: new Map(),
  }),
}));
vi.mock("../utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      sessions: {
        ...actual.api.sessions,
        list: (...args: unknown[]) => mocks.list(...args),
        getHistory: (...args: unknown[]) => mocks.getHistory(...args),
        state: async () => ({ agents: [], subagents: [] }),
        getTrace: async () => {
          throw new Error("trace not stubbed in this test");
        },
      },
    },
  };
});

import { SessionProvider, useSessions } from "../contexts/SessionContext";

type ContextValue = ReturnType<typeof useSessions>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => {});
  return { promise, resolve, reject };
}

const session = (id: string, updatedAt: string): Session => ({
  id,
  title: `Title ${id}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
});

const textEvent = (messageId: string, delta: string) => ({
  type: "TEXT_MESSAGE_CHUNK",
  messageId,
  role: "user",
  delta,
  _ts: "2026-01-02T00:00:00.000Z",
});

const history = (events: unknown[] = []) => ({ events, total: events.length, truncated: false });

let latest: ContextValue | null = null;

function Probe() {
  latest = useSessions();
  return null;
}

const value = () => {
  if (!latest) throw new Error("provider never rendered");
  return latest;
};

/** Lets every pending microtask inside the provider's effects settle. */
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
};

async function mount(): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
  });
  await flush();
  return renderer;
}

beforeEach(() => {
  latest = null;
  mocks.list.mockReset();
  mocks.getHistory.mockReset();
  mocks.connect.mockReset();
  mocks.disconnect.mockReset();
  mocks.list.mockResolvedValue([]);
  mocks.getHistory.mockResolvedValue(history());
});

describe("session-list load failure is scoped to the list", () => {
  it("records sessionsListError without touching the run/action error, and clears it on a successful retry", async () => {
    mocks.list.mockRejectedValueOnce(new Error("Request failed (500)"));
    const renderer = await mount();

    expect(value().sessionsListStatus).toBe("error");
    expect(value().sessionsListError).toBe("Request failed (500)");
    // The generic error belongs to runs/actions and must stay untouched.
    expect(value().error).toBeNull();
    expect(value().sessions).toEqual([]);
    // An errored list must not auto-open a draft (that would look like "empty").
    expect(value().isDraft).toBe(false);

    mocks.list.mockResolvedValueOnce([session("s1", "2026-02-01T00:00:00.000Z")]);
    await act(async () => {
      await value().refreshSessions();
    });
    await flush();

    expect(value().sessionsListStatus).toBe("ready");
    expect(value().sessionsListError).toBeNull();
    expect(value().sessions.map((s) => s.id)).toEqual(["s1"]);
    await act(async () => renderer.unmount());
  });

  it("keeps the cached rows when a later refresh fails", async () => {
    mocks.list.mockResolvedValueOnce([session("s1", "2026-02-01T00:00:00.000Z")]);
    const renderer = await mount();
    expect(value().sessions.map((s) => s.id)).toEqual(["s1"]);

    mocks.list.mockRejectedValueOnce(new Error("network blip"));
    await act(async () => {
      await value().refreshSessions();
    });
    await flush();

    expect(value().sessionsListError).toBe("network blip");
    expect(value().sessions.map((s) => s.id)).toEqual(["s1"]);
    expect(value().error).toBeNull();
    await act(async () => renderer.unmount());
  });

  it("ignores a superseded list request that lands after a newer one", async () => {
    // The initial read is still in flight when the user refreshes; the older
    // reply — success or failure — must not overwrite the newer outcome.
    const stale = deferred<Session[]>();
    mocks.list.mockImplementationOnce(() => stale.promise);
    const renderer = await mount();
    expect(value().sessionsListStatus).toBe("loading");

    mocks.list.mockResolvedValueOnce([session("s2", "2026-02-01T00:00:00.000Z")]);
    await act(async () => {
      await value().refreshSessions();
    });
    await flush();
    expect(value().sessionsListStatus).toBe("ready");
    expect(value().sessions.map((s) => s.id)).toEqual(["s2"]);

    stale.reject(new Error("stale list failed"));
    await flush();

    expect(value().sessionsListStatus).toBe("ready");
    expect(value().sessionsListError).toBeNull();
    expect(value().sessions.map((s) => s.id)).toEqual(["s2"]);
    expect(value().isLoading).toBe(false);
    await act(async () => renderer.unmount());
  });
});

describe("history load failure is scoped to the active session", () => {
  it("reports the failure instead of leaving a silently blank conversation", async () => {
    mocks.list.mockResolvedValueOnce([session("s1", "2026-02-01T00:00:00.000Z")]);
    mocks.getHistory.mockRejectedValueOnce(new Error("history fetch failed: 500 Error"));
    const renderer = await mount();

    expect(value().currentSession?.id).toBe("s1");
    expect(value().historyLoadError).toBe("history fetch failed: 500 Error");
    expect(value().messages).toEqual([]);
    expect(value().error).toBeNull();
    expect(value().isRefreshingMessages).toBe(false);

    // Retry through the same action the composer notice uses.
    mocks.getHistory.mockResolvedValueOnce(history([textEvent("m1", "hello")]));
    await act(async () => {
      await value().refreshMessages();
    });
    await flush();

    expect(value().historyLoadError).toBeNull();
    expect(value().messages.map((m) => m.content)).toEqual(["hello"]);
    await act(async () => renderer.unmount());
  });

  it("preserves the messages already on screen when a manual refresh fails", async () => {
    mocks.list.mockResolvedValueOnce([session("s1", "2026-02-01T00:00:00.000Z")]);
    mocks.getHistory.mockResolvedValueOnce(history([textEvent("m1", "hello")]));
    const renderer = await mount();
    expect(value().messages.map((m) => m.content)).toEqual(["hello"]);

    mocks.getHistory.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await value().refreshMessages();
    });
    await flush();

    expect(value().historyLoadError).toBe("offline");
    // The cached/live transcript is never replaced by an empty one.
    expect(value().messages.map((m) => m.content)).toEqual(["hello"]);
    expect(value().error).toBeNull();
    await act(async () => renderer.unmount());
  });

  it("does not show one session's failure on another, even for a late reply", async () => {
    const pending = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
    mocks.list.mockResolvedValueOnce([
      session("s1", "2026-02-02T00:00:00.000Z"),
      session("s2", "2026-02-01T00:00:00.000Z"),
    ]);
    mocks.getHistory.mockImplementationOnce(() => pending.promise);
    const renderer = await mount();
    expect(value().currentSession?.id).toBe("s1");

    // Switch away while s1's history is still in flight, then let it fail.
    mocks.getHistory.mockResolvedValueOnce(history([textEvent("m2", "second")]));
    await act(async () => {
      value().selectSession("s2");
    });
    await flush();
    expect(value().currentSession?.id).toBe("s2");

    pending.reject(new Error("s1 history fetch failed"));
    await flush();

    // s2 is healthy: no inherited error, and its own messages are intact.
    expect(value().historyLoadError).toBeNull();
    expect(value().messages.map((m) => m.content)).toEqual(["second"]);
    await act(async () => renderer.unmount());
  });

  it("does not let a late reply for an abandoned session hide the new one's loading state", async () => {
    // Loading is owned per session. A manual refresh of s1 that lands after the
    // user opened s2 must not clear the indicator s2's own (still pending)
    // hydration owns.
    const abandoned = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
    const pendingForS2 = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
    mocks.list.mockResolvedValueOnce([
      session("s1", "2026-02-02T00:00:00.000Z"),
      session("s2", "2026-02-01T00:00:00.000Z"),
    ]);
    const renderer = await mount();
    expect(value().currentSession?.id).toBe("s1");
    expect(value().isRefreshingMessages).toBe(false);

    mocks.getHistory.mockImplementationOnce(() => abandoned.promise);
    act(() => {
      void value().refreshMessages();
    });
    await flush();
    expect(value().isRefreshingMessages).toBe(true);

    mocks.getHistory.mockImplementationOnce(() => pendingForS2.promise);
    await act(async () => {
      value().selectSession("s2");
    });
    await flush();
    expect(value().currentSession?.id).toBe("s2");
    expect(value().isRefreshingMessages).toBe(true);

    // s1's refresh finally answers — s2 is still loading, so the indicator stays.
    abandoned.resolve(history([textEvent("m1", "first")]));
    await flush();
    expect(value().isRefreshingMessages).toBe(true);
    expect(value().messages).toEqual([]);

    // Only s2's own reply ends its loading state.
    pendingForS2.resolve(history([textEvent("m2", "second")]));
    await flush();
    expect(value().isRefreshingMessages).toBe(false);
    expect(value().messages.map((m) => m.content)).toEqual(["second"]);
    await act(async () => renderer.unmount());
  });

  it("does not let a slow initial hydration replace a newer manual refresh", async () => {
    // Initial hydration and manual refresh share one per-session sequence, so the
    // older read is dropped wholesale instead of rewriting the newer transcript.
    const stale = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
    mocks.list.mockResolvedValueOnce([session("s1", "2026-02-01T00:00:00.000Z")]);
    mocks.getHistory.mockImplementationOnce(() => stale.promise);
    const renderer = await mount();
    expect(value().currentSession?.id).toBe("s1");
    expect(value().messages).toEqual([]);

    mocks.getHistory.mockResolvedValueOnce(history([textEvent("m2", "fresh")]));
    await act(async () => {
      await value().refreshMessages();
    });
    await flush();
    expect(value().messages.map((m) => m.content)).toEqual(["fresh"]);

    stale.resolve(history([textEvent("m1", "stale")]));
    await flush();

    expect(value().messages.map((m) => m.content)).toEqual(["fresh"]);
    expect(value().historyLoadError).toBeNull();
    expect(value().isRefreshingMessages).toBe(false);
    await act(async () => renderer.unmount());
  });

  it("does not let a superseded history failure overwrite a newer success", async () => {
    const stale = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
    mocks.list.mockResolvedValueOnce([session("s1", "2026-02-01T00:00:00.000Z")]);
    mocks.getHistory.mockImplementationOnce(() => stale.promise);
    const renderer = await mount();

    mocks.getHistory.mockResolvedValueOnce(history([textEvent("m2", "fresh")]));
    await act(async () => {
      await value().refreshMessages();
    });
    await flush();
    expect(value().historyLoadError).toBeNull();

    stale.reject(new Error("stale history fetch failed"));
    await flush();

    // The session loaded successfully since; it must not be flagged as failed.
    expect(value().historyLoadError).toBeNull();
    expect(value().messages.map((m) => m.content)).toEqual(["fresh"]);
    expect(value().isRefreshingMessages).toBe(false);
    await act(async () => renderer.unmount());
  });
});

describe("history loading is owned by the session that requested it", () => {
  // The composer shows "loading history" for the conversation ON SCREEN. An
  // outstanding read for a session the user has left owns only its own entry:
  // it neither keeps the newly shown scope busy nor, when it finally answers,
  // clears a scope that is loading something else.
  it.each(["cached-session", "draft"] as const)(
    "leaves the active scope idle when a refresh of another session is still pending (%s)",
    async (target) => {
      mocks.list.mockResolvedValueOnce([
        session("s1", "2026-02-02T00:00:00.000Z"),
        session("s2", "2026-02-01T00:00:00.000Z"),
      ]);
      const renderer = await mount();
      try {
        // Hydrate s2 as well, then come back to s1: re-selecting an already
        // hydrated session issues no new read, so it has nothing to wait for.
        await act(async () => {
          value().selectSession("s2");
        });
        await flush();
        await act(async () => {
          value().selectSession("s1");
        });
        await flush();
        expect(value().currentSession?.id).toBe("s1");
        expect(value().isRefreshingMessages).toBe(false);

        const abandoned = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
        mocks.getHistory.mockImplementationOnce(() => abandoned.promise);
        act(() => {
          void value().refreshMessages();
        });
        await flush();
        expect(value().isRefreshingMessages).toBe(true);

        await act(async () => {
          if (target === "draft") value().startDraftSession();
          else value().selectSession("s2");
        });
        await flush();
        expect(target === "draft" ? value().isDraft : value().currentSession?.id === "s2").toBe(true);
        // Immediately after the switch: the scope on screen has no read of its
        // own, so it is idle even though s1's refresh is still in flight.
        expect(value().isRefreshingMessages).toBe(false);

        abandoned.resolve(history([textEvent("m1", "from s1")]));
        await flush();
        // And s1's late answer leaves the active scope idle too.
        expect(value().isRefreshingMessages).toBe(false);

        if (target !== "draft") {
          // Returning to s1 shows no stale busy state either: its request is done.
          await act(async () => {
            value().selectSession("s1");
          });
          await flush();
          expect(value().isRefreshingMessages).toBe(false);
        }
      } finally {
        await act(async () => renderer.unmount());
      }
    },
  );

  it("keeps a session busy while its own request is still pending after a round trip away", async () => {
    mocks.list.mockResolvedValueOnce([
      session("s1", "2026-02-02T00:00:00.000Z"),
      session("s2", "2026-02-01T00:00:00.000Z"),
    ]);
    const renderer = await mount();
    try {
      await act(async () => {
        value().selectSession("s2");
      });
      await flush();
      await act(async () => {
        value().selectSession("s1");
      });
      await flush();
      expect(value().isRefreshingMessages).toBe(false);

      const pending = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
      mocks.getHistory.mockImplementationOnce(() => pending.promise);
      act(() => {
        void value().refreshMessages();
      });
      await flush();
      expect(value().isRefreshingMessages).toBe(true);

      // Away to s2 (idle there) and back to s1, whose read is still in flight.
      await act(async () => {
        value().selectSession("s2");
      });
      await flush();
      expect(value().isRefreshingMessages).toBe(false);
      await act(async () => {
        value().selectSession("s1");
      });
      await flush();
      expect(value().isRefreshingMessages).toBe(true);

      pending.resolve(history([textEvent("m1", "first")]));
      await flush();
      expect(value().isRefreshingMessages).toBe(false);
      expect(value().messages.map((m) => m.content)).toEqual(["first"]);
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it("stays busy until the newest of two overlapping refreshes finishes", async () => {
    mocks.list.mockResolvedValueOnce([session("s1", "2026-02-01T00:00:00.000Z")]);
    const renderer = await mount();
    try {
      expect(value().currentSession?.id).toBe("s1");
      expect(value().isRefreshingMessages).toBe(false);

      const older = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
      const newer = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
      mocks.getHistory.mockImplementationOnce(() => older.promise);
      act(() => {
        void value().refreshMessages();
      });
      await flush();
      mocks.getHistory.mockImplementationOnce(() => newer.promise);
      act(() => {
        void value().refreshMessages();
      });
      await flush();
      expect(value().isRefreshingMessages).toBe(true);

      // The superseded read answers first: it owns nothing anymore, so it may
      // neither publish its transcript nor end the newer read's loading state.
      older.resolve(history([textEvent("m1", "stale")]));
      await flush();
      expect(value().isRefreshingMessages).toBe(true);
      expect(value().messages).toEqual([]);

      newer.resolve(history([textEvent("m2", "fresh")]));
      await flush();
      expect(value().isRefreshingMessages).toBe(false);
      expect(value().messages.map((m) => m.content)).toEqual(["fresh"]);
      expect(value().historyLoadError).toBeNull();
    } finally {
      await act(async () => renderer.unmount());
    }
  });

  it("releases the pending record when a refresh for an abandoned session fails", async () => {
    mocks.list.mockResolvedValueOnce([
      session("s1", "2026-02-02T00:00:00.000Z"),
      session("s2", "2026-02-01T00:00:00.000Z"),
    ]);
    const renderer = await mount();
    try {
      await act(async () => {
        value().selectSession("s2");
      });
      await flush();
      await act(async () => {
        value().selectSession("s1");
      });
      await flush();

      const failing = deferred<{ events: unknown[]; total: number; truncated: boolean }>();
      mocks.getHistory.mockImplementationOnce(() => failing.promise);
      act(() => {
        void value().refreshMessages();
      });
      await flush();
      expect(value().isRefreshingMessages).toBe(true);

      await act(async () => {
        value().selectSession("s2");
      });
      await flush();
      failing.reject(new Error("s1 refresh failed"));
      await flush();

      // s2 is untouched, and s1 is neither busy nor silently stuck on return.
      expect(value().isRefreshingMessages).toBe(false);
      expect(value().historyLoadError).toBeNull();
      await act(async () => {
        value().selectSession("s1");
      });
      await flush();
      expect(value().isRefreshingMessages).toBe(false);
      expect(value().historyLoadError).toBe("s1 refresh failed");
    } finally {
      await act(async () => renderer.unmount());
    }
  });
});
