import { describe, expect, it } from "vitest";

import { deriveKbGuidedState } from "../components/settings/kbGuidedWorkflow";

describe("guided Knowledge Base workflow (#486)", () => {
  it("starts with PDF upload", () => {
    const state = deriveKbGuidedState({ pdfCount: 0, envReady: false, readyToQuery: false, busy: false, hasError: false });
    expect(state.action).toBe("upload");
    expect(state.steps.files).toBe("active");
  });

  it("moves through setup and build", () => {
    expect(deriveKbGuidedState({ pdfCount: 2, envReady: false, readyToQuery: false, busy: false, hasError: false }).action).toBe("setup");
    expect(deriveKbGuidedState({ pdfCount: 2, envReady: true, readyToQuery: false, busy: false, hasError: false }).action).toBe("build");
  });

  it("marks the workflow ready only when query readiness is true", () => {
    const state = deriveKbGuidedState({ pdfCount: 2, envReady: true, readyToQuery: true, busy: false, hasError: false });
    expect(state.action).toBe("ready");
    expect(state.steps).toMatchObject({ files: "complete", preparing: "complete", ready: "complete" });
  });

  it("surfaces one error branch without losing the recovery action", () => {
    const state = deriveKbGuidedState({ pdfCount: 2, envReady: false, readyToQuery: false, busy: false, hasError: true });
    expect(state.action).toBe("setup");
    expect(state.steps.error).toBe("active");
    expect(state.steps.preparing).toBe("error");
  });
});
