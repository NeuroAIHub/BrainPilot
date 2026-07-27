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
import type { ProviderApi, ProviderAdapter, HealthStatus, ModelHealth } from "@brainpilot/protocol";
import { deriveProviderApi, EXAMPLE_MODEL } from "@brainpilot/protocol";

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
 * the data dir is gitignored. The HTTP layer never returns the plaintext key
 * — it masks it (see app.ts `toHttpProfile`). A session selects a profile +
 * model by id; resolveProvider() resolves the *selected* profile first,
 * falling back to the legacy env/dotenv chain for backward compat.
 *
 * #4 — cross-platform file-mode caveat:
 *   - POSIX hosts: we write providers.json with `mode: 0o600` (owner R/W only),
 *     which is the standard "this file contains a secret" guard.
 *   - Windows hosts: Node's `mode` parameter only maps to the FAT-era read-
 *     only attribute; it does NOT translate to a Windows ACL. The file ends
 *     up with whatever ACL it inherits from the parent directory (typically
 *     `Users: Read`), so other local user accounts on the same machine can
 *     read it. Treat the at-rest key on Windows as protected at the
 *     filesystem-permission level only by your account login / disk encryption
 *     (BitLocker, EFS). Future work: OS keychain (Win Credential Manager /
 *     macOS Keychain / libsecret) for true plaintext-free at-rest storage.
 * -------------------------------------------------------------------------- */

/** A stored provider profile (internal — holds the plaintext key). */
export interface StoredProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  /** #63: wire protocol. Optional for back-compat with pre-#63 profiles
   *  (read as anthropic-messages). createProfile defaults it. */
  api?: ProviderApi;
  /** #68 (R-10): coarse adapter family declared by the UI (auto/openai/
   *  anthropic). When set without an explicit `api`, the runtime derives the
   *  precise wire value. Optional; absent → treated as "auto". */
  adapter?: ProviderAdapter;
  apiKey: string;
  /** #65: name of an env var the key is read from at request time, instead of
   *  persisting the plaintext secret. Set by the env bootstrap so a self-hosted
   *  user who supplies ANTHROPIC_API_KEY via the environment never has it copied
   *  into providers.json. When set, apiKey is left empty on disk and the runtime
   *  falls back to its env gateway path (which reads the same env var). */
  apiKeyEnv?: string;
  models: string[];
  icon?: string;
  iconColor?: string;
  notes?: string;
  /** #69: last connectivity-probe result, persisted so the Settings card
   *  reflects the test outcome across reads/reopens instead of "unknown".
   *  Written by POST /provider/profiles/:id/test. */
  healthStatus?: HealthStatus;
  healthCheckedAt?: number;
  healthMessage?: string;
  healthLatencyMs?: number | null;
  /** Per-model result from the protocol-aware probe. */
  modelHealth?: ModelHealth[];
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
    // #75: do not unconditionally default api to anthropic-messages — that
    // short-circuited the runtime's adapter fallback (an `adapter:"openai"`
    // profile got `api:"anthropic-messages"`, a contradictory state). Precedence:
    // explicit api → derived from adapter → default. Persist only an explicit or
    // adapter-derived api; leave it unset otherwise so the runtime resolves it.
    api: input.api ?? deriveProviderApi(input.adapter),
    adapter: input.adapter,
    apiKey: input.apiKey ?? "",
    apiKeyEnv: input.apiKeyEnv,
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
  for (const k of ["name", "baseUrl", "api", "adapter", "models", "icon", "iconColor", "notes"] as const) {
    if (patch[k] !== undefined) writable[k] = patch[k];
  }
  if (typeof patch.apiKey === "string" && patch.apiKey.length > 0) {
    profile.apiKey = patch.apiKey;
    // #65: the user is now intentionally persisting a key in Settings — drop the
    // env reference so the stored key (not the env var) is the source of truth.
    delete profile.apiKeyEnv;
  }
  profile.updatedAt = Date.now();
  await writeProviders(dataDir, file);
  return profile;
}

