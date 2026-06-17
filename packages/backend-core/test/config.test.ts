import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveProvider,
  writeLocalSettings,
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
    expect(r.settingsPath).toBe(path.join(dir, "bp_template", "settings.json"));
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
  it("unconfigured: lists settings file, env, init, settings UI, and BP_MOCK", () => {
    const lines = formatProviderGuidance({
      hasKey: false,
      settingsPath: "/data/bp_template/settings.json",
      dotenvPath: "/data/.env",
    });
    const text = lines.join("\n");
    expect(text).toContain("/data/bp_template/settings.json");
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
    await writeLocalSettings(dir, { model: "m1", apiKey: "sk-1", baseUrl: "u1" });
    await writeLocalSettings(dir, { model: "m2" }); // update: keep apiKey/baseUrl
    const raw = JSON.parse(
      await readFile(path.join(dir, "bp_template", "providers.json"), "utf8"),
    );
    expect(raw.profiles).toHaveLength(1);
    const p = raw.profiles[0];
    expect(p.apiKey).toBe("sk-1");
    expect(p.baseUrl).toBe("u1");
    // newest model is the default (front of the model list)
    expect(p.models[0]).toBe("m2");
    expect(p.models).toContain("m1");
    expect(raw.selectedProfileId).toBe(p.id);
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
