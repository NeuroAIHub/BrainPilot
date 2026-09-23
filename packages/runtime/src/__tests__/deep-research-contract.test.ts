import { describe, expect, it } from "vitest";
import { compileWorkflowValidator, parseWorkflowDefinition, WorkflowValidationError } from "@brainpilot/plugin-sdk/workflow";
import definition from "../workflows/deep-research.definition.json" with { type: "json" };
import {
  DEEP_RESEARCH_BUDGET_DEFAULTS, isCalendarDate, parseDeepResearchInput,
  researchEvidenceSchema, researchFollowupSchema, researchPlanSchema,
  researchSynthesisSchema, researchVerificationSchema,
} from "../workflows/deep-research-contract.js";

/** The smallest run input the TypeScript contract accepts; every other field is optional. */
const minimalInput = () => ({ question: "Does sleep restriction impair working memory?", scope: "Randomized trials in healthy adults since 2015.", cutoffDate: "2025-01-31" });
const input = (overrides: Record<string, unknown>) => ({ ...minimalInput(), ...overrides });
const accepts = (validate: (value: unknown) => void, value: unknown) => expect(() => validate(value)).not.toThrow();
const rejects = (validate: (value: unknown) => void, value: unknown) => expect(() => validate(value)).toThrow(WorkflowValidationError);
const repeat = (length: number) => "q".repeat(length);

const validatePlan = compileWorkflowValidator(researchPlanSchema, "research plan");
const validateEvidence = compileWorkflowValidator(researchEvidenceSchema, "research evidence");
const validateFollowups = compileWorkflowValidator(researchFollowupSchema, "research followups");
const validateSynthesis = compileWorkflowValidator(researchSynthesisSchema, "research synthesis");
const validateVerification = compileWorkflowValidator(researchVerificationSchema, "research verification");

const branch = (overrides: Record<string, unknown> = {}) => ({
  question: "How large is the effect on n-back accuracy?", query: "sleep restriction n-back accuracy randomized trial",
  requiredFacets: ["effect size", "population"], ...overrides,
});
const claim = (overrides: Record<string, unknown> = {}) => ({
  text: "One night of 4h sleep reduced n-back accuracy by 8 percentage points.",
  facetIds: ["f1"], supports: [{ sourceId: "s1", quote: "accuracy fell by 8 percentage points" }],
  limitations: ["single night, young adults only"], ...overrides,
});
const followup = (overrides: Record<string, unknown> = {}) => ({
  parentId: "b1", facetIds: ["f2"], gapIds: ["g1"],
  query: "chronic partial sleep restriction working memory older adults", reason: "No source covered adults over 60.", ...overrides,
});
const paragraph = (overrides: Record<string, unknown> = {}) => ({
  heading: "Effects on working memory", text: "Across four trials accuracy declined after restriction.",
  claimIds: ["c1", "c2"], ...overrides,
});
const verification = (overrides: Record<string, unknown> = {}) => ({
  paragraphs: [{ paragraphId: "p1", verdict: "supported", reason: "Every sentence maps to a recorded quote." }],
  facetCoverage: [{ facetId: "f1", status: "covered", reason: "Three trials report the effect size." }],
  issues: [], ...overrides,
});

