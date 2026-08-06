import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pluginCreate, pluginImport, pluginTest } from "./plugin.js";

describe("plugin conformance command", () => {
  it("tests a generated range-preview plugin through the SDK testing entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-cli-plugin-test-"));
    const messages: string[] = [];
    await pluginCreate({ dir: root, id: "org.example.range-preview" }, (message) => messages.push(message));
    await pluginTest({ dir: root, environment: "local" }, (message) => messages.push(message));
    expect(messages).toContain("Plugin conformance: passed");
    await rm(root, { recursive: true, force: true });
  });
});

describe("plugin import command", () => {
  it("uses the same backend-core importer as the API", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-cli-plugin-import-"));
    const source = path.join(root, "source");
    const dataDir = path.join(root, "data");
    await mkdir(path.join(source, ".codex-plugin"), { recursive: true });
    await writeFile(path.join(source, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "cli-demo", version: "1.0.0", description: "CLI demo" }));
    const messages: string[] = [];
    await pluginImport({ source, dataDir, format: "codex" }, (message) => messages.push(message));
    expect(messages).toEqual(["Imported cli-demo@1.0.0 (codex)"]);
    expect(await readFile(path.join(dataDir, "plugins", "installed", "cli-demo", "1.0.0", "manifest.json"), "utf8")).toContain('"id": "cli-demo"');
    await rm(root, { recursive: true, force: true });
  });
});
