import { describe, expect, it } from "vitest";
import {
  groupProviders,
  isSharedProvider,
  providerActionPermissions,
} from "../components/settings/providerSettingsView";

/** Only the fields the view logic reads. */
const provider = (id: string, isShared?: boolean) =>
  (isShared === undefined ? { id } : { id, isShared });

describe("provider shared classification (#556 follow-up)", () => {
  it("trusts isShared for hosted preset ids that carry no shared_ prefix", () => {
    // Cloud's preset ids come from preset_providers.json ("preset-1", …); the
    // old id-prefix check classified them as private and offered Edit/Remove
    // buttons that could only ever 403.
    expect(isSharedProvider(provider("preset-1", true))).toBe(true);
    expect(isSharedProvider(provider("anything-at-all", true))).toBe(true);

    const permissions = providerActionPermissions(provider("preset-1", true));
    expect(permissions.canEdit).toBe(false);
    expect(permissions.canRemove).toBe(false);
    // Using and probing a shared profile is allowed by the backend.
    expect(permissions.canSelect).toBe(true);
    expect(permissions.canTest).toBe(true);
  });

  it("treats an explicit isShared:false as authoritative over the legacy prefix", () => {
    expect(isSharedProvider(provider("shared_legacy", false))).toBe(false);
    const permissions = providerActionPermissions(provider("shared_legacy", false));
    expect(permissions.canEdit).toBe(true);
    expect(permissions.canRemove).toBe(true);
  });

  it("falls back to the id prefix only when the field is absent", () => {
    expect(isSharedProvider(provider("shared_legacy"))).toBe(true);
    expect(isSharedProvider(provider("my-own"))).toBe(false);
  });

  it("groups by the authoritative flag, not the id shape", () => {
    const groups = groupProviders([
      provider("preset-1", true),
      provider("shared_legacy", false),
      provider("mine", false),
    ]);
    expect(groups.shared.map((p) => p.id)).toEqual(["preset-1"]);
    expect(groups.private.map((p) => p.id)).toEqual(["shared_legacy", "mine"]);
  });

  it("grants full permissions to ordinary private profiles", () => {
    expect(providerActionPermissions(provider("mine", false))).toEqual({
      canEdit: true,
      canRemove: true,
      canSelect: true,
      canTest: true,
    });
  });
});