describe("isCalendarDate", () => {
  it("accepts real leap days and rejects the years that only look like leap years", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2000-02-29")).toBe(true);
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(isCalendarDate("1900-02-29")).toBe(false);
    expect(isCalendarDate("2025-02-28")).toBe(true);
  });

  it("rejects days that no month has, including the ones Date.parse would roll forward", () => {
    for (const value of ["2025-04-31", "2025-02-30", "2025-06-31", "2025-09-31", "2025-11-31", "2025-01-32", "2025-00-10", "2025-13-01", "2025-01-00"]) {
      expect(isCalendarDate(value)).toBe(false);
    }
    expect(isCalendarDate("2025-01-31")).toBe(true);
    expect(isCalendarDate("2025-04-30")).toBe(true);
  });

  it("rejects year 0000 while keeping the rest of the Gregorian range", () => {
    expect(isCalendarDate("0000-01-01")).toBe(false);
    expect(isCalendarDate("0000-12-31")).toBe(false);
    expect(isCalendarDate("0001-01-01")).toBe(true);
    expect(isCalendarDate("9999-12-31")).toBe(true);
  });

  it("rejects malformed text that a permissive parser would still read as a date", () => {
    for (const value of ["", "2025-1-31", "2025/01/31", "31-01-2025", "2025-01-31T00:00:00Z", "2025-01-31 ", " 2025-01-31", "20250131", "2025-01-31extra", "tomorrow", "+2025-01-31", "2025-01-3１"]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});

describe("parseDeepResearchInput", () => {
  it("preserves the cutoff exactly and fills the remaining fields with defaults", () => {
    const parsed = parseDeepResearchInput(minimalInput());
    expect(parsed.cutoffDate).toBe("2025-01-31");
    expect(parsed.exclusions).toBe("");
    expect(parsed.language).toBe("en");
    expect(parsed.inputPaths).toEqual([]);
    expect(parsed.budget).toEqual(DEEP_RESEARCH_BUDGET_DEFAULTS);
    expect(parseDeepResearchInput(input({ cutoffDate: "2024-02-29" })).cutoffDate).toBe("2024-02-29");
  });

  it("keeps explicit zero allowances instead of treating them as missing", () => {
    const parsed = parseDeepResearchInput(input({ budget: { maxFollowups: 0, maxResearchCalls: 0, maxExtractUrls: 0 } }));
    expect(parsed.budget).toEqual({
      ...DEEP_RESEARCH_BUDGET_DEFAULTS, maxFollowups: 0, maxResearchCalls: 0, maxExtractUrls: 0,
    });
  });

  it("returns a budget the caller can mutate without changing the shared defaults", () => {
    expect(Object.isFrozen(DEEP_RESEARCH_BUDGET_DEFAULTS)).toBe(true);
    const parsed = parseDeepResearchInput(minimalInput());
    expect(parsed.budget).not.toBe(DEEP_RESEARCH_BUDGET_DEFAULTS);
    parsed.budget.maxBranches = 1;
    expect(DEEP_RESEARCH_BUDGET_DEFAULTS.maxBranches).toBe(3);
    expect(parseDeepResearchInput(minimalInput()).budget.maxBranches).toBe(3);
  });

  it("never coerces strings into numbers, enums or arrays", () => {
    expect(() => parseDeepResearchInput(input({ budget: { maxBranches: "2" } }))).toThrow();
    expect(() => parseDeepResearchInput(input({ budget: { maxBranches: 2.5 } }))).toThrow();
    expect(() => parseDeepResearchInput(input({ inputPaths: "notes.md" }))).toThrow();
    expect(() => parseDeepResearchInput(input({ language: "fr" }))).toThrow();
  });

  it("rejects unknown fields at the top level and inside budget", () => {
    expect(() => parseDeepResearchInput(input({ model: "claude-opus-5" }))).toThrow();
    expect(() => parseDeepResearchInput(input({ budget: { maxTokens: 1000 } }))).toThrow();
    expect(() => parseDeepResearchInput(input({ budget: { maxBranches: 2, maxTokens: 1000 } }))).toThrow();
  });

  it("rejects duplicate input paths and accepts distinct ones", () => {
    expect(() => parseDeepResearchInput(input({ inputPaths: ["notes.md", "notes.md"] }))).toThrow();
    expect(parseDeepResearchInput(input({ inputPaths: ["notes.md", "prior.md"] })).inputPaths).toEqual(["notes.md", "prior.md"]);
  });

  it("rejects blank or whitespace-only text where a real question or scope is required", () => {
    expect(() => parseDeepResearchInput(input({ question: "" }))).toThrow();
    expect(() => parseDeepResearchInput(input({ question: "   " }))).toThrow();
    expect(() => parseDeepResearchInput(input({ scope: "\n\t " }))).toThrow();
    expect(() => parseDeepResearchInput(input({ exclusions: " " }))).toThrow();
    expect(() => parseDeepResearchInput(input({ inputPaths: [" "] }))).toThrow();
  });

  it("enforces the budget bounds at their exact edges", () => {
    const at = (budget: Record<string, number>) => parseDeepResearchInput(input({ budget })).budget;
    expect(at({ maxBranches: 3, maxDurationMs: 60_000 })).toMatchObject({ maxBranches: 3, maxDurationMs: 60_000 });
    expect(at({ maxDurationMs: 14_400_000 })).toMatchObject({ maxDurationMs: 14_400_000 });
    expect(() => parseDeepResearchInput(input({ budget: { maxBranches: 4 } }))).toThrow();
    expect(() => parseDeepResearchInput(input({ budget: { maxBranches: 0 } }))).toThrow();
    expect(() => parseDeepResearchInput(input({ budget: { maxDurationMs: 59_999 } }))).toThrow();
    expect(() => parseDeepResearchInput(input({ budget: { maxDurationMs: 14_400_001 } }))).toThrow();
  });
});

describe("optional provided-source selection", () => {
  /** The schema as written, not a re-declaration: the items subschema is read off the compiled contract. */
  const branchItems = (schema: unknown): Record<string, any> =>
    (schema as any).properties.branches.items;
  const followupItems = (schema: unknown): Record<string, any> =>
    (schema as any).properties.followups.items;

  it("leaves sourceIds out of the required list while keeping every other property required", () => {
    for (const [items, required] of [
      [branchItems(researchPlanSchema), ["question", "query", "requiredFacets"]],
      [followupItems(researchFollowupSchema), ["parentId", "facetIds", "gapIds", "query", "reason"]],
    ] as const) {
      expect(items.required).toEqual(required);
      expect(items.required).not.toContain("sourceIds");
      expect(Object.keys(items.properties)).toContain("sourceIds");
    }
    // Bounds mirror the input contract: at most the 8 files a run may be given.
    expect(branchItems(researchPlanSchema).properties.sourceIds).toMatchObject({ minItems: 0, maxItems: 8, uniqueItems: true });
    expect(followupItems(researchFollowupSchema).properties.sourceIds).toMatchObject({ minItems: 0, maxItems: 8, uniqueItems: true });
  });

  it("still accepts stage outputs written before the field existed", () => {
    accepts(validatePlan, { branches: [branch()] });
    accepts(validateFollowups, { followups: [followup()] });
    expect(branch()).not.toHaveProperty("sourceIds");
  });

  it("accepts an empty or populated selection, including one branch with and one without", () => {
    accepts(validatePlan, { branches: [branch({ sourceIds: [] })] });
    accepts(validatePlan, { branches: [branch({ sourceIds: ["s1"] }), branch({ sourceIds: ["s2", "s3"] })] });
    accepts(validateFollowups, { followups: [followup({ sourceIds: [] })] });
    accepts(validateFollowups, { followups: [followup({ sourceIds: ["s1", "s2"] })] });
  });

  it("bounds the selection at eight identifiers", () => {
    const eight = Array.from({ length: 8 }, (_, index) => `s${index + 1}`);
    accepts(validatePlan, { branches: [branch({ sourceIds: eight })] });
    accepts(validateFollowups, { followups: [followup({ sourceIds: eight })] });
    rejects(validatePlan, { branches: [branch({ sourceIds: [...eight, "s9"] })] });
    rejects(validateFollowups, { followups: [followup({ sourceIds: [...eight, "s9"] })] });
  });

  it("rejects duplicate, blank and non-string selections", () => {
    rejects(validatePlan, { branches: [branch({ sourceIds: ["s1", "s1"] })] });
    rejects(validatePlan, { branches: [branch({ sourceIds: [""] })] });
    rejects(validatePlan, { branches: [branch({ sourceIds: ["   "] })] });
    rejects(validatePlan, { branches: [branch({ sourceIds: ["s1", null] })] });
    rejects(validatePlan, { branches: [branch({ sourceIds: "s1" })] });
    rejects(validatePlan, { branches: [branch({ sourceIds: [repeat(201)] })] });
    rejects(validateFollowups, { followups: [followup({ sourceIds: ["s1", "s1"] })] });
    rejects(validateFollowups, { followups: [followup({ sourceIds: ["\t"] })] });
    rejects(validateFollowups, { followups: [followup({ sourceIds: [1] })] });
  });

  it("treats an arbitrary unknown identifier as structurally valid and leaves membership to the host", () => {
    // Naming a source that does not exist is a ledger concern: the schema cannot see the catalogue,
    // so it must not pretend this identifier is real, and the host must not read it as proof.
    accepts(validatePlan, { branches: [branch({ sourceIds: ["not-a-real-source"] })] });
    accepts(validateFollowups, { followups: [followup({ sourceIds: ["not-a-real-source"] })] });
  });
});

describe("stage schemas", () => {
  it("compiles every stage schema and accepts one representative stage output each", () => {
    accepts(validatePlan, { branches: [branch()] });
    accepts(validateEvidence, { claims: [claim()], gaps: ["No trial reported retention beyond one week."], contradictions: [] });
    accepts(validateFollowups, { followups: [followup()] });
    accepts(validateSynthesis, { title: "Sleep restriction and working memory", paragraphs: [paragraph()] });
    accepts(validateVerification, verification());
  });

  it("bounds the plan to between one and three branches", () => {
    rejects(validatePlan, { branches: [] });
    rejects(validatePlan, { branches: [branch(), branch(), branch(), branch()] });
    accepts(validatePlan, { branches: [branch(), branch(), branch()] });
  });

  it("rejects unknown properties anywhere in a stage output", () => {
    rejects(validatePlan, { branches: [branch()], notes: "extra" });
    rejects(validatePlan, { branches: [branch({ branchId: "b1" })] });
    rejects(validateEvidence, { claims: [claim({ confidence: 0.9 })], gaps: [], contradictions: [] });
    rejects(validateSynthesis, { title: "T", paragraphs: [paragraph()], references: [] });
  });

  it("rejects whitespace-only strings that satisfy minLength alone", () => {
    rejects(validatePlan, { branches: [branch({ query: "   " })] });
    rejects(validatePlan, { branches: [branch({ requiredFacets: ["effect size", " "] })] });
    rejects(validateEvidence, { claims: [claim({ supports: [{ sourceId: "s1", quote: "\t\n" }] })], gaps: [], contradictions: [] });
    rejects(validateFollowups, { followups: [followup({ query: " " })] });
    rejects(validateSynthesis, { title: " ", paragraphs: [paragraph()] });
  });

  it("caps research queries at the 1000 characters the research adapter accepts", () => {
    accepts(validatePlan, { branches: [branch({ query: repeat(1000) })] });
    rejects(validatePlan, { branches: [branch({ query: repeat(1001) })] });
    accepts(validateFollowups, { followups: [followup({ query: repeat(1000) })] });
    rejects(validateFollowups, { followups: [followup({ query: repeat(1001) })] });
    // Branch questions and follow-up reasons are prose for the host, not adapter queries.
    accepts(validatePlan, { branches: [branch({ question: repeat(2000) })] });
    rejects(validatePlan, { branches: [branch({ question: repeat(2001) })] });
  });

  it("rejects duplicate identifiers in the host-assigned id lists", () => {
    rejects(validateEvidence, { claims: [claim({ facetIds: ["f1", "f1"] })], gaps: [], contradictions: [] });
    rejects(validateFollowups, { followups: [followup({ facetIds: ["f2", "f2"] })] });
    rejects(validateFollowups, { followups: [followup({ gapIds: ["g1", "g1"] })] });
    rejects(validateSynthesis, { title: "T", paragraphs: [paragraph({ claimIds: ["c1", "c1"] })] });
    accepts(validateSynthesis, { title: "T", paragraphs: [paragraph({ claimIds: ["c1", "c2"] })] });
  });

  it("rejects verdict and coverage values outside the closed enums", () => {
    rejects(validateVerification, verification({ paragraphs: [{ paragraphId: "p1", verdict: "partially-supported", reason: "Mixed." }] }));
    rejects(validateVerification, verification({ facetCoverage: [{ facetId: "f1", status: "partial", reason: "Mixed." }] }));
    rejects(validateVerification, verification({ paragraphs: [{ paragraphId: "p1", verdict: "supported" }] }));
  });

  it("accepts honest empty findings, which the orchestrator vets separately", () => {
    // Schema validity never proves acceptance: the host still checks membership and coverage.
    accepts(validateEvidence, { claims: [], gaps: ["The library returned no trial in this population."], contradictions: [] });
    accepts(validateFollowups, { followups: [] });
    accepts(validateSynthesis, { title: "Scope and method", paragraphs: [paragraph({ heading: "Method", text: "We searched the library and the web up to the cutoff.", claimIds: [] })] });
    accepts(validateVerification, {
      paragraphs: [{ paragraphId: "p1", verdict: "unverified", reason: "No recorded quote covers the second sentence." }],
      facetCoverage: [{ facetId: "f1", status: "gap", reason: "No source addressed older adults." }],
      issues: ["One paragraph remains unverified."],
    });
  });

  it("requires at least one support per claim and at least one paragraph per report", () => {
    rejects(validateEvidence, { claims: [claim({ supports: [] })], gaps: [], contradictions: [] });
    rejects(validateEvidence, { claims: [claim({ facetIds: [] })], gaps: [], contradictions: [] });
    rejects(validateSynthesis, { title: "T", paragraphs: [] });
    rejects(validateVerification, verification({ paragraphs: [] }));
    rejects(validateVerification, verification({ facetCoverage: [] }));
  });
});

describe("definition JSON versus the TypeScript parser", () => {
  const parsed = parseWorkflowDefinition(definition);
  const validateDefinitionInput = compileWorkflowValidator(parsed.inputSchema, "deep research input");

  it("is a valid workflow definition that does not resume", () => {
    expect(parsed.id).toBe("deep-research");
    expect(parsed.version).toBe("0.1.0");
    expect(parsed.resume).toBe(false);
  });

  it("agrees with the parser on the shared limit cases", () => {
    for (const value of [minimalInput(), input({ question: repeat(4000) }), input({ inputPaths: ["a.md", "b.md"], budget: { maxFollowups: 0 } })]) {
      accepts(validateDefinitionInput, value);
      expect(() => parseDeepResearchInput(value)).not.toThrow();
    }
    for (const value of [input({ question: repeat(4001) }), input({ question: "" }), input({ budget: { maxBranches: "2" } }),
      input({ inputPaths: ["notes.md", "notes.md"] }), input({ model: "claude-opus-5" }), input({ cutoffDate: "2025-1-31" }),
      { scope: "Only a scope.", cutoffDate: "2025-01-31" }]) {
      rejects(validateDefinitionInput, value);
      expect(() => parseDeepResearchInput(value)).toThrow();
    }
  });

  it("is intentionally stronger in TypeScript for real calendar days and non-blank text", () => {
    // The JSON pattern only checks the shape; calendar validity and blankness are enforced in code.
    for (const cutoffDate of ["2025-02-30", "2025-04-31", "2025-02-29", "1900-02-29", "0000-01-01"]) {
      accepts(validateDefinitionInput, input({ cutoffDate }));
      expect(() => parseDeepResearchInput(input({ cutoffDate }))).toThrow();
    }
    accepts(validateDefinitionInput, input({ question: "   " }));
    expect(() => parseDeepResearchInput(input({ question: "   " }))).toThrow();
  });
});
