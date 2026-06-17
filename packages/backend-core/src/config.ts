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
  /** Multi-provider registry (the SSOT for provider config, §11A.2 rewrite). */
  providers: string;
}

export function configPaths(dataDir: string): ConfigPaths {
  return {
    dataDir,
    bpTemplateSettings: path.join(dataDir, "bp_template", "settings.json"),
    brainpilotConfig: path.join(dataDir, "brainpilot.config.json"),
    dotenv: path.join(dataDir, ".env"),
    providers: path.join(dataDir, "bp_template", "providers.json"),
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

/* ----------------------------- providers.json ----------------------------- *
 * The provider registry is the SSOT for LLM credentials in single-user mode.
 * It stores FULL profiles (incl. plaintext apiKey) on disk under bp_template/;
 * the data dir is gitignored and written 0600. The HTTP layer never returns the
 * plaintext key — it masks it (see app.ts `toHttpProfile`). A session selects a
 * profile + model by id; resolveProvider() resolves the *selected* profile
 * first, falling back to the legacy env/dotenv chain for backward compat.
 * -------------------------------------------------------------------------- */

/** A stored provider profile (internal — holds the plaintext key). */
export interface StoredProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  icon?: string;
  iconColor?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProvidersFile {
  profiles: StoredProviderProfile[];
  /** Id of the profile new sessions default to. */
  selectedProfileId?: string;
}

export async function readProviders(dataDir: string): Promise<ProvidersFile> {
  const raw = (await readJsonSafe(configPaths(dataDir).providers)) as unknown as ProvidersFile | null;
  const profiles = Array.isArray(raw?.profiles) ? raw.profiles : [];
  const selectedProfileId =
    typeof raw?.selectedProfileId === "string" ? raw.selectedProfileId : profiles[0]?.id;
  return { profiles, selectedProfileId };
}

async function writeProviders(dataDir: string, file: ProvidersFile): Promise<void> {
  const target = configPaths(dataDir).providers;
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(file, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target); // atomic
}

/** The profile a session should use given an optional explicit id. */
export async function selectedProfile(
  dataDir: string,
  preferId?: string,
): Promise<StoredProviderProfile | undefined> {
  const { profiles, selectedProfileId } = await readProviders(dataDir);
  return (
    profiles.find((p) => p.id === preferId) ??
    profiles.find((p) => p.id === selectedProfileId) ??
    profiles[0]
  );
}

let _counter = 0;
function newId(): string {
  // No crypto.randomUUID dependency need; ids are local-only and short-lived.
  _counter += 1;
  return `p${Date.now().toString(36)}${_counter.toString(36)}`;
}

export async function createProfile(
  dataDir: string,
  input: Partial<StoredProviderProfile>,
): Promise<StoredProviderProfile> {
  const file = await readProviders(dataDir);
  const now = Date.now();
  const profile: StoredProviderProfile = {
    id: input.id ?? newId(),
    name: input.name ?? "Provider",
    baseUrl: input.baseUrl ?? "",
    apiKey: input.apiKey ?? "",
    models: input.models ?? [],
    icon: input.icon,
    iconColor: input.iconColor,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };
  file.profiles.push(profile);
  if (!file.selectedProfileId) file.selectedProfileId = profile.id;
  await writeProviders(dataDir, file);
  return profile;
}

export async function updateProfile(
  dataDir: string,
  id: string,
  patch: Partial<StoredProviderProfile>,
): Promise<StoredProviderProfile | undefined> {
  const file = await readProviders(dataDir);
  const profile = file.profiles.find((p) => p.id === id);
  if (!profile) return undefined;
  // apiKey omitted in patch → keep existing (UI sends masked key, not the real one).
  const writable = profile as unknown as Record<string, unknown>;
  for (const k of ["name", "baseUrl", "models", "icon", "iconColor", "notes"] as const) {
    if (patch[k] !== undefined) writable[k] = patch[k];
  }
  if (typeof patch.apiKey === "string" && patch.apiKey.length > 0) profile.apiKey = patch.apiKey;
  profile.updatedAt = Date.now();
  await writeProviders(dataDir, file);
  return profile;
}

export async function deleteProfile(dataDir: string, id: string): Promise<boolean> {
  const file = await readProviders(dataDir);
  const before = file.profiles.length;
  file.profiles = file.profiles.filter((p) => p.id !== id);
  if (file.profiles.length === before) return false;
  if (file.selectedProfileId === id) file.selectedProfileId = file.profiles[0]?.id;
  await writeProviders(dataDir, file);
  return true;
}

export async function setSelectedProfile(dataDir: string, id: string): Promise<boolean> {
  const file = await readProviders(dataDir);
  if (!file.profiles.some((p) => p.id === id)) return false;
  file.selectedProfileId = id;
  await writeProviders(dataDir, file);
  return true;
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

  // Highest authority: the selected profile in providers.json (SSOT). When set,
  // it wins outright; the legacy env/dotenv chain below is the fallback for
  // deployments that haven't migrated (e.g. Docker injecting ANTHROPIC_API_KEY).
  const profile = await selectedProfile(options.dataDir);
  if (profile?.apiKey) {
    return {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl || undefined,
      model: profile.models[0],
      source: "bp_template",
    };
  }

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
 * Persist a simple settings patch into the providers registry (the SSOT). With
 * no profiles yet it creates a default "Local" profile; otherwise it updates the
 * selected profile in place. This keeps the legacy single-field `/api/settings`
 * PUT and `brainpilot init` flowing into providers.json rather than the
 * deprecated settings.json.
 */
export async function writeLocalSettings(
  dataDir: string,
  patch: Partial<{ model: string; apiKey: string; baseUrl: string }>,
): Promise<void> {
  const current = await selectedProfile(dataDir);
  const models = patch.model ? [patch.model] : undefined;
  if (!current) {
    await createProfile(dataDir, {
      name: "Local",
      baseUrl: patch.baseUrl ?? "",
      apiKey: patch.apiKey ?? "",
      models: models ?? [],
    });
    return;
  }
  await updateProfile(dataDir, current.id, {
    ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
    ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey } : {}),
    // merge the model into the profile's model list (front of list = default)
    ...(models ? { models: Array.from(new Set([...models, ...current.models])) } : {}),
  });
}

/**
 * Onboarding-facing view of the resolved provider config. A boolean-only key
 * presence (never the plaintext key) plus the two files a user would edit, so
 * `init`/`up` can print accurate, consistent guidance from one source.
 */
export interface ProviderConfigReport {
  hasKey: boolean;
  source?: ResolvedProvider["source"];
  baseUrl?: string;
  model?: string;
  /** Absolute path of bp_template/providers.json (the provider registry SSOT). */
  settingsPath: string;
  /** Absolute path of the data dir's .env. */
  dotenvPath: string;
}

/**
 * Resolve the provider config and reduce it to an onboarding report. Reuses the
 * full priority chain via {@link resolveProvider}; folds apiKey to a boolean so
 * the key never leaves this module in plaintext.
 */
export async function describeProviderConfig(
  options: ResolveProviderOptions,
): Promise<ProviderConfigReport> {
  const resolved = await resolveProvider(options);
  const paths = configPaths(options.dataDir);
  return {
    hasKey: Boolean(resolved.apiKey),
    source: resolved.source,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    settingsPath: paths.providers,
    dotenvPath: paths.dotenv,
  };
}

/**
 * Turn a {@link ProviderConfigReport} into human guidance lines (uncolored;
 * callers pick the styling). Shared by `init` and `up` so the onboarding text
 * never drifts between them.
 */
export function formatProviderGuidance(report: ProviderConfigReport): string[] {
  if (report.hasKey) {
    const model = report.model || "(default) claude-sonnet-4-6";
    const baseUrl = report.baseUrl || "(built-in Anthropic endpoint)";
    return [
      `✓ Provider key configured (from ${report.source ?? "unknown"}).`,
      `  model: ${model}   baseUrl: ${baseUrl}`,
    ];
  }
  return [
    "No provider API key configured yet. Set one of:",
    "  • web Settings UI: launch, open Settings → Providers, add a provider (recommended).",
    `  • providers file:  ${report.settingsPath}`,
    `      { "profiles": [ { "id": "local", "name": "Local", "apiKey": "<key>", "baseUrl": "<gateway, optional>", "models": ["<id>"] } ], "selectedProfileId": "local" }`,
    "  • env var:        export ANTHROPIC_API_KEY=<key>   (also ANTHROPIC_BASE_URL / BP_MODEL)",
    "  • re-run init:    brainpilot init --api-key <key> [--base-url <url>] [--model <id>]",
    "No key needed for a test run:  BP_MOCK=1 brainpilot up",
  ];
}
