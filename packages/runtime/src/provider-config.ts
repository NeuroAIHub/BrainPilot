/**
 * provider-config.ts — runtime-side resolver for the per-session LLM provider.
 *
 * The backend owns provider CRUD; the runtime only READS the same on-disk SSOT
 * (`<dataRoot>/bp_template/providers.json`) plus a per-session reference
 * (`<dataRoot>/.bp/<sid>/provider.json` = `{ providerId, modelId }`). It turns
 * those into a concrete `{ baseUrl, apiKey, modelId }` for the agent factory.
 *
 * Resolution: a stored session providerId is authoritative; legacy sessions
 * without one use the file's selectedProfileId, then the first profile. A
 * missing stored provider is an error rather than permission to switch an
 * existing conversation to another provider. Returns `undefined` only when an
 * unbound session has no usable configuration, so the factory can retain Pi's
 * env-based fallback for Docker/static compatibility.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ProviderConfig {
  providerId: string;
  baseUrl?: string;
  /** #63: wire protocol (Pi models.json api). Undefined → runtime defaults it. */
  api?: string;
  /** #68: coarse adapter family (auto/openai/anthropic). When `api` is unset,
   *  the runtime derives the precise wire value from this. */
  adapter?: string;
  apiKey: string;
  modelId?: string;
  contextWindow?: number;
  reasoningEnabled?: boolean;
}

interface StoredProfile {
  id: string;
  baseUrl?: string;
  api?: string;
  adapter?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  models?: string[];
  contextWindow?: number;
  reasoningModels?: string[];
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Per-session reference written by SessionManager.createSession. */
export interface SessionProviderRef {
  providerId?: string;
  modelId?: string;
}

/**
 * Resolve the effective provider config for a session. `ref` is the session's
 * stored `{ providerId, modelId }` (may be empty). An unbound session returns
 * undefined when no usable profile/key exists; a stale bound ref throws.
 */
export async function resolveSessionProvider(
  dataRoot: string,
  ref: SessionProviderRef,
  options: { requireConfiguredModel?: boolean } = {},
): Promise<ProviderConfig | undefined> {
  const file = await readJson<{ profiles?: StoredProfile[]; selectedProfileId?: string }>(
    join(dataRoot, "bp_template", "providers.json"),
  );
  const profiles = file?.profiles ?? [];
  if (profiles.length === 0) {
    if (ref.providerId) {
      throw new Error(`session provider is no longer configured: ${ref.providerId}`);
    }
    return undefined;
  }

  const profile = ref.providerId
    ? profiles.find((p) => p.id === ref.providerId)
    : profiles.find((p) => p.id === file?.selectedProfileId) ?? profiles[0];
  if (!profile) {
    throw new Error(`session provider is no longer configured: ${ref.providerId}`);
  }
  const apiKey = profile?.apiKey || (profile?.apiKeyEnv
    ? process.env[profile.apiKeyEnv]?.trim()
    : undefined);
  if (!apiKey) {
    if (ref.providerId) {
      throw new Error(`session provider no longer has credentials: ${ref.providerId}`);
    }
    return undefined;
  }

  if (ref.modelId && options.requireConfiguredModel && !profile.models?.includes(ref.modelId)) {
    throw new Error(`model is not configured for provider ${profile.id}: ${ref.modelId}`);
  }
  // A stored model id is immutable for the session. The operator may remove it
  // from the editor's current choices, but that must not silently switch an
  // existing conversation to the profile's first model.
  const modelId = ref.modelId ?? profile.models?.[0];

  return {
    providerId: profile.id,
    baseUrl: profile.baseUrl || undefined,
    api: profile.api || undefined,
    adapter: profile.adapter || undefined,
    apiKey,
    modelId,
    contextWindow: profile.contextWindow,
    reasoningEnabled: modelId
      ? (profile.reasoningModels ?? profile.models ?? []).includes(modelId)
      : false,
  };
}
