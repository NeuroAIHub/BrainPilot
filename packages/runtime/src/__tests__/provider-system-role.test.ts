import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionModel } from "../pi-provider.js";

// pi-coding-agent may nest its pinned pi-ai dependency instead of hoisting it.
function completionsPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dirname(dir) !== dir) {
    for (const prefix of ["@earendil-works/pi-coding-agent/node_modules", ""]) {
      const path = join(dir, "node_modules", prefix,
        "@earendil-works/pi-ai/dist/api/openai-completions.js");
      if (existsSync(path)) return path;
    }
    dir = dirname(dir);
  }
  throw new Error("Could not locate the installed pi-ai Chat Completions transport");
}

const { stream } = await import(pathToFileURL(completionsPath()).href);

describe("custom provider system role (#549)", () => {
  let agentDir: string;
  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "bp-system-role-"));
    // Request inspection must never contact a real provider.
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(agentDir, { recursive: true, force: true });
  });

  it.each([
    ["https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "openai-completions", "system"],
    ["https://unknown-gateway.example/v1", "openai-completions", "system"],
    ["https://unknown-gateway.example/v1", undefined, "system"],
    ["https://api.openai.com/v1", "openai-completions", "developer"],
    ["https://api.openai.com.proxy.example/v1", "openai-completions", "system"],
  ])("sends the correct role for %s (api=%s), retaining reasoning", async (baseUrl, api, role) => {
    const { model } = await resolveSessionModel({ ModelRuntime }, agentDir, {
      providerId: "custom",
      modelId: "deepseek-v4-flash-0731",
      baseUrl,
      api,
      adapter: "openai",
      apiKey: "fake-test-key",
      reasoningEnabled: true,
    });
    expect(model).toMatchObject({ reasoning: true });
    const onPayload = vi.fn((_payload: unknown) => { throw new Error("STOP_BEFORE_NETWORK"); });
    await stream(model, {
      systemPrompt: "You are a helpful research assistant.",
      messages: [{ role: "user", content: "Hello", timestamp: 0 }],
    }, { apiKey: "fake-test-key", reasoningEffort: "medium", onPayload }).result();
    expect(onPayload).toHaveBeenCalledOnce();
    expect(onPayload.mock.calls[0]?.[0]).toMatchObject({
      messages: [
        { role, content: "You are a helpful research assistant." },
        { role: "user", content: "Hello" },
      ],
      reasoning_effort: "medium",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["anthropic-messages", "openai-responses", "azure-openai-responses"])(
    "does not add Chat Completions compatibility overrides to %s", async (api) => {
      await resolveSessionModel({ ModelRuntime }, agentDir, {
        providerId: "custom", modelId: "test-model", api,
        baseUrl: "https://gateway.example/v1", apiKey: "fake-test-key",
      });
      const cfg = JSON.parse(readFileSync(join(agentDir, "bp-session-custom-models.json"), "utf8"));
      expect(cfg.providers.custom.models[0].compat).toBeUndefined();
    },
  );
});