/**
 * #69: persist the latest connectivity-probe result on a profile. Kept
 * separate from updateProfile (which is for user-edited fields and bumps
 * updatedAt) — a health write must not look like a profile edit. Returns the
 * updated profile, or undefined if the id is unknown.
 */
export async function setProfileHealth(
  dataDir: string,
  id: string,
  health: {
    healthStatus: HealthStatus;
    healthCheckedAt: number;
    healthMessage?: string;
    healthLatencyMs?: number | null;
    modelHealth?: ModelHealth[];
  },
): Promise<StoredProviderProfile | undefined> {
  const file = await readProviders(dataDir);
  const profile = file.profiles.find((p) => p.id === id);
  if (!profile) return undefined;
  profile.healthStatus = health.healthStatus;
  profile.healthCheckedAt = health.healthCheckedAt;
  profile.healthMessage = health.healthMessage ?? "";
  profile.healthLatencyMs = health.healthLatencyMs ?? null;
  profile.modelHealth = health.modelHealth ?? [];
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
    env.ANTHROPIC_MODEL ||
    dotenv.BP_MODEL ||
    dotenv.ANTHROPIC_MODEL ||
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
  patch: Partial<{ model: string; apiKey: string; baseUrl: string; api: ProviderApi }>,
): Promise<void> {
  const current = await selectedProfile(dataDir);
  const models = patch.model ? [patch.model] : undefined;
  if (!current) {
    await createProfile(dataDir, {
      name: "Local",
      baseUrl: patch.baseUrl ?? "",
      api: patch.api,
      apiKey: patch.apiKey ?? "",
      models: models ?? [],
    });
    return;
  }
  await updateProfile(dataDir, current.id, {
    ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl } : {}),
    ...(patch.api !== undefined ? { api: patch.api } : {}),
    ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey } : {}),
    // merge the model into the profile's model list (front of list = default)
    ...(models ? { models: Array.from(new Set([...models, ...current.models])) } : {}),
  });
}

/**
 * #51: project env-only provider config into a real, selected provider profile
 * on first launch, so a user who supplies ANTHROPIC_API_KEY (etc.) via the
 * environment — the README's documented quick-start path — sees an active
 * provider in Settings → Providers and an enabled model selector, instead of an
 * empty providers.json and a disabled UI.
 *
 * Bootstrap semantics (intentionally a one-time seed, matching `init --api-key`):
 *   - only runs when providers.json has NO profiles yet;
 *   - only when the env actually supplies an API key;
 *   - writes a selected "Environment" profile from the resolved env key / base
 *     URL / model.
 * After this, providers.json is the SSOT — anything the user later edits in
 * Settings wins and is never re-overwritten from the env.
 *
 * Returns the created profile, or null if nothing was bootstrapped.
 */
