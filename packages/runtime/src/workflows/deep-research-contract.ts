/*
 * Pure contract for the deep-research workflow: run input parsing plus the JSON schema
 * each model stage must satisfy. No orchestration, research adapter or ledger validation
 * lives here. The host assigns every identifier and enforces membership, duplicate and
 * coverage rules afterwards; schema validity alone never proves a stage acceptable.
 */
import { z } from "zod";
import type { WorkflowJsonSchema } from "@brainpilot/plugin-sdk/workflow";

export const DEEP_RESEARCH_LANGUAGES = ["en", "zh-CN"] as const;
export type DeepResearchLanguage = (typeof DEEP_RESEARCH_LANGUAGES)[number];

export interface DeepResearchBudget {
  maxBranches: number;
  maxFollowups: number;
  maxModelStages: number;
  maxResearchCalls: number;
  maxExtractUrls: number;
  maxDurationMs: number;
}
export interface DeepResearchInput {
  question: string;
  scope: string;
  exclusions: string;
  cutoffDate: string;
  language: DeepResearchLanguage;
  inputPaths: string[];
  budget: DeepResearchBudget;
}

/**
 * Orchestration limits only: research branches, model stages, research tool calls and wall
 * clock. This is not a token budget and not a cap on the HTTP requests a single research
 * tool makes internally.
 */
export const DEEP_RESEARCH_BUDGET_DEFAULTS: Readonly<DeepResearchBudget> = Object.freeze({
  maxBranches: 3, maxFollowups: 3, maxModelStages: 12,
  maxResearchCalls: 18, maxExtractUrls: 18, maxDurationMs: 2_700_000,
});

const CUTOFF_DATE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
/**
 * A real Gregorian calendar day written as YYYY-MM-DD. Date.parse is deliberately unused:
 * it rolls 2025-02-30 into March and accepts free-form text, both of which silently move
 * the evidence cutoff. Year 0000 is not a Gregorian year, so the range is 0001..9999.
 */
export function isCalendarDate(value: string): boolean {
  const match = CUTOFF_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1) return false;
  return day <= (month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1]!);
}

const nonblank = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0, "must not be blank");
const unique = (values: string[]) => new Set(values).size === values.length;
const integer = (min: number, max: number) => z.number().int().min(min).max(max);
/** Every bound mirrors deep-research.definition.json; strings are never coerced. */
const budgetInputSchema = z.object({
  maxBranches: integer(1, 3).optional(),
  maxFollowups: integer(0, 3).optional(),
  maxModelStages: integer(1, 16).optional(),
  maxResearchCalls: integer(0, 24).optional(),
  maxExtractUrls: integer(0, 24).optional(),
  maxDurationMs: integer(60_000, 14_400_000).optional(),
}).strict();
const deepResearchInputSchema = z.object({
  question: nonblank(4000),
  scope: nonblank(8000),
  exclusions: nonblank(4000).optional(),
  // Preserved exactly as supplied; the run excludes sources published after this day.
  cutoffDate: z.string().refine(isCalendarDate, "cutoffDate must be a real calendar date as YYYY-MM-DD"),
  language: z.enum(DEEP_RESEARCH_LANGUAGES).optional(),
  inputPaths: z.array(nonblank(2000)).max(8).refine(unique, "inputPaths must be unique").optional(),
  budget: budgetInputSchema.optional(),
}).strict();

function mergeBudget(budget: z.infer<typeof budgetInputSchema> | undefined): DeepResearchBudget {
  const defaults = DEEP_RESEARCH_BUDGET_DEFAULTS;
  return {
    maxBranches: budget?.maxBranches ?? defaults.maxBranches,
    maxFollowups: budget?.maxFollowups ?? defaults.maxFollowups,
    maxModelStages: budget?.maxModelStages ?? defaults.maxModelStages,
    maxResearchCalls: budget?.maxResearchCalls ?? defaults.maxResearchCalls,
    maxExtractUrls: budget?.maxExtractUrls ?? defaults.maxExtractUrls,
    maxDurationMs: budget?.maxDurationMs ?? defaults.maxDurationMs,
  };
}

export function parseDeepResearchInput(raw: unknown): DeepResearchInput {
  const input = deepResearchInputSchema.parse(raw);
  return {
    question: input.question, scope: input.scope,
    exclusions: input.exclusions ?? "",
    cutoffDate: input.cutoffDate,
    language: input.language ?? "en",
    inputPaths: input.inputPaths ?? [],
    budget: mergeBudget(input.budget),
  };
}

type JsonSchemaObject = Record<string, unknown>;
/**
 * Nonblank, length-bounded scalars shared by every stage schema. minLength alone would let a
 * model answer with spaces, so the pattern additionally demands one non-whitespace character.
 */
const text = (maxLength: number): JsonSchemaObject => ({ type: "string", minLength: 1, maxLength, pattern: "\\S" });
/** A host-assigned identifier the model echoes back; membership is checked outside the schema. */
const id = text(200);
const list = (items: JsonSchemaObject, minItems: number, maxItems: number, uniqueItems = false): JsonSchemaObject =>
  ({ type: "array", minItems, maxItems, ...(uniqueItems ? { uniqueItems: true } : {}), items });
