import { afterEach, describe, expect, it, vi } from "vitest";
import { navigateWorkspace, updateMarketplaceLocation, workspacePage, writeWorkspaceLocation } from "../components/shell/workspaceNavigation";

afterEach(() => vi.unstubAllGlobals());

function browser(href = "http://brainpilot.test/") {
  const saved = new Map<string, string>();
  const entries = [href];
  const win = Object.assign(new EventTarget(), {
    location: new URL(href),
    history: {
      state: { retained: true },
      pushState: vi.fn((_state, _title, url) => { win.location = new URL(url); entries.push(win.location.href); }),
      replaceState: vi.fn((_state, _title, url) => { win.location = new URL(url); entries[entries.length - 1] = win.location.href; }),
    },
  });
  vi.stubGlobal("window", win);
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  return { win, entries };
}

describe("workspace navigation", () => {
  it("makes a selected dataset shareable and preserves a list entry for Back", () => {
    const { win, entries } = browser();
    navigateWorkspace("plugins");
    updateMarketplaceLocation({ category: "datasets", q: "抑郁", topic: "clinical" });
    const list = win.location.href;
    updateMarketplaceLocation({ dataset: "openneuro-ds000171", scope: "first-participant" }, false);
    expect(entries.at(-2)).toBe(list);
    expect(workspacePage(win.location)).toBe("plugins");
    expect(win.location.searchParams.get("q")).toBe("抑郁");
    expect(win.location.searchParams.get("dataset")).toBe("openneuro-ds000171");
    navigateWorkspace("workspace");
    expect(workspacePage(win.location)).toBe("workspace");
    navigateWorkspace("plugins");
    expect(win.location.searchParams.get("scope")).toBe("first-participant");
    expect(win.location.searchParams.get("dataset")).toBe("openneuro-ds000171");
  });

  it("does not leave file routes or line hashes on a marketplace link", () => {
    const { win } = browser("http://brainpilot.test/sessions/s1/files?path=%2Fdata%2Fa.csv#L8");
    updateMarketplaceLocation({ category: "knowledge" });
    expect(win.location.pathname).not.toContain("/sessions/");
    expect(win.location.searchParams.has("path")).toBe(false);
    expect(win.location.hash).toBe("");
    const before = win.location.href;
    writeWorkspaceLocation("https://elsewhere.test/");
    expect(win.location.href).toBe(before);
    expect(win.history.state).toEqual({ retained: true });
  });
});
