import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDITOR_PLUGIN_ID,
  BACKGROUND_JOBS_PLUGIN_ID,
  GOT_PLUGIN_ID,
  MONITOR_PLUGIN_ID,
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
    expect(systemPluginEnabled(snapshot, MONITOR_PLUGIN_ID)).toBe(false);
    expect(systemPluginEnabled(snapshot, BACKGROUND_JOBS_PLUGIN_ID)).toBe(false);
    const principalSkills = systemPluginSkillPaths(plugins, snapshot, "principal");
    expect(principalSkills).toHaveLength(1);
    expect(principalSkills[0]).toMatch(/plugin-auditor.*audit-feedback-loop/);
    const auditorSkills = systemPluginSkillPaths(plugins, snapshot, "auditor");
    expect(auditorSkills).toHaveLength(5);
    for (const skill of [
      "audit-feedback-loop",
      "audit-data-integrity",
      "audit-model-validation",
      "audit-code-artifact",
      "audit-evidence",
    ]) {
      expect(auditorSkills).toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(skill))]));
    }
    expect(systemPluginSkillPaths(plugins, snapshot, "engineer")).toEqual([]);
    expect(systemPluginSkillPaths(plugins, snapshot, "trace")[0])
      .toMatch(/plugin-got.*curate-research-trace/);
    const principalInstructions = (await systemPluginInstructions(plugins, snapshot, "principal")).join("\n");
    expect(principalInstructions).toContain("Auditor feedback loop");
    expect(principalInstructions).toContain("never immediately claim that the");
    expect(principalInstructions).toContain("task is complete");
    expect(principalInstructions).toContain("Only `Verdict: PASS`");
    const auditorInstructions = (await systemPluginInstructions(plugins, snapshot, "auditor")).join("\n");
    expect(auditorInstructions).toContain("Begin every completed audit reply");
    expect(auditorInstructions).toContain("PI must not claim the task is complete");
    const auditorSkill = auditorSkills.find((path) => path.endsWith("audit-feedback-loop"))!;
    const auditorReview = await readFile(join(auditorSkill, "references", "auditor-review.md"), "utf8");
    expect(auditorReview).toContain("call `spawn_subagent` once with two to");
    expect(auditorReview).toContain("Children return evidence and candidate findings only");
    expect(auditorReview).toContain("`operational validity` and `empirical adequacy`");
    expect(auditorReview).toContain("Write the complete report to a new path under");
    const methodSkill = auditorSkills.find((path) => path.endsWith("audit-model-validation"))!;
    const methodReview = await readFile(join(methodSkill, "SKILL.md"), "utf8");
    expect(methodReview).toContain("Audit Method Validation");
    expect(methodReview).toContain("substantively different alternatives");
    expect(methodReview).toContain("operational correctness and feasibility");
    expect(methodReview).toContain("implementation convenience");
    expect(methodReview).toContain("Separate operational and empirical evidence");
    expect(methodReview).toContain("macro-F1 `2 / (K * (K + 1))`");
    expect(methodReview).toContain("does not validate cross-session transfer");
    expect(methodReview).toContain("sample counts across sampling");
    expect(methodReview).toContain("rates is not protocol fidelity");
    const responseTemplate = await readFile(join(auditorSkill, "references", "audit-response-template.md"), "utf8");
    expect(responseTemplate).toContain("## Compact completion reply");
    expect(responseTemplate).toContain("Report: docs/audits/<actual-report-file>.md");
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
