/**
 * Plugin marketplace control plane.
 *
 * This module manages installation and activation state only. Contribution
 * hosts consume enabled, compatible manifests through separate adapters.
 */
import { promises as fs, type Stats } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runCompatHookEvent } from "@brainpilot/runtime";
import {
  PLUGIN_API_VERSION,
  SUPPORTED_PLUGIN_PROTOCOLS,
  comparePluginVersions,
  isSafePluginPath,
  isBrainPilotVersionCompatible,
  isPluginVersion,
  parsePluginManifest,
  parsePublishablePluginManifest,
  type LegacyPluginKind,
  type EnabledPreviewer,
  type InstalledPlugin as SdkInstalledPlugin,
  type MarketplaceEntry,
  type MarketplaceRelease,
  type MarketplaceSourceStatus,
  type PluginCompatibility,
  type PluginManifest,
  type PluginPermission,
  type RuntimeExtensionContribution,
  type PluginUpdateStatus,
} from "@brainpilot/plugin-sdk";
import {
  resolveExternalPlugin,
  type ImportablePluginSourceFormat,
  type PluginSourceFormat,
  type ResolvedExternalPlugin,
  type ResolvedPlugin,
} from "./external-plugins.js";

const backendVersion = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

export { PLUGIN_API_VERSION, parsePluginManifest } from "@brainpilot/plugin-sdk";
export type PluginKind = LegacyPluginKind;
export type { PluginManifest, PluginPermission } from "@brainpilot/plugin-sdk";
export type { MarketplaceEntry, MarketplaceRelease, MarketplaceSourceStatus, PluginCompatibility, PluginUpdateStatus } from "@brainpilot/plugin-sdk";
export type { ImportablePluginSourceFormat, PluginSourceFormat, ResolvedPlugin } from "./external-plugins.js";

/** Host registry metadata added by the import adapter; the SDK shape remains the common base. */
export type InstalledPlugin = SdkInstalledPlugin & {
  sourceFormat?: PluginSourceFormat;
  unsupported?: string[];
};

interface PluginRuntimeProjection {
  schemaVersion: 1;
  id: string;
  version: string;
  format: PluginSourceFormat;
  root: string;
  dataDir: string;
  mcpConfigPath?: string;
  hookConfig?: { dialect: "codex" | "claude-code"; path: string };
  extensionPaths?: string[];
}

interface RegistryFile {
  plugins: Record<string, InstalledPlugin>;
}

interface PluginBundle {
  manifest: PluginManifest;
  files?: Array<{ path: string; contentBase64: string }>;
}

interface BuiltinPluginRelease {
  plugin: string;
  /** Versioned directory relative to packages/backend-core/plugins/. */
  source: string;
  version: string;
  publishedAt: string;
  releaseNotes: string;
  publisher?: string;
  verified?: boolean;
  sourceFormat?: PluginSourceFormat;
  repositoryUrl?: string;
  license?: string;
  upstreamRef?: string;
  upstreamCommit?: string;
  capabilities?: MarketplaceEntry["capabilities"];
  requirements?: string[];
  executesLocalCode?: boolean;
  status?: "test";
  packageName?: string;
}

// PR4 adds immutable built-in release directories here. Every source directory
// contains the exact manifest and files for that version; versions are never
// synthesized by rewriting the current bundle.
const BUILTIN_PLUGIN_RELEASES: readonly BuiltinPluginRelease[] = [
  {
    plugin: "autoresearch", source: "autoresearch/0.1.2", packageName: "@brainpilot/plugin-autoresearch", version: "0.1.2",
    publishedAt: "2026-08-07T00:00:00.000Z", releaseNotes: "Initial Engineer-owned measured optimization loop with checkpoint rollback.",
    publisher: "BrainPilot", verified: true, sourceFormat: "brainpilot", repositoryUrl: "https://github.com/NeuroAIHub/BrainPilot",
    license: "MIT", capabilities: ["skills", "runtime-tools"], requirements: ["Explicit per-version host execution trust"], executesLocalCode: true,
  },
  {
    plugin: "monitor",
    source: "monitor/0.1.2",
    version: "0.1.2",
    publishedAt: "2026-08-07T00:00:00.000Z",
    releaseNotes: "Initial official command-only Monitor runtime tool.",
    publisher: "BrainPilot",
    verified: true,
    sourceFormat: "brainpilot",
    repositoryUrl: "https://github.com/NeuroAIHub/BrainPilot",
    license: "AGPL-3.0-only",
    capabilities: ["runtime-tools"],
    requirements: ["Local deployment", "Linux or macOS (Windows experimental)", "Background process permission"],
    executesLocalCode: true,
  },
  {
    plugin: "nifti-viewer",
    source: "nifti-viewer/0.1.0",
    version: "0.1.0",
    publishedAt: "2026-08-03T00:00:00.000Z",
    releaseNotes: "Initial range-backed NIfTI-1 metadata and central axial slice preview.",
  },
  {
    plugin: "superpowers",
    source: "superpowers/6.2.0",
    version: "6.2.0",
    publishedAt: "2026-07-24T00:28:17.000Z",
    releaseNotes: "Initial verified Pi Package release with 14 upstream Superpowers skills and native session bootstrap.",
    publisher: "Jesse Vincent",
    verified: true,
    sourceFormat: "pi-package",
    repositoryUrl: "https://github.com/obra/superpowers",
    license: "MIT",
    upstreamRef: "v6.2.0",
    upstreamCommit: "3dcbd5c4b48e02263fbf4a3c01e3fe4f81d584d9",
    capabilities: ["skills"],
    requirements: ["Local deployment", "Runs a trusted Pi TypeScript extension", "Git; Bash and Node.js are used by optional workflows"],
    executesLocalCode: true,
    status: "test",
  },
  {
    plugin: "playwright-mcp",
    source: "playwright-mcp/0.0.78",
    version: "0.0.78",
    publishedAt: "2026-08-05T00:00:00.000Z",
    releaseNotes: "Initial BrainPilot wrapper for Microsoft Playwright MCP with an isolated headless browser session.",
    publisher: "Microsoft",
    verified: true,
    sourceFormat: "brainpilot",
    repositoryUrl: "https://github.com/microsoft/playwright-mcp",
    license: "Apache-2.0",
    upstreamRef: "npm:@playwright/mcp@0.0.78",
    upstreamCommit: "8414d571beed0e12a4b8c7f537bfdab44236ba4c",
    capabilities: ["mcp"],
    requirements: ["Local deployment", "Node.js 18+ and npx", "Downloads the pinned npm package on first use", "A Chrome/Chromium executable or BRAINPILOT_PLAYWRIGHT_EXECUTABLE_PATH"],
    executesLocalCode: true,
    status: "test",
  },
];
const TEST_PLUGIN_SOURCES = new Set<string>();

export function pluginsDir(dataDir: string): string {
  return path.join(dataDir, "plugins");
}

function registryPath(dataDir: string): string {
  return path.join(pluginsDir(dataDir), "registry.json");
}

function marketplacePath(dataDir: string): string {
  return path.join(pluginsDir(dataDir), "marketplace.json");
}

function marketplaceSourcesPath(dataDir: string): string {
  return path.join(pluginsDir(dataDir), "marketplace-sources.json");
}

function installedVersionPath(dataDir: string, manifest: PluginManifest): string {
  return path.join(pluginsDir(dataDir), "installed", manifest.id, manifest.version);
}

function pluginRuntimeDir(dataDir: string): string {
  return path.join(pluginsDir(dataDir), "runtime");
}

function externalMetadataPath(dataDir: string, manifest: PluginManifest): string {
  return path.join(installedVersionPath(dataDir, manifest), ".brainpilot", "source.json");
}

function builtinPluginRoot(release: BuiltinPluginRelease): string {
  if (release.packageName) return path.dirname(createRequire(import.meta.url).resolve(`${release.packageName}/package.json`));
  return fileURLToPath(new URL(`../plugins/${release.source}`, import.meta.url));
}

