import { describe, expect, it } from "vitest";
import { categoryForMarketplaceEntry, categoryForPluginKind, matchesMarketplaceQuery } from "../components/plugins/PluginMarketplace";

const entry = {
  manifest: {
    id: "org.brainpilot.nifti-viewer",
    displayName: "NIfTI Viewer",
    description: "Central-slice neuroscience preview",
    version: "0.1.0",
    kind: "previewer",
  },
  publisher: "BrainPilot",
  verified: true,
} as Parameters<typeof matchesMarketplaceQuery>[0];

describe("plugin marketplace catalogue model", () => {
  it("maps contribution kinds into the three marketplace panels", () => {
    expect(categoryForPluginKind("skill-pack")).toBe("skills");
    expect(categoryForPluginKind("knowledge-base")).toBe("knowledge");
    expect(categoryForPluginKind("literature-provider")).toBe("knowledge");
    expect(categoryForPluginKind("previewer")).toBe("plugins");
    expect(categoryForPluginKind("workflow")).toBe("plugins");
    expect(categoryForMarketplaceEntry({
      ...entry,
      manifest: { ...entry.manifest, kind: undefined, categories: ["skills"], contributes: { skills: [{ id: "method", title: "Method", entry: "SKILL.md" }] } },
    })).toBe("skills");
  });

  it("searches names, descriptions, ids, kinds, and publishers case-insensitively", () => {
    expect(matchesMarketplaceQuery(entry, "nifti")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "NEUROSCIENCE")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "brainpilot")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "previewer")).toBe(true);
    expect(matchesMarketplaceQuery(entry, "atlas")).toBe(false);
  });
});
