import { describe, expect, it } from "vitest";
import { resolveComposerReasoningSupport } from "../components/chat/PromptComposer";

describe("composer reasoning support", () => {
  it("keeps an existing session enabled after the global provider switches", () => {
    expect(resolveComposerReasoningSupport({
      isDraft: false,
      sessionReasoningSupported: true,
      selectedModel: "plain-model",
      activeProviderModels: ["plain-model"],
      activeProviderReasoningModels: [],
    })).toBe(true);
  });

  it("keeps an existing session disabled when the global provider supports reasoning", () => {
    expect(resolveComposerReasoningSupport({
      isDraft: false,
      sessionReasoningSupported: false,
      selectedModel: "thinking-model",
      activeProviderModels: ["thinking-model"],
      activeProviderReasoningModels: ["thinking-model"],
    })).toBe(false);
  });

  it("uses the current provider only while composing a draft session", () => {
    expect(resolveComposerReasoningSupport({
      isDraft: true,
      sessionReasoningSupported: false,
      selectedModel: "thinking-model",
      activeProviderModels: ["thinking-model"],
      activeProviderReasoningModels: ["thinking-model"],
    })).toBe(true);
  });
});
