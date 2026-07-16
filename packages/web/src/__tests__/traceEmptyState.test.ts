import { describe, it, expect } from "vitest";
import {
  resolveTraceGraphEmpty,
  traceControlsEffective,
  layoutToggleState,
  traceEmptyLabelKey,
} from "../components/session/traceEmptyState";

describe("resolveTraceGraphEmpty (#317)", () => {
  it("reports no-nodes when total is zero (0/0)", () => {
    expect(resolveTraceGraphEmpty(0, 0)).toBe("no-nodes");
  });

  it("never claims filter mismatch when total is zero even if visible is weird", () => {
    // Defensive: total is the authority for corpus emptiness.
    expect(resolveTraceGraphEmpty(0, 5)).toBe("no-nodes");
  });

  it("reports filtered-out when corpus has nodes but none are visible", () => {
    expect(resolveTraceGraphEmpty(3, 0)).toBe("filtered-out");
  });

  it("returns null for a normal non-empty graph", () => {
    expect(resolveTraceGraphEmpty(4, 2)).toBe(null);
    expect(resolveTraceGraphEmpty(1, 1)).toBe(null);
  });
});

describe("traceControlsEffective", () => {
  it("is false when there are no nodes", () => {
    expect(traceControlsEffective(0)).toBe(false);
  });

  it("is true when the corpus is non-empty", () => {
    expect(traceControlsEffective(1)).toBe(true);
  });
});

describe("layoutToggleState", () => {
  it("exposes aria-pressed semantics for the active direction", () => {
    expect(layoutToggleState("LR", true)).toEqual({
      lr: { pressed: true, disabled: false },
      tb: { pressed: false, disabled: false },
    });
    expect(layoutToggleState("TB", true)).toEqual({
      lr: { pressed: false, disabled: false },
      tb: { pressed: true, disabled: false },
    });
  });

  it("disables both directions when controls are ineffective", () => {
    expect(layoutToggleState("LR", false)).toEqual({
      lr: { pressed: true, disabled: true },
      tb: { pressed: false, disabled: true },
    });
  });
});

describe("traceEmptyLabelKey", () => {
  it("maps reasons to i18n keys", () => {
    expect(traceEmptyLabelKey("no-nodes")).toBe("trace.emptyNoNodes");
    expect(traceEmptyLabelKey("filtered-out")).toBe("trace.noMatch");
    expect(traceEmptyLabelKey(null)).toBe(null);
  });
});