async function readBuiltinPluginBundle(release: BuiltinPluginRelease): Promise<Buffer> {
  const root = builtinPluginRoot(release);
  const manifest = parsePublishablePluginManifest(JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as unknown);
  if (!manifest || manifest.version !== release.version) {
    throw new Error(`built-in plugin ${release.source} does not contain immutable version ${release.version}`);
  }
  const files: Array<{ path: string; contentBase64: string }> = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "manifest.json" || entry.name === "package.json" || entry.name === ".npmignore" || entry.name.includes(".test.")) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const relative = path.relative(root, absolute).split(path.sep).join("/");
        files.push({ path: relative, contentBase64: (await fs.readFile(absolute)).toString("base64") });
      }
    }
  };
  await walk(root);
  return Buffer.from(JSON.stringify({ manifest, files }));
}

function builtinArtifactUrl(release: BuiltinPluginRelease): string {
  return `builtin:${release.source}@${release.version}`;
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, file);
}

const registryMutationQueues = new Map<string, Promise<void>>();

async function withRegistryMutation<T>(dataDir: string, mutation: () => Promise<T>): Promise<T> {
  const key = registryPath(dataDir);
  const previous = registryMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.catch(() => undefined).then(() => gate);
  registryMutationQueues.set(key, queued);
  await previous.catch(() => undefined);
  try {
    return await mutation();
  } finally {
    release();
    if (registryMutationQueues.get(key) === queued) registryMutationQueues.delete(key);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try { return new URL(value).protocol === "https:" ? value : undefined; } catch { return undefined; }
}

function optionalStringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function parseMarketplaceEntry(value: unknown): MarketplaceEntry | null {
  if (!isObject(value) || typeof value.publisher !== "string" || !value.publisher.trim()) return null;
  const manifest = parsePublishablePluginManifest(value.manifest);
  if (!manifest) return null;
  let artifact: MarketplaceEntry["artifact"];
  if (value.artifact !== undefined) {
    if (!isObject(value.artifact) || typeof value.artifact.url !== "string" || typeof value.artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.artifact.sha256)) return null;
    artifact = { url: value.artifact.url, sha256: value.artifact.sha256.toLowerCase() };
  }
  let releases: MarketplaceRelease[] | undefined;
  if (value.releases !== undefined) {
    if (!Array.isArray(value.releases)) return null;
    releases = [];
    for (const raw of value.releases) {
      if (!isObject(raw) || typeof raw.version !== "string" || typeof raw.publishedAt !== "string" || typeof raw.releaseNotes !== "string") return null;
      const releaseManifest = parsePublishablePluginManifest(raw.manifest);
      if (!releaseManifest || releaseManifest.id !== manifest.id || releaseManifest.version !== raw.version || !isObject(raw.artifact) || typeof raw.artifact.url !== "string" || typeof raw.artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.artifact.sha256)) return null;
      releases.push({ version: raw.version, manifest: releaseManifest, artifact: { url: raw.artifact.url, sha256: raw.artifact.sha256.toLowerCase() }, publishedAt: raw.publishedAt, releaseNotes: raw.releaseNotes });
    }
  }
  const sourceFormat = value.sourceFormat === "brainpilot" || value.sourceFormat === "pi-package" || value.sourceFormat === "codex" || value.sourceFormat === "claude-code"
    ? value.sourceFormat
    : undefined;
  const capabilities = Array.isArray(value.capabilities) && value.capabilities.every((item) => item === "skills" || item === "mcp" || item === "hooks")
    ? value.capabilities as Array<"skills" | "mcp" | "hooks">
    : undefined;
  const repositoryUrl = optionalHttpsUrl(value.repositoryUrl);
  const homepage = optionalHttpsUrl(value.homepage);
  const unsupported = optionalStringList(value.unsupported);
  const requirements = optionalStringList(value.requirements);
  return { manifest, publisher: value.publisher.trim(), ...(artifact ? { artifact } : {}), verified: value.verified === true,
    ...(releases?.length ? { releases } : {}),
    ...(value.status === "test" ? { status: "test" as const } : {}),
    ...(homepage ? { homepage } : {}),
    ...(sourceFormat ? { sourceFormat } : {}),
    ...(repositoryUrl ? { repositoryUrl } : {}),
    ...(typeof value.license === "string" ? { license: value.license } : {}),
    ...(typeof value.upstreamRef === "string" ? { upstreamRef: value.upstreamRef } : {}),
    ...(typeof value.upstreamCommit === "string" ? { upstreamCommit: value.upstreamCommit } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(typeof value.executesLocalCode === "boolean" ? { executesLocalCode: value.executesLocalCode } : {}),
    ...(unsupported ? { unsupported } : {}),
    ...(requirements ? { requirements } : {}) };
}

interface MarketplaceSourceDefinition { id: string; type: "https"; url: string; enabled: boolean; }

function parseMarketplaceSourceDefinitions(value: unknown): MarketplaceSourceDefinition[] {
  if (!isObject(value) || !Array.isArray(value.sources)) return [];
  return value.sources.flatMap((source) => {
    if (!isObject(source) || typeof source.id !== "string" || !/^[A-Za-z0-9._-]+$/.test(source.id) || source.type !== "https" || typeof source.url !== "string" || !source.url.startsWith("https://")) return [];
    return [{ id: source.id, type: "https" as const, url: source.url, enabled: source.enabled !== false }];
  });
}

async function readMarketplaceSource(raw: unknown, source: MarketplaceEntry["source"]): Promise<MarketplaceEntry[]> {
  if (!isObject(raw) || !Array.isArray(raw.plugins)) return [];
  return raw.plugins.map(parseMarketplaceEntry).filter((entry): entry is MarketplaceEntry => entry !== null).map((entry) => ({ ...entry, source }));
}

function resolveRemoteArtifacts(entry: MarketplaceEntry, catalogueUrl: string): MarketplaceEntry | null {
  const resolveArtifact = (artifact: NonNullable<MarketplaceEntry["artifact"]>): NonNullable<MarketplaceEntry["artifact"]> | null => {
    try {
      const url = new URL(artifact.url, catalogueUrl);
      return url.protocol === "https:" ? { ...artifact, url: url.toString() } : null;
    } catch { return null; }
  };
  const artifact = entry.artifact ? resolveArtifact(entry.artifact) : undefined;
  if (entry.artifact && !artifact) return null;
  const releases = entry.releases?.map((release) => {
    const resolved = resolveArtifact(release.artifact);
    return resolved ? { ...release, artifact: resolved } : null;
  });
  if (releases?.some((release) => release === null)) return null;
  return { ...entry, ...(artifact ? { artifact } : {}), ...(releases ? { releases: releases as MarketplaceRelease[] } : {}) };
}

