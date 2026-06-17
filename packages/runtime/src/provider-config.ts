/**
 * provider-config.ts — runtime-side resolver for the per-session LLM provider.
 *
 * The backend owns provider CRUD; the runtime only READS the same on-disk SSOT
 * (`<dataRoot>/bp_template/providers.json`) plus a per-session reference
 * (`<dataRoot>/.bp/<sid>/provider.json` = `{ providerId, modelId }`). It turns
 * those into a concrete `{ baseUrl, apiKey, modelId }` for the agent factory.
 *
 * Resolution: session ref's providerId → else the file's selectedProfileId →
 * else the first profile. Returns `undefined` when nothing is configured, so
 * the factory falls back to Pi's env-based default (Docker/static compat).
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface ProviderConfig {
  providerId: string;
  baseUrl?: string;
  apiKey: string;
  modelId?: string;
}

interface StoredProfile {
  id: string;
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
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
 * stored `{ providerId, modelId }` (may be empty). Returns undefined when no
 * usable profile/key exists.
 */
export async function resolveSessionProvider(
  dataRoot: string,
  ref: SessionProviderRef,
): Promise<ProviderConfig | undefined> {
  const file = await readJson<{ profiles?: StoredProfile[]; selectedProfileId?: string }>(
    join(dataRoot, "bp_template", "providers.json"),
  );
  const profiles = file?.profiles ?? [];
  if (profiles.length === 0) return undefined;

  const profile =
    profiles.find((p) => p.id === ref.providerId) ??
    profiles.find((p) => p.id === file?.selectedProfileId) ??
    profiles[0];
  if (!profile?.apiKey) return undefined;

  // Model: the session's choice if still offered by the profile, else default.
  const modelId =
    ref.modelId && profile.models?.includes(ref.modelId) ? ref.modelId : profile.models?.[0];

  return {
    providerId: profile.id,
    baseUrl: profile.baseUrl || undefined,
    apiKey: profile.apiKey,
    modelId,
  };
}
