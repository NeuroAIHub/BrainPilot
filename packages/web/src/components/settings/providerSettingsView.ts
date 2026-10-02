/**
 * Pure view logic for the Settings → Providers list.
 *
 * Hosted deployments inject platform-managed ("shared") provider profiles
 * alongside the user's own. The backend is the authority: the profile carries
 * `isShared`, and BrainPilot Cloud answers 403 to a PUT/DELETE against a shared
 * profile. The UI used to infer shared-ness from an `id.startsWith("shared_")`
 * prefix, which is not the contract — Cloud's preset ids come from the
 * administrator's `preset_providers.json` (defaulting to `preset-1`, `preset-2`,
 * …). Those profiles were classified as private, listed under the wrong heading,
 * and offered Edit / Remove buttons that could only ever fail with a 403.
 *
 * Select ("use") and Test stay available for shared profiles: both are allowed
 * by the backend and are the main reason a user opens this tab.
 */
import type { ProviderProfile } from "../../contracts/backend";

/** Legacy fallback for a backend that predates the `isShared` field. */
const LEGACY_SHARED_ID_PREFIX = "shared_";

/**
 * `isShared` is authoritative whenever the field is present — including an
 * explicit `false`, which must not be second-guessed by the id prefix. The
 * prefix is consulted only when the field is absent altogether.
 */
export function isSharedProvider(
  provider: Pick<ProviderProfile, "id"> & { isShared?: boolean },
): boolean {
  if (typeof provider.isShared === "boolean") return provider.isShared;
  return provider.id.startsWith(LEGACY_SHARED_ID_PREFIX);
}

export interface ProviderActionPermissions {
  /** Platform-managed profiles are read-only: the backend 403s on write. */
  canEdit: boolean;
  canRemove: boolean;
  /** Always allowed — selecting and probing a shared profile is supported. */
  canSelect: boolean;
  canTest: boolean;
}

export function providerActionPermissions(
  provider: Pick<ProviderProfile, "id"> & { isShared?: boolean },
): ProviderActionPermissions {
  const shared = isSharedProvider(provider);
  return { canEdit: !shared, canRemove: !shared, canSelect: true, canTest: true };
}

export interface ProviderGroups<T> {
  shared: T[];
  private: T[];
}

/** Split a profile list into its "shared" / "private" rendering groups. */
export function groupProviders<T extends Pick<ProviderProfile, "id"> & { isShared?: boolean }>(
  providers: T[],
): ProviderGroups<T> {
  return {
    shared: providers.filter((provider) => isSharedProvider(provider)),
    private: providers.filter((provider) => !isSharedProvider(provider)),
  };
}
