import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  resolveProvider,
  writeLocalSettings,
  parseDotenv,
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

describe("writeLocalSettings", () => {
  it("atomically merges into bp_template/settings.json", async () => {
    const dir = await tmp();
    await writeLocalSettings(dir, { model: "m1", apiKey: "sk-1", baseUrl: "u1" });
    await writeLocalSettings(dir, { model: "m2" }); // merge: keep apiKey/baseUrl
    const raw = JSON.parse(
      await readFile(path.join(dir, "bp_template", "settings.json"), "utf8"),
    );
    expect(raw.model).toBe("m2");
    expect(raw.apiKey).toBe("sk-1");
    expect(raw.baseUrl).toBe("u1");
  });
});
