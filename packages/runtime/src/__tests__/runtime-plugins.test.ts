import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeExtensionDescriptor } from "@brainpilot/protocol";
import { loadRuntimePluginExtension } from "../runtime-plugins.js";
import { WorkspaceCheckpointStore } from "../workspace-checkpoints.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("runtime plugin loader", () => {
  it("loads an installed entry and exposes permission-scoped host services", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-runtime-plugin-"));
    roots.push(dataRoot);
    const cwd = join(dataRoot, "workspaces", "s1");
    const pluginRoot = join(dataRoot, "plugins", "installed", "org.example.loop", "1.0.0");
    await mkdir(pluginRoot, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(pluginRoot, "index.mjs"), `export default context => pi => pi.registerTool({name:"probe",execute:()=>context.execProcess("printf ok",1000)})`);
    const descriptor: RuntimeExtensionDescriptor = {
      pluginId: "org.example.loop", pluginVersion: "1.0.0", entry: "index.mjs", targets: ["engineer"], permissions: ["execute:process"],
    };
    const tools = new Map<string, { execute(): Promise<{ stdout: string }> }>();
    const extension = await loadRuntimePluginExtension({
      dataRoot, descriptor, sessionId: "s1", agentName: "engineer", cwd,
      checkpoints: new WorkspaceCheckpointStore("s1", cwd, join(dataRoot, ".bp", "s1")),
      acquireLease: () => true, releaseLease: () => {}, ownsLease: () => true, emit: () => {},
    }) as (pi: { registerTool(tool: { name: string; execute(): Promise<{ stdout: string }> }): void }) => void;
    extension({ registerTool: (tool) => tools.set(tool.name, tool) });
    expect((await tools.get("probe")!.execute()).stdout).toBe("ok");
  });

  it("rejects entries that escape the installed bundle", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "bp-runtime-plugin-"));
    roots.push(dataRoot);
    const descriptor: RuntimeExtensionDescriptor = {
      pluginId: "org.example.loop", pluginVersion: "1.0.0", entry: "../escape.mjs", targets: ["engineer"], permissions: [],
    };
    await expect(loadRuntimePluginExtension({
      dataRoot, descriptor, sessionId: "s1", agentName: "engineer", cwd: dataRoot,
      checkpoints: new WorkspaceCheckpointStore("s1", dataRoot, join(dataRoot, ".bp", "s1")),
      acquireLease: () => true, releaseLease: () => {}, ownsLease: () => true, emit: () => {},
    })).rejects.toThrow("escapes bundle");
  });
});
