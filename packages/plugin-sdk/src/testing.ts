import { promises as fs } from "node:fs";
import path from "node:path";
import {
  SUPPORTED_PLUGIN_PROTOCOLS,
  isBrainPilotVersionCompatible,
  isSafePluginPath,
  parsePublishablePluginManifest,
  type PluginEnvironment,
  type PluginCompatibilityIssue,
  type PluginManifest,
} from "./index.js";

export type CompatibilityIssueSeverity = "error" | "warning";
export type CompatibilityIssue = PluginCompatibilityIssue;

export interface PluginCompatibilityHost {
  brainpilotVersion: string;
  environment: PluginEnvironment;
  supportedProtocols?: Record<string, string>;
  installedPlugins?: Record<string, { version: string; enabled?: boolean }>;
}

export interface PluginConformanceReport {
  status: "passed" | "warning" | "failed";
  manifest?: PluginManifest;
  issues: CompatibilityIssue[];
}

export function evaluatePluginCompatibility(manifest: PluginManifest, host: PluginCompatibilityHost): CompatibilityIssue[] {
  const issues: CompatibilityIssue[] = [];
  const requiredBrainPilot = manifest.engines?.brainpilot;
  if (!requiredBrainPilot || !isBrainPilotVersionCompatible(requiredBrainPilot, host.brainpilotVersion)) {
    issues.push({ code: "brainpilot-version", severity: "error", subject: "engines.brainpilot", message: `Requires BrainPilot ${requiredBrainPilot ?? "(undeclared)"}; host is ${host.brainpilotVersion}.` });
  }
  if (manifest.environments?.length && !manifest.environments.includes(host.environment)) {
    issues.push({ code: "environment", severity: "error", subject: host.environment, message: `Plugin does not support the ${host.environment} deployment environment.` });
  }
  const supported: Record<string, string> = host.supportedProtocols ?? SUPPORTED_PLUGIN_PROTOCOLS;
  for (const [name, required] of Object.entries(manifest.protocols ?? {})) {
    const actual = supported[name];
    if (actual !== required) issues.push({ code: "protocol", severity: "error", subject: name, message: `Requires ${name} protocol ${required}; host provides ${actual ?? "none"}.` });
  }
  const installed = host.installedPlugins ?? {};
  for (const dependency of manifest.dependencies ?? []) {
    const found = installed[dependency.id];
    if (!found) {
      issues.push({ code: "dependency-missing", severity: dependency.optional ? "warning" : "error", subject: dependency.id, message: `Dependency ${dependency.id} ${dependency.version} is not installed.` });
    } else if (!isBrainPilotVersionCompatible(dependency.version, found.version)) {
      issues.push({ code: "dependency-version", severity: dependency.optional ? "warning" : "error", subject: dependency.id, message: `Dependency ${dependency.id} ${found.version} does not satisfy ${dependency.version}.` });
    }
  }
  for (const conflict of manifest.conflicts ?? []) {
    if (installed[conflict]?.enabled) issues.push({ code: "plugin-conflict", severity: "error", subject: conflict, message: `Conflicts with enabled plugin ${conflict}.` });
  }
  return issues;
}

function report(manifest: PluginManifest | undefined, issues: CompatibilityIssue[]): PluginConformanceReport {
  return {
    status: issues.some((issue) => issue.severity === "error") ? "failed" : issues.length ? "warning" : "passed",
    ...(manifest ? { manifest } : {}),
    issues,
  };
}

function contributionEntries(manifest: PluginManifest): string[] {
  const contributions = manifest.contributes;
  return [
    ...(contributions?.previewers ?? []),
    ...(contributions?.skills ?? []),
    ...(contributions?.knowledgeBases ?? []),
    ...(contributions?.panels ?? []),
    ...(contributions?.literatureProviders ?? []),
    ...(contributions?.workflows ?? []),
    ...(contributions?.agentInstructions ?? []),
  ].map((item) => item.entry);
}

/** Filesystem-backed conformance runner used by plugin authors and the CLI. */
export async function testPlugin(root: string, host: PluginCompatibilityHost): Promise<PluginConformanceReport> {
  const issues: CompatibilityIssue[] = [];
  let raw: unknown;
  try { raw = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as unknown; }
  catch (error) { return report(undefined, [{ code: "manifest-read", severity: "error", message: error instanceof Error ? error.message : String(error) }]); }
  const manifest = parsePublishablePluginManifest(raw);
  if (!manifest) return report(undefined, [{ code: "manifest-invalid", severity: "error", message: "Manifest is invalid or does not declare engines.brainpilot." }]);
  issues.push(...evaluatePluginCompatibility(manifest, host));
  for (const entry of contributionEntries(manifest)) {
    if (!isSafePluginPath(entry)) {
      issues.push({ code: "entry-path", severity: "error", subject: entry, message: "Contribution entry escapes the plugin bundle." });
      continue;
    }
    try { await fs.access(path.join(root, entry)); }
    catch { issues.push({ code: "entry-missing", severity: "error", subject: entry, message: `Contribution entry does not exist: ${entry}` }); }
  }
  return report(manifest, issues);
}

export async function testPluginMatrix(root: string, hosts: PluginCompatibilityHost[]): Promise<Array<{ host: PluginCompatibilityHost; report: PluginConformanceReport }>> {
  return Promise.all(hosts.map(async (host) => ({ host, report: await testPlugin(root, host) })));
}
