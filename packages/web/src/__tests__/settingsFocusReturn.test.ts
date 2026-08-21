import { describe, expect, it, vi } from "vitest";
import { restoreFocusAfterModalClose } from "../components/settings/settingsFocusReturn";

function fakeElement(overrides: {
  connected?: boolean;
  inertAncestor?: boolean;
  focus?: () => void;
} = {}) {
  return {
    isConnected: overrides.connected ?? true,
    closest: vi.fn(() => overrides.inertAncestor ? ({}) : null),
    focus: vi.fn(overrides.focus),
  } as unknown as HTMLElement;
}

describe("Settings focus return (#501)", () => {
  it("waits for the supplied post-close scheduler before focusing the opener", () => {
    const opener = fakeElement();
    let scheduled: (() => void) | undefined;

    restoreFocusAfterModalClose(opener, (callback) => { scheduled = callback; });
    expect(opener.focus).not.toHaveBeenCalled();

    scheduled?.();
    expect(opener.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("does not focus an opener that was removed or is still inert", () => {
    const removed = fakeElement({ connected: false });
    const inert = fakeElement({ inertAncestor: true });

    restoreFocusAfterModalClose(removed, (callback) => callback());
    restoreFocusAfterModalClose(inert, (callback) => callback());

    expect(removed.focus).not.toHaveBeenCalled();
    expect(inert.focus).not.toHaveBeenCalled();
  });

  it("does not turn a stale opener into a close failure", () => {
    const opener = fakeElement({ focus: () => { throw new Error("detached"); } });
    expect(() => restoreFocusAfterModalClose(opener, (callback) => callback())).not.toThrow();
  });
});
