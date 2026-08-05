import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { detectExternalPluginFormats, resolveExternalPlugin } from "../src/external-plugins.js";
import { importExternalPlugin, listInstalledPlugins, setPluginEnabled } from "../src/plugins.js";
import type { Orchestrator, RuntimeHandle } from "../src/orchestrator.js";

const roots: string[] = [];
async function temp(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

function orchestrator(): Orchestrator {
  return {
    ensureRuntime: async (): Promise<RuntimeHandle> => ({ baseUrl: "http://runtime.test" }),
    health: async () => true,
    stopRuntime: async () => {},
  };
}

describe("external plugin resolver", () => {
  it("detects ambiguity and resolves explicit Codex inline contributions", async () => {
    const root = await temp("bp-foreign-");
    await writeJson(path.join(root, ".codex-plugin", "plugin.json"), {
      name: "sample-plugin", version: "1.2.3", description: "sample", skills: "./skills",
      mcpServers: { search: { command: "node", args: ["server.js"] } },
      hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "node hook.js" }] }] },
      agents: "./agents",
    });
    await writeJson(path.join(root, ".claude-plugin", "plugin.json"), { name: "sample-plugin", version: "1.2.3" });
    await mkdir(path.join(root, "skills", "sample"), { recursive: true });
    await writeFile(path.join(root, "skills", "sample", "SKILL.md"), "---\nname: sample\ndescription: Sample\n---\n");
    expect(await detectExternalPluginFormats(root)).toEqual(["codex", "claude-code"]);
    await expect(resolveExternalPlugin(root)).rejects.toThrow(/Multiple plugin formats/);
    const resolved = await resolveExternalPlugin(root, "codex");
    expect(resolved).toEqual(expect.objectContaining({ id: "sample-plugin", version: "1.2.3", format: "codex", unsupported: ["agents"] }));
    expect(resolved.skillPaths).toHaveLength(1);
    expect(resolved.inlineMcpConfig).toEqual({ mcpServers: { search: { command: "node", args: ["server.js"] } } });
  });

  it("rejects contribution paths that escape the plugin root", async () => {
    const root = await temp("bp-foreign-path-");
    await writeJson(path.join(root, ".codex-plugin", "plugin.json"), { name: "bad-plugin", version: "1.0.0", skills: "../skills" });
    await expect(resolveExternalPlugin(root, "codex")).rejects.toThrow(/escapes the plugin root/);
  });

  it("reads Pi packages separately from BrainPilot native manifests", async () => {
    const root = await temp("bp-pi-package-");
    await writeJson(path.join(root, "package.json"), { name: "pi-demo", version: "2.0.0", pi: { skills: ["./skills"], extensions: ["./extension.ts"], prompts: ["./prompts"] } });
    await mkdir(path.join(root, "skills", "demo"), { recursive: true });
    await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
    await writeFile(path.join(root, "extension.ts"), "export default function extension() {}\n");
    const resolved = await resolveExternalPlugin(root);
    expect(resolved.format).toBe("pi-package");
    expect(resolved.extensionPaths).toEqual([path.join(root, "extension.ts")]);
    expect(resolved.unsupported).toEqual(["prompts"]);
  });
});

describe("external plugin import", () => {
  it("imports, enables, projects runtime config, and disables without changing the installed copy", async () => {
    const root = await temp("bp-import-source-");
    const dataDir = await temp("bp-import-data-");
    await writeJson(path.join(root, ".claude-plugin", "plugin.json"), { name: "hook-demo", version: "1.0.0", description: "Hook demo" });
    await mkdir(path.join(root, "skills", "demo"), { recursive: true });
    await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
    await writeJson(path.join(root, ".mcp.json"), { mcpServers: { demo: { command: "node", args: ["server.js"] } } });
    await writeJson(path.join(root, "hooks", "hooks.json"), { hooks: { Setup: [{ hooks: [{ type: "command", command: "node -e \"process.exit(0)\"" }] }] } });

    const imported = await importExternalPlugin(dataDir, root, "claude-code");
    expect(imported).toEqual(expect.objectContaining({ enabled: false, sourceFormat: "claude-code" }));
    await setPluginEnabled(dataDir, imported.manifest.id, true);
    const runtime = JSON.parse(await readFile(path.join(dataDir, "plugins", "runtime", "hook-demo.json"), "utf8")) as { root: string; mcpConfigPath: string };
    expect(runtime.root).toContain(path.join("plugins", "execution", "hook-demo", "1.0.0"));
    expect(runtime.mcpConfigPath).toBe(path.join(runtime.root, ".mcp.json"));
    expect(await readFile(path.join(dataDir, "plugins", "installed", "hook-demo", "1.0.0", "manifest.json"), "utf8")).toContain('"id": "hook-demo"');
    expect((await listInstalledPlugins(dataDir))[0]?.enabled).toBe(true);
    await setPluginEnabled(dataDir, imported.manifest.id, false);
    await expect(readFile(path.join(dataDir, "plugins", "runtime", "hook-demo.json"), "utf8")).rejects.toThrow();
  });

  it("exposes local import through the API and rejects it in cloud mode", async () => {
    const root = await temp("bp-import-api-source-");
    const dataDir = await temp("bp-import-api-data-");
    await writeJson(path.join(root, ".codex-plugin", "plugin.json"), { name: "api-demo", version: "1.0.0", description: "API demo" });
    const local = createApp({ orchestrator: orchestrator(), dataDir, serveWeb: false });
    const response = await local.request("/api/plugins/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: root, format: "codex" }) });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(expect.objectContaining({ sourceFormat: "codex" }));

    const cloudData = await temp("bp-import-cloud-");
    const cloud = createApp({ orchestrator: orchestrator(), dataDir: cloudData, serveWeb: false, env: { BP_LOCAL_MODE: "0" } });
    const denied = await cloud.request("/api/plugins/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: root, format: "codex" }) });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toEqual({ error: "Local plugin directory import is only available in local deployments" });
  });
});
