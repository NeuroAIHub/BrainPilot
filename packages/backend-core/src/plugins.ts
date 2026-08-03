/**
 * Plugin marketplace control plane.
 *
 * This module manages installation and activation state only. Contribution
 * hosts consume enabled, compatible manifests through separate adapters.
 */
import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
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
  type InstalledPlugin,
  type MarketplaceEntry,
  type MarketplaceRelease,
  type MarketplaceSourceStatus,
  type PluginCompatibility,
  type PluginManifest,
  type PluginPermission,
  type PluginUpdateStatus,
} from "@brainpilot/plugin-sdk";

const backendVersion = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

export { PLUGIN_API_VERSION, parsePluginManifest } from "@brainpilot/plugin-sdk";
export type PluginKind = LegacyPluginKind;
export type { PluginManifest, PluginPermission } from "@brainpilot/plugin-sdk";

export type { InstalledPlugin, MarketplaceEntry, MarketplaceRelease, MarketplaceSourceStatus, PluginCompatibility, PluginUpdateStatus } from "@brainpilot/plugin-sdk";

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
}

// PR4 adds immutable built-in release directories here. Every source directory
// contains the exact manifest and files for that version; versions are never
// synthesized by rewriting the current bundle.
const BUILTIN_PLUGIN_RELEASES: readonly BuiltinPluginRelease[] = [
  {
    plugin: "nifti-viewer",
    source: "nifti-viewer/0.1.0",
    version: "0.1.0",
    publishedAt: "2026-08-03T00:00:00.000Z",
    releaseNotes: "Initial range-backed NIfTI-1 metadata and central axial slice preview.",
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

function builtinPluginRoot(source: string): string {
  return fileURLToPath(new URL(`../plugins/${source}`, import.meta.url));
}

async function readBuiltinPluginBundle(release: BuiltinPluginRelease): Promise<Buffer> {
  const root = builtinPluginRoot(release.source);
  const manifest = parsePublishablePluginManifest(JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as unknown);
  if (!manifest || manifest.version !== release.version) {
    throw new Error(`built-in plugin ${release.source} does not contain immutable version ${release.version}`);
  }
  const files: Array<{ path: string; contentBase64: string }> = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === "manifest.json") continue;
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
  return { manifest, publisher: value.publisher.trim(), ...(artifact ? { artifact } : {}), verified: value.verified === true,
    ...(releases?.length ? { releases } : {}),
    ...(value.status === "test" ? { status: "test" as const } : {}),
    ...(typeof value.homepage === "string" ? { homepage: value.homepage } : {}) };
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
    plugins[id] = {
      manifest,
      publisher: item.publisher,
      verified: item.verified === true,
      enabled: item.enabled === true,
      installedAt: item.installedAt,
      activeVersion,
      ...(typeof item.previousVersion === "string" ? { previousVersion: item.previousVersion } : {}),
      ...(typeof item.updatedAt === "string" ? { updatedAt: item.updatedAt } : {}),
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
    const plugin = BUILTIN_PLUGIN_RELEASES.find((release) => release.version === latest.version && latest.artifact.url === builtinArtifactUrl(release))?.plugin;
    return { manifest: latest.manifest, publisher: "BrainPilot", verified: true, artifact: latest.artifact, releases, source: { id: "builtin", type: "builtin" }, ...(plugin && TEST_PLUGIN_SOURCES.has(plugin) ? { status: "test" as const } : {}) };
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
    await installBundle(dataDir, await downloadRelease(dataDir, release));
    const previousVersion = installed.activeVersion;
    installed.manifest = release.manifest;
    installed.activeVersion = release.version;
    installed.previousVersion = previousVersion;
    installed.updatedAt = new Date().toISOString();
    installed.compatibility = compatibilityFor(release.manifest, registry.plugins);
    assertEnabledPluginsCompatible(registry.plugins);
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
    const replacedVersion = installed.activeVersion;
    installed.manifest = previousManifest;
    installed.activeVersion = previousManifest.version;
    installed.previousVersion = replacedVersion;
    installed.updatedAt = new Date().toISOString();
    installed.compatibility = compatibilityFor(previousManifest, registry.plugins);
    assertEnabledPluginsCompatible(registry.plugins);
    await writeJsonAtomic(registryPath(dataDir), registry);
    return installed;
  });
}

export async function setPluginEnabled(dataDir: string, id: string, enabled: boolean): Promise<InstalledPlugin | null> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    const installed = registry.plugins[id];
    if (!installed) return null;
    installed.enabled = enabled;
    assertEnabledPluginsCompatible(registry.plugins);
    installed.compatibility = compatibilityFor(installed.manifest, registry.plugins);
    await writeJsonAtomic(registryPath(dataDir), registry);
    return installed;
  });
}

export async function uninstallPlugin(dataDir: string, id: string): Promise<boolean> {
  return withRegistryMutation(dataDir, async () => {
    const registry = await readRegistry(dataDir);
    const installed = registry.plugins[id];
    if (!installed) return false;
    delete registry.plugins[id];
    assertEnabledPluginsCompatible(registry.plugins);
    await writeJsonAtomic(registryPath(dataDir), registry);
    await fs.rm(path.join(pluginsDir(dataDir), "installed", installed.manifest.id), { recursive: true, force: true });
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
