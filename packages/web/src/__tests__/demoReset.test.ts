import { describe, expect, it } from "vitest";
import { shouldResetDemo } from "../components/demo/demoReset";

describe("shouldResetDemo (#111 sidebar re-click returns to landing)", () => {
  it("does not reset on the initial mount (same value)", () => {
    // prev === next on first render — packing/importing a bundle must survive.
    expect(shouldResetDemo(0, 0)).toBe(false);
    expect(shouldResetDemo(3, 3)).toBe(false);
  });

  it("resets when the signal advances (sidebar clicked again)", () => {
    expect(shouldResetDemo(0, 1)).toBe(true);
    expect(shouldResetDemo(1, 2)).toBe(true);
  });

  it("treats an undefined signal (standalone mount) as no reset", () => {
    // DemoView mounted without the prop: prev and next are both undefined.
    expect(shouldResetDemo(undefined, undefined)).toBe(false);
  });

  it("resets when transitioning from undefined to a number", () => {
    expect(shouldResetDemo(undefined, 1)).toBe(true);
  });
});