export async function bootstrapEnvProvider(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): Promise<StoredProviderProfile | null> {
  const { profiles } = await readProviders(dataDir);
  if (profiles.length > 0) return null; // already configured — never clobber

  // Reuse the full resolution chain, then only act on env/dotenv-sourced keys
  // (a template/config key would already imply a profile or be handled by init).
  const resolved = await resolveProvider({ dataDir, env });
  if (!resolved.apiKey || (resolved.source !== "env" && resolved.source !== "dotenv")) {
    return null;
  }

  // #65: do NOT copy the plaintext env key into providers.json. Record only the
  // *name* of the env var the key came from; the profile is created with an
  // empty apiKey, so at request time both resolveProvider (backend) and
  // resolveSessionProvider (runtime) skip the empty key and fall back to the
  // env gateway path, which reads the same env var. The profile still exists so
  // the user sees an active "Environment" provider + model in Settings (#51),
  // but the secret stays in the environment, never on disk.
  const keySources =
    resolved.source === "dotenv"
      ? (await parseDotenv(configPaths(dataDir).dotenv))
      : env;
  const apiKeyEnv =
    (keySources.ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY") ||
    (keySources.BP_API_KEY && "BP_API_KEY") ||
    (keySources.OPENAI_API_KEY && "OPENAI_API_KEY") ||
    "ANTHROPIC_API_KEY";

  return createProfile(dataDir, {
    name: "Environment",
    baseUrl: resolved.baseUrl ?? "",
    apiKey: "", // #65: never persisted; resolved from apiKeyEnv at request time
    apiKeyEnv,
    models: resolved.model ? [resolved.model] : [],
    notes: `Auto-created from environment variables on first launch. The API key is read from $${apiKeyEnv} at request time and is not stored on disk.`,
  });
}

/**
 * Strip the plaintext key from a legacy settings.json (top-level AND nested
 * `provider` object), rewrite it at mode 0o600 so it stops sitting on disk at
 * the old 0644. Best-effort: if the rewrite fails, at least tighten the mode.
 */
async function stripLegacyKey(
  file: string,
  parsed: Record<string, unknown> | null,
): Promise<void> {
  try {
    if (parsed) {
      for (const k of ["apiKey", "api_key"]) delete parsed[k];
      const nested = parsed.provider;
      if (nested && typeof nested === "object") {
        for (const k of ["apiKey", "api_key"]) delete (nested as Record<string, unknown>)[k];
      }
      await fs.writeFile(file, JSON.stringify(parsed, null, 2), { encoding: "utf8", mode: 0o600 });
    }
    await fs.chmod(file, 0o600);
  } catch {
    // best-effort: a failure to sanitize the legacy file must not break startup
  }
}

/**
 * #202: one-time upgrade migration. Pre-rewrite versions wrote the provider —
 * including a plaintext apiKey at mode 0644 — into bp_template/settings.json;
 * the current SSOT is bp_template/providers.json. If providers.json is empty and
 * the legacy settings.json carries an apiKey, fold it into a provider profile
 * (written 0600 by createProfile, set as selected) and strip the plaintext key
 * from the old file so it no longer lingers on disk. Idempotent: a no-op once
 * providers.json has any profile or there's nothing to migrate.
 */
export async function migrateLegacySettings(
  dataDir: string,
): Promise<StoredProviderProfile | null> {
  const { profiles } = await readProviders(dataDir);
  if (profiles.length > 0) return null; // already configured — never clobber

  const paths = configPaths(dataDir);
  const legacy = await readJsonSafe(paths.bpTemplateSettings);
  const apiKey = pickString(legacy, "apiKey", "api_key");
  if (!apiKey) return null; // nothing to migrate

  const model = pickString(legacy, "model");
  const profile = await createProfile(dataDir, {
    name: "Migrated",
    apiKey, // persisted into providers.json at 0600 by createProfile
    baseUrl: pickString(legacy, "baseUrl", "base_url") ?? "",
    models: model ? [model] : [],
    notes: "Migrated from legacy settings.json on upgrade (#202).",
  });

  await stripLegacyKey(paths.bpTemplateSettings, legacy);
  return profile;
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
    const model = report.model || `(default) ${EXAMPLE_MODEL}`;
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
    "  • env var:        export ANTHROPIC_API_KEY=<key>   (also ANTHROPIC_BASE_URL / ANTHROPIC_MODEL / BP_MODEL)",
    "  • re-run init:    brainpilot init --api-key <key> [--base-url <url>] [--model <id>]",
    "No key needed for a test run:  BP_MOCK=1 brainpilot up",
  ];
}

/* ----------------------- MCP server config CRUD ----------------------- *
 * The runtime reads `mcp_servers.json` from disk (`loadMcpServersConfig` in
 * mcp-bridge.ts); these functions let the Settings → MCP tab persist entries
 * through the same file so the UI and disk stay in sync.
 *
 * Disk format (keyed map):   { mcpServers: { name: spec } }
 * HTTP format (flat array):  [{ name, ...spec }]
 * -------------------------------------------------------------------------- */

