import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveProvider,
  writeLocalSettings,
  bootstrapEnvProvider,
  migrateLegacySettings,
  parseDotenv,
  describeProviderConfig,
  formatProviderGuidance,
  createProfile,
  updateProfile,
  deleteProfile,
  setSelectedProfile,
  selectedProfile,
  readProviders,
} from "../src/config.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "bp-prio-"));
}

describe("provider/key priority (bp_template > config > env > .env)", () => {
  it("bp_template wins over env and all other layers", async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(path.join(dir, "bp_template", "settings.json"), JSON.stringify({ apiKey: "tmpl" }));
    await writeFile(path.join(dir, "brainpilot.config.json"), JSON.stringify({ apiKey: "cfg" }));
    await writeFile(path.join(dir, ".env"), "ANTHROPIC_API_KEY=dotenv");
    const r = await resolveProvider({ dataDir: dir, env: { ANTHROPIC_API_KEY: "envkey" } });
    expect(r.apiKey).toBe("tmpl");
    expect(r.source).toBe("bp_template");
  });

  it("env wins over .env when file layers absent", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, ".env"), "ANTHROPIC_API_KEY=dotenv");
    const r = await resolveProvider({ dataDir: dir, env: { ANTHROPIC_API_KEY: "envkey" } });
    expect(r.apiKey).toBe("envkey");
    expect(r.source).toBe("env");
  });

  it("bp_template wins over config and .env when env is absent", async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(path.join(dir, "bp_template", "settings.json"), JSON.stringify({ apiKey: "tmpl" }));
    await writeFile(path.join(dir, "brainpilot.config.json"), JSON.stringify({ apiKey: "cfg" }));
    await writeFile(path.join(dir, ".env"), "ANTHROPIC_API_KEY=dotenv");
    const r = await resolveProvider({ dataDir: dir, env: {} });
    expect(r.apiKey).toBe("tmpl");
    expect(r.source).toBe("bp_template");
  });

  it("brainpilot.config.json wins over .env when higher layers absent", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, "brainpilot.config.json"), JSON.stringify({ apiKey: "cfg" }));
    await writeFile(path.join(dir, ".env"), "ANTHROPIC_API_KEY=dotenv");
    const r = await resolveProvider({ dataDir: dir, env: {} });
    expect(r.apiKey).toBe("cfg");
    expect(r.source).toBe("config");
  });

  it("falls back to .env when it is the only source", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, ".env"), "ANTHROPIC_API_KEY=dotenv");
    const r = await resolveProvider({ dataDir: dir, env: {} });
    expect(r.apiKey).toBe("dotenv");
    expect(r.source).toBe("dotenv");
  });

  it("returns undefined apiKey when no layer supplies one", async () => {
    const dir = await tmp();
    const r = await resolveProvider({ dataDir: dir, env: {} });
    expect(r.apiKey).toBeUndefined();
    expect(r.source).toBeUndefined();
  });
});

describe("parseDotenv", () => {
  it("parses KEY=VALUE, ignores comments/blank, strips quotes", async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, ".env"), "# c\n\nFOO=bar\nQ=\"quoted\"\nSP = spaced \n");
    const parsed = await parseDotenv(path.join(dir, ".env"));
    expect(parsed.FOO).toBe("bar");
    expect(parsed.Q).toBe("quoted");
    expect(parsed.SP).toBe("spaced");
  });
  it("returns {} for a missing file", async () => {
    expect(await parseDotenv("/nope/.env")).toEqual({});
  });
});

describe("describeProviderConfig", () => {
  it("reports hasKey + source when key comes from bp_template", async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(
      path.join(dir, "bp_template", "settings.json"),
      JSON.stringify({ apiKey: "sk-secret", baseUrl: "https://gw", model: "m1" }),
    );
    const r = await describeProviderConfig({ dataDir: dir, env: {} });
    expect(r.hasKey).toBe(true);
    expect(r.source).toBe("bp_template");
    expect(r.baseUrl).toBe("https://gw");
    expect(r.model).toBe("m1");
    expect(r.settingsPath).toBe(path.join(dir, "bp_template", "providers.json"));
    expect(r.dotenvPath).toBe(path.join(dir, ".env"));
  });

  it("reports source 'env' when key comes from the environment", async () => {
    const dir = await tmp();
    const r = await describeProviderConfig({
      dataDir: dir,
      env: { ANTHROPIC_API_KEY: "envkey" },
    });
    expect(r.hasKey).toBe(true);
    expect(r.source).toBe("env");
  });

  it("reports hasKey:false when no layer supplies a key", async () => {
    const dir = await tmp();
    const r = await describeProviderConfig({ dataDir: dir, env: {} });
    expect(r.hasKey).toBe(false);
    expect(r.source).toBeUndefined();
  });

  it("never leaks the plaintext key in the report", async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(
      path.join(dir, "bp_template", "settings.json"),
      JSON.stringify({ apiKey: "sk-secret" }),
    );
    const r = await describeProviderConfig({ dataDir: dir, env: {} });
    expect(JSON.stringify(r)).not.toContain("sk-secret");
  });
});

