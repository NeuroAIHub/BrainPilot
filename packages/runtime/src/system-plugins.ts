import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  isBrainPilotVersionCompatible,
  parsePublishablePluginManifest,
  type AgentInstructionContribution,
  type PluginManifest,
  type SkillContribution,
} from "@brainpilot/plugin-sdk";

export const AUDITOR_PLUGIN_ID = "org.brainpilot.auditor";
export const GOT_PLUGIN_ID = "org.brainpilot.got";
export const MONITOR_PLUGIN_ID = "org.brainpilot.monitor";
export const BACKGROUND_JOBS_PLUGIN_ID = "org.brainpilot.background-jobs";
export const RESEARCH_PLUGIN_ID = "org.brainpilot.research";
export const SYSTEM_PLUGIN_DISABLE_ENV = "BP_EXPERIMENT_DISABLE_PLUGINS";

export interface SystemPluginSnapshot {
  id: string;
  /** Installed version resolved for this session; informational, not pinned. */
  version: string;
  enabled: boolean;
  reason: "default" | "experiment-override" | "marketplace";
}

export interface BundledSystemPlugin {
  manifest: PluginManifest;
  root: string;
  defaultEnabled: boolean;
  disabledByExperiment: boolean;
}

interface SystemPluginSpec {
  packageName: string;
  defaultEnabled: boolean;
}

const SPECS: readonly SystemPluginSpec[] = [
  { packageName: "@brainpilot/plugin-auditor", defaultEnabled: true },
  { packageName: "@brainpilot/plugin-got", defaultEnabled: true },
  { packageName: "@brainpilot/plugin-monitor", defaultEnabled: false },
  { packageName: "@brainpilot/plugin-background-jobs", defaultEnabled: false },
  { packageName: "@brainpilot/plugin-research", defaultEnabled: true },
];

function disabledPluginIds(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

function packageRoot(packageName: string): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve(`${packageName}/package.json`));
}

function safeEntry(root: string, entry: string): string {
  if (isAbsolute(entry)) throw new Error(`system plugin entry must be relative: ${entry}`);
  const target = resolve(root, entry);
  const rel = relative(resolve(root), target);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`system plugin entry escapes package: ${entry}`);
  return target;
}

export function loadBundledSystemPlugins(
  env: Record<string, string | undefined> = process.env,
  brainpilotVersion = JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
  ).version as string,
): BundledSystemPlugin[] {
  const disabled = disabledPluginIds(env[SYSTEM_PLUGIN_DISABLE_ENV]);
  return SPECS.map((spec) => {
    const root = packageRoot(spec.packageName);
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { version?: string };
    const manifest = parsePublishablePluginManifest(
      JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8")) as unknown,
    );
    if (!manifest) throw new Error(`invalid bundled system plugin: ${spec.packageName}`);
    if (pkg.version !== manifest.version) {
      throw new Error(`system plugin package/manifest version mismatch: ${spec.packageName}`);
    }
    if (!isBrainPilotVersionCompatible(manifest.engines?.brainpilot, brainpilotVersion)) {
      throw new Error(
        `system plugin ${manifest.id}@${manifest.version} requires BrainPilot ` +
        `${manifest.engines?.brainpilot}, current ${brainpilotVersion}`,
      );
    }
    for (const contribution of [
      ...(manifest.contributes?.skills ?? []),
      ...(manifest.contributes?.agentInstructions ?? []),
    ]) safeEntry(root, contribution.entry);
    return {
      manifest,
      root,
      defaultEnabled: spec.defaultEnabled,
      disabledByExperiment: disabled.has(manifest.id),
    };
  });
}

export function snapshotSystemPlugins(plugins: readonly BundledSystemPlugin[]): SystemPluginSnapshot[] {
  return plugins.map((plugin) => ({
    id: plugin.manifest.id,
    version: plugin.manifest.version,
    enabled: plugin.defaultEnabled && !plugin.disabledByExperiment,
    reason: plugin.disabledByExperiment ? "experiment-override" : "default",
  }));
}

export function systemPluginEnabled(
  snapshot: readonly SystemPluginSnapshot[],
  id: string,
): boolean {
  return snapshot.some((plugin) => plugin.id === id && plugin.enabled);
}

function activePlugin(
  plugins: readonly BundledSystemPlugin[],
  snapshot: readonly SystemPluginSnapshot[],
  id: string,
): BundledSystemPlugin | undefined {
  const state = snapshot.find((plugin) => plugin.id === id && plugin.enabled);
  return state
    ? plugins.find((plugin) => plugin.manifest.id === id)
    : undefined;
}

export function systemPluginSkillPaths(
  plugins: readonly BundledSystemPlugin[],
  snapshot: readonly SystemPluginSnapshot[],
  agentName: string,
): string[] {
  return plugins.flatMap((plugin) => {
    if (!activePlugin(plugins, snapshot, plugin.manifest.id)) return [];
    return (plugin.manifest.contributes?.skills ?? []).flatMap((skill: SkillContribution) =>
      skill.targets && !skill.targets.includes(agentName)
        ? []
        : [dirname(safeEntry(plugin.root, skill.entry))],
    );
  });
}

export async function systemPluginInstructions(
  plugins: readonly BundledSystemPlugin[],
  snapshot: readonly SystemPluginSnapshot[],
  agentName: string,
): Promise<string[]> {
  const contributions: Array<{ plugin: BundledSystemPlugin; instruction: AgentInstructionContribution }> = [];
  for (const plugin of plugins) {
    if (!activePlugin(plugins, snapshot, plugin.manifest.id)) continue;
    for (const instruction of plugin.manifest.contributes?.agentInstructions ?? []) {
      if (instruction.targets.includes(agentName)) contributions.push({ plugin, instruction });
    }
  }
  contributions.sort((left, right) => (left.instruction.priority ?? 0) - (right.instruction.priority ?? 0));
  return Promise.all(contributions.map(({ plugin, instruction }) =>
    readFile(safeEntry(plugin.root, instruction.entry), "utf8").then((text) => text.trim()),
  ));
}
