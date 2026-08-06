import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager, mockAgentFactory } from "@brainpilot/runtime";
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
    await writeFile(path.join(root, "AGENTS.md"), "Use the imported lab workflow.\n");
    expect(await detectExternalPluginFormats(root)).toEqual(["codex", "claude-code"]);
    await expect(resolveExternalPlugin(root)).rejects.toThrow(/Multiple plugin formats/);
    const resolved = await resolveExternalPlugin(root, "codex");
    expect(resolved).toEqual(expect.objectContaining({ id: "sample-plugin", version: "1.2.3", format: "codex", unsupported: ["agents"] }));
    expect(resolved.skillPaths).toHaveLength(1);
    expect(resolved.instructionPaths).toEqual([path.join(root, "AGENTS.md")]);
    expect(resolved.inlineMcpConfig).toEqual({ mcpServers: { search: { command: "node", args: ["server.js"] } } });
  });

  it("rejects contribution paths that escape the plugin root", async () => {
    const root = await temp("bp-foreign-path-");
    await writeJson(path.join(root, ".codex-plugin", "plugin.json"), { name: "bad-plugin", version: "1.0.0", skills: "../skills" });
    await expect(resolveExternalPlugin(root, "codex")).rejects.toThrow(/escapes the plugin root/);
  });

  it("resolves conventional Claude Code instructions", async () => {
    const root = await temp("bp-claude-instructions-");
    await writeJson(path.join(root, ".claude-plugin", "plugin.json"), {
      name: "claude-instructions",
      version: "1.0.0",
    });
    await writeFile(path.join(root, "CLAUDE.md"), "Follow the imported Claude workflow.\n");
    const resolved = await resolveExternalPlugin(root, "claude-code");
    expect(resolved.instructionPaths).toEqual([path.join(root, "CLAUDE.md")]);
  });

  it("reads Pi packages separately from BrainPilot native manifests", async () => {
    const root = await temp("bp-pi-package-");
    await writeJson(path.join(root, "package.json"), { name: "pi-demo", version: "2.0.0", pi: { skills: ["./skills"], instructions: ["./AGENTS.md"], extensions: ["./extension.ts"], prompts: ["./prompts"] } });
    await mkdir(path.join(root, "skills", "demo"), { recursive: true });
    await writeFile(path.join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: Demo\n---\n");
    await writeFile(path.join(root, "AGENTS.md"), "Follow the imported Pi workflow.\n");
    const resolved = await resolveExternalPlugin(root);
    expect(resolved.format).toBe("pi-package");
    expect(resolved.unsupported).toEqual(["extensions", "prompts"]);
    expect(resolved.instructionPaths).toEqual([path.join(root, "AGENTS.md")]);
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

  it("projects imported agent instructions into a newly created Principal", async () => {
    const root = await temp("bp-import-instructions-");
    const dataDir = await temp("bp-import-instructions-data-");
    await writeJson(path.join(root, ".codex-plugin", "plugin.json"), {
      name: "instruction-demo",
      version: "1.0.0",
      description: "Instruction demo",
      instructions: "guidance/principal.md",
    });
    await mkdir(path.join(root, "guidance"), { recursive: true });
    await writeFile(path.join(root, "guidance", "principal.md"), "Always apply the imported evidence checklist.\n");

    const imported = await importExternalPlugin(dataDir, root, "codex");
    await setPluginEnabled(dataDir, imported.manifest.id, true);
    expect(imported.manifest.contributes?.agentInstructions).toEqual([
      expect.objectContaining({ entry: "guidance/principal.md", targets: ["principal"] }),
    ]);

    const prompts: string[] = [];
    const manager = new SessionManager({
      dataRoot: dataDir,
      persist: false,
      agentFactory: async (params) => {
        if (params.agentName === "principal") prompts.push(params.systemPrompt);
        return mockAgentFactory(params);
      },
    });
    const session = await manager.createSession();
    await manager.sendMessage(session.id, "hello");
    expect(prompts[0]).toContain("# Enabled plugin instructions");
    expect(prompts[0]).toContain("Always apply the imported evidence checklist.");
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
