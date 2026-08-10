/**
 * pi-provider.ts — resolve a custom LLM provider for the Pi SDK from env.
 *
 * Pi does NOT honour `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` (it only reads
 * `ANTHROPIC_API_KEY`, and otherwise hits the built-in Anthropic endpoint with
 * a built-in model). To target a third-party model we register it as a custom
 * Pi provider via a `models.json` + ModelRegistry and select its model.
 *
 * Three configuration tiers (simplest first):
 *
 *   1. Nothing set                         → Pi uses its built-in endpoint.
 *   2. ANTHROPIC_BASE_URL + ANTHROPIC_MODEL → we auto-generate a one-provider
 *      `bp-gateway-models.json` for an Anthropic-compatible gateway. Optional
 *      ANTHROPIC_CONTEXT_WINDOW / ANTHROPIC_MAX_TOKENS tune the model limits.
 *   3. BP_MODELS_JSON + ANTHROPIC_MODEL     → advanced: use the user's own
 *      hand-written models.json verbatim (multi-provider, custom headers,
 *      `compat` flags, openai-compatible APIs, …). BP_MODEL_PROVIDER picks the
 *      provider (defaults to the file's first provider key).
 *
 * Returns the resolved `{ model, modelRegistry }` to pass to
 * `createAgentSession`, or `{}` when nothing custom is configured.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveProviderApi, type ProviderAdapter } from "@brainpilot/protocol";

/** The synthetic provider id under which the auto-generated gateway lives. */
export const GATEWAY_PROVIDER = "bp-gateway";

/**
 * Anthropic's SDK appends `/v1/messages` to `baseURL` itself. Provider forms
 * commonly use the OpenAI-style convention of including a trailing `/v1`,
 * which would otherwise produce `/v1/v1/messages`. Keep every other API
 * family untouched because their SDKs expect the version segment in baseUrl.
 */
