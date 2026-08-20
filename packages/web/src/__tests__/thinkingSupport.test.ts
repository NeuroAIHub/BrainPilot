import { describe, expect, it } from "vitest";
import { mergeProviderHealth, resolveComposerReasoningSupport } from "../components/chat/PromptComposer";
import { selectedModelSupportsReasoning } from "../components/chat/ProviderModelControl";
import type { ProviderProfile } from "../contracts/backend";

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

  it("checks reasoning support per provider/model pair", () => {
    expect(selectedModelSupportsReasoning({
      models: ["plain", "reasoning"],
      reasoningModels: ["reasoning"],
    }, "plain")).toBe(false);
    expect(selectedModelSupportsReasoning({
      models: ["plain", "reasoning"],
      reasoningModels: ["reasoning"],
    }, "reasoning")).toBe(true);
  });

  it("merges health without losing provider/model metadata", () => {
    const profile = {
      id: "p1",
      name: "Provider",
      models: ["m1"],
      reasoningModels: ["m1"],
      healthStatus: "unknown",
      modelHealth: [],
    } as unknown as ProviderProfile;
    const health = {
      ...profile,
      healthStatus: "healthy",
      modelHealth: [{ model: "m1", status: "healthy" }],
    } as ProviderProfile;
    expect(mergeProviderHealth([profile], [health])[0]).toMatchObject({
      id: "p1",
      models: ["m1"],
      reasoningModels: ["m1"],
      healthStatus: "healthy",
      modelHealth: [{ model: "m1", status: "healthy" }],
    });
  });
});