export async function loadMarketplaceSources(dataDir: string, fetchFn: typeof fetch = fetch): Promise<{ entries: MarketplaceEntry[]; sources: MarketplaceSourceStatus[] }> {
  const entries: MarketplaceEntry[] = [];
  const sources: MarketplaceSourceStatus[] = [];
  const localRaw = await readJson(marketplacePath(dataDir));
  const localEntries = await readMarketplaceSource(localRaw, { id: "local", type: "local" });
  entries.push(...localEntries);
  sources.push({ id: "local", type: "local", enabled: true, status: "ready", pluginCount: localEntries.length });
  const definitions = parseMarketplaceSourceDefinitions(await readJson(marketplaceSourcesPath(dataDir)));
  for (const definition of definitions) {
    if (!definition.enabled) {
      sources.push({ id: definition.id, type: "https", enabled: false, status: "ready", pluginCount: 0, url: definition.url });
      continue;
    }
    try {
      const response = await fetchFn(definition.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`catalogue request failed (${response.status})`);
      const remoteEntries = (await readMarketplaceSource(await response.json(), { id: definition.id, type: "https" }))
        .map((entry) => resolveRemoteArtifacts(entry, definition.url))
        .filter((entry): entry is MarketplaceEntry => entry !== null);
      entries.push(...remoteEntries);
      sources.push({ id: definition.id, type: "https", enabled: true, status: "ready", pluginCount: remoteEntries.length, url: definition.url });
    } catch (error) {
      sources.push({ id: definition.id, type: "https", enabled: true, status: "error", pluginCount: 0, url: definition.url, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { entries, sources };
}

function deploymentEnvironment(): "local" | "cloud" | "browser" {
  return process.env.BP_LOCAL_MODE === "0" ? "cloud" : "local";
}

function compatibilityFor(manifest: PluginManifest, installed: Record<string, InstalledPlugin> = {}, hostVersion = backendVersion, environment = deploymentEnvironment()): PluginCompatibility {
  const requiredRange = manifest.engines?.brainpilot;
  const issues: PluginCompatibility["issues"] = [];
  if (!isBrainPilotVersionCompatible(requiredRange, hostVersion)) issues.push({ code: "brainpilot-version", severity: "error", message: `Requires BrainPilot ${requiredRange}; current version is ${hostVersion}.` });
  if (manifest.environments?.length && !manifest.environments.includes(environment)) issues.push({ code: "environment", severity: "error", message: `Plugin does not support the ${environment} environment.` });
  for (const [name, required] of Object.entries(manifest.protocols ?? {})) {
    const actual = SUPPORTED_PLUGIN_PROTOCOLS[name as keyof typeof SUPPORTED_PLUGIN_PROTOCOLS];
    if (actual !== required) issues.push({ code: "protocol", severity: "error", message: `Requires ${name} protocol ${required}; host provides ${actual ?? "none"}.` });
  }
  for (const dependency of manifest.dependencies ?? []) {
    const found = installed[dependency.id];
    const severity = dependency.optional ? "warning" as const : "error" as const;
    if (!found) issues.push({ code: "dependency-missing", severity, message: `Dependency ${dependency.id} ${dependency.version} is not installed.` });
    else if (!isBrainPilotVersionCompatible(dependency.version, found.activeVersion)) issues.push({ code: "dependency-version", severity, message: `Dependency ${dependency.id} ${found.activeVersion} does not satisfy ${dependency.version}.` });
    else if (!found.enabled) issues.push({ code: "dependency-disabled", severity, message: `Dependency ${dependency.id} is disabled.` });
  }
  for (const [id, plugin] of Object.entries(installed)) {
    if (!plugin.enabled || id === manifest.id) continue;
    if (manifest.conflicts?.includes(id) || plugin.manifest.conflicts?.includes(manifest.id)) issues.push({ code: "plugin-conflict", severity: "error", message: `Conflicts with enabled plugin ${id}.` });
  }
  const compatible = !issues.some((issue) => issue.severity === "error");
  return {
    brainpilotVersion: hostVersion,
    ...(requiredRange ? { requiredRange } : {}),
    declared: Boolean(requiredRange),
    compatible,
    status: compatible ? issues.length ? "warning" : "compatible" : "incompatible",
    issues,
  };
}

function assertEnabledPluginsCompatible(plugins: Record<string, InstalledPlugin>): void {
  const failures = Object.values(plugins).flatMap((plugin) => {
    if (!plugin.enabled) return [];
    return compatibilityFor(plugin.manifest, plugins).issues
      .filter((issue) => issue.severity === "error")
      .map((issue) => `${plugin.manifest.id}: ${issue.message}`);
  });
  if (failures.length) throw new Error(failures.join(" "));
}

export async function preflightPluginCompatibility(dataDir: string, targetVersion: string, environment: "local" | "cloud" | "browser" = deploymentEnvironment()): Promise<Array<{ pluginId: string; activeVersion: string; enabled: boolean; compatibility: PluginCompatibility }>> {
  if (!isPluginVersion(targetVersion)) throw new Error("target BrainPilot version must be SemVer");
  const registry = await readRegistry(dataDir);
  return Object.values(registry.plugins).map((plugin) => ({
    pluginId: plugin.manifest.id,
    activeVersion: plugin.activeVersion,
    enabled: plugin.enabled,
    compatibility: compatibilityFor(plugin.manifest, registry.plugins, targetVersion, environment),
  }));
}

async function readRegistry(dataDir: string): Promise<RegistryFile> {
  const raw = await readJson(registryPath(dataDir));
  if (!isObject(raw) || !isObject(raw.plugins)) return { plugins: {} };
  const plugins: Record<string, InstalledPlugin> = {};
  for (const [id, item] of Object.entries(raw.plugins)) {
    if (!isObject(item)) continue;
    const manifest = parsePluginManifest(item.manifest);
    if (!manifest || manifest.id !== id || typeof item.publisher !== "string" || typeof item.installedAt !== "string") continue;
    const activeVersion = typeof item.activeVersion === "string" ? item.activeVersion : manifest.version;
    if (activeVersion !== manifest.version) continue;
    const repositoryUrl = optionalHttpsUrl(item.repositoryUrl);
    plugins[id] = {
      manifest,
      publisher: item.publisher,
      verified: item.verified === true,
      enabled: item.enabled === true,
      installedAt: item.installedAt,
      activeVersion,
      ...(typeof item.previousVersion === "string" ? { previousVersion: item.previousVersion } : {}),
      ...(typeof item.updatedAt === "string" ? { updatedAt: item.updatedAt } : {}),
      ...(item.sourceFormat === "brainpilot" || item.sourceFormat === "pi-package" || item.sourceFormat === "codex" || item.sourceFormat === "claude-code"
        ? { sourceFormat: item.sourceFormat }
        : {}),
      ...(Array.isArray(item.unsupported) && item.unsupported.every((entry) => typeof entry === "string")
        ? { unsupported: item.unsupported as string[] }
        : {}),
      ...(repositoryUrl ? { repositoryUrl } : {}),
      ...(typeof item.executesLocalCode === "boolean" ? { executesLocalCode: item.executesLocalCode } : {}),
      ...(isObject(item.executionTrust) && item.executionTrust.version === activeVersion && typeof item.executionTrust.trustedAt === "string"
        ? { executionTrust: { version: activeVersion, trustedAt: item.executionTrust.trustedAt } }
        : {}),
    };
  }
  for (const plugin of Object.values(plugins)) plugin.compatibility = compatibilityFor(plugin.manifest, plugins);
  return { plugins };
}

export async function listMarketplace(dataDir: string): Promise<MarketplaceEntry[]> {
  const { entries: configured } = await loadMarketplaceSources(dataDir);
  const builtinReleases = await Promise.all(BUILTIN_PLUGIN_RELEASES.map(async (release): Promise<MarketplaceRelease> => {
    const bytes = await readBuiltinPluginBundle(release);
    return {
      version: release.version,
      manifest: parseBundle(bytes).manifest,
      artifact: { url: builtinArtifactUrl(release), sha256: createHash("sha256").update(bytes).digest("hex") },
      publishedAt: release.publishedAt,
      releaseNotes: release.releaseNotes,
    };
  }));
  const releaseGroups = new Map<string, MarketplaceRelease[]>();
  for (const release of builtinReleases) {
    const group = releaseGroups.get(release.manifest.id) ?? [];
    group.push(release);
    releaseGroups.set(release.manifest.id, group);
  }
  const builtins = [...releaseGroups.values()].map((releases): MarketplaceEntry => {
    releases.sort((left, right) => comparePluginVersions(right.version, left.version));
    const latest = releases[0]!;
    const builtin = BUILTIN_PLUGIN_RELEASES.find((release) => release.version === latest.version && latest.artifact.url === builtinArtifactUrl(release));
    const capabilities = builtin?.capabilities ?? (latest.manifest.contributes?.skills?.length ? ["skills" as const] : []);
    return {
      manifest: latest.manifest,
      publisher: builtin?.publisher ?? "BrainPilot",
      verified: builtin?.verified ?? true,
      artifact: latest.artifact,
      releases,
      source: { id: "builtin", type: "builtin" },
      sourceFormat: builtin?.sourceFormat ?? "brainpilot",
      repositoryUrl: builtin?.repositoryUrl ?? "https://github.com/NeuroAIHub/BrainPilot",
      ...(builtin?.license ? { license: builtin.license } : {}),
      ...(builtin?.upstreamRef ? { upstreamRef: builtin.upstreamRef } : {}),
      ...(builtin?.upstreamCommit ? { upstreamCommit: builtin.upstreamCommit } : {}),
      ...(builtin?.requirements ? { requirements: builtin.requirements } : {}),
      ...(builtin?.executesLocalCode ? { executesLocalCode: true } : {}),
      ...(capabilities.length ? { capabilities } : {}),
      ...(builtin?.status === "test" || builtin && TEST_PLUGIN_SOURCES.has(builtin.plugin) ? { status: "test" as const } : {}),
    };
  });
  const selected = new Map(builtins.map((entry) => [entry.manifest.id, entry]));
  for (const entry of configured) selected.set(entry.manifest.id, entry);
  const registry = await readRegistry(dataDir);
  return [...selected.values()]
    .map((entry) => {
      const latestCompatibleVersion = compatibleReleases(entry)[0]?.version;
      return {
        ...entry,
        compatibility: compatibilityFor(entry.manifest, registry.plugins),
        ...(latestCompatibleVersion ? { latestCompatibleVersion } : {}),
      };
    });
}

export async function listMarketplaceSourceStatuses(dataDir: string): Promise<MarketplaceSourceStatus[]> {
  const loaded = await loadMarketplaceSources(dataDir);
  return [{ id: "builtin", type: "builtin", enabled: true, status: "ready", pluginCount: new Set(BUILTIN_PLUGIN_RELEASES.map((release) => release.plugin)).size }, ...loaded.sources];
}

export async function listInstalledPlugins(dataDir: string): Promise<InstalledPlugin[]> {
  const registry = await readRegistry(dataDir);
  return Object.values(registry.plugins).sort((a, b) => a.manifest.displayName.localeCompare(b.manifest.displayName));
}

export async function listEnabledRuntimeTools(dataDir: string): Promise<string[]> {
  return [...new Set((await listInstalledPlugins(dataDir)).flatMap((plugin) =>
    plugin.enabled && plugin.compatibility?.compatible !== false
      ? (plugin.manifest.contributes?.runtimeTools ?? []).map((tool) => tool.capability)
      : [],
  ))];
}

export interface EnabledRuntimeExtension {
  pluginId: string; pluginVersion: string; extension: RuntimeExtensionContribution; permissions: PluginPermission[];
  skillEntries: Array<{ entry: string; targets?: string[] }>;
}

export async function listEnabledRuntimeExtensions(dataDir: string): Promise<EnabledRuntimeExtension[]> {
  return (await listInstalledPlugins(dataDir)).flatMap((plugin) =>
    plugin.enabled && plugin.compatibility?.compatible !== false && plugin.executionTrust?.version === plugin.activeVersion
      ? (plugin.manifest.contributes?.runtimeExtensions ?? []).map((extension) => ({
          pluginId: plugin.manifest.id, pluginVersion: plugin.activeVersion, extension,
          permissions: plugin.manifest.permissions ?? [],
          skillEntries: (plugin.manifest.contributes?.skills ?? []).map((skill) => ({ entry: skill.entry, ...(skill.targets ? { targets: skill.targets } : {}) })),
        }))
      : [],
  );
}

/** Opt-in gate for sharing the active file/preview context with chat. */
export async function isFileContextBridgeEnabled(dataDir: string): Promise<boolean> {
  return (await listInstalledPlugins(dataDir)).some((plugin) =>
    plugin.enabled
    && plugin.compatibility?.compatible !== false
    && plugin.manifest.id === "org.brainpilot.file-context-bridge",
  );
}

async function readArtifact(dataDir: string, artifact: NonNullable<MarketplaceEntry["artifact"]>): Promise<Buffer> {
  const maxBytes = 10 * 1024 * 1024;
  if (artifact.url.startsWith("builtin:")) {
    const identifier = artifact.url.slice("builtin:".length);
    const release = BUILTIN_PLUGIN_RELEASES.find((candidate) => `${candidate.source}@${candidate.version}` === identifier);
    if (!release) throw new Error("unknown built-in plugin artifact");
    return readBuiltinPluginBundle(release);
  }
  if (artifact.url.startsWith("https://")) {
    const response = await fetch(artifact.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`plugin artifact download failed (${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("plugin artifact exceeds 10 MiB limit");
    return bytes;
  }
  // Local catalogues may use a relative path. Never permit arbitrary absolute
  // paths or traversal: hosted deployments must not turn their marketplace into
  // a host-file read endpoint.
  if (path.isAbsolute(artifact.url) || artifact.url.includes("://")) throw new Error("plugin artifact URL must use https or a relative path");
  const base = path.dirname(marketplacePath(dataDir));
  const target = path.resolve(base, artifact.url);
  if (!target.startsWith(`${base}${path.sep}`)) throw new Error("plugin artifact path escapes marketplace directory");
  const bytes = await fs.readFile(target);
  if (bytes.length > maxBytes) throw new Error("plugin artifact exceeds 10 MiB limit");
  return bytes;
}

function safeBundlePath(value: string): boolean {
  return isSafePluginPath(value);
}

function parseBundle(bytes: Buffer, expected?: PluginManifest): PluginBundle {
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString("utf8")) as unknown; } catch { throw new Error("plugin artifact is not valid JSON"); }
  if (!isObject(raw)) throw new Error("plugin artifact must be an object");
  const manifest = parsePluginManifest(raw.manifest);
  if (!manifest || (expected && (manifest.id !== expected.id || manifest.version !== expected.version))) throw new Error("plugin artifact manifest does not match marketplace entry");
  if (raw.files !== undefined && !Array.isArray(raw.files)) throw new Error("plugin artifact files must be an array");
  const files: PluginBundle["files"] = [];
  const paths = new Set<string>();
  for (const file of raw.files ?? []) {
    if (!isObject(file) || typeof file.path !== "string" || typeof file.contentBase64 !== "string") throw new Error("invalid plugin artifact file");
    if (!safeBundlePath(file.path)) throw new Error("plugin artifact file escapes bundle");
    if (paths.has(file.path)) throw new Error(`plugin artifact contains duplicate file: ${file.path}`);
    paths.add(file.path);
    const decoded = Buffer.from(file.contentBase64, "base64");
    if (decoded.length > 5 * 1024 * 1024) throw new Error("plugin artifact file exceeds 5 MiB limit");
    files.push({ path: file.path, contentBase64: file.contentBase64 });
  }
  if (files.length > 200) throw new Error("plugin artifact has too many files");
  const contributions = manifest.contributes;
  const requiredEntries = [
    ...(contributions?.previewers ?? []),
    ...(contributions?.skills ?? []),
    ...(contributions?.knowledgeBases ?? []),
    ...(contributions?.panels ?? []),
    ...(contributions?.literatureProviders ?? []),
    ...(contributions?.workflows ?? []),
    ...(contributions?.agentInstructions ?? []),
    ...(contributions?.runtimeExtensions ?? []),
  ].map((contribution) => contribution.entry);
  for (const entry of requiredEntries) {
    if (!paths.has(entry)) throw new Error(`plugin artifact is missing contribution entry: ${entry}`);
  }
  return { manifest, files };
}

async function installBundle(dataDir: string, bundle: PluginBundle): Promise<void> {
  const destination = installedVersionPath(dataDir, bundle.manifest);
  try { await fs.access(destination); return; } catch { /* install below */ }
  const temporary = `${destination}.${randomUUID()}.tmp`;
  await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
  try {
    await fs.writeFile(path.join(temporary, "manifest.json"), JSON.stringify(bundle.manifest, null, 2) + "\n", { mode: 0o600 });
    for (const file of bundle.files ?? []) {
      const target = path.resolve(temporary, file.path);
      if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error("plugin artifact file escapes bundle");
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, Buffer.from(file.contentBase64, "base64"), { mode: 0o600 });
    }
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.rename(temporary, destination);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

interface ExternalPluginMetadata {
  format: PluginSourceFormat;
  unsupported: string[];
  mcpConfigPath?: string;
  hookConfig?: { dialect: "codex" | "claude-code"; path: string };
  extensionPaths?: string[];
}

function externalSkillId(skillPath: string, used: Set<string>): string {
  const base = path.basename(path.dirname(skillPath)).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "skill";
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  used.add(candidate);
  return candidate;
}

function externalInstructionId(instructionPath: string, used: Set<string>): string {
  const base = path.basename(instructionPath, path.extname(instructionPath)).toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "instructions";
  let candidate = base;
  for (let suffix = 2; used.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  used.add(candidate);
  return candidate;
}

async function pathExists(target: string): Promise<boolean> {
  try { await fs.access(target); return true; } catch { return false; }
}

async function copyExternalTree(sourceRoot: string, destinationRoot: string): Promise<void> {
  let files = 0;
  let bytes = 0;
  const walk = async (source: string, destination: string): Promise<void> => {
    const stat = await fs.lstat(source);
    const relative = path.relative(sourceRoot, source);
    if (relative.split(path.sep).some((part) => part === ".git" || part === ".hg" || part === ".svn")) return;
    if (stat.isSymbolicLink()) {
      const target = await fs.realpath(source);
      const root = await fs.realpath(sourceRoot);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error(`Imported plugin symbolic link escapes its root: ${relative}`);
      const targetStat = await fs.stat(target);
      if (!targetStat.isFile()) throw new Error(`Imported plugin symbolic links must target files: ${relative}`);
      await copyFile(target, destination, relative, targetStat);
      return;
    }
    if (stat.isDirectory()) {
      await fs.mkdir(destination, { recursive: true, mode: 0o700 });
      for (const entry of await fs.readdir(source)) await walk(path.join(source, entry), path.join(destination, entry));
      return;
    }
    if (!stat.isFile()) return;
    await copyFile(source, destination, relative, stat);
  };
  const copyFile = async (source: string, destination: string, relative: string, stat: Stats): Promise<void> => {
    files += 1;
    bytes += stat.size;
    if (files > 200) throw new Error("Imported plugin has more than 200 files");
    if (stat.size > 5 * 1024 * 1024) throw new Error(`Imported plugin file exceeds 5 MiB: ${relative}`);
    if (bytes > 10 * 1024 * 1024) throw new Error("Imported plugin exceeds 10 MiB");
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.copyFile(source, destination);
    await fs.chmod(destination, stat.mode & 0o777);
  };
  await walk(sourceRoot, destinationRoot);
}

function externalManifest(resolved: ResolvedExternalPlugin): PluginManifest {
  const used = new Set<string>();
  const skills = resolved.skillPaths.map((skillPath) => ({
    id: externalSkillId(skillPath, used),
    title: path.basename(path.dirname(skillPath)),
    description: `Agent Skill imported from ${resolved.format}`,
    entry: path.relative(resolved.root, skillPath).split(path.sep).join("/"),
  }));
  const instructionIds = new Set<string>();
  const agentInstructions = resolved.instructionPaths.map((instructionPath) => ({
    id: externalInstructionId(instructionPath, instructionIds),
    title: path.basename(instructionPath, path.extname(instructionPath)),
    entry: path.relative(resolved.root, instructionPath).split(path.sep).join("/"),
    targets: ["principal"],
    mode: "append" as const,
  }));
  const contributes = {
    ...(skills.length > 0 ? { skills } : {}),
    ...(agentInstructions.length > 0 ? { agentInstructions } : {}),
  };
  const parsed = parsePluginManifest({
    id: resolved.id,
    version: resolved.version,
    apiVersion: PLUGIN_API_VERSION,
    displayName: resolved.displayName,
    description: resolved.description,
    categories: skills.length > 0 ? ["skills"] : ["other"],
    environments: ["local"],
    permissions: ["read:workspace", "read:data", "compute:worker", "network"],
    ...(agentInstructions.length > 0 ? { protocols: { agentInstructions: "1" } } : {}),
    contributes,
  });
  if (!parsed) throw new Error("Could not synthesize a valid BrainPilot manifest for the imported plugin");
  return parsed;
}

async function materializeExternalPlugin(
  dataDir: string,
  resolved: ResolvedExternalPlugin,
  manifest: PluginManifest,
): Promise<ExternalPluginMetadata> {
  const destination = installedVersionPath(dataDir, manifest);
  if (await pathExists(destination)) throw new Error(`${manifest.id}@${manifest.version} is already installed`);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await copyExternalTree(resolved.root, temporary);
    const internal = path.join(temporary, ".brainpilot");
    await fs.mkdir(internal, { recursive: true, mode: 0o700 });
    let mcpConfigPath = resolved.mcpConfigPath
      ? path.relative(resolved.root, resolved.mcpConfigPath).split(path.sep).join("/")
      : undefined;
    if (resolved.inlineMcpConfig) {
      mcpConfigPath = ".brainpilot/mcp.json";
      await fs.writeFile(path.join(temporary, mcpConfigPath), JSON.stringify(resolved.inlineMcpConfig, null, 2) + "\n", { mode: 0o600 });
    }
    let hookConfig = resolved.hookConfig ? {
      dialect: resolved.hookConfig.dialect,
      path: path.relative(resolved.root, resolved.hookConfig.path).split(path.sep).join("/"),
    } : undefined;
    if (resolved.inlineHookConfig) {
      const dialect = resolved.format === "codex" ? "codex" as const : "claude-code" as const;
      hookConfig = { dialect, path: ".brainpilot/hooks.json" };
      await fs.writeFile(path.join(temporary, hookConfig.path), JSON.stringify(resolved.inlineHookConfig, null, 2) + "\n", { mode: 0o600 });
    }
    const metadata: ExternalPluginMetadata = {
      format: resolved.format,
      unsupported: resolved.unsupported,
      ...(mcpConfigPath ? { mcpConfigPath } : {}),
      ...(hookConfig ? { hookConfig } : {}),
      ...(resolved.extensionPaths?.length ? { extensionPaths: resolved.extensionPaths.map((entry) => path.relative(resolved.root, entry).split(path.sep).join("/")) } : {}),
    };
    await fs.writeFile(path.join(internal, "source.json"), JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
    await fs.writeFile(path.join(temporary, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await fs.rename(temporary, destination);
    return metadata;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function readExternalMetadata(dataDir: string, manifest: PluginManifest): Promise<ExternalPluginMetadata | null> {
  const raw = await readJson(externalMetadataPath(dataDir, manifest));
  if (!isObject(raw) || (raw.format !== "brainpilot" && raw.format !== "pi-package" && raw.format !== "codex" && raw.format !== "claude-code")) return null;
  const unsupported = Array.isArray(raw.unsupported) && raw.unsupported.every((entry) => typeof entry === "string") ? raw.unsupported as string[] : [];
  const mcpConfigPath = typeof raw.mcpConfigPath === "string" && isSafePluginPath(raw.mcpConfigPath) ? raw.mcpConfigPath : undefined;
  const hookConfig = isObject(raw.hookConfig)
    && (raw.hookConfig.dialect === "codex" || raw.hookConfig.dialect === "claude-code")
    && typeof raw.hookConfig.path === "string" && isSafePluginPath(raw.hookConfig.path)
    ? { dialect: raw.hookConfig.dialect as "codex" | "claude-code", path: raw.hookConfig.path }
    : undefined;
  const extensionPaths = Array.isArray(raw.extensionPaths)
    && raw.extensionPaths.every((entry) => typeof entry === "string" && isSafePluginPath(entry))
    ? raw.extensionPaths as string[]
    : undefined;
  return { format: raw.format, unsupported, ...(mcpConfigPath ? { mcpConfigPath } : {}), ...(hookConfig ? { hookConfig } : {}), ...(extensionPaths?.length ? { extensionPaths } : {}) };
}

async function runtimeProjectionFor(dataDir: string, manifest: PluginManifest, metadata: ExternalPluginMetadata): Promise<PluginRuntimeProjection> {
  const installedRoot = path.resolve(installedVersionPath(dataDir, manifest));
  const root = path.resolve(pluginsDir(dataDir), "execution", manifest.id, manifest.version);
  if (!await pathExists(root)) {
    const temporary = `${root}.${randomUUID()}.tmp`;
    try {
      await copyExternalTree(installedRoot, temporary);
      await fs.mkdir(path.dirname(root), { recursive: true, mode: 0o700 });
      await fs.rename(temporary, root);
    } catch (error) {
      await fs.rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }
  const safe = (relative: string): string => {
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`)) throw new Error("External plugin runtime path escapes its installed directory");
    return target;
  };
  return {
    schemaVersion: 1,
    id: manifest.id,
    version: manifest.version,
    format: metadata.format,
    root,
    dataDir: path.resolve(pluginsDir(dataDir), "data", manifest.id, manifest.version),
    ...(metadata.mcpConfigPath ? { mcpConfigPath: safe(metadata.mcpConfigPath) } : {}),
    ...(metadata.hookConfig ? { hookConfig: { dialect: metadata.hookConfig.dialect, path: safe(metadata.hookConfig.path) } } : {}),
    ...(metadata.extensionPaths?.length ? { extensionPaths: metadata.extensionPaths.map(safe) } : {}),
  };
}

function mcpServersFrom(value: unknown): Record<string, Record<string, unknown>> {
  if (!isObject(value)) throw new Error("MCP config must be an object");
  const servers = isObject(value.mcpServers) ? value.mcpServers : value;
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, spec] of Object.entries(servers)) {
    if (!name.trim() || !isObject(spec)) throw new Error("MCP server entries must be named objects");
    result[name] = spec;
  }
  return result;
}

async function executableAvailable(command: string): Promise<boolean> {
  if (path.isAbsolute(command) || command.includes(path.sep)) return pathExists(command);
  for (const directory of (process.env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    if (await pathExists(path.join(directory, command))) return true;
    if (process.platform === "win32" && await pathExists(path.join(directory, `${command}.cmd`))) return true;
  }
  return false;
}

async function preflightExternalRuntime(dataDir: string, projection: PluginRuntimeProjection): Promise<void> {
  if (!projection.mcpConfigPath) return;
  const servers = mcpServersFrom(await readJson(projection.mcpConfigPath));
  const occupied = new Map<string, string>();
  for (const globalPath of [path.join(dataDir, "bp_template", "mcp_servers.json"), path.join(dataDir, ".bp", "mcp_servers.json")]) {
    const global = await readJson(globalPath);
    if (!global) continue;
    for (const name of Object.keys(mcpServersFrom(global))) occupied.set(name, "global MCP configuration");
    break;
  }
  let runtimeEntries: string[] = [];
  try { runtimeEntries = await fs.readdir(pluginRuntimeDir(dataDir)); } catch { /* no enabled foreign plugins */ }
  for (const entry of runtimeEntries.filter((name) => name.endsWith(".json"))) {
    const other = await readJson(path.join(pluginRuntimeDir(dataDir), entry));
    if (!isObject(other) || typeof other.id !== "string" || other.id === projection.id || typeof other.mcpConfigPath !== "string") continue;
    const config = await readJson(other.mcpConfigPath);
    if (!config) continue;
    for (const name of Object.keys(mcpServersFrom(config))) occupied.set(name, other.id);
  }
  for (const [name, spec] of Object.entries(servers)) {
    const owner = occupied.get(name);
    if (owner) throw new Error(`MCP server name conflict: ${name} is already provided by ${owner}`);
    const type = typeof spec.type === "string" ? spec.type : "stdio";
    if (type === "stdio") {
      if (typeof spec.command !== "string" || !spec.command.trim()) throw new Error(`MCP server ${name} requires a command`);
      if (!await executableAvailable(spec.command)) throw new Error(`MCP server ${name} command is not available: ${spec.command}`);
    } else if ((type === "http" || type === "sse") && typeof spec.url !== "string") {
      throw new Error(`MCP server ${name} requires a URL`);
    }
    const supplied = new Set(["BRAINPILOT_PLUGIN_ROOT", "BRAINPILOT_PLUGIN_DATA", "CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "CLAUDE_MEM_DATA_DIR", "PLUGIN_ROOT"]);
    const configuredEnv = isObject(spec.env) ? spec.env : {};
    for (const key of Object.keys(configuredEnv)) supplied.add(key);
    for (const value of [...Object.values(configuredEnv), ...(isObject(spec.headers) ? Object.values(spec.headers) : [])]) {
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
        const variable = match[1]!;
        if (!supplied.has(variable) && process.env[variable] === undefined) throw new Error(`MCP server ${name} requires environment variable ${variable}`);
      }
    }
  }
}

async function runExternalSetup(projection: PluginRuntimeProjection): Promise<void> {
  if (!projection.hookConfig) return;
  const marker = path.join(projection.dataDir, `.setup-${projection.version}`);
  if (await pathExists(marker)) return;
  await fs.mkdir(projection.dataDir, { recursive: true, mode: 0o700 });
  const results = await runCompatHookEvent(projection, "Setup", {
    session_id: "setup",
    cwd: projection.root,
    hook_event_name: "Setup",
    plugin_id: projection.id,
  });
  const failure = results.find((result) => !result.ok);
  if (failure) throw new Error(`Plugin Setup hook failed${failure.stderr.trim() ? `: ${failure.stderr.trim()}` : ""}`);
  await fs.writeFile(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
}

async function syncExternalRuntimeProjection(dataDir: string, manifest: PluginManifest, enabled: boolean): Promise<void> {
  const target = path.join(pluginRuntimeDir(dataDir), `${manifest.id}.json`);
  if (!enabled) { await fs.rm(target, { force: true }); return; }
  const metadata = await readExternalMetadata(dataDir, manifest);
  if (!metadata) return;
  const projection = await runtimeProjectionFor(dataDir, manifest, metadata);
  await preflightExternalRuntime(dataDir, projection);
  await runExternalSetup(projection);
  await writeJsonAtomic(target, projection);
}

/** Import a local Codex, Claude Code, or Pi package into the immutable registry. */
export async function importExternalPlugin(
  dataDir: string,
  directory: string,
  format: ImportablePluginSourceFormat | "auto" = "auto",
  environment: "local" | "cloud" | "browser" = deploymentEnvironment(),
): Promise<InstalledPlugin> {
  if (environment !== "local") throw new Error("Local plugin directory import is only available in local deployments");
  return withRegistryMutation(dataDir, async () => {
    const resolved = await resolveExternalPlugin(directory, format);
    const manifest = externalManifest(resolved);
    const registry = await readRegistry(dataDir);
    if (registry.plugins[manifest.id]) throw new Error(`Plugin ${manifest.id} is already installed`);
    const metadata = await materializeExternalPlugin(dataDir, resolved, manifest);
    const installed: InstalledPlugin = {
      manifest,
      publisher: resolved.publisher,
      verified: false,
      enabled: false,
      installedAt: new Date().toISOString(),
      activeVersion: manifest.version,
      sourceFormat: metadata.format,
      executesLocalCode: Boolean(resolved.mcpConfigPath || resolved.inlineMcpConfig || resolved.hookConfig || resolved.inlineHookConfig),
      unsupported: metadata.unsupported,
      ...(resolved.repositoryUrl ? { repositoryUrl: resolved.repositoryUrl } : {}),
    };
    installed.compatibility = compatibilityFor(manifest, { ...registry.plugins, [manifest.id]: installed });
    registry.plugins[manifest.id] = installed;
    await writeJsonAtomic(registryPath(dataDir), registry);
    return installed;
  });
}

function releasesForEntry(entry: MarketplaceEntry): MarketplaceRelease[] {
  if (entry.releases?.length) return [...entry.releases].sort((left, right) => comparePluginVersions(right.version, left.version));
  return entry.artifact ? [{
    version: entry.manifest.version,
    manifest: entry.manifest,
    artifact: entry.artifact,
    publishedAt: "",
    releaseNotes: "",
  }] : [];
}

function compatibleReleases(entry: MarketplaceEntry): MarketplaceRelease[] {
  return releasesForEntry(entry).filter((release) => {
    const compatibility = compatibilityFor(release.manifest);
    return !compatibility.issues.some((issue) => ["brainpilot-version", "environment", "protocol"].includes(issue.code) && issue.severity === "error");
  });
}

async function downloadRelease(dataDir: string, release: MarketplaceRelease): Promise<PluginBundle> {
  const bytes = await readArtifact(dataDir, release.artifact);
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== release.artifact.sha256) throw new Error("plugin artifact checksum mismatch");
  return parseBundle(bytes, release.manifest);
}

/** Download, verify, and atomically install a JSON Plugin Bundle from the local curated catalogue. */
export async function installPlugin(dataDir: string, id: string, requestedVersion?: string): Promise<InstalledPlugin | null> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    if (registry.plugins[id]) return registry.plugins[id]!;
    const entry = (await listMarketplace(dataDir)).find((candidate) => candidate.manifest.id === id);
    if (!entry) return null;
    const releases = releasesForEntry(entry);
    const release = requestedVersion ? releases.find((candidate) => candidate.version === requestedVersion) : compatibleReleases(entry)[0];
    if (!release) throw new Error(requestedVersion ? `plugin version ${requestedVersion} is not available` : "plugin marketplace entry has no compatible downloadable release");
    const compatibility = compatibilityFor(release.manifest, registry.plugins);
    if (!compatibility.compatible) throw new Error(compatibility.issues.map((issue) => issue.message).join(" "));
    await installBundle(dataDir, await downloadRelease(dataDir, release));
    const installed: InstalledPlugin = {
      manifest: release.manifest,
      publisher: entry.publisher,
      verified: entry.verified === true,
      enabled: false,
      installedAt: new Date().toISOString(),
      activeVersion: release.version,
      sourceFormat: entry.sourceFormat ?? "brainpilot",
      executesLocalCode: entry.executesLocalCode ?? Boolean(entry.capabilities?.some((capability) => capability === "mcp" || capability === "hooks")),
      ...(entry.repositoryUrl ? { repositoryUrl: entry.repositoryUrl } : {}),
      ...(entry.unsupported?.length ? { unsupported: entry.unsupported } : {}),
    };
    installed.compatibility = compatibilityFor(release.manifest, { ...registry.plugins, [id]: installed });
    registry.plugins[id] = installed;
    await writeJsonAtomic(registryPath(dataDir), registry);
    return installed;
  });
}