describe("formatProviderGuidance", () => {
  it("unconfigured: lists providers file, env, init, settings UI, and BP_MOCK", () => {
    const lines = formatProviderGuidance({
      hasKey: false,
      settingsPath: "/data/bp_template/providers.json",
      dotenvPath: "/data/.env",
    });
    const text = lines.join("\n");
    expect(text).toContain("/data/bp_template/providers.json");
    expect(text).toContain("ANTHROPIC_API_KEY");
    expect(text).toContain("--base-url");
    expect(text.toLowerCase()).toContain("settings"); // UI hint
    expect(text).toContain("BP_MOCK=1");
  });

  it("configured: shows a confirmation with the source", () => {
    const lines = formatProviderGuidance({
      hasKey: true,
      source: "bp_template",
      baseUrl: "https://gw",
      model: "m1",
      settingsPath: "/data/bp_template/settings.json",
      dotenvPath: "/data/.env",
    });
    const text = lines.join("\n");
    expect(text).toContain("bp_template");
    expect(text).toContain("m1");
    expect(text).toContain("https://gw");
  });
});

describe("writeLocalSettings", () => {
  it("creates then updates the selected profile in providers.json", async () => {
    const dir = await tmp();
    await writeLocalSettings(dir, {
      model: "m1",
      apiKey: "sk-1",
      baseUrl: "u1",
      api: "openai-responses",
    });
    await writeLocalSettings(dir, { model: "m2" }); // update: keep apiKey/baseUrl
    const raw = JSON.parse(
      await readFile(path.join(dir, "bp_template", "providers.json"), "utf8"),
    );
    expect(raw.profiles).toHaveLength(1);
    const p = raw.profiles[0];
    expect(p.apiKey).toBe("sk-1");
    expect(p.baseUrl).toBe("u1");
    expect(p.api).toBe("openai-responses");
    // newest model is the default (front of the model list)
    expect(p.models[0]).toBe("m2");
    expect(p.models).toContain("m1");
    expect(raw.selectedProfileId).toBe(p.id);
  });

  it("keeps per-model reasoning support when changing the default model", async () => {
    const dir = await tmp();
    const profile = await createProfile(dir, {
      name: "Mixed",
      baseUrl: "u",
      apiKey: "sk",
      models: ["reasoning", "plain"],
      reasoningModels: ["reasoning"],
    });
    await writeLocalSettings(dir, { model: "plain" });
    const stored = (await readProviders(dir)).profiles.find((item) => item.id === profile.id);
    expect(stored?.models[0]).toBe("plain");
    expect(stored?.reasoningModels).toEqual(["reasoning"]);
  });
});

