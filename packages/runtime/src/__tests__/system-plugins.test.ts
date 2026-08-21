import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDITOR_PLUGIN_ID,
  BACKGROUND_JOBS_PLUGIN_ID,
  GOT_PLUGIN_ID,
  MONITOR_PLUGIN_ID,
  RESEARCH_PLUGIN_ID,
  loadBundledSystemPlugins,
  snapshotSystemPlugins,
  systemPluginEnabled,
  systemPluginInstructions,
  systemPluginSkillPaths,
} from "../system-plugins.js";

describe("bundled system plugins", () => {
  it("loads all official workflow plugins by default from their npm packages", async () => {
    const plugins = loadBundledSystemPlugins({});
    const snapshot = snapshotSystemPlugins(plugins);
    expect(systemPluginEnabled(snapshot, AUDITOR_PLUGIN_ID)).toBe(true);
    expect(systemPluginEnabled(snapshot, GOT_PLUGIN_ID)).toBe(true);
    expect(systemPluginEnabled(snapshot, MONITOR_PLUGIN_ID)).toBe(true);
    expect(systemPluginEnabled(snapshot, BACKGROUND_JOBS_PLUGIN_ID)).toBe(true);
    expect(systemPluginEnabled(snapshot, RESEARCH_PLUGIN_ID)).toBe(true);
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
    const engineerSkills = systemPluginSkillPaths(plugins, snapshot, "engineer");
    expect(engineerSkills).toHaveLength(1);
    expect(engineerSkills[0]).toMatch(/plugin-research.*create-data-inventory/);
    const inventorySkill = (await readFile(join(engineerSkills[0]!, "SKILL.md"), "utf8")).replace(/\s+/g, " ");
    expect(inventorySkill).toContain("before creating or updating any data inventory");
    expect(inventorySkill).toContain("docs/specs/data-inventory.md");
    expect(inventorySkill).toContain("one canonical Markdown document");
    expect(inventorySkill).toContain("bounded, structure-aware summaries");
    expect(inventorySkill).toContain("localized concentration, extreme patterns");
    expect(inventorySkill).toContain("Report observed patterns without selecting a method");
    expect(inventorySkill).not.toContain("forbidden/private");
    const librarianSkills = systemPluginSkillPaths(plugins, snapshot, "librarian");
    expect(librarianSkills).toHaveLength(1);
    expect(librarianSkills[0]).toMatch(/plugin-research.*source-grounded-research-report/);
    const researchSkill = await readFile(join(librarianSkills[0]!, "SKILL.md"), "utf8");
    expect(researchSkill).toContain("claim to the source that owns or best synthesizes it");
    expect(researchSkill).toContain('workspaceMode: "shared"');
    expect(systemPluginSkillPaths(plugins, snapshot, "trace")[0])
      .toMatch(/plugin-got.*curate-research-trace/);
    const principalInstructions = (await systemPluginInstructions(plugins, snapshot, "principal")).join("\n");
    expect(principalInstructions).toContain("Auditor feedback loop");
    expect(principalInstructions).toContain("never immediately claim that the");
    expect(principalInstructions).toContain("task is complete");
    expect(principalInstructions).toContain("Only `Verdict: PASS`");
    expect(principalInstructions).toContain("iteration ledger including rejected rounds");
    expect(principalInstructions).toContain("evidence alone is not a complete audit target");
    expect(principalInstructions).toContain("one final audit");
    expect(principalInstructions).toContain("Do not dispatch Auditor for intermediate");
    expect(principalInstructions).toContain("Any change to an audited claim, evidence file, or artifact after PASS invalidates that PASS");
    expect(principalInstructions).toContain("latest corrected candidate comparison");
    expect(principalInstructions).toMatch(/Experimentalist\s+selection\s+decision/);
    expect(principalInstructions).not.toContain("Raw Expert output is a valid intermediate audit target");
    const auditorInstructions = (await systemPluginInstructions(plugins, snapshot, "auditor")).join("\n");
    expect(auditorInstructions).toContain("Begin every completed audit reply");
    expect(auditorInstructions).toContain("PI must not claim the task is complete");
    expect(auditorInstructions).toContain("audit the complete iteration history");
    expect(auditorInstructions).toContain("short real-data run");
    expect(auditorInstructions).toContain("bounded deterministic implementation checks");
    const auditorSkill = auditorSkills.find((path) => path.endsWith("audit-feedback-loop"))!;
    const auditorReview = await readFile(join(auditorSkill, "references", "auditor-review.md"), "utf8");
    expect(auditorReview).toContain("call `spawn_subagent` once with two to");
    expect(auditorReview).toContain("Children return evidence and candidate findings only");
    expect(auditorReview).toContain("shared session workspace by default");
    expect(auditorReview).toContain("representative set covering the main types and boundary cases");
    expect(auditorReview).toContain("each assigned path with `realpath`");
    expect(auditorReview).toContain("requests such as checking every number");
    expect(auditorReview).toContain("returns `blocked`");
    expect(auditorReview).toContain("`operational validity` and `empirical adequacy`");
    expect(auditorReview).toContain("Write the complete report to a new path under");
    expect(auditorReview).toContain("frozen final delivery candidate");
    expect(auditorReview).not.toContain("Raw Expert output is a valid intermediate");
    const piOrchestration = await readFile(join(auditorSkill, "references", "pi-orchestration.md"), "utf8");
    expect(piOrchestration).toContain("Start one final audit");
    expect(piOrchestration).toContain("Do not audit intermediate rounds");
    const methodSkill = auditorSkills.find((path) => path.endsWith("audit-model-validation"))!;
    const methodReview = (await readFile(join(methodSkill, "SKILL.md"), "utf8")).replace(/\s+/g, " ");
    expect(methodReview).toContain("Audit Method Validation");
    expect(methodReview).toContain("substantively different alternatives");
    expect(methodReview).toContain("operational correctness and feasibility");
    expect(methodReview).toContain("implementation convenience");
    expect(methodReview).toContain("Separate operational and empirical evidence");
    expect(methodReview).toContain("macro-F1 `2 / (K * (K + 1))`");
    expect(methodReview).toContain("does not validate cross-session transfer");
    expect(methodReview).toContain("sample counts across sampling");
    expect(methodReview).toContain("rates is not protocol fidelity");
    expect(methodReview).toContain("Audit decision provenance");
    expect(methodReview).toContain("independent prescribing constraint or current selection evidence");
    expect(methodReview).toContain("user, task, or external scientific requirement independently determines");
    expect(methodReview).toContain("Runtime-owned recent user messages are authoritative");
    expect(methodReview).toContain("Missing, invalid, or stale decision provenance requires `REVISE`");
    expect(methodReview).toContain("eligibility guards from ranking evidence");
    expect(methodReview).toContain("observable outcome that could change the decision");
    expect(methodReview).toContain("latest valid, comparable results");
    expect(methodReview).toContain("every correction affecting eligibility, ranking, or comparability");
    expect(methodReview).toContain("every material challenge and contradictory result propagated");
    expect(methodReview).toContain("current evidence has invalidated or left unresolved");
    expect(methodReview).toContain("Do not choose a replacement method");
    expect(methodReview).toContain("method-specific budgets or stopping rules");
    expect(methodReview).toContain("scientific principle, method family, and concrete implementation");
    expect(methodReview).toContain("implementation-specific limitation cannot exclude a method family");
    expect(methodReview).toContain("minimal, adapted, or alternative implementation");
    const requestTemplate = await readFile(join(auditorSkill, "references", "audit-request-template.md"), "utf8");
    expect(requestTemplate).toContain("Decision provenance");
    expect(requestTemplate).toContain("Material alternatives or unresolved challenges");
    expect(requestTemplate).not.toContain("Selection mode and rule");
    expect(requestTemplate).toContain("Latest corrected candidate comparison");
    expect(requestTemplate).toContain("Experimentalist selection decision");
    const responseTemplate = await readFile(join(auditorSkill, "references", "audit-response-template.md"), "utf8");
    expect(responseTemplate).toContain("## Compact completion reply");
    expect(responseTemplate).toContain("Report: docs/audits/<actual-report-file>.md");
    const revisionLoop = await readFile(join(auditorSkill, "references", "revision-loop.md"), "utf8");
    expect(revisionLoop).toContain("Previously confirmed checks remain valid");
    expect(revisionLoop).toContain("Do not repeat an expensive check merely to");
    expect(await systemPluginInstructions(plugins, snapshot, "trace")).toEqual([]);
  });

  it("requires Auditor to verify parameter provenance and the evidence-to-validation chronology", async () => {
    const plugins = loadBundledSystemPlugins({});
    const snapshot = snapshotSystemPlugins(plugins);
    const auditorSkills = systemPluginSkillPaths(plugins, snapshot, "auditor");
    const feedback = auditorSkills.find((path) => path.endsWith("audit-feedback-loop"))!;
    const evidence = auditorSkills.find((path) => path.endsWith("audit-evidence"))!;
    const code = auditorSkills.find((path) => path.endsWith("audit-code-artifact"))!;
    const validation = auditorSkills.find((path) => path.endsWith("audit-model-validation"))!;

    const auditorReview = (await readFile(join(feedback, "references", "auditor-review.md"), "utf8")).replace(/\s+/g, " ");
    expect(auditorReview).toContain("evidence → decision → code/config diff → representative real-data validation → report");
    expect(auditorReview).toContain("mark the chronology `unverified`");
    expect(auditorReview).toContain("out-of-order chain or validation of an older revision is a `flaw`");

    const evidenceSkill = (await readFile(join(evidence, "SKILL.md"), "utf8")).replace(/\s+/g, " ");
    expect(evidenceSkill).toContain("decision-relevant evidence existed before the decision");
    expect(evidenceSkill).toContain("post-hoc citation");

    const codeSkill = (await readFile(join(code, "SKILL.md"), "utf8")).replace(/\s+/g, " ");
    expect(codeSkill).toContain("machine-readable configuration separate from the main implementation logic");
    expect(codeSkill).toContain("Map each decision-relevant parameter");

    const validationSkill = (await readFile(join(validation, "SKILL.md"), "utf8")).replace(/\s+/g, " ");
    expect(validationSkill).toContain("same or later code and configuration revision");
    expect(validationSkill).toContain("For each material iteration");

    const request = (await readFile(join(feedback, "references", "audit-request-template.md"), "utf8")).replace(/\s+/g, " ");
    expect(request).toContain("Parameter configuration and provenance");
    expect(request).toContain("Implementation checkpoint or diff");
    expect(request).toContain("Validation run and code/config revision");
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