export function mcpServersPath(dataDir: string): string {
  return path.join(dataDir, "bp_template", "mcp_servers.json");
}

type McpSpec = Record<string, unknown>;

interface McpServersFile {
  mcpServers: Record<string, McpSpec>;
}

async function readMcpServersRaw(dataDir: string): Promise<Record<string, McpSpec>> {
  const raw = await readJsonSafe(mcpServersPath(dataDir));
  if (raw && typeof (raw as Record<string, unknown>).mcpServers === "object") {
    return (raw as unknown as McpServersFile).mcpServers;
  }
  return {};
}

async function writeMcpServersRaw(dataDir: string, servers: Record<string, McpSpec>): Promise<void> {
  const target = mcpServersPath(dataDir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ mcpServers: servers }, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}

export async function readMcpServers(dataDir: string): Promise<Array<{ name: string } & McpSpec>> {
  const servers = await readMcpServersRaw(dataDir);
  return Object.entries(servers).map(([name, spec]) => ({ name, ...spec }));
}

/**
 * #377: true when the stored entry is a platform-managed preset (`readOnly: true`).
 * Hosted deployments inject presets into the same on-disk file, so the CRUD routes
 * have to refuse edits/deletes server-side — hiding the buttons in the UI is a
 * hint, not enforcement, and the preset URL can carry the platform's shared key.
 * An absent entry is *not* read-only: the caller still needs its own 404.
 */
export async function isReadOnlyMcpServer(dataDir: string, name: string): Promise<boolean> {
  const servers = await readMcpServersRaw(dataDir);
  return servers[name]?.readOnly === true;
}

export async function createMcpServer(
  dataDir: string,
  name: string,
  spec: McpSpec,
): Promise<{ name: string } & McpSpec> {
  const servers = await readMcpServersRaw(dataDir);
  servers[name] = spec;
  await writeMcpServersRaw(dataDir, servers);
  return { name, ...spec };
}

export async function updateMcpServer(
  dataDir: string,
  name: string,
  spec: McpSpec,
): Promise<({ name: string } & McpSpec) | null> {
  const servers = await readMcpServersRaw(dataDir);
  if (!(name in servers)) return null;
  servers[name] = spec;
  await writeMcpServersRaw(dataDir, servers);
  return { name, ...spec };
}

export async function deleteMcpServer(dataDir: string, name: string): Promise<boolean> {
  const servers = await readMcpServersRaw(dataDir);
  if (!(name in servers)) return false;
  delete servers[name];
  await writeMcpServersRaw(dataDir, servers);
  return true;
}

/* ----------------------- Built-in tool toggles ------------------------- *
 * Per-tool on/off overrides for the three user-controllable Pi-native
 * SystemTools (`skill_search`, `get_domain_knowledge_local`,
 * `search_papers_local`), persisted at
 * `<dataDir>/bp_template/tool_toggles.json`. The runtime consumes the same
 * file via `packages/runtime/src/tool-toggles.ts:loadToolToggles`.
 *
 * Semantics:
 *   - Every field is optional. Missing / non-boolean → runtime treats as
 *     enabled (default-on).
 *   - Write is a MERGE (PATCH), not a REPLACE: passing `{ skill_search: false }`
 *     leaves the other two keys untouched. Matches how the frontend toggle
 *     UI operates (flip one row, save).
 *   - Written 0o600 through the same tmp+rename dance as providers.json /
 *     mcp_servers.json. Preserves unrelated top-level keys the user may have
 *     hand-edited (forward-compat with future toggles).
 * ------------------------------------------------------------------------- */

export const TOGGLEABLE_TOOL_NAMES = [
  "skill_search",
  "get_domain_knowledge_local",
  "search_papers_local",
] as const;

export type ToggleableToolName = (typeof TOGGLEABLE_TOOL_NAMES)[number];

