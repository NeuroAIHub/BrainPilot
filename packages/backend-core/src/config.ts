/**
 * Local config resolution — backend-LOCAL settings/provider routes (§11A.2).
 * These are NOT proxied to the runtime; the backend owns the on-disk config
 * tree under the data dir (`./brainpilot/` by default).
 *
 * Provider/key priority (§11A.2 要点 2), highest first:
 *   1. bp_template/settings.json  (user-configured, highest authority)
 *   2. brainpilot.config.json
 *   3. real environment variables (ANTHROPIC_API_KEY, etc.)
 *   4. .env  (lowest — fallback)
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export interface ResolvedProvider {
  /** API key, if any layer supplied one. */
  apiKey?: string;
  /** Base URL override, if any. */
  baseUrl?: string;
  /** Model id, if any. */
  model?: string;
  /** Which layer the apiKey came from (for diagnostics). */
  source?: "env" | "bp_template" | "config" | "dotenv";
}

export interface ConfigPaths {
  dataDir: string;
  bpTemplateSettings: string;
  brainpilotConfig: string;
  dotenv: string;
}

export function configPaths(dataDir: string): ConfigPaths {
  return {
    dataDir,
    bpTemplateSettings: path.join(dataDir, "bp_template", "settings.json"),
    brainpilotConfig: path.join(dataDir, "brainpilot.config.json"),
    dotenv: path.join(dataDir, ".env"),
  };
}

async function readJsonSafe(file: string): Promise<Record<string, unknown> | null> {
  try {
    const text = await fs.readFile(file, "utf8");
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Minimal .env parser (KEY=VALUE per line, `#` comments, optional quotes). */
export async function parseDotenv(file: string): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function pickString(obj: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  if (!obj) return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  // Nested `provider` object support (settings.json may nest).
  const provider = obj.provider;
  if (provider && typeof provider === "object") {
    for (const k of keys) {
      const v = (provider as Record<string, unknown>)[k];
      if (typeof v === "string" && v.length > 0) return v;
    }
  }
  return undefined;
}

export interface ResolveProviderOptions {
  dataDir: string;
  env?: Record<string, string | undefined>;
}

/**
 * Resolve the effective provider config by walking the priority chain. The
 * apiKey's `source` reflects the FIRST layer that supplied it; baseUrl/model
 * are likewise taken from the highest layer that supplies each.
 */
export async function resolveProvider(
  options: ResolveProviderOptions,
): Promise<ResolvedProvider> {
  const env = options.env ?? process.env;
  const paths = configPaths(options.dataDir);

  const templateSettings = await readJsonSafe(paths.bpTemplateSettings);
  const config = await readJsonSafe(paths.brainpilotConfig);
  const dotenv = await parseDotenv(paths.dotenv);

  // Layer values, highest priority first.
  const envKey =
    env.ANTHROPIC_API_KEY || env.BP_API_KEY || env.OPENAI_API_KEY || undefined;
  const templateKey = pickString(templateSettings, "apiKey", "api_key");
  const configKey = pickString(config, "apiKey", "api_key");
  const dotenvKey =
    dotenv.ANTHROPIC_API_KEY || dotenv.BP_API_KEY || dotenv.OPENAI_API_KEY || undefined;

  let apiKey: string | undefined;
  let source: ResolvedProvider["source"];
  if (templateKey) {
    apiKey = templateKey;
    source = "bp_template";
  } else if (configKey) {
    apiKey = configKey;
    source = "config";
  } else if (envKey) {
    apiKey = envKey;
    source = "env";
  } else if (dotenvKey) {
    apiKey = dotenvKey;
    source = "dotenv";
  }

  const baseUrl =
    pickString(templateSettings, "baseUrl", "base_url") ||
    pickString(config, "baseUrl", "base_url") ||
    env.ANTHROPIC_BASE_URL ||
    env.BP_BASE_URL ||
    dotenv.ANTHROPIC_BASE_URL ||
    dotenv.BP_BASE_URL ||
    undefined;

  const model =
    pickString(templateSettings, "model") ||
    pickString(config, "model") ||
    env.BP_MODEL ||
    dotenv.BP_MODEL ||
    undefined;

  return { apiKey, baseUrl, model, source };
}

/** Masked, frontend-facing settings (never leak the raw key). */
export interface LocalSettings {
  model: string;
  apiKey: string; // masked
  baseUrl: string;
}

function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export async function readLocalSettings(
  options: ResolveProviderOptions,
): Promise<LocalSettings> {
  const resolved = await resolveProvider(options);
  return {
    model: resolved.model ?? "",
    apiKey: maskKey(resolved.apiKey),
    baseUrl: resolved.baseUrl ?? "",
  };
}

/**
 * Persist a settings patch to `bp_template/settings.json` (the user-editable
 * template layer). Merges with existing content.
 */
export async function writeLocalSettings(
  dataDir: string,
  patch: Partial<{ model: string; apiKey: string; baseUrl: string }>,
): Promise<void> {
  const file = configPaths(dataDir).bpTemplateSettings;
  await fs.mkdir(path.dirname(file), { recursive: true });
  const existing = (await readJsonSafe(file)) ?? {};
  const next: Record<string, unknown> = { ...existing };
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.apiKey !== undefined) next.apiKey = patch.apiKey;
  if (patch.baseUrl !== undefined) next.baseUrl = patch.baseUrl;
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, file); // atomic write (§16.4 fix)
}