function nextUpdate(entry: MarketplaceEntry, currentVersion: string): MarketplaceRelease | undefined {
  return compatibleReleases(entry).find((release) => comparePluginVersions(release.version, currentVersion) > 0);
}

export async function listPluginUpdates(dataDir: string): Promise<PluginUpdateStatus[]> {
  const [registry, marketplace] = await Promise.all([readRegistry(dataDir), listMarketplace(dataDir)]);
  return Object.values(registry.plugins).map((installed) => {
    const entry = marketplace.find((candidate) => candidate.manifest.id === installed.manifest.id);
    const update = entry ? nextUpdate(entry, installed.activeVersion) : undefined;
    return {
      pluginId: installed.manifest.id,
      currentVersion: installed.activeVersion,
      latestVersion: update?.version ?? installed.activeVersion,
      updateAvailable: Boolean(update),
      ...(installed.previousVersion ? { previousVersion: installed.previousVersion } : {}),
      ...(update?.releaseNotes ? { releaseNotes: update.releaseNotes } : {}),
      ...(update?.publishedAt ? { publishedAt: update.publishedAt } : {}),
    };
  });
}

async function readInstalledManifest(dataDir: string, id: string, version: string): Promise<PluginManifest | null> {
  const raw = await readJson(path.join(pluginsDir(dataDir), "installed", id, version, "manifest.json"));
  const manifest = parsePluginManifest(raw);
  return manifest?.id === id && manifest.version === version ? manifest : null;
}