const idList = (minItems: number, maxItems: number) => list(id, minItems, maxItems, true);
const textList = (minItems: number, maxItems: number, maxLength = 2000) => list(text(maxLength), minItems, maxItems);
/** Keys named here are declared in `properties` but left out of `required`; every other key stays required. */
const object = (properties: JsonSchemaObject, ...optional: string[]): JsonSchemaObject =>
  ({ type: "object", additionalProperties: false, required: Object.keys(properties).filter(key => !optional.includes(key)), properties });

/**
 * An optional selection of already-provided full texts the model wants read in its own stage,
 * picked from the host catalogue of this run's provided files before any body is passed along.
 * At most 8 unique nonblank host-assigned identifiers, and the field is deliberately not required:
 * omitting it and sending an empty list both mean no additional provided file was selected, never
 * "every provided file". Membership, existence and the actual reading stay host ledger checks, so
 * a structurally valid identifier here is not proof that such a source exists.
 */
const providedSourceIds = idList(0, 8);

export interface ResearchPlanBranch { question: string; query: string; requiredFacets: string[]; sourceIds?: string[] }
export interface ResearchPlanOutput { branches: ResearchPlanBranch[] }
/** Branch and facet identifiers are assigned by the host, never by the planning model. */
export const researchPlanSchema: WorkflowJsonSchema = object({
  branches: list(object({
    question: text(2000), query: text(1000), requiredFacets: textList(1, 8, 500), sourceIds: providedSourceIds,
  }, "sourceIds"), 1, 3),
});

export interface ResearchClaimSupport { sourceId: string; quote: string }
export interface ResearchClaim { text: string; facetIds: string[]; supports: ResearchClaimSupport[]; limitations: string[] }
export interface ResearchEvidenceOutput { claims: ResearchClaim[]; gaps: string[]; contradictions: string[] }
/**
 * Quotes must be exact source text. The host assigns claim identifiers and locates each
 * quote's offsets in the recorded source afterwards.
 */
export const researchEvidenceSchema: WorkflowJsonSchema = object({
  claims: list(object({
    text: text(2000), facetIds: idList(1, 8),
    supports: list(object({ sourceId: id, quote: text(1500) }), 1, 4),
    limitations: textList(0, 8),
  }), 0, 12),
  gaps: textList(0, 8), contradictions: textList(0, 8),
});

export interface ResearchFollowup { parentId: string; facetIds: string[]; gapIds: string[]; query: string; reason: string; sourceIds?: string[] }
export interface ResearchFollowupOutput { followups: ResearchFollowup[] }
/** The host supplies these identifiers and later rejects unknown members and duplicate queries. */
export const researchFollowupSchema: WorkflowJsonSchema = object({
  followups: list(object({
    parentId: id, facetIds: idList(1, 8), gapIds: idList(1, 8), query: text(1000), reason: text(2000),
    sourceIds: providedSourceIds,
  }, "sourceIds"), 0, 3),
});

export interface ResearchParagraph { heading: string; text: string; claimIds: string[] }
export interface ResearchSynthesisOutput { title: string; paragraphs: ResearchParagraph[] }
/**
 * Empty claimIds only makes nonempirical scope and method text possible; the independent
 * verifier still judges every paragraph. The host assigns p1, p2, ... and generates the
 * reference list from the source ledger, so the model cannot invent reference metadata.
 */
export const researchSynthesisSchema: WorkflowJsonSchema = object({
  title: text(500),
  paragraphs: list(object({ heading: text(200), text: text(4000), claimIds: idList(0, 20) }), 1, 30),
});

export interface ResearchParagraphVerdict { paragraphId: string; verdict: "supported" | "unverified"; reason: string }
export interface ResearchFacetCoverage { facetId: string; status: "covered" | "gap"; reason: string }
export interface ResearchVerificationOutput {
  paragraphs: ResearchParagraphVerdict[];
  facetCoverage: ResearchFacetCoverage[];
  issues: string[];
}
/** The runtime additionally requires exact paragraph and facet membership and full coverage. */
export const researchVerificationSchema: WorkflowJsonSchema = object({
  paragraphs: list(object({
    paragraphId: id, verdict: { type: "string", enum: ["supported", "unverified"] }, reason: text(2000),
  }), 1, 30),
  facetCoverage: list(object({
    facetId: id, status: { type: "string", enum: ["covered", "gap"] }, reason: text(2000),
  }), 1, 24),
  issues: textList(0, 20),
});

export interface ResearchRevisionOutput {
  updates: Array<{ paragraphId: string; text: string; claimIds: string[]; reason: string }>;
}
/**
 * A revision rewrites the body of paragraphs the host selected, so it carries neither a title nor
 * headings: the host keeps the drafted heading, position and every untargeted paragraph, and only
 * substitutes text and claimIds for the paragraphIds named here. The runtime additionally requires
 * each update to name a distinct targeted paragraph and to cite existing claim ids, and a revised
 * report is verified again from scratch rather than inheriting the earlier verdicts.
 */
export const researchRevisionSchema: WorkflowJsonSchema = object({
  updates: list(object({
    paragraphId: id, text: text(4000), claimIds: idList(0, 20), reason: text(2000),
  }), 1, 30),
});
