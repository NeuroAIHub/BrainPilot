import { describe, it, expect } from "vitest";
import {
  PERSONAS,
  BUILTIN_PERSONA_NAMES,
  personaFor,
  sharedRootDirective,
  withoutLegacyAuditorInstructions,
  withCoreCoordinationProtocols,
  withSharedRootDirective,
} from "../personas.js";

describe("personas", () => {
  const EXPECTED = [
    "principal",
    "librarian",
    "experimentalist",
    "engineer",
    "writer",
    "auditor",
    "trace",
  ];

  it("ships a curated persona for every built-in agent", () => {
    for (const name of EXPECTED) {
      expect(BUILTIN_PERSONA_NAMES).toContain(name);
      const p = PERSONAS[name];
      expect(p, name).toBeTruthy();
      // Not the old one-line placeholder.
      expect(p.length, name).toBeGreaterThan(200);
    }
  });

  it("uses BARE tool names — never the legacy mcp__builtin__ prefix", () => {
    for (const [name, p] of Object.entries(PERSONAS)) {
      expect(p, name).not.toContain("mcp__builtin__");
    }
  });

  it("does not reference legacy Docker mount paths", () => {
    for (const [name, p] of Object.entries(PERSONAS)) {
      expect(p, name).not.toContain("/workspace");
      expect(p, name).not.toContain("/root/.claude");
      expect(p, name).not.toContain("/shared");
    }
  });

  it("principal persona is delegation-oriented and names the experts", () => {
    const p = PERSONAS.principal!;
    expect(p).toContain("dispatch_task");
    expect(p).toContain("complete_task");
    expect(p).toContain("ask_user");
    expect(p).toContain("librarian");
    expect(p).toContain("engineer");
    expect(p).toContain("writer");
    expect(p).toContain("experimentalist");
    expect(p).toContain("Final reports");
    expect(p).not.toContain("## Communicating back to the Principal");
  });

  it("PI and methodology agents enforce skills-first preflight", () => {
    expect(PERSONAS.principal!).toContain("Skills-first preflight");
    expect(PERSONAS.principal!).toMatch(/Check\s+expert skill use/);
    expect(PERSONAS.experimentalist!).toContain("skills are not");
    expect(PERSONAS.experimentalist!).toContain("Find relevant skills first");
    expect(PERSONAS.writer!).toContain("Skills-first writing preflight");
    expect(PERSONAS.writer!).toContain("Select the most relevant skill by default");
    expect(PERSONAS.engineer!).toContain("Find relevant skills first");
    expect(personaFor("statistician", "expert")).toContain("Skills-first preflight");
  });

  it("non-trace personas advertise the router (skill_search) library path", () => {
    // Every non-trace persona must mention the router tool and its name, so the
    // model knows <available_skills> is NOT the full library.
    for (const name of [
      "principal",
      "librarian",
      "experimentalist",
      "engineer",
      "writer",
    ]) {
      const p = PERSONAS[name]!;
      expect(p, name).toContain("skill_search");
      expect(p, name).toContain("Router skill library");
    }
    // Generic fallback expert (no curated persona) inherits the router hint
    // through SKILLS_FIRST_EXPERT.
    expect(personaFor("statistician", "expert")).toContain("skill_search");
    // Trace agent is graph-only and must not be told about skill_search.
    expect(PERSONAS.trace!).not.toContain("skill_search");
  });

  it("teaches Trace research-unit granularity and direct dependency rules", () => {
    const trace = PERSONAS.trace!;
    expect(trace).toContain("curate-research-trace");
    expect(trace).toContain("setting, its result");
    expect(trace).toContain("Settings in one ablation are normally parallel");
    expect(trace).toContain("Episode membership");
    expect(trace).toContain("only direct parents");
  });

  it("expert personas carry the flat task completion contract", () => {
    for (const name of ["librarian", "engineer", "experimentalist", "writer"]) {
      expect(PERSONAS[name], name).toContain('complete_task(task_id="<exact assigned ID>"');
      expect(PERSONAS[name], name).toContain("one run may handle several task");
    }
  });

  it("injects the compact handoff protocol exactly once for working agents", () => {
    for (const name of [
      "principal",
      "librarian",
      "experimentalist",
      "engineer",
      "writer",
    ]) {
      expect(PERSONAS[name]!.match(/^## Handoffs$/gm), name).toHaveLength(1);
    }
    expect(PERSONAS.auditor!).not.toContain("## Handoffs");
    expect(PERSONAS.trace!).not.toContain("## Handoffs");
    expect(personaFor("statistician", "expert").match(/^## Handoffs$/gm)).toHaveLength(1);
  });

  it("keeps the delegation brief exclusive to the principal", () => {
    expect(PERSONAS.principal!.match(/^## Delegation$/gm)).toHaveLength(1);
    for (const name of ["librarian", "experimentalist", "engineer", "writer", "auditor", "trace"]) {
      expect(PERSONAS[name]!, name).not.toMatch(/^## Delegation$/m);
    }
  });

  it("upgrades legacy expert overrides to the flat task contract", () => {
    const legacy = `# Custom expert

## Communicating back to the Principal

Always send_message(to="principal").

## Local rules

Keep this section.`;
    const resolved = withCoreCoordinationProtocols(legacy, "custom", "expert");
    expect(resolved).not.toContain("Communicating back to the Principal");
    expect(resolved).not.toContain('send_message(to="principal")');
    expect(resolved.match(/^## Communicating with other agents$/gm)).toHaveLength(1);
    expect(resolved).toContain('complete_task(task_id="<exact assigned ID>"');
    expect(resolved).toContain("## Local rules");
  });

  it("injects expert communication into minimal custom overrides exactly once", () => {
    const once = withCoreCoordinationProtocols("# Minimal expert", "custom", "expert");
    const twice = withCoreCoordinationProtocols(once, "custom", "expert");
    expect(twice.match(/^## Communicating with other agents$/gm)).toHaveLength(1);
    expect(twice.match(/^## Handoffs$/gm)).toHaveLength(1);
  });

  it("refreshes a stale current communication section", () => {
    const stale = `# Custom expert

## Communicating with other agents

Stale local routing rule.`;
    const resolved = withCoreCoordinationProtocols(stale, "custom", "expert");
    expect(resolved).not.toContain("Stale local routing rule");
    expect(resolved).toContain("<task_list>");
  });

  it("keeps Auditor behavior out of core personas", () => {
    expect(PERSONAS.principal).not.toMatch(/auditor|audit-feedback-loop/i);
    expect(PERSONAS.trace).not.toMatch(/auditor|audit-feedback-loop/i);
    expect(PERSONAS.librarian).not.toMatch(/auditor|audit-feedback-loop/i);
    expect(PERSONAS.engineer).not.toMatch(/auditor|audit-feedback-loop/i);
  });

  it("principal and writer personas keep internal status out of user-facing prose", () => {
    const pi = PERSONAS.principal!;
    const writer = PERSONAS.writer!;
    expect(pi).toContain("User-facing communication style");
    expect(pi).toContain("internal task-queue state");
    expect(pi).toContain("agent-status blocks");
    expect(pi).toContain("Never claim");
    expect(pi).toContain("offered options");
    expect(writer).toContain("Academic report narrative");
    expect(writer).toContain("Purpose");
    expect(writer).toContain("Translate them into a clean narrative");
  });

  it("writer persona encourages evidence-grounded visual presentation", () => {
    const writer = PERSONAS.writer!;
    expect(writer).toContain("Visualization-first presentation");
    expect(writer).toContain("For every report-like deliverable");
    expect(writer).toContain("statistical charts");
    expect(writer).toContain("Do not invent numbers");
    expect(writer).toContain("ask the engineer");
  });

  it("keeps only a neutral system-plugin base persona for Auditor", () => {
    const a = PERSONAS.auditor!;
    expect(a).toContain("System plugin agent");
    expect(a).toContain('complete_task(task_id="<exact assigned ID>"');
    expect(a).not.toMatch(/reliability|audit-feedback-loop|edit_trace_review/i);
  });

  it("neutralizes legacy Trace Auditor wording without removing other guidance", () => {
    const legacy = `Keep this custom guidance. Auditor review is independent.\n\n` +
      "You only propose candidates; Auditor confirms or rejects them. Never recreate a rejected candidate without materially new evidence.";
    const migrated = withoutLegacyAuditorInstructions(legacy);
    expect(migrated).toContain("Keep this custom guidance.");
    expect(migrated).not.toContain("Auditor review is independent");
    expect(migrated).toContain("records structurally valid causal parents directly");
  });

  it("requires PI to delegate complete research execution while retaining coordination tools", () => {
    const pi = PERSONAS.principal!;
    expect(pi).toContain("Mandatory workflow for complete research tasks");
    expect(pi).toContain("MUST coordinate Experts and MUST");
    expect(pi).toContain("NOT perform the scientific execution yourself");
    expect(pi).toContain("engineer` inspects the real data structure");
    expect(pi).toContain("librarian` surveys credible alternatives");
    expect(pi).toContain("experimentalist` reads the contract");
    expect(pi).toContain("Delegated task results are");
    expect(pi).toContain("Do not use `sleep`, polling loops");
    expect(pi).toContain("never for Agent coordination");
    expect(pi).toContain("Do not write analysis");
    expect(pi).toContain("The training prohibition is absolute");
    expect(pi).toContain("smoke-test training");
    expect(pi).toContain("Delegate every such run to `engineer`");
    expect(pi).toContain("you must not");
    expect(pi).toContain("execute the training command yourself");
  });

  it("requires data contracts, protocols, and independent method rechecks", () => {
    expect(PERSONAS.engineer).toContain("Research execution gate");
    expect(PERSONAS.engineer).toContain("start full training, model search");
    expect(PERSONAS.engineer).toContain("exported predictions match");
    expect(PERSONAS.experimentalist).toContain("Complete-task protocol and independent recheck");
    expect(PERSONAS.experimentalist).toContain("source tensor axes");
  });

  it("uses broad, staged, decision-relevant method comparison", () => {
    const pi = PERSONAS.principal!;
    const librarian = PERSONAS.librarian!;
    const experimentalist = PERSONAS.experimentalist!;
    const engineer = PERSONAS.engineer!;

    expect(pi).toContain("minimum valid deliverable");
    expect(pi).toContain("protocol proportional to those needs");
    expect(pi).toContain("broad, low-cost, decision-relevant comparison");
    expect(librarian).toContain("Method landscape");
    expect(librarian).toContain("substantively different families");
    expect(experimentalist).toContain("smallest procedure that answers the");
    expect(experimentalist).toContain("Do not default to exhaustive nested");
    expect(experimentalist).toContain("broad set of credible alternatives");
    expect(experimentalist).toContain("selection evidence represents the intended use");
    expect(experimentalist).toContain("not as a reason to enlarge the");
    expect(engineer).toContain("bounded operational check");
    expect(engineer).toContain("decision-relevant evaluation");
    expect(engineer).toContain("optional depth before removing a comparison");
    expect(engineer).toMatch(/infer superiority from an\s+incomplete comparison/);
  });

  it("requires result-driven real-data iteration before empirical completion", () => {
    const pi = PERSONAS.principal!;
    const experimentalist = PERSONAS.experimentalist!;
    const engineer = PERSONAS.engineer!;

    expect(pi).toContain("Empirical completion gate");
    expect(pi).toContain("complete iteration ledger");
    expect(pi).toContain("stop-no-meaningful-improvement");
    expect(pi).toContain("not an executable stopping rule");

    expect(experimentalist).toContain("Empirical iteration contract");
    expect(experimentalist).toContain("minimum meaningful improvement");
    expect(experimentalist).toContain("Issue exactly one");
    expect(experimentalist).toContain("Loss decrease, finite");

    expect(engineer).toContain("Representative real-data execution");
    expect(engineer).toContain("Empirical result bundle");
    expect(engineer).toContain("screening run cannot serve as the");
    expect(engineer).toContain("do not hand off the model as scientifically complete");
  });

  it("requires Engineer to pass a miniature end-to-end gate before every full run", () => {
    const engineer = personaFor("engineer", "expert").replace(/\s+/g, " ");

    expect(engineer).toContain("Before every full-data, full-fold, full-seed, full-budget");
    expect(engineer).toContain("same production entry point");
    expect(engineer).toContain("data loading, preprocessing, fitting or training, evaluation, aggregation, serialization");
    expect(engineer).toContain("after every material change to code, configuration, dependencies, or the execution environment");
    expect(engineer).toContain("must not launch the full run");
    expect(engineer).toContain("does not establish scientific validity");
  });

  it("requires Experimentalist to design and approve the miniature end-to-end gate", () => {
    const experimentalist = personaFor("experimentalist", "expert").replace(/\s+/g, " ");

    expect(experimentalist).toContain("Miniature end-to-end preflight design");
    expect(experimentalist).toContain("same production entry point and all applicable workflow stages");
    expect(experimentalist).toContain("sampling, grouping, folds, seeds, reduced budgets");
    expect(experimentalist).toContain("expected artifacts and explicit acceptance criteria");
    expect(experimentalist).toContain("Engineer provides passing preflight evidence");
    expect(experimentalist).toContain("after a material code, configuration, dependency, or environment change");
    expect(experimentalist).toContain("not scientific outcome evidence");
  });

  it("injects the end-to-end gates into existing role prompt overrides exactly once", () => {
    const engineerOnce = withCoreCoordinationProtocols("# Old Engineer", "engineer", "expert");
    const engineerTwice = withCoreCoordinationProtocols(engineerOnce, "engineer", "expert");
    const experimentalistOnce = withCoreCoordinationProtocols("# Old Experimentalist", "experimentalist", "expert");
    const experimentalistTwice = withCoreCoordinationProtocols(experimentalistOnce, "experimentalist", "expert");

    expect(engineerTwice.match(/^## Miniature end-to-end execution gate$/gm)).toHaveLength(1);
    expect(engineerTwice).toContain("same production entry point");
    expect(experimentalistTwice.match(/^## Miniature end-to-end preflight design$/gm)).toHaveLength(1);
    expect(experimentalistTwice.replace(/\s+/g, " ")).toContain("Engineer provides passing preflight evidence");
  });

  it("requires Engineer to inspect the environment and use working accelerators", () => {
    const engineer = PERSONAS.engineer!;
    expect(engineer).toContain("Environment and accelerator preflight");
    expect(engineer).toContain("CPU and available memory");
    expect(engineer).toContain("available VRAM");
    expect(engineer).toContain("prefer GPU or another suitable accelerator");
    expect(engineer).toContain("verify it with a small representative");
    expect(engineer).toContain("smoke test before a long run");
    expect(engineer).toContain("safe CPU fallback");
    expect(engineer).toContain("normal user-authorization gate");
  });

  it("injects the Engineer environment preflight into old overrides exactly once", () => {
    const legacy = "# Custom Engineer\n\nLocal instructions.";
    const once = withCoreCoordinationProtocols(legacy, "engineer", "expert");
    const twice = withCoreCoordinationProtocols(once, "engineer", "expert");
    expect(twice.match(/^## Environment and accelerator preflight$/gm)).toHaveLength(1);
    expect(twice).toContain("prefer GPU or another suitable accelerator");
  });

  it("authoring experts mention their write/run capability", () => {
    expect(PERSONAS.engineer!).toContain("bash");
    expect(PERSONAS.writer!).toContain("write");
  });

  it("personaFor falls back to a generic expert persona for unknown agents", () => {
    const p = personaFor("statistician", "expert");
    expect(p).toContain("statistician");
    expect(p).toContain('complete_task(task_id="<exact assigned ID>"');
    expect(p).not.toContain("mcp__builtin__");
  });

  it("personaFor returns the curated persona when one exists", () => {
    expect(personaFor("engineer", "expert")).toBe(PERSONAS.engineer);
  });
});

describe("sharedRootDirective (#261)", () => {
  it("interpolates the absolute path and states the read-only constraint", () => {
    const d = sharedRootDirective("/srv/shared");
    expect(d).toContain("/srv/shared");
    expect(d).toContain("READ-ONLY");
    // It must NOT invite writes — the whole point is a read-only cross-user root.
    expect(d.toLowerCase()).toMatch(/cannot write|read-only/);
  });

  it("withSharedRootDirective appends the directive to a persona", () => {
    const base = personaFor("engineer", "expert");
    const out = withSharedRootDirective(base, "/srv/shared");
    expect(out.startsWith(base)).toBe(true);
    expect(out).toContain("/srv/shared");
  });
});
