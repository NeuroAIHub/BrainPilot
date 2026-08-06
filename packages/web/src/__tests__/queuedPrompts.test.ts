import { describe, expect, it } from "vitest";
import { shouldClearQueuedPrompts } from "../components/chat/PromptComposer";

describe("queued prompt lifecycle", () => {
  it("keeps queued prompts only while the foreground run is active", () => {
    expect(shouldClearQueuedPrompts({ active: true })).toBe(false);
    expect(shouldClearQueuedPrompts({ active: false })).toBe(true);
    expect(shouldClearQueuedPrompts(null)).toBe(true);
  });
});