async function pruneInstalledVersions(dataDir: string, id: string, keep: string[]): Promise<void> {
  const root = path.join(pluginsDir(dataDir), "installed", id);
  let versions: string[];
  try { versions = await fs.readdir(root); } catch { return; }
  await Promise.all(versions.filter((version) => !keep.includes(version)).map((version) => fs.rm(path.join(root, version), { recursive: true, force: true })));
}

export async function updatePlugin(dataDir: string, id: string): Promise<InstalledPlugin | null> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    const installed = registry.plugins[id];
    if (!installed) return null;
    const entry = (await listMarketplace(dataDir)).find((candidate) => candidate.manifest.id === id);
    const release = entry ? nextUpdate(entry, installed.activeVersion) : undefined;
    if (!release) throw new Error("no compatible plugin update is available");
    if (installed.enabled) {
      await syncDeclarativeContributions(dataDir, installed.manifest, false);
      await syncExternalRuntimeProjection(dataDir, installed.manifest, false);
    }
    await installBundle(dataDir, await downloadRelease(dataDir, release));
    const previousVersion = installed.activeVersion;
    installed.manifest = release.manifest;
    installed.activeVersion = release.version;
    installed.previousVersion = previousVersion;
    installed.updatedAt = new Date().toISOString();
    installed.enabled = false;
    delete installed.executionTrust;
    installed.executesLocalCode = entry?.executesLocalCode ?? Boolean(entry?.capabilities?.some((capability) => capability === "mcp" || capability === "hooks"));
    installed.compatibility = compatibilityFor(release.manifest, registry.plugins);
    assertEnabledPluginsCompatible(registry.plugins);
    if (installed.enabled) await syncDeclarativeContributions(dataDir, installed.manifest, true);
    await writeJsonAtomic(registryPath(dataDir), registry);
    await pruneInstalledVersions(dataDir, id, [installed.activeVersion, previousVersion]);
    return installed;
  });
}

