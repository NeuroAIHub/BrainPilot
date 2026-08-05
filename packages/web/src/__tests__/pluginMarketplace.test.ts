import { describe, expect, it } from "vitest";
import {
  capabilitiesForMarketplaceEntry,
  categoryForMarketplaceEntry,
  categoryForPluginKind,
  matchesMarketplaceQuery,
  matchesMarketplaceSource,
  sourceFormatForMarketplaceEntry,
} from "../components/plugins/PluginMarketplace";

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

  it("defaults legacy entries to BrainPilot and filters explicit ecosystem sources", () => {
    expect(sourceFormatForMarketplaceEntry(entry)).toBe("brainpilot");
    expect(matchesMarketplaceSource(entry, "brainpilot")).toBe(true);
    expect(matchesMarketplaceSource({ ...entry, sourceFormat: "claude-code" }, "claude-code")).toBe(true);
    expect(matchesMarketplaceSource({ ...entry, sourceFormat: "claude-code" }, "codex")).toBe(false);
    expect(matchesMarketplaceSource(entry, "verified")).toBe(true);
  });

  it("uses explicit compact capabilities and derives legacy Skills", () => {
    expect(capabilitiesForMarketplaceEntry({ ...entry, capabilities: ["mcp", "hooks"] })).toEqual(["mcp", "hooks"]);
    expect(capabilitiesForMarketplaceEntry({
      ...entry,
      manifest: { ...entry.manifest, contributes: { skills: [{ id: "method", title: "Method", entry: "SKILL.md" }] } },
    })).toEqual(["skills"]);
  });
});
