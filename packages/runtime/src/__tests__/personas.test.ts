import { describe, it, expect } from "vitest";
import {
  PERSONAS,
  BUILTIN_PERSONA_NAMES,
  personaFor,
  sharedRootDirective,
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
    expect(p).toContain("send_message");
    expect(p).toContain("ask_user");
    expect(p).toContain("librarian");
    expect(p).toContain("engineer");
    expect(p).toContain("writer");
    expect(p).toContain("experimentalist");
    expect(p).toContain("Final reports");
  });

  it("PI and methodology agents enforce skills-first preflight", () => {
    expect(PERSONAS.principal!).toContain("Skills-first preflight");
    expect(PERSONAS.principal!).toContain("Check expert skill use");
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
      "auditor",
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

  it("expert personas carry the send_message-back contract", () => {
    for (const name of ["librarian", "engineer", "experimentalist", "writer", "auditor"]) {
      expect(PERSONAS[name], name).toContain('send_message(to="principal"');
    }
  });

  it("principal persona requires a pre-delivery audit for hard claims", () => {
    const p = PERSONAS.principal!;
    expect(p).toContain("Pre-delivery audit");
    expect(p).toContain("MUST");
    expect(p).toContain("auditor");
    expect(p).toContain("expert deliverable");
    expect(p).toContain("original user need");
    expect(p).toContain("Do NOT personally perform fabrication/reliability audit");
    // The exemption clause keeps the audit out of pure conversational turns.
    expect(p.toLowerCase()).toContain("exemption");
  });

  it("principal audit gate covers analysis/modelling validity risks", () => {
    const p = PERSONAS.principal!;
    expect(p.toLowerCase()).toContain("leakage");
    expect(p.toLowerCase()).toContain("cross-validation");
    expect(p).toContain("data-split");
  });

  it("principal and writer personas keep internal status out of user-facing prose", () => {
    const pi = PERSONAS.principal!;
    const writer = PERSONAS.writer!;
    expect(pi).toContain("User-facing communication style");
    expect(pi).toContain("unread-message counts");
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

  it("auditor persona constrains scope, bash, and followup count", () => {
    const a = PERSONAS.auditor!;
    // Three claim categories explicitly named
    expect(a.toLowerCase()).toContain("numeric");
    expect(a.toLowerCase()).toContain("file");
    expect(a.toLowerCase()).toContain("citation");
    // Bash is filesystem-inspection only
    expect(a).toContain("filesystem inspection");
    expect(a).toContain("grep");
    // Audit report path discipline
    expect(a).toContain(".audit/");
    expect(a).toContain("ISO8601");
    // Followup limit (2 different agents) — robust to whitespace/newline.
    expect(a.toLowerCase()).toMatch(/two different\s+agents/);
    // And the explicit "2 different agents" cap line.
    expect(a).toMatch(/2 different agents/);
    // Verdict vocabulary
    expect(a).toContain("confirmed");
    expect(a).toContain("unverified");
    expect(a).toContain("disputed");
    // The persona deliberately tells the auditor it CANNOT call
    // get_trace_graph (so the model doesn't try). Assert the explicit
    // "cannot call" disclaimer rather than that the name is absent.
    expect(a).toMatch(/cannot call\s+`?get_trace_graph`?/);
  });

  it("auditor persona audits scientific-reliability defects, open-ended", () => {
    const a = PERSONAS.auditor!;
    // Still an evidence/fabrication auditor …
    expect(a.toLowerCase()).toContain("fabrication");
    // … now also a bounded-but-open reliability reviewer.
    expect(a.toLowerCase()).toContain("reliability");
    expect(a.toLowerCase()).toContain("leakage");
    expect(a.toLowerCase()).toContain("baseline");
    expect(a.toLowerCase()).toContain("metric");
    // Reliability verdict vocabulary.
    expect(a).toContain("concern");
    expect(a).toContain("flaw");
    // Scope is explicitly non-exhaustive.
    expect(a.toLowerCase()).toMatch(/not exhaustive|including but not limited/);
  });

  it("authoring experts mention their write/run capability", () => {
    expect(PERSONAS.engineer!).toContain("bash");
    expect(PERSONAS.writer!).toContain("write");
  });

  it("personaFor falls back to a generic expert persona for unknown agents", () => {
    const p = personaFor("statistician", "expert");
    expect(p).toContain("statistician");
    expect(p).toContain('send_message(to="principal"');
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
