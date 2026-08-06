import { describe, expect, it } from "vitest";
import { isBrainPilotVersionCompatible, isBrainPilotVersionRange, isPreviewPluginMessage, parsePluginManifest, parsePublishablePluginManifest, previewerExtensions } from "./index.js";

const base = { id: "org.example.viewer", version: "1.0.0", apiVersion: "1", displayName: "Viewer", description: "Example" };

describe("plugin SDK compatibility", () => {
  it("normalizes legacy previewer extensions", () => {
    const manifest = parsePluginManifest({ ...base, kind: "previewer", contributes: { previewers: [{ id: "main", extensions: [".nii"], entry: "ui/index.html" }] } });
    expect(previewerExtensions(manifest!.contributes!.previewers![0]!)).toEqual([".nii"]);
    expect(manifest!.contributes!.previewers![0]!.match?.extensions).toEqual([".nii"]);
  });

  it("preserves future contribution keys while validating previewers", () => {
    const manifest = parsePluginManifest({ ...base, categories: ["visualization"], contributes: { previewers: [{ id: "main", match: { extensions: [".nwb"] }, entry: "ui/index.html" }], futureFeature: [{ id: "future" }] } });
    expect(manifest?.contributes?.futureFeature).toEqual([{ id: "future" }]);
  });

  it("validates RPC and engine versions", () => {
    expect(isPreviewPluginMessage({ type: "preview/ready", rpcVersion: "1", token: "x" })).toBe(true);
    expect(isPreviewPluginMessage({ type: "preview/ready", rpcVersion: "2", token: "x" })).toBe(false);
    expect(isBrainPilotVersionCompatible(">=0.1.0 <1.0.0", "0.2.0")).toBe(true);
    expect(isBrainPilotVersionCompatible(">=0.2.0", "0.1.0")).toBe(false);
    expect(isBrainPilotVersionRange(">=0.1.1 <0.2.0")).toBe(true);
    expect(isBrainPilotVersionRange("latest")).toBe(false);
    expect(parsePublishablePluginManifest(base)).toBeNull();
    expect(parsePublishablePluginManifest({ ...base, engines: { brainpilot: ">=0.1.1 <0.2.0" } })).not.toBeNull();
  });

  it("validates agent instructions and range-backed dataset previews", () => {
    const manifest = parsePluginManifest({
      ...base,
      protocols: { preview: "1", agentInstructions: "1" },
      environments: ["local", "cloud"],
      contributes: {
        previewers: [{ id: "compound", entry: "ui/index.html", delivery: "range", match: { extensions: [".vhdr"], dataset: { kind: "stem-siblings", companions: [".vhdr", ".eeg", ".vmrk"], required: [".vhdr", ".eeg"] } } }],
        agentInstructions: [{ id: "writing", title: "Writing", entry: "prompts/writing.md", targets: ["writer"], mode: "append", priority: 10 }],
      },
    });
    expect(manifest?.contributes?.previewers?.[0]?.delivery).toBe("range");
    expect(manifest?.contributes?.agentInstructions?.[0]?.targets).toEqual(["writer"]);
    expect(isPreviewPluginMessage({ type: "preview/read-range", rpcVersion: "1", token: "x", requestId: "r", handle: "primary", offset: 0, length: 64 })).toBe(true);
  });

  it("validates role-targeted skill contributions", () => {
    const manifest = parsePluginManifest({
      ...base,
      contributes: { skills: [{ id: "audit", entry: "skills/audit/SKILL.md", targets: ["principal", "auditor"] }] },
    });
    expect(manifest?.contributes?.skills?.[0]).toMatchObject({
      id: "audit",
      targets: ["principal", "auditor"],
    });
    expect(parsePluginManifest({
      ...base,
      contributes: { skills: [{ id: "audit", entry: "skills/audit/SKILL.md", targets: [] }] },
    })).toBeNull();
  });

  it("uses standard npm SemVer ranges", () => {
    const range = "^0.1.2 || >=1.0.0 <2.0.0";
    expect(isBrainPilotVersionRange(range)).toBe(true);
    expect(isBrainPilotVersionCompatible(range, "0.1.9")).toBe(true);
    expect(isBrainPilotVersionCompatible(range, "0.2.0")).toBe(false);
  });

  it("rejects duplicate contribution ids and self-references", () => {
    const invalid = { ...base, id: "org.example.invalid" };
    expect(parsePluginManifest({ ...invalid, contributes: { skills: [
      { id: "same", entry: "one/SKILL.md" },
      { id: "same", entry: "two/SKILL.md" },
    ] } })).toBeNull();
    expect(parsePluginManifest({ ...invalid, dependencies: [{ id: invalid.id, version: "^1.0.0" }] })).toBeNull();
    expect(parsePluginManifest({ ...invalid, conflicts: [invalid.id] })).toBeNull();
  });
});
