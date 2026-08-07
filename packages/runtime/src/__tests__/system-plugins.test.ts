import { describe, expect, it } from "vitest";
import {
  AUDITOR_PLUGIN_ID,
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
    expect(systemPluginSkillPaths(plugins, snapshot, "principal")[0]).toMatch(/plugin-auditor.*audit-feedback-loop/);
    expect(systemPluginSkillPaths(plugins, snapshot, "engineer")).toEqual([]);
    expect(systemPluginSkillPaths(plugins, snapshot, "trace")[0])
      .toMatch(/plugin-got.*curate-research-trace/);
    expect((await systemPluginInstructions(plugins, snapshot, "principal")).join("\n"))
      .toContain("Auditor feedback loop");
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