describe("providers registry (CRUD + selection)", () => {
  it("creates, updates (keeping key when omitted), deletes, and reselects", async () => {
    const dir = await tmp();
    const a = await createProfile(dir, { name: "A", baseUrl: "ua", apiKey: "ka", models: ["ma"] });
    const b = await createProfile(dir, { name: "B", baseUrl: "ub", apiKey: "kb", models: ["mb"] });

    // first profile is auto-selected
    expect((await readProviders(dir)).selectedProfileId).toBe(a.id);

    // update without apiKey keeps the existing key
    const updated = await updateProfile(dir, a.id, { name: "A2" });
    expect(updated?.name).toBe("A2");
    expect(updated?.apiKey).toBe("ka");

    // switch selection
    expect(await setSelectedProfile(dir, b.id)).toBe(true);
    expect((await selectedProfile(dir))?.id).toBe(b.id);

    // delete selected → selection falls back to a remaining profile
    expect(await deleteProfile(dir, b.id)).toBe(true);
    const after = await readProviders(dir);
    expect(after.profiles.map((p) => p.id)).toEqual([a.id]);
    expect(after.selectedProfileId).toBe(a.id);
  });

  it("resolveProvider prefers the selected profile over env", async () => {
    const dir = await tmp();
    await createProfile(dir, { name: "Gw", baseUrl: "https://gw", apiKey: "sk-profile", models: ["m1"] });
    const resolved = await resolveProvider({ dataDir: dir, env: { ANTHROPIC_API_KEY: "sk-env" } });
    expect(resolved.apiKey).toBe("sk-profile");
    expect(resolved.baseUrl).toBe("https://gw");
    expect(resolved.model).toBe("m1");
  });

  it("resolveProvider falls back to env when no profile has a key", async () => {
    const dir = await tmp();
    const resolved = await resolveProvider({ dataDir: dir, env: { ANTHROPIC_API_KEY: "sk-env" } });
    expect(resolved.apiKey).toBe("sk-env");
  });
});

