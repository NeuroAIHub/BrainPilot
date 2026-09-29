import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

// #324 follow-up: an unknown or failed conversation list must never render as
// "0 sessions" / "No conversations yet" / "No matching conversations found".
// The package's vitest runs in the `node` env, so markup assertions use
// react-dom/server and interaction uses react-test-renderer (no effects needed
// for SearchDialog, which is why it is only rendered to static markup).

vi.mock("../i18n/useT", () => ({
  useT: () => (k: string, vars?: Record<string, string | number>) =>
    vars ? `${k}:${JSON.stringify(vars)}` : k,
}));

const sessionsMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("../contexts/SessionContext", () => ({
  useSessions: () => sessionsMock.value,
}));

import { SearchDialog } from "../components/search/SearchDialog";
import { SessionList } from "../components/sidebar/SessionList";
import type { Session } from "../contracts/backend";

const session = (id: string, title = `Title ${id}`): Session => ({
  id,
  title,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
});

type ListState = {
  sessions?: Session[];
  isLoading?: boolean;
  listStatus?: "idle" | "loading" | "ready" | "error";
  loadError?: string | null;
  onRetry?: () => void;
};

function listMarkup(state: ListState = {}) {
  return renderToStaticMarkup(
    <SessionList
      sessions={state.sessions ?? []}
      currentId={undefined}
      isLoading={state.isLoading ?? false}
      listStatus={state.listStatus}
      loadError={state.loadError ?? null}
      onRetry={state.onRetry}
      onSelect={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
      onOpenSearch={() => {}}
    />,
  );
}

describe("SessionList load state", () => {
  // The mocked `t` serialises vars as JSON and renderToStaticMarkup escapes the
  // quotes, so assert the escaped payload rather than dropping the count check.
  const countLabel = (count: number) => `sidebar.sessionCount:{&quot;count&quot;:${count}}`;

  it("says loading — not a count or the empty state — while the first read is pending", () => {
    const html = listMarkup({ listStatus: "loading", isLoading: true });
    expect(html).toContain("sidebar.loading");
    expect(html).not.toContain("sidebar.sessionCount");
    expect(html).not.toContain("sidebar.empty");
    expect(html).not.toContain("session-list-error");
  });

  it("treats an idle list as unknown, not as zero conversations", () => {
    // `idle` = the first request hasn't finished, so there is nothing to count.
    const html = listMarkup({ listStatus: "idle" });
    expect(html).toContain("sidebar.loading");
    expect(html).not.toContain("sidebar.sessionCount");
    expect(html).not.toContain("sidebar.empty");
    expect(html).not.toContain("session-list-error");
  });

  it("reports a scoped failure with Retry instead of an empty list", () => {
    const onRetry = vi.fn();
    const html = listMarkup({
      listStatus: "error",
      loadError: "history fetch failed: 500",
      onRetry,
    });
    expect(html).toContain("sidebar.list.unavailable");
    expect(html).toContain("session-list-retry");
    expect(html).toContain("sidebar.list.retry");
    expect(html).not.toContain("sidebar.empty");
    expect(html).not.toContain("sidebar.sessionCount");
    // The raw HTTP text is available, but only as collapsed detail.
    expect(html).toContain("<details>");
    expect(html).toContain("history fetch failed: 500");
  });

  it("reports the failure even when the host has no retry callback", () => {
    const html = listMarkup({ listStatus: "error", loadError: "offline" });
    expect(html).toContain("session-list-error");
    expect(html).toContain("sidebar.list.unavailable");
    expect(html).not.toContain("session-list-retry");
    expect(html).not.toContain("sidebar.empty");
  });

  it("still reports an errored list that came without a detail string", () => {
    // `listStatus` alone is authoritative: no detail must not degrade to "0".
    const html = listMarkup({ listStatus: "error", onRetry: vi.fn() });
    expect(html).toContain("session-list-error");
    expect(html).toContain("sidebar.list.unavailable");
    expect(html).toContain("session-list-retry");
    expect(html).not.toContain("sidebar.empty");
    expect(html).not.toContain("sidebar.sessionCount");
    expect(html).not.toContain("<details>");
  });

  it("keeps cached rows usable and marks the refresh failure", () => {
    const html = listMarkup({
      sessions: [session("a"), session("b")],
      listStatus: "error",
      loadError: "network blip",
    });
    expect(html).toContain("sidebar.list.refreshFailed");
    expect(html).not.toContain("sidebar.list.unavailable");
    expect(html).toContain(countLabel(2));
    expect(html).toContain("Title a");
    expect(html).toContain("Title b");
  });

  it("keeps cached rows and the refresh notice without a detail string", () => {
    const html = listMarkup({
      sessions: [session("a"), session("b")],
      listStatus: "error",
    });
    expect(html).toContain("sidebar.list.refreshFailed");
    expect(html).toContain(countLabel(2));
    expect(html).toContain("Title a");
  });

  it("still shows the real empty state once the list is genuinely empty", () => {
    const html = listMarkup({ listStatus: "ready" });
    expect(html).toContain("sidebar.empty");
    expect(html).toContain(countLabel(0));
    expect(html).not.toContain("session-list-error");
  });

  it("keeps the legacy isLoading-only contract for hosts without listStatus", () => {
    expect(listMarkup({ isLoading: true })).toContain("sidebar.loading");
    const settled = listMarkup({ sessions: [session("a")] });
    expect(settled).toContain(countLabel(1));
    expect(settled).not.toContain("session-list-error");
  });

  it("keeps the Retry mounted and busy while the retry request runs", () => {
    const onRetry = vi.fn();
    const props = (listStatus: ListState["listStatus"], loadError: string | null) => (
      <SessionList
        sessions={[]}
        currentId={undefined}
        isLoading={listStatus === "loading"}
        listStatus={listStatus}
        loadError={loadError}
        onRetry={onRetry}
        onSelect={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        onOpenSearch={() => {}}
      />
    );
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(props("error", "offline"));
    });
    const retry = () =>
      renderer.root.findAll((node) => node.props?.["data-testid"] === "session-list-retry")[0];

    expect(retry().props["aria-disabled"]).toBe(false);
    act(() => {
      retry().props.onClick();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);

    // In-flight: the error is deliberately still set, so the button stays mounted
    // (focus is not lost) and reports itself busy.
    act(() => {
      renderer.update(props("loading", "offline"));
    });
    expect(retry().props["aria-disabled"]).toBe(true);
    act(() => retry().props.onClick());
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(retry().props["aria-busy"]).toBe(true);

    // Success clears the list's own error: notice gone, count back.
    act(() => {
      renderer.update(props("ready", null));
    });
    expect(
      renderer.root.findAll((node) => node.props?.["data-testid"] === "session-list-error"),
    ).toHaveLength(0);
    act(() => renderer.unmount());
  });
});

function searchMarkup(state: Record<string, unknown>) {
  sessionsMock.value = {
    sessions: [],
    selectSession: () => {},
    refreshSessions: async () => {},
    sessionsListStatus: "ready",
    sessionsListError: null,
    ...state,
  };
  return renderToStaticMarkup(
    <SearchDialog isOpen onClose={() => {}} onOpenWorkspace={() => {}} />,
  );
}

describe("SearchDialog load state", () => {
  it("says loading rather than 'no matching conversations' while the list is pending", () => {
    const html = searchMarkup({ sessionsListStatus: "loading" });
    expect(html).toContain("search.loading");
    expect(html).not.toContain("search.empty");
  });

  it("treats an idle list as unknown rather than as no matches", () => {
    const html = searchMarkup({ sessionsListStatus: "idle" });
    expect(html).toContain("search.loading");
    expect(html).not.toContain("search.empty");
    expect(html).not.toContain("search-list-error");
  });

  it("reports the failure with Retry and does not claim zero matches", () => {
    const html = searchMarkup({
      sessionsListStatus: "error",
      sessionsListError: "Request failed (500)",
    });
    expect(html).toContain("search.loadFailed");
    expect(html).toContain("search-list-retry");
    expect(html).not.toContain("search.empty");
    expect(html).toContain("Request failed (500)");
  });

  it("reports an errored list that came without a detail string", () => {
    const html = searchMarkup({ sessionsListStatus: "error", sessionsListError: null });
    expect(html).toContain("search-list-error");
    expect(html).toContain("search.loadFailed");
    expect(html).toContain("search-list-retry");
    expect(html).not.toContain("search.empty");
    expect(html).not.toContain("<details>");
  });

  it("keeps cached results searchable and marks the refresh failure", () => {
    const html = searchMarkup({
      sessions: [session("a", "Ion channel review")],
      sessionsListStatus: "error",
      sessionsListError: "network blip",
    });
    expect(html).toContain("Ion channel review");
    expect(html).toContain("search.refreshFailed");
    expect(html).not.toContain("search.loadFailed");
    expect(html).not.toContain("search.empty");
  });

  it("still shows the real no-matches state for a healthy empty list", () => {
    const html = searchMarkup({ sessionsListStatus: "ready" });
    expect(html).toContain("search.empty");
    expect(html).not.toContain("search-list-error");
  });
});