export function normalizeProviderBaseUrl(baseUrl: string, api: string): string {
  const trimmed = baseUrl.trim();
  if (api !== "anthropic-messages") return trimmed;
  return trimmed.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Defaults applied to an auto-generated gateway model when env is unset. */
const DEFAULT_CONTEXT_WINDOW = 200_000;
// #293: 8_192 is far below what modern models (Claude Sonnet 5, GPT-5, Gemini 2.5)
// support and — critically — below what a single tool call can require. Anthropic/
// OpenAI stream tool_use arguments as JSON in order, so a `write` / `edit` /
// `dispatch_task` whose `content` runs long gets its stream cut off mid-string when
// `max_tokens` is hit; Pi's streaming JSON repair recovers earlier fields (`path`)
// but the truncated `content` is lost, and the agent then retries indefinitely
// against the same ceiling. 32_768 matches the modal maxTokens in Pi's built-in
// model catalogue (see `pi-ai/dist/models.generated.js`) and is well above the
// 16_384 SDK-side fallback (`model-registry.js`). Users can still raise it
// further via the `ANTHROPIC_MAX_TOKENS` env override.
const DEFAULT_MAX_TOKENS = 32_768;

/** Minimal structural surface of the Pi SDK bits this module needs. */
export interface PiProviderSdk {
  AuthStorage: {
    create(path: string): PiAuthStorage;
    inMemory?(): PiAuthStorage;
  };
  ModelRegistry: {
    create(authStorage: unknown, modelsJsonPath?: string): {
      refresh(): void;
      getError(): string | undefined;
      find(provider: string, modelId: string): unknown;
    };
  };
}

export interface PiAuthStorage {
  /** In-memory, non-persisted, highest-priority key override (per provider). */
  setRuntimeApiKey?(provider: string, key: string): void;
}

/** A concrete per-session provider config resolved from providers.json. */
export interface SessionProviderConfig {
  providerId: string;
  baseUrl?: string;
  /** #63: wire protocol (Pi models.json `api`). Defaults to anthropic-messages. */
  api?: string;
  /** #68: coarse adapter family (auto/openai/anthropic). When `api` is unset,
   *  the precise wire value is derived from this. */
  adapter?: string;
  apiKey: string;
  modelId?: string;
  /** Provider-level override; absent preserves env/default behavior. */
  contextWindow?: number;
  reasoningEnabled?: boolean;
}

export interface CompactionSettings {
  enabled: true;
  reserveTokens: number;
  keepRecentTokens: number;
}

/**
 * A 1M context needs a proportionally larger safety margin than Pi's 16K
 * default. This triggers compaction at 900K and retains one full 64K tool
 * result plus nearby reasoning. Smaller/automatic contexts keep Pi defaults.
 */
export function resolveCompactionSettings(
  contextWindow?: number,
): CompactionSettings | undefined {
  if (contextWindow !== 1_000_000) return undefined;
  return { enabled: true, reserveTokens: 100_000, keepRecentTokens: 64_000 };
}

export interface ResolvedProvider {
  model?: unknown;
  modelRegistry?: unknown;
  /** Per-session AuthStorage holding the runtime key (when provider-configured). */
  authStorage?: unknown;
}

/** Parse a positive integer env var, or `undefined` if unset/invalid. */
function intEnv(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * Resolve a custom model from env, or return `{}` when none is configured.
 * `agentDir` is Pi's global config dir (getAgentDir()).
 */
export function resolveGatewayModel(sdk: PiProviderSdk, agentDir: string): ResolvedProvider {
  const modelId = process.env.ANTHROPIC_MODEL?.trim();

  // Tier 3 — advanced: user supplies their own models.json verbatim.
  const customPath = process.env.BP_MODELS_JSON?.trim();
  if (customPath) {
    // A custom file is meaningless without knowing which model to select.
    if (!modelId) return {};
    const provider = resolveCustomProvider(customPath);
    return select(sdk, agentDir, customPath, provider, modelId);
  }

  // Tier 2 — simple gateway: auto-generate a one-provider models.json.
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim();
  // Tier 1 — neither set → let Pi use its built-in providers/models.
  if (!baseUrl || !modelId) return {};

  mkdirSync(agentDir, { recursive: true });
  const modelsJsonPath = join(agentDir, "bp-gateway-models.json");
  const desired = JSON.stringify(
    {
      providers: {
        [GATEWAY_PROVIDER]: {
          baseUrl: normalizeProviderBaseUrl(baseUrl, "anthropic-messages"),
          api: "anthropic-messages",
          // Resolved at request time from the same env the gateway key lives in.
          apiKey: "$ANTHROPIC_API_KEY",
          models: [
            {
              id: modelId,
              reasoning: true,
              input: ["text"],
              contextWindow: intEnv("ANTHROPIC_CONTEXT_WINDOW") ?? DEFAULT_CONTEXT_WINDOW,
              maxTokens: intEnv("ANTHROPIC_MAX_TOKENS") ?? DEFAULT_MAX_TOKENS,
            },
          ],
        },
      },
    },
    null,
    2,
  );
  // Write idempotently (avoid churn when many agents start).
  let current: string | undefined;
  try {
    current = readFileSync(modelsJsonPath, "utf8");
  } catch {
    /* not written yet */
  }
  if (current !== desired) writeFileSync(modelsJsonPath, desired);

  return select(sdk, agentDir, modelsJsonPath, GATEWAY_PROVIDER, modelId);
}

/**
 * Pick the provider for a user-supplied models.json: explicit BP_MODEL_PROVIDER,
 * else the file's first provider key. Throws if the file is unreadable/empty.
 */
function resolveCustomProvider(modelsJsonPath: string): string {
  const explicit = process.env.BP_MODEL_PROVIDER?.trim();
  if (explicit) return explicit;
  let raw: string;
  try {
    raw = readFileSync(modelsJsonPath, "utf8");
  } catch (e) {
    throw new Error(`BP_MODELS_JSON unreadable (${modelsJsonPath}): ${(e as Error).message}`);
  }
  let providers: Record<string, unknown> | undefined;
  try {
    providers = (JSON.parse(raw) as { providers?: Record<string, unknown> }).providers;
  } catch (e) {
    throw new Error(`BP_MODELS_JSON is not valid JSON (${modelsJsonPath}): ${(e as Error).message}`);
  }
  const first = providers && Object.keys(providers)[0];
  if (!first) {
    throw new Error(`BP_MODELS_JSON has no "providers" (${modelsJsonPath}); set BP_MODEL_PROVIDER`);
  }
  return first;
}

/** Load the registry against `modelsJsonPath` and resolve `provider/modelId`. */
function select(
  sdk: PiProviderSdk,
  agentDir: string,
  modelsJsonPath: string,
  provider: string,
  modelId: string,
): ResolvedProvider {
  const authStorage = sdk.AuthStorage.create(join(agentDir, "auth.json"));
  const modelRegistry = sdk.ModelRegistry.create(authStorage, modelsJsonPath);
  modelRegistry.refresh();
  const err = modelRegistry.getError();
  if (err) throw new Error(`Pi models.json load error (${modelsJsonPath}): ${err}`);
  const model = modelRegistry.find(provider, modelId);
  if (!model) {
    throw new Error(`model not found in ${modelsJsonPath}: ${provider}/${modelId}`);
  }
  return { model, modelRegistry };
}

/**
 * Resolve a model for a PER-SESSION provider config (from providers.json),
 * isolated from process env so concurrent sessions can use different keys.
 *
 * Strategy (per the Pi SDK): build a dedicated models.json + ModelRegistry +
 * AuthStorage for this provider, then push the key via
 * `authStorage.setRuntimeApiKey` — an in-memory, non-persisted, top-priority
 * override. The models.json `apiKey` is a harmless placeholder; the runtime
 * override wins at request time. Returns `{}` when no usable config is given,
 * so the caller falls back to {@link resolveGatewayModel} (env-based).
 */
export function resolveSessionModel(
  sdk: PiProviderSdk,
  agentDir: string,
  cfg: SessionProviderConfig,
): ResolvedProvider {
  if (!cfg.apiKey || !cfg.baseUrl || !cfg.modelId) return {};

  mkdirSync(agentDir, { recursive: true });
  const api =
    cfg.api ??
    deriveProviderApi(cfg.adapter as ProviderAdapter | undefined) ??
    "anthropic-messages";
  // One models.json per provider id — distinct registries stay isolated.
  const modelsJsonPath = join(agentDir, `bp-session-${sanitize(cfg.providerId)}-models.json`);
  const desired = JSON.stringify(
    {
      providers: {
        [cfg.providerId]: {
          baseUrl: normalizeProviderBaseUrl(cfg.baseUrl, api),
          // #63/#68: persist the selected wire protocol instead of hardcoding
          // anthropic-messages. Precedence: explicit `api` (precise, #63) →
          // derived from `adapter` (coarse family, #68) → default. Pi's
          // ModelRegistry accepts any known api; azure-openai-responses derives
          // api-version/deployment from the Azure base URL.
          api,
          // Placeholder — the real key is injected via setRuntimeApiKey below.
          apiKey: `$BP_PROVIDER_${sanitize(cfg.providerId).toUpperCase()}`,
          models: [
            {
              id: cfg.modelId,
              reasoning: cfg.reasoningEnabled ?? true,
              input: ["text"],
              contextWindow:
                cfg.contextWindow ?? intEnv("ANTHROPIC_CONTEXT_WINDOW") ?? DEFAULT_CONTEXT_WINDOW,
              maxTokens: intEnv("ANTHROPIC_MAX_TOKENS") ?? DEFAULT_MAX_TOKENS,
            },
          ],
        },
      },
    },
    null,
    2,
  );
  let current: string | undefined;
  try {
    current = readFileSync(modelsJsonPath, "utf8");
  } catch {
    /* not written yet */
  }
  if (current !== desired) writeFileSync(modelsJsonPath, desired);

  // A per-session AuthStorage isolates the runtime key. Prefer inMemory()
  // (never touches disk); fall back to a file-backed instance if unavailable.
  const authStorage: PiAuthStorage = sdk.AuthStorage.inMemory
    ? sdk.AuthStorage.inMemory()
    : sdk.AuthStorage.create(join(agentDir, `auth-${sanitize(cfg.providerId)}.json`));
  authStorage.setRuntimeApiKey?.(cfg.providerId, cfg.apiKey);

  const modelRegistry = sdk.ModelRegistry.create(authStorage, modelsJsonPath);
  modelRegistry.refresh();
  const err = modelRegistry.getError();
  if (err) throw new Error(`Pi models.json load error (${modelsJsonPath}): ${err}`);
  const model = modelRegistry.find(cfg.providerId, cfg.modelId);
  if (!model) throw new Error(`model not found: ${cfg.providerId}/${cfg.modelId}`);
  return { model, modelRegistry, authStorage };
}

/** Filesystem/JSON-key-safe form of a provider id. */
function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "_");
}
