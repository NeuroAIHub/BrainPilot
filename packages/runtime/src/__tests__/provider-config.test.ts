import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSessionProvider } from "../provider-config.js";

async function dataRootWith(providers: unknown): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bp-prov-"));
  await mkdir(join(root, "bp_template"), { recursive: true });
  await writeFile(join(root, "bp_template", "providers.json"), JSON.stringify(providers), "utf8");
  return root;
}

describe("resolveSessionProvider", () => {
  const file = {
    profiles: [
      { id: "a", baseUrl: "https://a", apiKey: "ka", models: ["a1", "a2"] },
      { id: "b", baseUrl: "https://b", apiKey: "kb", models: ["b1"] },
    ],
    selectedProfileId: "b",
  };

  it("uses the session's providerId + modelId when valid", async () => {
    const root = await dataRootWith(file);
    const cfg = await resolveSessionProvider(root, { providerId: "a", modelId: "a2" });
    expect(cfg).toMatchObject({ providerId: "a", apiKey: "ka", baseUrl: "https://a", modelId: "a2" });
    expect(cfg?.reasoningEnabled).toBe(true);
  });

  it("carries the provider context window into the session config", async () => {
    const root = await dataRootWith({
      profiles: [
        { id: "long", apiKey: "key", models: ["m"], contextWindow: 1_000_000 },
      ],
    });
    expect(await resolveSessionProvider(root, {})).toMatchObject({ contextWindow: 1_000_000 });
  });

  it("keeps context and reasoning metadata for an environment-backed profile", async () => {
    const previous = process.env.BP_TEST_PROVIDER_KEY;
    process.env.BP_TEST_PROVIDER_KEY = "env-key";
    try {
      const root = await dataRootWith({
        profiles: [{
          id: "environment",
          apiKey: "",
          apiKeyEnv: "BP_TEST_PROVIDER_KEY",
          models: ["plain", "think"],
          contextWindow: 1_000_000,
          reasoningModels: ["think"],
        }],
      });
      expect(await resolveSessionProvider(root, { modelId: "think" })).toMatchObject({
        apiKey: "env-key",
        contextWindow: 1_000_000,
        reasoningEnabled: true,
      });
    } finally {
      if (previous === undefined) delete process.env.BP_TEST_PROVIDER_KEY;
      else process.env.BP_TEST_PROVIDER_KEY = previous;
    }
  });

  it("honours an explicit per-model reasoning allowlist", async () => {
    const root = await dataRootWith({
      profiles: [{ id: "a", apiKey: "ka", models: ["plain", "think"], reasoningModels: ["think"] }],
    });
    expect((await resolveSessionProvider(root, { modelId: "plain" }))?.reasoningEnabled).toBe(false);
    expect((await resolveSessionProvider(root, { modelId: "think" }))?.reasoningEnabled).toBe(true);
  });

  it("keeps the session's model when it is removed from the current choices", async () => {
    const root = await dataRootWith(file);
    const cfg = await resolveSessionProvider(root, { providerId: "a", modelId: "stale" });
    expect(cfg?.modelId).toBe("stale");
  });

  it("rejects a new model that is not configured for the provider", async () => {
    const root = await dataRootWith(file);
    await expect(resolveSessionProvider(
      root,
      { providerId: "a", modelId: "stale" },
      { requireConfiguredModel: true },
    )).rejects.toThrow("model is not configured for provider a: stale");
  });

  it("does not switch providers when the session's provider is missing/deleted", async () => {
    const root = await dataRootWith(file);
    await expect(resolveSessionProvider(root, { providerId: "gone" }))
      .rejects.toThrow("session provider is no longer configured: gone");
  });

  it("returns undefined when no profiles exist (→ env fallback)", async () => {
    const root = await dataRootWith({ profiles: [] });
    expect(await resolveSessionProvider(root, {})).toBeUndefined();
  });

  it("returns undefined when providers.json is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-prov-empty-"));
    expect(await resolveSessionProvider(root, {})).toBeUndefined();
  });

  it("does not fall back when the session's provider loses its credentials", async () => {
    const root = await dataRootWith({ profiles: [{ id: "x", apiKey: "", models: ["m"] }] });
    await expect(resolveSessionProvider(root, { providerId: "x" }))
      .rejects.toThrow("session provider no longer has credentials: x");
  });
});
