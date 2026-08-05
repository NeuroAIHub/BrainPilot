/**
 * Foreign agent-plugin discovery.
 *
 * The Claude parsing model follows the MIT-licensed implementation in
 * EveryInc/compound-engineering-plugin (Copyright (c) 2025 Every), adapted to
 * resolve references without rewriting the source tree. BrainPilot keeps the
 * result private: this is an import adapter, not a new public plugin standard.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export type PluginSourceFormat = "brainpilot" | "pi-package" | "codex" | "claude-code";
export type ImportablePluginSourceFormat = Exclude<PluginSourceFormat, "brainpilot">;

export interface ResolvedPlugin {
  format: PluginSourceFormat;
  id: string;
  version: string;
  root: string;
  skillPaths: string[];
  mcpConfigPath?: string;
  hookConfig?: { dialect: "codex" | "claude-code"; path: string };
  unsupported: string[];
}

export interface ResolvedExternalPlugin extends ResolvedPlugin {
  format: ImportablePluginSourceFormat;
  displayName: string;
  description: string;
  publisher: string;
  inlineMcpConfig?: unknown;
  inlineHookConfig?: unknown;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function readJson(file: string): Promise<JsonObject> {
  let parsed: unknown;
  try { parsed = JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { throw new Error(`Invalid JSON at ${file}: ${(error as Error).message}`); }
  if (!object(parsed)) throw new Error(`Expected a JSON object at ${file}`);
  return parsed;
}

async function exists(file: string): Promise<boolean> {
  try { await fs.access(file); return true; } catch { return false; }
}

function resolveInside(root: string, candidate: string, label: string): string {
  if (!candidate.trim() || path.isAbsolute(candidate)) throw new Error(`${label} must be relative to the plugin root`);
  const resolved = path.resolve(root, candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error(`${label} escapes the plugin root`);
  return resolved;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : [];
}

function normalizeId(value: string): string {
  const slug = value.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  const usable = slug || "plugin";
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(usable) ? usable : `external.${usable}`;
}

function normalizeVersion(value: unknown): string {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value) ? value : "0.0.0";
}

async function collectSkillFiles(root: string, locations: string[]): Promise<string[]> {
  const found = new Set<string>();
  const walk = async (entry: string): Promise<void> => {
    let stat;
    try { stat = await fs.lstat(entry); } catch { return; }
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in imported plugin skills: ${entry}`);
    if (stat.isFile()) {
      if (path.basename(entry).toLowerCase() === "skill.md") found.add(entry);
      return;
    }
    if (!stat.isDirectory()) return;
    for (const child of await fs.readdir(entry)) await walk(path.join(entry, child));
  };
  for (const location of locations) await walk(location);
  return [...found].sort();
}

function authorName(manifest: JsonObject): string {
  if (typeof manifest.author === "string" && manifest.author.trim()) return manifest.author.trim();
  return object(manifest.author) && typeof manifest.author.name === "string" && manifest.author.name.trim()
    ? manifest.author.name.trim()
    : "External plugin";
}

function unsupportedForManifest(manifest: JsonObject, format: ImportablePluginSourceFormat): string[] {
  const unsupported: string[] = [];
  const keys = format === "pi-package"
    ? ["extensions", "prompts", "themes"]
    : ["agents", "commands", "apps", "app", "lspServers", "lsp", "browserExtensions", "scheduledTasks", "monitors", "channels"];
  for (const key of keys) {
    const value = manifest[key];
    if (value !== undefined && (!Array.isArray(value) || value.length > 0)) unsupported.push(key);
  }
  return unsupported;
}

async function resolveAgentPlugin(root: string, format: "codex" | "claude-code"): Promise<ResolvedExternalPlugin> {
  const manifestFile = path.join(root, format === "codex" ? ".codex-plugin" : ".claude-plugin", "plugin.json");
  const manifest = await readJson(manifestFile);
  if (typeof manifest.name !== "string" || !manifest.name.trim()) throw new Error(`${format} plugin manifest requires name`);

  const skillLocations = [path.join(root, "skills")];
  for (const entry of stringList(manifest.skills)) skillLocations.push(resolveInside(root, entry, "skills path"));
  const skillPaths = await collectSkillFiles(root, [...new Set(skillLocations)]);

  let mcpConfigPath: string | undefined;
  let inlineMcpConfig: unknown;
  const mcpField = manifest.mcpServers;
  if (typeof mcpField === "string") mcpConfigPath = resolveInside(root, mcpField, "mcpServers path");
  else if (Array.isArray(mcpField)) {
    if (mcpField.length > 1) throw new Error("v1 supports one plugin MCP config file");
    if (typeof mcpField[0] === "string") mcpConfigPath = resolveInside(root, mcpField[0], "mcpServers path");
  } else if (object(mcpField)) inlineMcpConfig = { mcpServers: mcpField };
  else if (await exists(path.join(root, ".mcp.json"))) mcpConfigPath = path.join(root, ".mcp.json");
  if (mcpConfigPath && !await exists(mcpConfigPath)) throw new Error(`MCP config not found: ${mcpConfigPath}`);

  let hookPath: string | undefined;
  let inlineHookConfig: unknown;
  const hooksField = manifest.hooks;
  if (typeof hooksField === "string") hookPath = resolveInside(root, hooksField, "hooks path");
  else if (Array.isArray(hooksField)) {
    if (hooksField.length > 1) throw new Error("v1 supports one plugin hooks config file");
    if (typeof hooksField[0] === "string") hookPath = resolveInside(root, hooksField[0], "hooks path");
  } else if (object(hooksField)) inlineHookConfig = hooksField.hooks ? hooksField : { hooks: hooksField };
  else if (await exists(path.join(root, "hooks", "hooks.json"))) hookPath = path.join(root, "hooks", "hooks.json");
  if (hookPath && !await exists(hookPath)) throw new Error(`Hooks config not found: ${hookPath}`);

  const unsupported = unsupportedForManifest(manifest, format);
  for (const conventional of ["agents", "commands", "lsp", "monitors", "channels"]) {
    if (!unsupported.includes(conventional) && await exists(path.join(root, conventional))) unsupported.push(conventional);
  }
  return {
    format,
    id: normalizeId(manifest.name),
    version: normalizeVersion(manifest.version),
    root,
    displayName: typeof manifest.interface === "object" && manifest.interface && typeof (manifest.interface as JsonObject).displayName === "string"
      ? String((manifest.interface as JsonObject).displayName)
      : manifest.name,
    description: typeof manifest.description === "string" && manifest.description.trim() ? manifest.description.trim() : `${manifest.name} imported from ${format}`,
    publisher: authorName(manifest),
    skillPaths,
    ...(mcpConfigPath ? { mcpConfigPath } : {}),
    ...(hookPath ? { hookConfig: { dialect: format, path: hookPath } } : {}),
    ...(inlineMcpConfig ? { inlineMcpConfig } : {}),
    ...(inlineHookConfig ? { inlineHookConfig } : {}),
    unsupported,
  };
}

async function resolvePiPackage(root: string): Promise<ResolvedExternalPlugin> {
  const manifest = await readJson(path.join(root, "package.json"));
  if (!object(manifest.pi)) throw new Error("package.json does not contain a pi object");
  const pi = manifest.pi;
  const skillLocations = stringList(pi.skills).map((entry) => resolveInside(root, entry, "pi.skills path"));
  const skillPaths = await collectSkillFiles(root, skillLocations);
  const unsupported = unsupportedForManifest(pi, "pi-package");
  return {
    format: "pi-package",
    id: normalizeId(typeof manifest.name === "string" ? manifest.name : path.basename(root)),
    version: normalizeVersion(manifest.version),
    root,
    displayName: typeof manifest.name === "string" ? manifest.name : path.basename(root),
    description: typeof manifest.description === "string" && manifest.description.trim() ? manifest.description : "Pi package imported into BrainPilot",
    publisher: authorName(manifest),
    skillPaths,
    unsupported,
  };
}

export async function detectExternalPluginFormats(directory: string): Promise<ImportablePluginSourceFormat[]> {
  const root = path.resolve(directory);
  const formats: ImportablePluginSourceFormat[] = [];
  if (await exists(path.join(root, ".codex-plugin", "plugin.json"))) formats.push("codex");
  if (await exists(path.join(root, ".claude-plugin", "plugin.json"))) formats.push("claude-code");
  if (await exists(path.join(root, "package.json"))) {
    try { if (object((await readJson(path.join(root, "package.json"))).pi)) formats.push("pi-package"); } catch { /* resolver reports malformed JSON when explicitly selected */ }
  }
  return formats;
}

export async function resolveExternalPlugin(
  directory: string,
  requested: ImportablePluginSourceFormat | "auto" = "auto",
): Promise<ResolvedExternalPlugin> {
  const root = path.resolve(directory);
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`Plugin directory not found: ${root}`);
  let format: ImportablePluginSourceFormat;
  if (requested === "auto") {
    const detected = await detectExternalPluginFormats(root);
    if (detected.length === 0) throw new Error("No supported Codex, Claude Code, or Pi package manifest found");
    if (detected.length > 1) throw new Error(`Multiple plugin formats detected (${detected.join(", ")}); select --format explicitly`);
    format = detected[0]!;
  } else format = requested;
  return format === "pi-package" ? resolvePiPackage(root) : resolveAgentPlugin(root, format);
}