export type ToolToggles = Partial<Record<ToggleableToolName, boolean>>;

export function toolTogglesPath(dataDir: string): string {
  return path.join(dataDir, "bp_template", "tool_toggles.json");
}

/**
 * Read the toggles file. Malformed / missing → `{}` (all enabled).
 * Unknown keys are silently dropped; non-boolean values are dropped
 * (matches the runtime loader's contract).
 */
export async function readToolToggles(dataDir: string): Promise<ToolToggles> {
  const raw = await readJsonSafe(toolTogglesPath(dataDir));
  if (!raw || typeof raw !== "object") return {};
  const out: ToolToggles = {};
  for (const name of TOGGLEABLE_TOOL_NAMES) {
    const v = (raw as Record<string, unknown>)[name];
    if (typeof v === "boolean") out[name] = v;
  }
  return out;
}

/**
 * Merge `patch` into the current toggles and persist. Returns the new
 * complete state (post-merge). Any keys in `patch` that aren't in the
 * strict tool-name union are ignored. Any non-boolean values are ignored
 * (so the disk file only ever contains booleans on the strict keys).
 *
 * We preserve unknown top-level keys already on disk (a future field the
 * user's build doesn't know about survives round-trip through this
 * endpoint). Known keys not present in the merged result are dropped —
 * `writeToolToggles(x, {})` still normalises the file.
 */
