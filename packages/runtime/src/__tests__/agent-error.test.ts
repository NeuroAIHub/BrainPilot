import { describe, it, expect } from "vitest";
import { normalizeAgentError } from "../agent-error.js";

describe("normalizeAgentError (#45)", () => {
  const noKeyRaw = [
    "No API key found for the selected model.",
    "",
    "Use /login to log into a provider via OAuth or API key. See:",
    "  /home/u/app/node_modules/@earendil-works/pi-coding-agent/docs/providers.md",
    "  /home/u/app/node_modules/@earendil-works/pi-coding-agent/docs/models.md",
  ].join("\n");

  it("replaces the no-key SDK error with a Settings → Providers message", () => {
    const out = normalizeAgentError(noKeyRaw);
    expect(out).toContain("设置 → Providers");
  });

  it("never leaks /login or node_modules paths for the no-key case", () => {
    const out = normalizeAgentError(noKeyRaw);
    expect(out).not.toMatch(/\/login/i);
    expect(out).not.toMatch(/node_modules/);
  });

  it("does not mention the BP_MOCK test switch", () => {
    const out = normalizeAgentError(noKeyRaw);
    expect(out).not.toMatch(/BP_MOCK/i);
  });

  it("redacts paths/login from other errors while keeping the message", () => {
    const raw =
      "Tool failed: cannot read config.\nUse /login first.\n/srv/app/node_modules/pkg/docs/x.md";
    const out = normalizeAgentError(raw);
    expect(out).toContain("Tool failed: cannot read config.");
    expect(out).not.toMatch(/\/login/i);
    expect(out).not.toMatch(/node_modules/);
  });

  it("leaves a clean error untouched", () => {
    const raw = "Rate limit exceeded, retry in 30s.";
    expect(normalizeAgentError(raw)).toBe(raw);
  });

  it("handles empty input", () => {
    expect(normalizeAgentError("")).toBe("");
  });
});
