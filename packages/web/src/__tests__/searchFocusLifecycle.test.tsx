import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({
  sessions: [],
  selectSession: vi.fn(),
  refreshSessions: vi.fn(async () => {}),
  sessionsListStatus: "error",
  sessionsListError: "offline",
}));
vi.mock("../contexts/SessionContext", () => ({ useSessions: () => context }));
vi.mock("../i18n/useT", () => ({ useT: () => (key: string) => key }));
import { SearchDialog } from "../components/search/SearchDialog";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SearchDialog focus lifecycle", () => {
  it("does not refocus the input when a retry or a parent callback changes", () => {
    vi.useFakeTimers();
    const inputFocus = vi.fn();
    const returnFocus = vi.fn();
    class FocusTarget { isConnected = true; focus = returnFocus; }
    vi.stubGlobal("HTMLElement", FocusTarget);
    vi.stubGlobal("document", { activeElement: new FocusTarget() });
    vi.stubGlobal("window", {
      setTimeout, clearTimeout,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    });
    let renderer!: ReactTestRenderer;
    const view = () => <SearchDialog isOpen onClose={() => {}} onOpenWorkspace={() => {}} />;
    act(() => {
      renderer = create(view(), { createNodeMock: (node) => node.type === "input" ? { focus: inputFocus } : {} });
    });
    act(() => { vi.runAllTimers(); });
    expect(inputFocus).toHaveBeenCalledTimes(1);
    const retry = () => renderer.root.findByProps({ "data-testid": "search-list-retry" });
    act(() => retry().props.onClick());
    expect(context.refreshSessions).toHaveBeenCalledTimes(1);
    context.sessionsListStatus = "loading";
    act(() => renderer.update(view()));
    act(() => { vi.runAllTimers(); });
    expect(inputFocus).toHaveBeenCalledTimes(1);
    expect(returnFocus).not.toHaveBeenCalled();
    expect(retry().props["aria-disabled"]).toBe(true);
    expect(retry().props.disabled).toBeUndefined(); // Busy control remains focusable.
    act(() => retry().props.onClick());
    expect(context.refreshSessions).toHaveBeenCalledTimes(1);
    context.sessionsListStatus = "error";
    act(() => renderer.update(view()));
    act(() => { vi.runAllTimers(); });
    expect(inputFocus).toHaveBeenCalledTimes(1);
    expect(retry().props["aria-disabled"]).toBe(false);
    act(() => renderer.unmount());
    expect(returnFocus).toHaveBeenCalledTimes(1);
  });
});
