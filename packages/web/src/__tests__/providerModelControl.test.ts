import { describe, expect, it, vi } from "vitest";
import {
  focusProviderModelPopup,
  restoreProviderModelFocus,
} from "../components/chat/ProviderModelControl";

describe("ProviderModelControl focus management", () => {
  it("focuses the selected available model first", () => {
    const selected = { focus: vi.fn() };
    const popup = {
      focus: vi.fn(),
      querySelector: vi.fn((selector: string) => selector.includes('aria-pressed="true"') ? selected : null),
    } as unknown as HTMLElement;

    focusProviderModelPopup(popup);

    expect(selected.focus).toHaveBeenCalledOnce();
    expect(popup.focus).not.toHaveBeenCalled();
  });

  it("restores focus only while the trigger is still mounted", () => {
    const mounted = { focus: vi.fn(), isConnected: true } as unknown as HTMLElement;
    const removed = { focus: vi.fn(), isConnected: false } as unknown as HTMLElement;

    restoreProviderModelFocus(mounted);
    restoreProviderModelFocus(removed);

    expect(mounted.focus).toHaveBeenCalledOnce();
    expect(removed.focus).not.toHaveBeenCalled();
  });
});
