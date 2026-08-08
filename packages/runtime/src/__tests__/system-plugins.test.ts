import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDITOR_PLUGIN_ID,
  GOT_PLUGIN_ID,
  loadBundledSystemPlugins,
  snapshotSystemPlugins,
  systemPluginEnabled,
  systemPluginInstructions,
  systemPluginSkillPaths,
} from "../system-plugins.js";

describe("bundled system plugins", () => {
  it("loads Auditor and GoT by default from their npm packages", async () => {
    const plugins = loadBundledSystemPlugins({});
    const snapshot = snapshotSystemPlugins(plugins);
    expect(systemPluginEnabled(snapshot, AUDITOR_PLUGIN_ID)).toBe(true);
    expect(systemPluginEnabled(snapshot, GOT_PLUGIN_ID)).toBe(true);
    expect(systemPluginSkillPaths(plugins, snapshot, "principal")[0]).toMatch(/plugin-auditor.*audit-feedback-loop/);
    expect(systemPluginSkillPaths(plugins, snapshot, "engineer")).toEqual([]);
    expect(systemPluginSkillPaths(plugins, snapshot, "trace")[0])
      .toMatch(/plugin-got.*curate-research-trace/);
    const principalInstructions = (await systemPluginInstructions(plugins, snapshot, "principal")).join("\n");
    expect(principalInstructions).toContain("Auditor feedback loop");
    expect(principalInstructions).toContain("never immediately claim that the task is");
    expect(principalInstructions).toContain("Only `Verdict: PASS`");
    const auditorInstructions = (await systemPluginInstructions(plugins, snapshot, "auditor")).join("\n");
    expect(auditorInstructions).toContain("Begin every completed audit reply");
    expect(auditorInstructions).toContain("PI must not claim the task is complete");
    const auditorSkill = systemPluginSkillPaths(plugins, snapshot, "auditor")[0]!;
    const auditorReview = await readFile(join(auditorSkill, "references", "auditor-review.md"), "utf8");
    expect(auditorReview).toContain("Comparison and adaptation validity");
    expect(auditorReview).toContain("Do not prescribe a winning model or redesign the study");
    expect(await systemPluginInstructions(plugins, snapshot, "trace")).toEqual([]);
  });

  it("rejects a bundled plugin outside its declared BrainPilot range", () => {
    expect(() => loadBundledSystemPlugins({}, "9.0.0")).toThrow(
      /requires BrainPilot .* current 9\.0\.0/,
    );
  });

  it("uses the current compatible plugin version for a stored assignment", async () => {
    const plugins = loadBundledSystemPlugins({});
    const stored = snapshotSystemPlugins(plugins).map((plugin) => ({
      ...plugin,
      version: "0.0.1",
    }));
    expect(await systemPluginInstructions(plugins, stored, "principal"))
      .toEqual(expect.arrayContaining([expect.stringContaining("Auditor feedback loop")]));
  });

  it("removes all Auditor contributions under the experiment override", async () => {
    const plugins = loadBundledSystemPlugins({
      BP_EXPERIMENT_DISABLE_PLUGINS: AUDITOR_PLUGIN_ID,
    });
    const snapshot = snapshotSystemPlugins(plugins);
    expect(snapshot).toContainEqual(expect.objectContaining({
      id: AUDITOR_PLUGIN_ID,
      enabled: false,
      reason: "experiment-override",
    }));
    expect(systemPluginSkillPaths(plugins, snapshot, "principal")).toEqual([]);
    expect(await systemPluginInstructions(plugins, snapshot, "principal")).toEqual([]);
    expect(await systemPluginInstructions(plugins, snapshot, "auditor")).toEqual([]);
    expect(await systemPluginInstructions(plugins, snapshot, "trace")).toEqual([]);
  });

  it("removes only the targeted GoT skill under its experiment override", () => {
    const plugins = loadBundledSystemPlugins({
      BP_EXPERIMENT_DISABLE_PLUGINS: GOT_PLUGIN_ID,
    });
    const snapshot = snapshotSystemPlugins(plugins);
    expect(snapshot).toContainEqual(expect.objectContaining({
      id: GOT_PLUGIN_ID,
      enabled: false,
      reason: "experiment-override",
    }));
    expect(systemPluginSkillPaths(plugins, snapshot, "trace")).toEqual([]);
    expect(systemPluginEnabled(snapshot, AUDITOR_PLUGIN_ID)).toBe(true);
  });
});