export async function rollbackPlugin(dataDir: string, id: string): Promise<InstalledPlugin | null> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    const installed = registry.plugins[id];
    if (!installed) return null;
    if (!installed.previousVersion) throw new Error("plugin has no previous version to restore");
    const previousManifest = await readInstalledManifest(dataDir, id, installed.previousVersion);
    if (!previousManifest) throw new Error("previous plugin version is no longer installed");
    const rollbackCompatibility = compatibilityFor(previousManifest, registry.plugins);
    if (!rollbackCompatibility.compatible) throw new Error(rollbackCompatibility.issues.map((issue) => issue.message).join(" "));
    if (installed.enabled) {
      await syncDeclarativeContributions(dataDir, installed.manifest, false);
      await syncExternalRuntimeProjection(dataDir, installed.manifest, false);
    }
    const replacedVersion = installed.activeVersion;
    installed.manifest = previousManifest;
    installed.activeVersion = previousManifest.version;
    installed.previousVersion = replacedVersion;
    installed.updatedAt = new Date().toISOString();
    installed.enabled = false;
    delete installed.executionTrust;
    installed.compatibility = compatibilityFor(previousManifest, registry.plugins);
    assertEnabledPluginsCompatible(registry.plugins);
    if (installed.enabled) await syncDeclarativeContributions(dataDir, installed.manifest, true);
    await writeJsonAtomic(registryPath(dataDir), registry);
    return installed;
  });
}

