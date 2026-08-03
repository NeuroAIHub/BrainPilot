import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createPreviewerPlugin, packPlugin, readPluginManifest } from "@brainpilot/plugin-sdk/node";
import { testPlugin } from "@brainpilot/plugin-sdk/testing";

const brainpilotVersion = (createRequire(import.meta.url)("../../package.json") as { version: string }).version;

export async function pluginCreate(options: { dir: string; id: string }, log: (message: string) => void = console.log): Promise<void> {
  const root = resolve(options.dir);
  await createPreviewerPlugin(root, options.id);
  log(`Created previewer plugin at ${root}`);
}

export async function pluginValidate(options: { dir: string }, log: (message: string) => void = console.log): Promise<void> {
  const manifest = await readPluginManifest(resolve(options.dir));
  log(`Valid ${manifest.id}@${manifest.version} (Plugin API ${manifest.apiVersion})`);
}

export async function pluginPack(options: { dir: string; output?: string }, log: (message: string) => void = console.log): Promise<void> {
  const result = await packPlugin(resolve(options.dir), options.output ? resolve(options.output) : undefined);
  log(`Packed ${result.output}`);
  log(`sha256 ${result.sha256}`);
}

export async function pluginTest(options: { dir: string; environment?: "local" | "cloud" | "browser" }, log: (message: string) => void = console.log): Promise<void> {
  const result = await testPlugin(resolve(options.dir), { brainpilotVersion, environment: options.environment ?? "local" });
  for (const issue of result.issues) log(`${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
  log(`Plugin conformance: ${result.status}`);
  if (result.status === "failed") throw new Error("plugin conformance failed");
}