export async function writeToolToggles(
  dataDir: string,
  patch: ToolToggles,
): Promise<ToolToggles> {
  const current = await readToolToggles(dataDir);
  const merged: ToolToggles = { ...current };
  for (const name of TOGGLEABLE_TOOL_NAMES) {
    const v = patch[name];
    if (typeof v === "boolean") merged[name] = v;
  }
  // Preserve unrelated top-level keys the user may have hand-edited.
  const existingRaw = (await readJsonSafe(toolTogglesPath(dataDir))) ?? {};
  const withUnknowns: Record<string, unknown> = { ...existingRaw };
  // Strip the strict fields from `withUnknowns` first, then reapply from
  // `merged`, so a strict field's on-disk value is authoritative from the
  // merge (not accidentally reintroduced from the raw read).
  for (const name of TOGGLEABLE_TOOL_NAMES) delete withUnknowns[name];
  Object.assign(withUnknowns, merged);

  const target = toolTogglesPath(dataDir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(withUnknowns, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  await fs.rename(tmp, target);
  return merged;
}

/* ---------------------- KnowledgeBase API config -------------------------
 * OCR + metadata-extract API keys the Python pipeline reads at build time.
 * Stored at ``<KB_ROOT>/source/API_config.json`` — the exact path
 * ``ocr_pdfs.py`` and ``extract_meta.py`` already consult as their 3rd-tier
 * fallback (after CLI flag and env var). Same on-disk file: no drift.
 *
 * OCR config is now a full provider descriptor (preset + base_url + model
 * + api_key + optional prompt) so international users can point at OpenAI /
 * Anthropic / Mistral / any OpenAI-compatible endpoint instead of being
 * pinned to SiliconFlow. Metadata-extract creds still go through the main
 * provider system.
 *
 * Written 0o600 through the same tmp+rename dance as providers.json /
 * mcp_servers.json. Preserves unrelated top-level keys the user may have
 * hand-edited into the file, and keeps the legacy ``siliconflow.API_KEY``
 * shape readable so upgrading from v3 doesn't invalidate saved keys. */

export interface KbApiConfig {
  /** Provider preset id. One of siliconflow | openai | anthropic | mistral
   *  | zhipu | qwen | custom. Sets defaults for the fields below when the
   *  file / UI leaves them blank. */
  ocrPreset?: string;
  ocrBaseUrl?: string;
  ocrModel?: string;
  ocrPrompt?: string;
  ocrApiKey?: string;
}

export function kbApiConfigPath(kbRoot: string): string {
  return path.join(kbRoot, "source", "API_config.json");
}

/** Read the OCR provider config, tolerating both the new schema
 *  (``{"ocr":{"PRESET","BASE_URL","MODEL","API_KEY","PROMPT"}}``) and the
 *  legacy shape (``{"siliconflow":{"API_KEY":"…"}}``) so v3 setups keep
 *  working after this upgrade. Only field values are returned — never any
 *  key stored under a name we don't recognise, in case the file was
 *  hand-edited with typos. */
export async function readKbApiConfig(kbRoot: string): Promise<KbApiConfig> {
  const raw = await readJsonSafe(kbApiConfigPath(kbRoot));
  if (!raw || typeof raw !== "object") return {};
  const ocr =
    raw.ocr && typeof raw.ocr === "object"
      ? (raw.ocr as Record<string, unknown>)
      : undefined;
  const sf =
    raw.siliconflow && typeof raw.siliconflow === "object"
      ? (raw.siliconflow as Record<string, unknown>)
      : undefined;
  const pick = (o: Record<string, unknown> | undefined, k: string) => {
    if (!o) return undefined;
    const v = o[k];
    return typeof v === "string" ? v : undefined;
  };
  const preset = pick(ocr, "PRESET") ?? (sf ? "siliconflow" : undefined);
  const key = pick(ocr, "API_KEY") ?? pick(sf, "API_KEY");
  return {
    ocrPreset: preset,
    ocrBaseUrl: pick(ocr, "BASE_URL"),
    ocrModel: pick(ocr, "MODEL"),
    ocrPrompt: pick(ocr, "PROMPT"),
    ocrApiKey: key,
  };
}

/** Patch the OCR provider config. Fields left undefined are kept as-is;
 *  fields set to the empty string are removed from disk. Legacy
 *  ``siliconflow.API_KEY`` is migrated into the new ``ocr.*`` block the
 *  first time the user saves via the new UI — but we don't nuke the
 *  siliconflow block outright, so a mixed setup (someone still driving
 *  ocr_pdfs.py from the shell) keeps working. */
export async function writeKbApiConfig(
  kbRoot: string, patch: KbApiConfig,
): Promise<void> {
  const target = kbApiConfigPath(kbRoot);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const existing = ((await readJsonSafe(target)) ?? {}) as Record<string, unknown>;
  const ocr: Record<string, unknown> = {
    ...((existing.ocr as Record<string, unknown> | undefined) ?? {}),
  };
  const setOrDelete = (jsonKey: string, v: string | undefined) => {
    if (v === undefined) return;
    if (v === "") delete ocr[jsonKey];
    else ocr[jsonKey] = v;
  };
  setOrDelete("PRESET", patch.ocrPreset);
  setOrDelete("BASE_URL", patch.ocrBaseUrl);
  setOrDelete("MODEL", patch.ocrModel);
  setOrDelete("PROMPT", patch.ocrPrompt);
  setOrDelete("API_KEY", patch.ocrApiKey);
  const next: Record<string, unknown> = { ...existing, ocr };
  // Mirror the OCR key back into the legacy siliconflow.API_KEY slot when
  // preset=siliconflow. Users who upgrade halfway (backend updated, CLI
  // scripts pinned) still read their key from the shape the older script
  // expected. Harmless duplication; costs one extra JSON key on disk.
  if (patch.ocrApiKey !== undefined) {
    const sf: Record<string, unknown> = {
      ...((existing.siliconflow as Record<string, unknown> | undefined) ?? {}),
    };
    if (patch.ocrApiKey === "" || (patch.ocrPreset && patch.ocrPreset !== "siliconflow")) {
      delete sf.API_KEY;
    } else if (patch.ocrPreset === "siliconflow" || !patch.ocrPreset) {
      sf.API_KEY = patch.ocrApiKey;
    }
    if (Object.keys(sf).length) next.siliconflow = sf;
    else delete next.siliconflow;
  }
  const tmp = `${target}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, target);
}
