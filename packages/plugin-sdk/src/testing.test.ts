import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { evaluatePluginCompatibility, testPlugin } from "./testing.js";
import type { PluginManifest } from "./index.js";

const manifest: PluginManifest = {
  id: "org.example.instructions", version: "1.0.0", apiVersion: "1", displayName: "Instructions", description: "Test",
  engines: { brainpilot: ">=0.1.1 <0.2.0" }, environments: ["local"], protocols: { agentInstructions: "1" },
  dependencies: [{ id: "org.example.base", version: ">=1.0.0 <2.0.0" }], conflicts: ["org.example.old"],
  contributes: { agentInstructions: [{ id: "main", title: "Main", entry: "prompts/main.md", targets: ["writer"], mode: "append" }] },
};

describe("plugin conformance testing", () => {
  it("reports environment, dependency and conflict incompatibilities", () => {
    const issues = evaluatePluginCompatibility(manifest, { brainpilotVersion: "0.1.1", environment: "cloud", installedPlugins: { "org.example.old": { version: "1.0.0", enabled: true } } });
    expect(issues.map((issue) => issue.code)).toEqual(["environment", "dependency-missing", "plugin-conflict"]);
  });

  it("checks every declared contribution entry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bp-plugin-test-"));
    await mkdir(path.join(root, "prompts"));
    await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(root, "prompts/main.md"), "Write reproducibly.");
    const result = await testPlugin(root, { brainpilotVersion: "0.1.1", environment: "local", installedPlugins: { "org.example.base": { version: "1.2.0" } } });
    expect(result.status).toBe("passed");
  });
});