describe("migrateLegacySettings (#202)", () => {
  it("folds a legacy plaintext-key settings.json into a selected profile and strips the key", async () => {
    const dir = await tmp();
    const legacyPath = path.join(dir, "bp_template", "settings.json");
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({ apiKey: "sk-legacy", baseUrl: "https://old", model: "m-old", logLevel: "info" }),
      { mode: 0o644 },
    );

    const profile = await migrateLegacySettings(dir);
    expect(profile).not.toBeNull();
    expect(profile?.apiKey).toBe("sk-legacy");
    expect(profile?.baseUrl).toBe("https://old");
    expect(profile?.models).toContain("m-old");

    // providers.json now holds the key and is selected
    const { profiles, selectedProfileId } = await readProviders(dir);
    expect(profiles).toHaveLength(1);
    expect(selectedProfileId).toBe(profile?.id);

    // the plaintext key is gone from settings.json, other fields kept
    const legacy = JSON.parse(await readFile(legacyPath, "utf8"));
    expect(legacy.apiKey).toBeUndefined();
    expect(legacy.logLevel).toBe("info");

    // settings.json tightened to 0600 (POSIX only)
    if (process.platform !== "win32") {
      const { stat } = await import("node:fs/promises");
      expect((await stat(legacyPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("migrates a nested provider.apiKey shape too", async () => {
    const dir = await tmp();
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(
      path.join(dir, "bp_template", "settings.json"),
      JSON.stringify({ provider: { apiKey: "sk-nested", baseUrl: "https://n", model: "mn" } }),
    );
    const profile = await migrateLegacySettings(dir);
    expect(profile?.apiKey).toBe("sk-nested");
    expect(profile?.baseUrl).toBe("https://n");
    const legacy = JSON.parse(
      await readFile(path.join(dir, "bp_template", "settings.json"), "utf8"),
    );
    expect(legacy.provider.apiKey).toBeUndefined();
  });

  it("is a no-op when providers.json already has a profile", async () => {
    const dir = await tmp();
    await createProfile(dir, { name: "Existing", apiKey: "sk-keep", models: ["m"] });
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(
      path.join(dir, "bp_template", "settings.json"),
      JSON.stringify({ apiKey: "sk-legacy" }),
    );
    expect(await migrateLegacySettings(dir)).toBeNull();
    const { profiles } = await readProviders(dir);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Existing");
    // legacy file untouched
    const legacy = JSON.parse(
      await readFile(path.join(dir, "bp_template", "settings.json"), "utf8"),
    );
    expect(legacy.apiKey).toBe("sk-legacy");
  });

  it("is a no-op when there's no legacy key to migrate", async () => {
    const dir = await tmp();
    expect(await migrateLegacySettings(dir)).toBeNull();
    // legacy file without a key → still no-op
    await mkdir(path.join(dir, "bp_template"), { recursive: true });
    await writeFile(
      path.join(dir, "bp_template", "settings.json"),
      JSON.stringify({ model: "m-only" }),
    );
    expect(await migrateLegacySettings(dir)).toBeNull();
    expect((await readProviders(dir)).profiles).toHaveLength(0);
  });
});

// #51: ANTHROPIC_MODEL must be honored wherever ANTHROPIC_BASE_URL is, and an
// env-only launch must surface a real selected provider profile.
describe("#51 env model resolution", () => {
  it("honors ANTHROPIC_MODEL", async () => {
    const dir = await tmp();
    const r = await resolveProvider({
      dataDir: dir,
      env: { ANTHROPIC_API_KEY: "sk", ANTHROPIC_BASE_URL: "https://gw", ANTHROPIC_MODEL: "env-anthropic-model" },
    });
    expect(r.model).toBe("env-anthropic-model");
  });

  it("BP_MODEL takes priority over ANTHROPIC_MODEL", async () => {
    const dir = await tmp();
    const r = await resolveProvider({
      dataDir: dir,
      env: { ANTHROPIC_API_KEY: "sk", BP_MODEL: "bp-m", ANTHROPIC_MODEL: "anthropic-m" },
    });
    expect(r.model).toBe("bp-m");
  });
});

describe("#51 bootstrapEnvProvider", () => {
  it("creates a selected Environment profile from env on first launch", async () => {
    const dir = await tmp();
    const created = await bootstrapEnvProvider(dir, {
      ANTHROPIC_API_KEY: "sk-env-test",
      ANTHROPIC_BASE_URL: "https://gateway.example.com/api",
      ANTHROPIC_MODEL: "env-anthropic-model",
    });
    expect(created).not.toBeNull();
    const { profiles, selectedProfileId } = await readProviders(dir);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Environment");
    expect(profiles[0].baseUrl).toBe("https://gateway.example.com/api");
    expect(profiles[0].models).toEqual(["env-anthropic-model"]);
    expect(selectedProfileId).toBe(profiles[0].id);
  });

  // #65: the plaintext env key must never be copied into providers.json. The
  // profile records only the env var *name* (apiKeyEnv) with an empty apiKey;
  // the runtime falls back to its env gateway path at request time.
  it("does not persist the plaintext env key (records apiKeyEnv instead)", async () => {
    const dir = await tmp();
    await bootstrapEnvProvider(dir, {
      ANTHROPIC_API_KEY: "sk-SECRET-do-not-store",
      ANTHROPIC_BASE_URL: "https://gateway.example.com/api",
      ANTHROPIC_MODEL: "env-anthropic-model",
    });
    const { profiles } = await readProviders(dir);
    expect(profiles[0].apiKey).toBe("");
    expect(profiles[0].apiKeyEnv).toBe("ANTHROPIC_API_KEY");

    // The strongest guarantee: the secret appears nowhere in the file on disk.
    const raw = await readFile(path.join(dir, "bp_template", "providers.json"), "utf8");
    expect(raw).not.toContain("sk-SECRET-do-not-store");
  });

  it("records the matching env var name for non-Anthropic keys", async () => {
    const dir = await tmp();
    await bootstrapEnvProvider(dir, { BP_API_KEY: "sk-bp-secret" });
    const { profiles } = await readProviders(dir);
    expect(profiles[0].apiKey).toBe("");
    expect(profiles[0].apiKeyEnv).toBe("BP_API_KEY");
    const raw = await readFile(path.join(dir, "bp_template", "providers.json"), "utf8");
    expect(raw).not.toContain("sk-bp-secret");
  });

  it("clears apiKeyEnv when the user later saves a real key in Settings", async () => {
    const dir = await tmp();
    const created = await bootstrapEnvProvider(dir, {
      ANTHROPIC_API_KEY: "sk-env",
      ANTHROPIC_BASE_URL: "https://g/api",
      ANTHROPIC_MODEL: "m",
    });
    await updateProfile(dir, created!.id, { apiKey: "sk-user-typed" });
    const { profiles } = await readProviders(dir);
    expect(profiles[0].apiKey).toBe("sk-user-typed");
    expect(profiles[0].apiKeyEnv).toBeUndefined();
  });

  it("does nothing when there is no env key", async () => {
    const dir = await tmp();
    const created = await bootstrapEnvProvider(dir, {});
    expect(created).toBeNull();
    expect((await readProviders(dir)).profiles).toHaveLength(0);
  });

  it("does not clobber an existing profile (one-time seed)", async () => {
    const dir = await tmp();
    await createProfile(dir, { name: "Local", apiKey: "sk-user", models: ["user-m"] });
    const created = await bootstrapEnvProvider(dir, { ANTHROPIC_API_KEY: "sk-env" });
    expect(created).toBeNull();
    const { profiles } = await readProviders(dir);
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe("Local");
  });
});
