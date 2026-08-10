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

  it("honours an explicit per-model reasoning allowlist", async () => {
    const root = await dataRootWith({
      profiles: [{ id: "a", apiKey: "ka", models: ["plain", "think"], reasoningModels: ["think"] }],
    });
    expect((await resolveSessionProvider(root, { modelId: "plain" }))?.reasoningEnabled).toBe(false);
    expect((await resolveSessionProvider(root, { modelId: "think" }))?.reasoningEnabled).toBe(true);
  });

  it("falls back to the profile's first model when the ref's model is gone", async () => {
    const root = await dataRootWith(file);
    const cfg = await resolveSessionProvider(root, { providerId: "a", modelId: "stale" });
    expect(cfg?.modelId).toBe("a1");
  });

  it("falls back to the selected profile when the ref's provider is missing/deleted", async () => {
    const root = await dataRootWith(file);
    const cfg = await resolveSessionProvider(root, { providerId: "gone" });
    expect(cfg?.providerId).toBe("b"); // selectedProfileId
  });

  it("returns undefined when no profiles exist (→ env fallback)", async () => {
    const root = await dataRootWith({ profiles: [] });
    expect(await resolveSessionProvider(root, {})).toBeUndefined();
  });

  it("returns undefined when providers.json is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "bp-prov-empty-"));
    expect(await resolveSessionProvider(root, {})).toBeUndefined();
  });

  it("returns undefined when the chosen profile has no key", async () => {
    const root = await dataRootWith({ profiles: [{ id: "x", apiKey: "", models: ["m"] }] });
    expect(await resolveSessionProvider(root, { providerId: "x" })).toBeUndefined();
  });
});
