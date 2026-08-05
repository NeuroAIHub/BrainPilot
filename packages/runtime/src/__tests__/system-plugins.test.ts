import { describe, expect, it } from "vitest";
import {
  AUDITOR_PLUGIN_ID,
  loadBundledSystemPlugins,
  snapshotSystemPlugins,
  systemPluginEnabled,
  systemPluginInstructions,
  systemPluginSkillPaths,
} from "../system-plugins.js";

describe("bundled system plugins", () => {
  it("loads Auditor by default from its npm package", async () => {
    const plugins = loadBundledSystemPlugins({});
    const snapshot = snapshotSystemPlugins(plugins);
    expect(systemPluginEnabled(snapshot, AUDITOR_PLUGIN_ID)).toBe(true);
    expect(systemPluginSkillPaths(plugins, snapshot, "principal")[0]).toMatch(/plugin-auditor.*audit-feedback-loop/);
    expect(systemPluginSkillPaths(plugins, snapshot, "engineer")).toEqual([]);
    expect((await systemPluginInstructions(plugins, snapshot, "principal")).join("\n"))
      .toContain("Auditor feedback loop");
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
});