function skillProjectionRoot(dataDir: string, manifest: PluginManifest): string {
  const category = `99_Marketplace_${manifest.id.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  return path.join(dataDir, "bp_template", "skills-router", category);
}

function agentInstructionProjectionRoot(dataDir: string, manifest: PluginManifest): string {
  return path.join(dataDir, "bp_template", "agent-instructions", manifest.id.replace(/[^A-Za-z0-9._-]/g, "_"));
}

async function replaceProjection(target: string, build: (temporary: string) => Promise<void>): Promise<void> {
  const temporary = `${target}.${randomUUID()}.tmp`;
  await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
  try {
    await build(temporary);
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function syncSkillContributions(dataDir: string, manifest: PluginManifest, enabled: boolean): Promise<void> {
  const targetRoot = skillProjectionRoot(dataDir, manifest);
  if (!enabled) { await fs.rm(targetRoot, { recursive: true, force: true }); return; }
  const skills = manifest.contributes?.skills ?? [];
  if (skills.length === 0) return;
  await replaceProjection(targetRoot, async (temporary) => {
    const installedRoot = path.resolve(installedVersionPath(dataDir, manifest));
    for (const skill of skills) {
      const entry = path.resolve(installedRoot, skill.entry);
      if (!entry.startsWith(`${installedRoot}${path.sep}`) || path.basename(entry).toLowerCase() !== "skill.md") {
        throw new Error("skill entry must be a safe SKILL.md inside the plugin bundle");
      }
      const target = path.resolve(temporary, skill.id);
      if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error("skill id escapes marketplace category");
      await fs.cp(path.dirname(entry), target, { recursive: true, force: false, errorOnExist: true });
    }
  });
}

/** BrainPilot-native compatibility adapter; not part of the cross-host plugin IR. */
async function syncAgentInstructionContributions(dataDir: string, manifest: PluginManifest, enabled: boolean): Promise<void> {
  const targetRoot = agentInstructionProjectionRoot(dataDir, manifest);
  if (!enabled) { await fs.rm(targetRoot, { recursive: true, force: true }); return; }
  const instructions = manifest.contributes?.agentInstructions ?? [];
  if (instructions.length === 0) return;
  await replaceProjection(targetRoot, async (temporary) => {
    const installedRoot = path.resolve(installedVersionPath(dataDir, manifest));
    for (const instruction of instructions) {
      const source = path.resolve(installedRoot, instruction.entry);
      if (!source.startsWith(`${installedRoot}${path.sep}`)) throw new Error("agent instruction entry escapes plugin bundle");
      const target = path.resolve(temporary, instruction.id);
      if (!target.startsWith(`${temporary}${path.sep}`)) throw new Error("agent instruction id escapes projection");
      await fs.mkdir(target, { recursive: true, mode: 0o700 });
      await fs.copyFile(source, path.join(target, "instructions.md"));
      await fs.writeFile(path.join(target, "metadata.json"), JSON.stringify({
        pluginId: manifest.id,
        contributionId: instruction.id,
        title: instruction.title,
        targets: instruction.targets,
        mode: instruction.mode,
        priority: instruction.priority ?? 0,
      }, null, 2) + "\n", { mode: 0o600 });
    }
  });
}

async function syncDeclarativeContributions(dataDir: string, manifest: PluginManifest, enabled: boolean): Promise<void> {
  await syncSkillContributions(dataDir, manifest, enabled);
  await syncAgentInstructionContributions(dataDir, manifest, enabled);
}

export async function setPluginEnabled(dataDir: string, id: string, enabled: boolean): Promise<InstalledPlugin | null> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    const installed = registry.plugins[id];
    if (!installed) return null;
    if (enabled && (installed.manifest.contributes?.runtimeExtensions?.length ?? 0) > 0 && installed.executionTrust?.version !== installed.activeVersion) {
      throw new Error(`plugin ${id}@${installed.activeVersion} contains host runtime code and must be explicitly trusted before enabling`);
    }
    const prospective = { ...registry.plugins, [id]: { ...installed, enabled } };
    assertEnabledPluginsCompatible(prospective);
    if (enabled) {
      const compatibility = compatibilityFor(installed.manifest, prospective);
      installed.compatibility = compatibility;
      try {
        await syncExternalRuntimeProjection(dataDir, installed.manifest, true);
        await syncDeclarativeContributions(dataDir, installed.manifest, true);
      } catch (error) {
        await syncExternalRuntimeProjection(dataDir, installed.manifest, false);
        await syncDeclarativeContributions(dataDir, installed.manifest, false);
        throw error;
      }
    } else {
      await syncDeclarativeContributions(dataDir, installed.manifest, false);
      await syncExternalRuntimeProjection(dataDir, installed.manifest, false);
    }
    installed.enabled = enabled;
    installed.compatibility = compatibilityFor(installed.manifest, registry.plugins);
    await writeJsonAtomic(registryPath(dataDir), registry);
    return installed;
  });
}

export async function trustPluginExecution(dataDir: string, id: string, version: string): Promise<InstalledPlugin | null> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    const installed = registry.plugins[id];
    if (!installed) return null;
    if (installed.activeVersion !== version) throw new Error(`plugin version changed; expected ${installed.activeVersion}`);
    if ((installed.manifest.contributes?.runtimeExtensions?.length ?? 0) === 0) throw new Error("plugin does not contain host runtime code");
    installed.executionTrust = { version, trustedAt: new Date().toISOString() };
    await writeJsonAtomic(registryPath(dataDir), registry);
    return installed;
  });
}

export async function uninstallPlugin(dataDir: string, id: string): Promise<boolean> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    const installed = registry.plugins[id];
    if (!installed) return false;
    await syncDeclarativeContributions(dataDir, installed.manifest, false);
    await syncExternalRuntimeProjection(dataDir, installed.manifest, false);
    delete registry.plugins[id];
    assertEnabledPluginsCompatible(registry.plugins);
    await writeJsonAtomic(registryPath(dataDir), registry);
    await fs.rm(path.join(pluginsDir(dataDir), "installed", installed.manifest.id), { recursive: true, force: true });
    await fs.rm(path.join(pluginsDir(dataDir), "execution", installed.manifest.id), { recursive: true, force: true });
    await fs.rm(path.join(pluginsDir(dataDir), "data", installed.manifest.id), { recursive: true, force: true });
    return true;
  });
}

export async function listEnabledPreviewers(dataDir: string): Promise<EnabledPreviewer[]> {
  return (await listInstalledPlugins(dataDir)).flatMap((plugin) =>
    plugin.enabled && plugin.compatibility?.compatible
      ? (plugin.manifest.contributes?.previewers ?? []).map((previewer) => ({
          pluginId: plugin.manifest.id,
          pluginVersion: plugin.activeVersion,
          displayName: plugin.manifest.displayName,
          previewer,
        }))
      : [],
  );
}

export async function readEnabledPluginAsset(dataDir: string, id: string, version: string, asset: string): Promise<Buffer | null> {
  const plugin = (await listInstalledPlugins(dataDir)).find((candidate) =>
    candidate.enabled && candidate.compatibility?.compatible && candidate.manifest.id === id && candidate.activeVersion === version,
  );
  if (!plugin || !isSafePluginPath(asset) || asset === "manifest.json") return null;
  const root = path.resolve(installedVersionPath(dataDir, plugin.manifest));
  const target = path.resolve(root, asset);
  if (!target.startsWith(`${root}${path.sep}`)) return null;
  try { return await fs.readFile(target); } catch { return null; }
}
