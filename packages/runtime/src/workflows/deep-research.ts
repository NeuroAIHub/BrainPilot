/*
 * Native deep-research workflow: a bounded plan → branch evidence → gap review → synthesis →
 * independent verification loop over the caller's provided files, BrainPilot's paper library and
 * Tavily. The approach is inspired by the pinned GPT Researcher commit recorded in
 * ./prompts/deep-research.ts (Apache-2.0); no upstream code is imported and this is not a port.
 *
 * Invariants this file owns, none of which a model output can relax:
 * - Every identifier (b*, f*, s*, c*, g*, p*, w*) is assigned here; a model may only echo one back.
 * - Every claim support must name a source that is actually visible in its own branch and quote it
 *   verbatim, exactly once, in the stored canonical body, inside a read window that branch was
 *   actually handed. An unlocatable or undelivered quote rejects the claim: a body sitting in the
 *   ledger is not evidence that the stage inspected it.
 * - Provided-file metadata is parsed locally from the file's own text and stays an unverified
 *   caller claim; source identity is never treated as proof that a claim is true.
 * - A failing or incomplete run writes its partial artifacts and then throws. It never returns a
 *   result envelope carrying an "incomplete" status.
 */
import { createHash } from "node:crypto";
import {
  compileWorkflowValidator, defineWorkflow,
  type WorkflowArtifact, type WorkflowContext, type WorkflowDefinition, type WorkflowJsonSchema,
} from "@brainpilot/plugin-sdk/workflow";
import definition from "./deep-research.definition.json" with { type: "json" };
import {
  parseDeepResearchInput, researchEvidenceSchema, researchFollowupSchema, researchPlanSchema,
  researchRevisionSchema, researchSynthesisSchema, researchVerificationSchema,
  type DeepResearchInput, type ResearchEvidenceOutput, type ResearchFollowupOutput,
  type ResearchPlanOutput, type ResearchRevisionOutput, type ResearchSynthesisOutput,
  type ResearchVerificationOutput,
} from "./deep-research-contract.js";
import {
  admitProvidedSources, admitResearchSources, catalogProvidedSources, createSourceLedger,
  type LedgerSource, type PlanningSource, type ProvidedSourceDescriptor, type SourceLedger,
} from "./deep-research-ledger.js";
import { isSpanInsideWindows, selectReadWindows, type ReadWindow } from "./deep-research-reading.js";
import type { WorkflowResearchEvidence } from "./research-tools.js";
import {
  GPT_RESEARCHER_COMMIT, GPT_RESEARCHER_LICENSE, GPT_RESEARCHER_URL,
  evidenceInstructions, followupInstructions, planInstructions, revisionInstructions,
  synthesisInstructions, verificationInstructions,
} from "./prompts/deep-research.js";

/** Wall-clock left untouched so a partial report can still be written and published. */
const SOFT_STOP_RESERVE_MS = 10_000;
/** The ceiling for a stage handed a small input: planning, the gap review and synthesis. */
const MAX_STAGE_TIMEOUT_MS = 600_000;
/**
 * The SDK's own hard maximum, given to the two kinds of stage that must weigh a whole corpus in a
 * single pass: an evidence stage reads and judges every window one branch was handed, and the
 * verification stage re-judges every paragraph of the draft against all of the evidence it cites.
 * Both have been observed to need more than MAX_STAGE_TIMEOUT_MS to reach a submission rather than
 * being cut off mid-way. The bounded revision and the re-verification of a revised draft weigh the
 * same evidence and share the ceiling. This is a ceiling, not an allocation: what is left of the
 * run's own wall clock, minus the write reserve, still wins whenever it is smaller.
 */
const LONG_STAGE_TIMEOUT_MS = 1_200_000;
/** Named because both the stage call and its timeout ceiling have to agree on it. */
const VERIFICATION_STAGE_ID = "deep-research-verification";
/** The re-verification of a revised draft: a full independent pass, never a diff of the first one. */
const VERIFICATION_RECHECK_STAGE_ID = "deep-research-verification-recheck";
/** The one bounded repair stage a run may be offered, at most once. */
const REVISION_STAGE_ID = "deep-research-revision";
const METADATA_HEAD_CHARS = 4_000;
const SEARCH_MAX_RESULTS = 4;
const MAX_CANDIDATES_PER_BRANCH = 3;
const MAX_URLS_PER_RESOLVE = 3;
const BRANCH_CONCURRENCY = 2;
/**
 * How much source text one evidence stage may be handed: at most 36 000 characters per branch, and at
 * most 12 000 from any single source, the per-branch total divided across the sources actually visible
 * to that branch. A whole long paper per source produced a stage that thought for ten minutes and
 * returned nothing, so reading is bounded here rather than left to the model's attention.
 */
const BRANCH_READ_CHARS = 36_000;
const SOURCE_READ_CHARS = 12_000;
/** A citation shorter than this is not a usable verbatim span, however unique it may be. */
const MIN_QUOTE_CHARS = 8;

/** Failures carry a generic code only: a message must never echo a path, body or credential. */
export class DeepResearchFailure extends Error {
  constructor(readonly code: string) {
    super(`deep_research_${code}`);
    this.name = "DeepResearchFailure";
  }
}
const fail = (code: string): never => { throw new DeepResearchFailure(code); };

export interface ResearchFacet { facetId: string; description: string }
/**
 * What one branch was actually handed for one source: the exact windows delivered, plus how many
 * characters of the full body they cover. `excerpted` false means the whole body was delivered; it is
 * never set from the size of the body on disk, only from the windows that went into the stage inputs.
 */
export interface BranchSourceReading {
  sourceId: string;
  contentHash: string | null;
  fullChars: number;
  readChars: number;
  excerpted: boolean;
  windows: ReadWindow[];
}
export interface ResearchBranchState {
  branchId: string;
  kind: "initial" | "followup";
  parentId: string | null;
  question: string;
  query: string;
  facets: ResearchFacet[];
  /** Ids this branch may cite: its admitted provided files plus its own retrieval. */
  visibleSourceIds: string[];
  claimIds: string[];
  gapIds: string[];
  contradictions: string[];
  status: "completed" | "failed" | "skipped";
  reason: string | null;
  diagnostics: string[];
  researchCalls: number;
  snapshots: string[];
  /** Present once the evidence stage inputs were built; the only spans this branch may quote. */
  readWindows?: BranchSourceReading[];
}
export interface ResearchClaimRecord {
  claimId: string;
  branchId: string;
  text: string;
  facetIds: string[];
  supports: Array<{ sourceId: string; quote: string; start: number; end: number; contentHash: string }>;
  limitations: string[];
}
export interface ResearchGapRecord { gapId: string; branchId: string; facetIds: string[]; text: string }

type JsonObject = Record<string, unknown>;
const jsonText = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const trimmed = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
};

/** Queries are compared with case, surrounding and repeated whitespace ignored. */
export function normalizeResearchQuery(query: string): string {
  return query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * The one span a quote occupies in a stored body, or null when it does not occur there exactly or
 * occurs more than once. Only surrounding whitespace is forgiven, and the located span — not the
 * model's original string — is what gets recorded. Offsets are JavaScript UTF-16 indices.
 */
export function locateExactQuote(body: string, quote: unknown):
{ quote: string; start: number; end: number } | null {
  const needle = trimmed(quote);
  if (needle === null || needle.length < MIN_QUOTE_CHARS) return null;
  const start = body.indexOf(needle);
  if (start === -1 || body.indexOf(needle, start + 1) !== -1) return null;
  return { quote: needle, start, end: start + needle.length };
}

/** A label written as frontmatter, a bold line or ordinary prose, read only from the head. */
function labelledField(head: string, label: string): string | null {
  const pattern = new RegExp(`^[\\s>*_#-]*${label}\\s*[*_]*\\s*[::]\\s*(.+)$`, "imu");
  const value = pattern.exec(head)?.[1];
  return trimmed(value?.replace(/[*_`]+/gu, " "));
}

/**
 * The caller's own claims about one provided file, read from the first 4000 characters of the file
 * itself: the first Markdown heading as title, `Authors` as a semicolon-separated list, and the
 * `First publication date`, `Publication year`, `DOI` and `Primary URL` labels our corpus writes and
 * ordinary documents often carry too. Nothing here contacts the outside world, so every field stays
 * an unverified provided claim and a missing one stays unknown rather than guessed. `expectedSha256`
 * is the hash of the very text that was read, which fences a body that changes between reading and
 * admission; it is a self-consistency check, never external verification.
 */
export function parseProvidedMetadata(path: string, text: string): ProvidedSourceDescriptor {
  const head = text.slice(0, METADATA_HEAD_CHARS);
  const heading = trimmed(/^[ \t]*#{1,6}[ \t]+(.+)$/mu.exec(head)?.[1]?.replace(/[*_`]+/gu, " "));
  const authors = (labelledField(head, "Authors") ?? "").split(";")
    .map((author) => trimmed(author)).filter((author): author is string => author !== null);
  const year = labelledField(head, "Publication year");
  const descriptor: ProvidedSourceDescriptor = {
    path,
    expectedSha256: sha256(text),
    bytes: Buffer.byteLength(text, "utf8"),
    provenanceNote: "Caller-supplied workspace file; metadata parsed locally from the file's own text and unverified.",
  };
  if (heading !== null) descriptor.title = heading;
  if (authors.length) descriptor.authors = authors;
  const publicationDate = labelledField(head, "First publication date");
  if (publicationDate !== null) descriptor.publicationDate = publicationDate;
  if (year !== null && /^\d{4}$/u.test(year)) descriptor.year = Number(year);
  const doi = labelledField(head, "DOI");
  if (doi !== null) descriptor.doi = doi.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, "");
  const url = labelledField(head, "Primary URL");
  if (url !== null) descriptor.url = url;
  return descriptor;
}

const titleKey = (value: unknown) =>
  (trimmed(value) ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export interface ResearchCandidate { title: string; urls: string[] }
/**
 * Up to three candidate papers taken only from what a search actually returned, deduplicated by
 * normalized title and by URL. A candidate the retrieval never reported is never manufactured here,
 * and a library paper without a public URL is still a candidate: resolution can find it by title.
 */
export function selectResearchCandidates(evidence: WorkflowResearchEvidence): ResearchCandidate[] {
  const candidates: ResearchCandidate[] = [];
  const titles = new Set<string>();
  const urls = new Set<string>();
  const consider = (rawTitle: unknown, rawUrl: unknown) => {
    if (candidates.length >= MAX_CANDIDATES_PER_BRANCH) return;
    const title = trimmed(rawTitle);
    const key = titleKey(title);
    const url = trimmed(rawUrl);
    if (title === null || key === "" || titles.has(key)) return;
    if (url !== null && urls.has(url)) return;
    titles.add(key);
    if (url !== null) urls.add(url);
    candidates.push({ title, urls: url === null ? [] : [url] });
  };
  for (const paper of Array.isArray(evidence?.localPapers) ? evidence.localPapers : []) {
    consider(paper?.title, paper?.url);
  }
  for (const result of Array.isArray(evidence?.webResults) ? evidence.webResults : []) {
    consider(result?.title, result?.url);
  }
  return candidates;
}

/**
 * Orchestration counters, reserved before the work they pay for so a refused reservation never
 * leaves a half-charged call. These bound branches, stages, research calls and extraction URLs;
 * they are not a token budget and not a cap on the requests one research tool makes internally.
 */
export class ResearchBudget {
  branches = 0; followups = 0; modelStages = 0; researchCalls = 0; extractUrls = 0;
  constructor(private readonly limits: DeepResearchInput["budget"]) {}
  admitBranch(kind: "initial" | "followup"): boolean {
    if (this.branches >= this.limits.maxBranches + this.limits.maxFollowups) return false;
    if (kind === "followup" && this.followups >= this.limits.maxFollowups) return false;
    if (kind === "initial" && this.branches - this.followups >= this.limits.maxBranches) return false;
    this.branches++;
    if (kind === "followup") this.followups++;
    return true;
  }
  admitModelStage(): boolean {
    if (this.modelStages >= this.limits.maxModelStages) return false;
    this.modelStages++;
    return true;
  }
  /** Stages still affordable, so a step needing two of them can decline before spending the first. */
  remainingModelStages(): number { return Math.max(0, this.limits.maxModelStages - this.modelStages); }
  admitResearchCall(): boolean {
    if (this.researchCalls >= this.limits.maxResearchCalls) return false;
    this.researchCalls++;
    return true;
  }
  /** Reserves the actual URLs a call may extract, capped by what is left; 0 means do not call. */
  reserveExtractUrls(wanted: number): number {
    const reserved = Math.max(0, Math.min(wanted, this.limits.maxExtractUrls - this.extractUrls));
    this.extractUrls += reserved;
    return reserved;
  }
  /**
   * Hands back the part of one reservation the call did not spend, counted from the URLs the adapter
   * reports it actually handed to extraction — never from the number of wrapper calls, which says
   * nothing about the requests made underneath. Only a resolve that came back may refund: a request
   * that failed keeps its whole reservation, because what it consumed upstream is unknown and
   * assuming nothing would let a retry oversubscribe the allowance. The refund is bounded by the
   * reservation itself and by the outstanding total, so a call reporting more or fewer URLs than it
   * was granted can neither release an allowance nobody reserved nor be credited twice.
   */
  refundExtractUrls(reserved: number, requestedUrls: number): number {
    if (!Number.isInteger(reserved) || reserved <= 0) return 0;
    const spent = Number.isInteger(requestedUrls) && requestedUrls > 0 ? Math.min(requestedUrls, reserved) : 0;
    const refund = Math.min(reserved - spent, this.extractUrls);
    this.extractUrls -= refund;
    return refund;
  }
  usage(): JsonObject {
    return {
      branches: this.branches, followups: this.followups, modelStages: this.modelStages,
      researchCalls: this.researchCalls, extractUrls: this.extractUrls, limits: { ...this.limits },
    };
  }
}

export interface VerificationCheck { ok: boolean; reasons: string[]; gapFacetIds: string[] }
/**
 * Whether an independent verification actually clears the draft. Every paragraph and every facet
 * must be judged exactly once with no unknown or omitted member, every paragraph verdict must be
 * `supported`, and the issue list must be empty. A facet may be reported as a gap — the report
 * discloses each gap and its reason — but a run where nothing is covered is not a completed
 * investigation, so an all-gap verdict never passes. `citedClaimCount` is the number of distinct
 * admitted claims the draft's own paragraphs cite, not how many the run admitted anywhere: a report
 * that cites none of them says nothing this run can stand behind, however many claims exist
 * elsewhere, so a draft of method paragraphs alone cannot pass.
 */
export function checkVerification(
  verification: ResearchVerificationOutput, paragraphIds: string[], facetIds: string[], citedClaimCount: number,
): VerificationCheck {
  const reasons: string[] = [];
  const judge = (
    label: string, reported: string[], expected: string[],
  ) => {
    if (new Set(reported).size !== reported.length) reasons.push(`${label}_duplicated`);
    if (reported.some((id) => !expected.includes(id))) reasons.push(`${label}_unknown`);
    if (expected.some((id) => !reported.includes(id))) reasons.push(`${label}_omitted`);
  };
  judge("paragraph", verification.paragraphs.map((entry) => entry.paragraphId), paragraphIds);
  judge("facet", verification.facetCoverage.map((entry) => entry.facetId), facetIds);
  const unverified = verification.paragraphs.filter((entry) => entry.verdict !== "supported");
  if (unverified.length) reasons.push("paragraph_unverified");
  if (verification.issues.length) reasons.push("verifier_issues");
  const gaps = verification.facetCoverage.filter((entry) => entry.status === "gap");
  if (!verification.facetCoverage.some((entry) => entry.status === "covered")) reasons.push("no_facet_covered");
  if (citedClaimCount < 1) reasons.push("no_cited_claim");
  return { ok: reasons.length === 0, reasons, gapFacetIds: gaps.map((entry) => entry.facetId) };
}

const REPORT_LABELS = {
  en: {
    references: "References", gaps: "Evidence gaps", appendix: "Claim-to-source map", draft: "Unverified draft",
    scope: "Scope: this report rests on the source passages that were selected and quoted for it. The reading coverage of each source and each branch's own observations are recorded in the evidence appendix.",
    claimMap: (path: string) => `Every claim, its supporting source and the exact quoted span are recorded in \`${path}\`.`,
    coverage: (path: string) => `How much of each source was actually read, and the run's own counts, are recorded in \`${path}\`.`,
    tree: (path: string) => `Each branch, what it was asked and what it could not settle from the passages it was handed, is recorded in \`${path}\`.`,
  },
  "zh-CN": {
    references: "参考文献", gaps: "证据缺口", appendix: "论断与来源对照", draft: "未通过核查的草稿",
    scope: "范围说明：本报告基于为其选取并引用的来源段落。各来源的阅读覆盖情况与各研究分支自身的观察记录见证据附录。",
    claimMap: (path: string) => `每条论断、其支持来源及其逐字引用的位置均记录于 \`${path}\`。`,
    coverage: (path: string) => `各来源的实际阅读覆盖情况与本次运行的各项计数记录于 \`${path}\`。`,
    tree: (path: string) => `各研究分支的问题、来源，以及它在所获段落中未能解决的事项，记录于 \`${path}\`。`,
  },
} as const;

export interface RenderReportInput {
  title: string;
  language: keyof typeof REPORT_LABELS;
  paragraphs: Array<{ paragraphId: string; heading: string; text: string; claimIds: string[] }>;
  claims: ResearchClaimRecord[];
  sources: LedgerSource[];
  /** Facet gaps and their verifier reasons, plus the branches that did not complete. */
  gaps: Array<{ label: string; reason: string }>;
  appendixPath: string;
  /**
   * The artifacts the scope note points at, when the caller has written them: the run summary
   * carries the measured reading coverage and the research tree carries each branch's own record.
   * Both are the paths the host actually wrote, never a guessed name, so an unwritten artifact is
   * simply not linked.
   */
  coveragePath?: string;
  treePath?: string;
  verified: boolean;
}
/**
 * The report body plus a numbered reference list built only from the sources that actually support
 * the cited claims, numbered deterministically by first appearance. Reference metadata comes from
 * the ledger, never from the model, and each provided entry is labelled as an unverified caller
 * claim. Every facet gap is printed with its reason, so disclosure cannot be skipped. One fixed
 * scope note states what the body stands on — selected passages — without any count the host would
 * have to invent; the measured coverage figures stay in the evidence artifacts.
 */
export function renderResearchReport(input: RenderReportInput): string {
  const labels = REPORT_LABELS[input.language] ?? REPORT_LABELS.en;
  const claimById = new Map(input.claims.map((claim) => [claim.claimId, claim]));
  const numbers = new Map<string, number>();
  const lines: string[] = [`# ${input.title}`];
  if (!input.verified) lines.push("", `> ${labels.draft}: independent verification did not clear this draft.`);
  lines.push("", `> ${labels.scope}`);
  for (const paragraph of input.paragraphs) {
    for (const claimId of paragraph.claimIds) {
      for (const support of claimById.get(claimId)?.supports ?? []) {
        if (!numbers.has(support.sourceId)) numbers.set(support.sourceId, numbers.size + 1);
      }
    }
    const cited = [...new Set(paragraph.claimIds.flatMap((claimId) =>
      (claimById.get(claimId)?.supports ?? []).map((support) => numbers.get(support.sourceId)!)))].sort((a, b) => a - b);
    lines.push("", `## ${paragraph.heading}`, "", paragraph.text);
    if (cited.length) lines.push("", `${labels.references}: ${cited.map((number) => `[${number}]`).join(" ")}`);
  }
  lines.push("", `## ${labels.gaps}`, "");
  lines.push(input.gaps.length
    ? input.gaps.map((gap) => `- ${gap.label}: ${gap.reason}`).join("\n")
    : "- None reported.");
  lines.push("", `## ${labels.references}`, "");
  if (numbers.size === 0) lines.push("- None cited.");
  for (const [sourceId, number] of [...numbers].sort((left, right) => left[1] - right[1])) {
    const source = input.sources.find((candidate) => candidate.sourceId === sourceId);
    const parts = [
      source?.title ?? "Untitled source",
      source?.authors.length ? source.authors.join("; ") : null,
      source?.publicationDate ?? "date unknown",
      source?.doi ? `doi:${source.doi}` : source?.url ?? null,
      source?.origin === "provided"
        ? "provided file, metadata unverified"
        : `retrieved via ${source?.origin ?? "unknown backend"}, metadata ${source?.metadataOrigin ?? "unknown"}`,
    ].filter((part): part is string => part !== null && part !== "");
    lines.push(`${number}. ${parts.join(" — ")} (${sourceId})`);
  }
  lines.push("", `## ${labels.appendix}`, "", labels.claimMap(input.appendixPath));
  // The scope note promises the reading coverage and the branch observations; they live in these two
  // artifacts, not in the claim map, so each is linked when its path was actually written.
  if (input.coveragePath) lines.push("", labels.coverage(input.coveragePath));
  if (input.treePath) lines.push("", labels.tree(input.treePath));
  lines.push("");
  return lines.join("\n");
}

const validators = new Map<WorkflowJsonSchema, (value: unknown) => void>();
function validatorFor(schema: WorkflowJsonSchema, label: string): (value: unknown) => void {
  let validate = validators.get(schema);
  if (!validate) { validate = compileWorkflowValidator(schema, label); validators.set(schema, validate); }
  return validate;
}

/**
 * One execution. Every await is fenced on both sides: the hard deadline sets `expired` before it
 * rejects and cancellation aborts the host context, so no late promise can write an artifact or add
 * a claim after the run has stopped. Already registered artifacts are kept.
 */
class DeepResearchRun {
  readonly artifacts: WorkflowArtifact[] = [];
  readonly diagnostics: Array<{ code: string; detail: string }> = [];
  readonly issues: string[] = [];
  readonly branches: ResearchBranchState[] = [];
  readonly claims: ResearchClaimRecord[] = [];
  readonly gaps: ResearchGapRecord[] = [];
  readonly ledger: SourceLedger;
  readonly budget: ResearchBudget;
  /** Each provided path is read at most once and its exact text reused everywhere. */
  private readonly providedText = new Map<string, string>();
  private readonly sourcePathById = new Map<string, string>();
  private readonly usedQueries = new Set<string>();
  planning: PlanningSource[] = [];
  expired = false;
  stopped = false;
  private facets = 0; private claimIds = 0; private gapIds = 0; private checkpoints = 0;
  private readonly deadlineAt: number;

  constructor(readonly ctx: WorkflowContext, readonly input: DeepResearchInput) {
    this.ledger = createSourceLedger(input.cutoffDate);
    this.budget = new ResearchBudget(input.budget);
    this.deadlineAt = Date.now() + input.budget.maxDurationMs;
  }

  remainingMs(): number { return this.deadlineAt - Date.now(); }
  /** True once only the write reserve is left: start no new stage, finish with what exists. */
  softStopped(): boolean { return this.stopped || this.remainingMs() <= SOFT_STOP_RESERVE_MS; }
  canWrite(): boolean { return !this.expired && !this.stopped && !this.ctx.signal.aborted; }
  guard(): void {
    if (this.expired) fail("deadline_exceeded");
    this.ctx.signal.throwIfAborted();
    if (this.stopped) fail("run_stopped");
  }

  note(code: string, detail: string): void {
    if (this.diagnostics.length < 400) this.diagnostics.push({ code, detail });
  }
  emit(type: string, stageId: string, message: string): void {
    if (!this.canWrite()) return;
    try { this.ctx.emit({ type, stageId, message }); }
    catch { /* An observational event must not decide the run's outcome. */ }
  }

  private collect(artifact: WorkflowArtifact): void {
    if (!this.artifacts.some((existing) => existing.path === artifact.path)) this.artifacts.push(artifact);
  }
  /** The single write path. A write is never attempted once the run is fenced off. */
  async save(path: string, content: string, mediaType: string, role: string): Promise<WorkflowArtifact> {
    if (!this.canWrite()) fail("write_after_stop");
    const artifact = await this.ctx.writeArtifact({ path, content, mediaType, role });
    if (!this.canWrite()) fail("write_after_stop");
    this.collect(artifact);
    return artifact;
  }
  json(path: string, value: unknown, role: string): Promise<WorkflowArtifact> {
    return this.save(path, jsonText(value), "application/json", role);
  }
  /** Best-effort persistence for the failure path: a refused write must not mask the real error. */
  async trySave(path: string, content: string, mediaType: string, role: string): Promise<string | null> {
    if (!this.canWrite()) return null;
    try { return (await this.save(path, content, mediaType, role)).path; }
    catch { return null; }
  }

  /** Whatever is left of the wall clock, minus the write reserve, capped per stage. */
  private stageTimeoutMs(stageId: string): number {
    const usable = Math.floor(this.remainingMs() - SOFT_STOP_RESERVE_MS);
    if (usable < 1) fail("budget_duration_exhausted");
    const ceiling = stageId.startsWith("deep-research-evidence-")
      || stageId === VERIFICATION_STAGE_ID || stageId === VERIFICATION_RECHECK_STAGE_ID
      || stageId === REVISION_STAGE_ID
      ? LONG_STAGE_TIMEOUT_MS
      : MAX_STAGE_TIMEOUT_MS;
    return Math.min(usable, ceiling);
  }

  /**
   * One model stage. The model binding is always the run's own — this workflow never overrides the
   * provider or model. The host validates a stage output too, but an injected test host may not, so
   * the schema is enforced here as well before any identifier is trusted.
   */
  async stage<T>(stageId: string, instructions: string, inputs: unknown, schema: WorkflowJsonSchema): Promise<T> {
    this.guard();
    if (!this.budget.admitModelStage()) fail("budget_model_stages_exhausted");
    const timeoutMs = this.stageTimeoutMs(stageId);
    this.emit("deep-research/stage-started", stageId, `Starting ${stageId}.`);
    const value = await this.ctx.runAgent({ stageId, instructions, inputs, outputSchema: schema, tools: [], timeoutMs });
    this.guard();
    validatorFor(schema, `deep-research ${stageId}`)(value);
    this.emit("deep-research/stage-finished", stageId, `Completed ${stageId}.`);
    return value as T;
  }

  /** One budgeted research call. Reservation happens before the call, never after it returned. */
  async research(name: "research_search" | "research_resolve", input: JsonObject, branch: ResearchBranchState):
  Promise<WorkflowResearchEvidence | null> {
    this.guard();
    if (!this.budget.admitResearchCall()) {
      branch.diagnostics.push("research_call_budget_exhausted");
      return null;
    }
    branch.researchCalls++;
    const result = await this.ctx.runTool({ name, input });
    this.guard();
    for (const artifact of result.artifacts) this.collect(artifact);
    const evidence = result.data as WorkflowResearchEvidence;
    for (const issue of Array.isArray(evidence?.issues) ? evidence.issues : []) {
      if (!this.issues.includes(issue)) this.issues.push(issue);
    }
    return evidence;
  }

  nextFacetId(): string { return `f${++this.facets}`; }
  nextClaimId(): string { return `c${++this.claimIds}`; }
  nextGapId(): string { return `g${++this.gapIds}`; }
  /** Claimed synchronously, so two branches finishing at once never race for the same path. */
  nextCheckpointSequence(): number { return ++this.checkpoints; }
  /** Unique facet ids: a follow-up inherits its parent's facets rather than adding new ones. */
  facetIds(): string[] {
    return [...new Set(this.branches.flatMap((branch) => branch.facets.map((facet) => facet.facetId)))];
  }
  /** Every distinct facet with its description and the branches that examined it. */
  facetInventory(): JsonObject[] {
    return this.facetIds().map((facetId) => {
      const branches = this.branches.filter((branch) => branch.facets.some((facet) => facet.facetId === facetId));
      const description = branches.flatMap((branch) => branch.facets).find((facet) => facet.facetId === facetId)?.description ?? facetId;
      return {
        facetId, description,
        branchIds: branches.map((branch) => branch.branchId),
        branchStatuses: branches.map((branch) => branch.status),
      };
    });
  }
  reserveQuery(query: string): boolean {
    const key = normalizeResearchQuery(query);
    if (key === "" || this.usedQueries.has(key)) return false;
    this.usedQueries.add(key);
    return true;
  }
  sourceById(sourceId: string): LedgerSource | undefined {
    return this.ledger.sources.find((source) => source.sourceId === sourceId);
  }

  /**
   * Reads each caller-supplied path exactly once, parses its local metadata and catalogues it for
   * planning. A path that cannot be read is recorded as the caller's gap and the run continues on
   * the files that could be read; planning sees metadata only, never a body.
   */
  async loadProvidedSources(): Promise<void> {
    const descriptors: ProvidedSourceDescriptor[] = [];
    for (const path of this.input.inputPaths) {
      this.guard();
      if (this.softStopped()) { this.note("input_read_skipped", `Not read before the time budget ran out: ${path}`); continue; }
      try {
        const text = await this.ctx.readText(path);
        this.guard();
        this.providedText.set(path, text);
        descriptors.push(parseProvidedMetadata(path, text));
      } catch (error) {
        this.guard();
        // Only the caller's own relative path is logged; no host location or file body.
        this.note("input_unreadable", `Provided path could not be read: ${path}`);
        if (error instanceof DeepResearchFailure) throw error;
      }
    }
    this.planning = catalogProvidedSources(this.ledger, descriptors);
    for (const view of this.planning) this.sourcePathById.set(view.sourceId, view.path);
  }

  /** Metadata-only planning catalogue: never a body, never a field the caller did not supply. */
  catalogue(): JsonObject[] {
    return this.planning.map((view) => ({
      sourceId: view.sourceId, path: view.path, title: view.title, authors: view.authors,
      publicationDate: view.publicationDate ?? "unknown", cutoffStatus: view.cutoffStatus,
      bytes: view.bytes, readable: view.readable, metadataOrigin: "provided-unverified",
    }));
  }

  /** Admits the already-read bodies for the ids a branch selected, and returns the visible ones. */
  admitProvided(sourceIds: string[], branch: ResearchBranchState): string[] {
    const inputs: Array<{ sourceId: string; text: string }> = [];
    for (const sourceId of [...new Set(sourceIds)]) {
      const path = this.sourcePathById.get(sourceId);
      const text = path === undefined ? undefined : this.providedText.get(path);
      if (text === undefined) {
        branch.diagnostics.push("provided_source_unavailable");
        this.note("provided_source_unavailable", `Branch ${branch.branchId} selected a provided source with no readable text.`);
        continue;
      }
      inputs.push({ sourceId, text });
    }
    return inputs.length ? admitProvidedSources(this.ledger, inputs) : [];
  }
}

/**
 * One immutable evidence snapshot of everything admitted so far: each source as stored, with its
 * metadata, body and hash, every admitted claim with its quoted spans and offsets, the gaps, and the
 * research tree as it stands. Every snapshot gets its own sequenced path, so a later stage never
 * overwrites what an earlier one recorded and the last successful branch's evidence stays on disk
 * through a verifier failure or an expired budget. Writing is best effort: a refused snapshot must
 * not fail a branch that did complete, and nothing is written once the run is fenced off, so neither
 * the hard deadline nor a parent Stop can trigger a fresh write.
 */
async function saveEvidenceCheckpoint(run: DeepResearchRun, label: string): Promise<string | null> {
  if (!run.canWrite()) return null;
  const sequence = String(run.nextCheckpointSequence()).padStart(2, "0");
  const safe = label.replace(/[^A-Za-z0-9-]+/gu, "-");
  return run.trySave(`evidence/${sequence}-${safe}.json`, jsonText({
    checkpoint: label, cutoffDate: run.ledger.cutoffDate,
    note: "Immutable snapshot of the evidence admitted up to this stage. Source bodies are recorded with the hash every claim quote was located against, and each branch keeps the read windows its stage was handed, whose text is preserved in that branch's read-windows.json.",
    sources: run.ledger.sources.map((source) => ({ ...source })),
    sourceDiagnostics: run.ledger.diagnostics.map((entry) => ({ ...entry })),
    claims: run.claims.map((claim) => ({ ...claim, supports: claim.supports.map((support) => ({ ...support })) })),
    gaps: run.gaps.map((gap) => ({ ...gap })),
    branches: run.branches.map(branchSnapshot),
  }), "application/json", "research-evidence-checkpoint");
}

/** Ids the plan asked for that actually exist and can be read; unknown ones are dropped, loudly. */function selectedProvidedIds(run: DeepResearchRun, requested: string[] | undefined, label: string): string[] {
  const selected: string[] = [];
  for (const sourceId of [...new Set(requested ?? [])]) {
    const view = run.planning.find((candidate) => candidate.sourceId === sourceId);
    if (!view) { run.note("plan_unknown_source", `${label} named a source id that is not in this run's catalogue.`); continue; }
    if (!view.readable) { run.note("plan_unreadable_source", `${label} named a catalogued source whose full text cannot be read.`); continue; }
    selected.push(sourceId);
  }
  return selected;
}

/**
 * The planning stage plus every host check on its output. Branch and facet identifiers are assigned
 * here; a branch whose query repeats one already used in this run is dropped with a diagnostic
 * rather than silently deduplicated, and a run left with no usable branch fails.
 */
async function planResearch(run: DeepResearchRun): Promise<Array<{ branch: ResearchBranchState; sourceIds: string[] }>> {
  const plan = await run.stage<ResearchPlanOutput>("deep-research-plan", planInstructions(run.input.language), {
    question: run.input.question, scope: run.input.scope, exclusions: run.input.exclusions,
    cutoffDate: run.input.cutoffDate, language: run.input.language,
    providedSources: run.catalogue(),
    budget: { maxBranches: run.input.budget.maxBranches, maxResearchCalls: run.input.budget.maxResearchCalls },
  }, researchPlanSchema);
  const planned: Array<{ branch: ResearchBranchState; sourceIds: string[] }> = [];
  for (const entry of plan.branches) {
    if (!run.reserveQuery(entry.query)) {
      run.note("plan_duplicate_query", "A planned branch repeated a query already used in this run and was dropped.");
      continue;
    }
    if (!run.budget.admitBranch("initial")) { run.note("plan_branch_over_budget", "A planned branch exceeded the branch budget."); continue; }
    const branch: ResearchBranchState = {
      branchId: `b${run.branches.length + 1}`, kind: "initial", parentId: null,
      question: entry.question, query: entry.query,
      facets: [...new Set(entry.requiredFacets)].map((description) => ({ facetId: run.nextFacetId(), description })),
      visibleSourceIds: [], claimIds: [], gapIds: [], contradictions: [],
      status: "failed", reason: null, diagnostics: [], researchCalls: 0, snapshots: [],
    };
    run.branches.push(branch);
    planned.push({ branch, sourceIds: selectedProvidedIds(run, entry.sourceIds, `Branch ${branch.branchId}`) });
  }
  if (!planned.length) fail("plan_produced_no_usable_branch");
  await run.json("plan.json", {
    question: run.input.question, scope: run.input.scope, cutoffDate: run.input.cutoffDate,
    branches: planned.map(({ branch, sourceIds }) => ({
      branchId: branch.branchId, question: branch.question, query: branch.query,
      facets: branch.facets, providedSourceIds: sourceIds,
    })),
  }, "research-plan");
  return planned;
}

/** Retrieval for one branch: one search, then up to three resolutions of what it actually found. */
async function gatherBranchSources(run: DeepResearchRun, branch: ResearchBranchState): Promise<void> {
  if (run.input.budget.maxResearchCalls < 1) {
    branch.diagnostics.push("retrieval_disabled_by_budget");
    return;
  }
  const search = await run.research("research_search", { query: branch.query, maxResults: SEARCH_MAX_RESULTS }, branch);
  if (!search) return;
  const snapshot = await run.json(`branches/${branch.branchId}/search.json`,
    { query: branch.query, maxResults: SEARCH_MAX_RESULTS, evidence: search }, "research-snapshot");
  branch.snapshots.push(snapshot.path);
  const candidates = selectResearchCandidates(search);
  let index = 0;
  for (const candidate of candidates) {
    run.guard();
    if (run.softStopped()) { branch.diagnostics.push("resolution_stopped_by_time_budget"); break; }
    index++;
    // The extraction allowance is reserved before the call, so a concurrent branch cannot spend it.
    const reserved = run.budget.reserveExtractUrls(Math.min(MAX_URLS_PER_RESOLVE, Math.max(1, candidate.urls.length)));
    if (reserved === 0) branch.diagnostics.push("extract_url_budget_exhausted");
    const resolved = await run.research("research_resolve",
      { title: candidate.title, urls: candidate.urls.slice(0, reserved), maxExtractUrls: reserved }, branch);
    if (!resolved) {
      // The call was refused before it was made, so its reservation never reached extraction.
      run.budget.refundExtractUrls(reserved, 0);
      break;
    }
    // A completed resolve reports the URLs it actually handed on; only the rest is released.
    const requested = new Set(Array.isArray(resolved.extractRequestedUrls) ? resolved.extractRequestedUrls : []);
    if (run.budget.refundExtractUrls(reserved, requested.size) > 0) {
      branch.diagnostics.push("extract_url_reservation_partly_refunded");
    }
    const stored = await run.json(`branches/${branch.branchId}/resolve-${index}.json`,
      { title: candidate.title, requestedUrls: candidate.urls, maxExtractUrls: reserved, evidence: resolved }, "research-snapshot");
    branch.snapshots.push(stored.path);
    for (const sourceId of admitResearchSources(run.ledger, resolved)) {
      if (!branch.visibleSourceIds.includes(sourceId)) branch.visibleSourceIds.push(sourceId);
    }
  }
}

/**
 * Admits one evidence stage output. A claim survives only when every facet it answers belongs to
 * this branch, every support names a source visible in this branch, and every quote is located
 * exactly once in that source's stored body under that body's own hash and wholly inside one read
 * window this branch was actually handed. Anything else rejects the
 * claim with a diagnostic — the run keeps going, but the claim never enters the ledger.
 */
function admitBranchEvidence(run: DeepResearchRun, branch: ResearchBranchState, output: ResearchEvidenceOutput): void {
  const branchFacetIds = branch.facets.map((facet) => facet.facetId);
  for (const claim of output.claims) {
    if (claim.facetIds.some((facetId) => !branchFacetIds.includes(facetId))) {
      branch.diagnostics.push("claim_rejected_unknown_facet");
      run.note("claim_rejected", `Branch ${branch.branchId} claimed a facet that does not belong to it.`);
      continue;
    }
    const supports: ResearchClaimRecord["supports"] = [];
    let rejected: string | null = null;
    for (const support of claim.supports) {
      if (!branch.visibleSourceIds.includes(support.sourceId)) { rejected = "claim_rejected_invisible_source"; break; }
      const source = run.sourceById(support.sourceId);
      if (!source?.canonicalText || !source.contentHash) { rejected = "claim_rejected_source_without_body"; break; }
      const located = locateExactQuote(source.canonicalText, support.quote);
      if (!located) { rejected = "claim_rejected_quote_not_unique_verbatim"; break; }
      // The span must sit wholly inside a window this branch was handed. A quote from a passage the
      // stage was never shown is not evidence it read the source, however well it matches the body.
      const delivered = branch.readWindows?.find((entry) => entry.sourceId === support.sourceId)?.windows;
      if (!isSpanInsideWindows(delivered, located.start, located.end)) {
        rejected = "claim_rejected_quote_outside_read_window";
        break;
      }
      supports.push({ sourceId: support.sourceId, quote: located.quote, start: located.start, end: located.end, contentHash: source.contentHash });
    }
    if (rejected !== null || supports.length === 0) {
      branch.diagnostics.push(rejected ?? "claim_rejected_without_support");
      run.note("claim_rejected", `Branch ${branch.branchId} produced a claim whose support could not be confirmed (${rejected ?? "no support"}).`);
      continue;
    }
    const record: ResearchClaimRecord = {
      claimId: run.nextClaimId(), branchId: branch.branchId, text: claim.text,
      facetIds: [...claim.facetIds], supports, limitations: [...claim.limitations],
    };
    run.claims.push(record);
    branch.claimIds.push(record.claimId);
  }
  for (const text of output.gaps) {
    const gap: ResearchGapRecord = { gapId: run.nextGapId(), branchId: branch.branchId, facetIds: branchFacetIds, text };
    run.gaps.push(gap);
    branch.gapIds.push(gap.gapId);
  }
  branch.contradictions.push(...output.contradictions);
}

/**
 * What this branch will actually read, in visible-source order. The per-branch allowance is divided
 * across the sources that really have a stored body — not across the ids the plan named — and capped
 * per source, so a branch seeing one paper reads up to 12 000 characters of it and a branch seeing six
 * reads up to 6 000 of each. Windows are chosen from this branch's own question, query and facets, so
 * a follow-up over an unchanged source can legitimately be handed different passages than its parent.
 * Pure: it selects and measures, and writes nothing.
 */
function planBranchReading(run: DeepResearchRun, branch: ResearchBranchState): BranchSourceReading[] {
  const bodies = branch.visibleSourceIds.flatMap((sourceId) => {
    const source = run.sourceById(sourceId);
    return source?.canonicalText ? [{ sourceId, source, body: source.canonicalText }] : [];
  });
  if (!bodies.length) return [];
  const perSource = Math.max(1, Math.min(SOURCE_READ_CHARS, Math.floor(BRANCH_READ_CHARS / bodies.length)));
  const query = `${branch.query} ${branch.question}`;
  const facets = branch.facets.map((facet) => facet.description);
  return bodies.map(({ sourceId, source, body }) => {
    const windows = selectReadWindows(body, query, facets, perSource);
    const readChars = windows.reduce((total, window) => total + window.text.length, 0);
    return {
      sourceId, contentHash: source.contentHash, fullChars: body.length, readChars,
      excerpted: readChars < body.length, windows,
    };
  });
}

/**
 * The source view an evidence stage receives: ledger metadata plus the exact excerpt windows this
 * branch was allotted, with their character ranges in the full body. The whole canonical body is
 * deliberately not sent; `fullChars` and `readChars` state how much of it was withheld, so the stage
 * cannot mistake an excerpt for a paper it has read end to end.
 */
function evidenceSourceInputs(
  run: DeepResearchRun, reading: BranchSourceReading[],
): JsonObject[] {
  return reading.flatMap((entry) => {
    const source = run.sourceById(entry.sourceId);
    if (!source || !entry.windows.length) return [];
    return [{
      sourceId: entry.sourceId, origin: source.origin, title: source.title, authors: source.authors,
      publicationDate: source.publicationDate ?? "unknown", publicationPrecision: source.publicationPrecision,
      cutoffStatus: source.cutoffStatus, doi: source.doi, url: source.url,
      metadataOrigin: source.origin === "provided" ? "provided-unverified" : source.metadataOrigin,
      contentTruncated: source.contentTruncated, contentHash: source.contentHash,
      excerpted: entry.excerpted, fullChars: entry.fullChars, readChars: entry.readChars,
      windowCount: entry.windows.length,
      coverageNote: entry.excerpted
        ? `Excerpts only: ${entry.readChars} of ${entry.fullChars} characters of this source were supplied, as the ranges below.`
        : "The whole stored body of this source was supplied as a single window.",
      windows: entry.windows.map((window, index) => ({
        windowIndex: index + 1, start: window.start, end: window.end, chars: window.text.length, text: window.text,
      })),
    }];
  });
}

/** The read-window record: exactly what was delivered, kept apart from the full bodies in the ledger. */
function readWindowRecord(branch: ResearchBranchState, reading: BranchSourceReading[]): JsonObject {
  return {
    branchId: branch.branchId, kind: branch.kind, parentId: branch.parentId,
    question: branch.question, query: branch.query, facets: branch.facets,
    note: "The exact source excerpts this branch's evidence stage was handed, written before the stage ran. "
      + "Offsets are UTF-16 indices into the canonical body of the given contentHash, whose full text stays in the source ledger. "
      + "A quote outside every window below is not admissible for this branch.",
    budget: { perBranchChars: BRANCH_READ_CHARS, perSourceChars: SOURCE_READ_CHARS },
    totalReadChars: reading.reduce((total, entry) => total + entry.readChars, 0),
    sources: reading.map((entry) => ({ ...entry, windows: entry.windows.map((window) => ({ ...window })) })),
  };
}

/** Branch state for a snapshot: delivered window ranges without their text, which is recorded once. */
function branchSnapshot(branch: ResearchBranchState): JsonObject {
  if (branch.readWindows === undefined) return { ...branch };
  return {
    ...branch,
    readWindows: branch.readWindows.map((entry) => ({
      sourceId: entry.sourceId, contentHash: entry.contentHash, fullChars: entry.fullChars,
      readChars: entry.readChars, excerpted: entry.excerpted,
      windows: entry.windows.map((window) => ({ start: window.start, end: window.end })),
    })),
  };
}

/**
 * One branch end to end. A branch with no admitted source is a recorded failure with a real gap,
 * never an empty success. A model stage failure marks the branch failed and is remembered so the
 * run cannot finish successfully, while the remaining branches still run.
 */
async function runBranch(run: DeepResearchRun, branch: ResearchBranchState, sourceIds: string[], stageFailures: string[]): Promise<void> {
  run.guard();
  if (run.softStopped()) {
    branch.status = "skipped"; branch.reason = "time_budget_exhausted_before_branch";
    return;
  }
  run.emit("deep-research/branch-started", branch.branchId, `Investigating: ${branch.question}`);
  branch.visibleSourceIds.push(...run.admitProvided(sourceIds, branch));
  await gatherBranchSources(run, branch);
  run.guard();
  const reading = planBranchReading(run, branch);
  if (!evidenceSourceInputs(run, reading).length) {
    branch.status = "failed";
    branch.reason = "no_source_admitted";
    const gap: ResearchGapRecord = {
      gapId: run.nextGapId(), branchId: branch.branchId, facetIds: branch.facets.map((facet) => facet.facetId),
      text: `No readable source was admitted for "${branch.question}", so none of its facets could be examined.`,
    };
    run.gaps.push(gap);
    branch.gapIds.push(gap.gapId);
    run.emit("deep-research/branch-failed", branch.branchId, "No source could be admitted for this branch.");
    return;
  }
  try {
    // The delivered windows are recorded on the branch and on disk before the stage sees them, so
    // what the run later admits is checked against what was actually handed over, not against the
    // catalogue: a source can be on disk in full and still have been read only in part.
    branch.readWindows = reading;
    const record = await run.json(`branches/${branch.branchId}/read-windows.json`,
      readWindowRecord(branch, reading), "research-read-windows");
    branch.snapshots.push(record.path);
    const output = await run.stage<ResearchEvidenceOutput>(
      `deep-research-evidence-${branch.branchId}`, evidenceInstructions(run.input.language),
      {
        question: run.input.question, branchQuestion: branch.question, scope: run.input.scope,
        cutoffDate: run.input.cutoffDate, facets: branch.facets, sources: evidenceSourceInputs(run, reading),
        reading: {
          note: "Each source below is supplied as exact excerpt windows of its canonical body, not as the whole document.",
          perBranchChars: BRANCH_READ_CHARS, perSourceChars: SOURCE_READ_CHARS,
        },
      }, researchEvidenceSchema);
    run.guard();
    admitBranchEvidence(run, branch, output);
    // A branch that admitted nothing and reported no gap has not answered its facets.
    branch.status = branch.claimIds.length || branch.gapIds.length ? "completed" : "failed";
    if (branch.status === "failed") branch.reason = "no_claim_and_no_reported_gap";
  } catch (error) {
    if (error instanceof DeepResearchFailure) throw error;
    run.ctx.signal.throwIfAborted();
    branch.status = "failed";
    branch.reason = "evidence_stage_failed";
    stageFailures.push(`evidence_stage_failed:${branch.branchId}`);
    run.note("stage_failed", `The evidence stage for branch ${branch.branchId} did not complete.`);
  }
  run.emit("deep-research/branch-finished", branch.branchId,
    `${branch.status}: ${branch.claimIds.length} claim(s), ${branch.gapIds.length} gap(s).`);
  if (branch.status === "completed") {
    const checkpoint = await saveEvidenceCheckpoint(run, `branch-${branch.branchId}`);
    if (checkpoint !== null) branch.snapshots.push(checkpoint);
  }
}

/** At most two branches in flight; each worker re-checks the fence before and after every await. */
async function runBranches(
  run: DeepResearchRun, planned: Array<{ branch: ResearchBranchState; sourceIds: string[] }>, stageFailures: string[],
): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(BRANCH_CONCURRENCY, planned.length) }, async () => {
    while (next < planned.length) {
      run.guard();
      const item = planned[next++]!;
      await runBranch(run, item.branch, item.sourceIds, stageFailures);
      run.guard();
    }
  }));
}

/**
 * The single gap review of the run. It sees identifiers, recorded claims, gaps and contradictions and
 * the provided-source catalogue, never a body. A follow-up is accepted only when it points at a real
 * initial parent, at facets and gaps belonging to that parent, one per parent at most, with a query
 * this run has not already issued. No material gap, or no budget, means the review is skipped with a
 * recorded reason rather than a follow-up invented to fill the allowance.
 */
async function reviewGaps(
  run: DeepResearchRun, initial: ResearchBranchState[],
): Promise<{ planned: Array<{ branch: ResearchBranchState; sourceIds: string[] }>; skipped: string | null }> {
  const remaining = run.input.budget.maxFollowups - run.budget.followups;
  if (remaining < 1) return { planned: [], skipped: "followups_not_allowed_by_budget" };
  if (!run.gaps.length && !initial.some((branch) => branch.contradictions.length)) {
    return { planned: [], skipped: "no_material_gap_recorded" };
  }
  if (run.softStopped()) return { planned: [], skipped: "time_budget_exhausted" };
  const review = await run.stage<ResearchFollowupOutput>("deep-research-gap-review", followupInstructions(remaining), {
    question: run.input.question, scope: run.input.scope, cutoffDate: run.input.cutoffDate,
    branches: initial.map((branch) => ({
      branchId: branch.branchId, question: branch.question, query: branch.query, facets: branch.facets,
      status: branch.status, claimIds: branch.claimIds, contradictions: branch.contradictions,
    })),
    claims: run.claims.map((claim) => ({ claimId: claim.claimId, branchId: claim.branchId, text: claim.text, facetIds: claim.facetIds, limitations: claim.limitations })),
    gaps: run.gaps,
    providedSources: run.catalogue(),
    budget: { remainingFollowups: remaining, remainingResearchCalls: run.input.budget.maxResearchCalls - run.budget.researchCalls },
  }, researchFollowupSchema);
  const planned: Array<{ branch: ResearchBranchState; sourceIds: string[] }> = [];
  const parents = new Set<string>();
  for (const followup of review.followups) {
    const parent = initial.find((branch) => branch.branchId === followup.parentId);
    if (!parent) { run.note("followup_rejected", "A follow-up named a parent branch that is not an initial branch of this run."); continue; }
    if (parents.has(parent.branchId)) { run.note("followup_rejected", "A second follow-up for the same parent branch was dropped."); continue; }
    const parentFacetIds = parent.facets.map((facet) => facet.facetId);
    if (followup.facetIds.some((facetId) => !parentFacetIds.includes(facetId))) {
      run.note("followup_rejected", "A follow-up named a facet that does not belong to its parent branch."); continue;
    }
    if (followup.gapIds.some((gapId) => !parent.gapIds.includes(gapId))) {
      run.note("followup_rejected", "A follow-up named a gap that its parent branch did not record."); continue;
    }
    if (planned.length >= remaining) { run.note("followup_rejected", "A follow-up exceeded the remaining follow-up allowance."); continue; }
    if (!run.reserveQuery(followup.query)) { run.note("followup_rejected", "A follow-up repeated a query already used in this run."); continue; }
    if (!run.budget.admitBranch("followup")) { run.note("followup_rejected", "A follow-up exceeded the branch budget."); continue; }
    parents.add(parent.branchId);
    const branch: ResearchBranchState = {
      branchId: `b${run.branches.length + 1}`, kind: "followup", parentId: parent.branchId,
      question: followup.reason, query: followup.query,
      // A follow-up inherits its parent's facet identifiers; it never introduces new facets.
      facets: parent.facets.filter((facet) => followup.facetIds.includes(facet.facetId)),
      visibleSourceIds: [], claimIds: [], gapIds: [], contradictions: [],
      status: "failed", reason: null, diagnostics: [], researchCalls: 0, snapshots: [],
    };
    run.branches.push(branch);
    planned.push({ branch, sourceIds: selectedProvidedIds(run, followup.sourceIds, `Follow-up ${branch.branchId}`) });
  }
  return { planned, skipped: planned.length ? null : "no_followup_accepted" };
}

/**
 * Footnote markers only. A bracketed number is deliberately not matched: "[0, 1]" is an interval and
 * "[1,2]" a range or a pair, ordinary notation in empirical prose, and rejecting a sound draft over
 * one would be worse than letting it through. Citations are owned by each paragraph's structured
 * claim ids and by the independent verifier, not by anything the model writes into its text.
 */
const CITATION_MARKER = /\[\^[^\]]+\]/u;
const INLINE_URL = /\bhttps?:\/\/|\bwww\.\S/iu;

/**
 * The synthesis stage plus its host checks. Every cited claim must exist, and paragraph text may not
 * carry its own footnote markers or external URLs: the host owns the reference list, so a marker
 * written by the model would point at nothing. A violation fails the stage rather than being edited
 * out, because rewriting a model's prose would hide what it actually produced.
 */
async function synthesize(run: DeepResearchRun): Promise<{ title: string; paragraphs: RenderReportInput["paragraphs"] }> {
  const output = await run.stage<ResearchSynthesisOutput>("deep-research-synthesis", synthesisInstructions(run.input.language), {
    question: run.input.question, scope: run.input.scope, exclusions: run.input.exclusions,
    cutoffDate: run.input.cutoffDate, language: run.input.language,
    claims: run.claims.map((claim) => ({
      claimId: claim.claimId, branchId: claim.branchId, text: claim.text, facetIds: claim.facetIds,
      limitations: claim.limitations, supportSourceIds: claim.supports.map((support) => support.sourceId),
    })),
    sources: run.ledger.sources.filter((source) => run.claims.some((claim) => claim.supports.some((support) => support.sourceId === source.sourceId)))
      .map((source) => ({
        sourceId: source.sourceId, origin: source.origin, title: source.title, authors: source.authors,
        publicationDate: source.publicationDate ?? "unknown", cutoffStatus: source.cutoffStatus,
        metadataOrigin: source.origin === "provided" ? "provided-unverified" : source.metadataOrigin,
      })),
    // Local, per-branch observations: what one branch could not settle in the windows it was handed.
    // Another branch may have settled the same point, so these are named for what they are and the
    // prompt requires the claim ledger to be checked before anything is called unresolved.
    branchGapObservations: run.gaps.map((gap) => ({
      gapId: gap.gapId, branchId: gap.branchId, facetIds: gap.facetIds, text: gap.text,
    })),
    contradictions: run.branches.flatMap((branch) => branch.contradictions.map((text) => ({ branchId: branch.branchId, text }))),
  }, researchSynthesisSchema);
  const known = new Set(run.claims.map((claim) => claim.claimId));
  const paragraphs = output.paragraphs.map((paragraph, index) => ({
    paragraphId: `p${index + 1}`, heading: paragraph.heading, text: paragraph.text, claimIds: [...paragraph.claimIds],
  }));
  for (const paragraph of paragraphs) {
    if (paragraph.claimIds.some((claimId) => !known.has(claimId))) {
      run.note("synthesis_rejected", `Paragraph ${paragraph.paragraphId} cited a claim id that is not in the ledger.`);
      fail("synthesis_cited_unknown_claim");
    }
    if (CITATION_MARKER.test(paragraph.text) || INLINE_URL.test(paragraph.text)) {
      run.note("synthesis_rejected", `Paragraph ${paragraph.paragraphId} wrote its own citation marker or an inline URL.`);
      fail("synthesis_wrote_unregistered_citation");
    }
  }
  return { title: output.title, paragraphs };
}

/** One cited claim, exactly as admitted, listed once however many paragraphs rely on it. */
export interface VerificationClaimView {
  claimId: string;
  branchId: string;
  text: string;
  facetIds: string[];
  limitations: string[];
  /** The paragraphs that cite this claim, in document order. */
  paragraphIds: string[];
  supports: Array<{ sourceId: string; quote: string; quoteSpan: { start: number; end: number }; contentHash: string }>;
}
/** One referenced source, carrying the same provenance a per-support copy used to carry. */
export interface VerificationSourceView {
  sourceId: string;
  origin: string;
  title: string | null;
  publicationDate: string;
  cutoffStatus: string;
  metadataOrigin: string;
}
export interface VerificationEvidence {
  paragraphs: RenderReportInput["paragraphs"];
  claims: VerificationClaimView[];
  sources: VerificationSourceView[];
}
/**
 * The evidence the verifier is handed, normalized. Every paragraph is present in full with the claim
 * ids it cites; each cited claim appears once, with its text, its recorded qualifications and every
 * support quote, span and hash; each source a support names appears once with its provenance. The
 * verifier resolves the references by id, which is the same evidence the per-paragraph shape carried
 * while repeating a claim quoted by four paragraphs four times and a source's provenance once per
 * support — a run whose draft cites 51 claims across 90 citations spent most of its request on those
 * copies. Nothing is summarised or dropped to achieve it: no canonical body was ever included and is
 * not now, an uncited claim is not part of what the report says and is not sent, and a reference that
 * cannot be resolved fails the run rather than quietly leaving a paragraph without its evidence.
 * Pure, and deterministic in first-cited order.
 */
export function buildVerificationEvidence(
  paragraphs: RenderReportInput["paragraphs"],
  claims: ResearchClaimRecord[],
  sources: Array<Pick<LedgerSource, "sourceId" | "origin" | "title" | "publicationDate" | "cutoffStatus" | "metadataOrigin">>,
): VerificationEvidence {
  const claimById = new Map(claims.map((claim) => [claim.claimId, claim]));
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const cited = new Map<string, VerificationClaimView>();
  const referenced = new Map<string, VerificationSourceView>();
  const views = paragraphs.map((paragraph) => ({
    paragraphId: paragraph.paragraphId, heading: paragraph.heading, text: paragraph.text,
    claimIds: [...paragraph.claimIds],
  }));
  for (const paragraph of views) {
    for (const claimId of paragraph.claimIds) {
      const known = cited.get(claimId);
      if (known !== undefined) {
        if (!known.paragraphIds.includes(paragraph.paragraphId)) known.paragraphIds.push(paragraph.paragraphId);
        continue;
      }
      const claim = claimById.get(claimId) ?? fail("verification_evidence_missing_claim");
      cited.set(claimId, {
        claimId, branchId: claim.branchId, text: claim.text, facetIds: [...claim.facetIds],
        limitations: [...claim.limitations], paragraphIds: [paragraph.paragraphId],
        supports: claim.supports.map((support) => ({
          sourceId: support.sourceId, quote: support.quote,
          quoteSpan: { start: support.start, end: support.end }, contentHash: support.contentHash,
        })),
      });
      for (const support of claim.supports) {
        if (referenced.has(support.sourceId)) continue;
        const source = sourceById.get(support.sourceId) ?? fail("verification_evidence_missing_source");
        referenced.set(support.sourceId, {
          sourceId: source.sourceId, origin: source.origin, title: source.title,
          publicationDate: source.publicationDate ?? "unknown", cutoffStatus: source.cutoffStatus,
          metadataOrigin: source.origin === "provided" ? "provided-unverified" : source.metadataOrigin,
        });
      }
    }
  }
  return { paragraphs: views, claims: [...cited.values()], sources: [...referenced.values()] };
}

/**
 * One passage a completed evidence stage was actually handed, listed once for the whole run. `text` is
 * exactly `body.slice(start, end)` of the canonical body whose hash is `contentHash`, so a support
 * quote's own span still lands inside it unchanged, and `fullChars` states how large that body is, so
 * the windows for one source are never mistaken for the whole of it.
 */
export interface SourceContextEntry {
  contextId: string;
  sourceId: string;
  contentHash: string;
  start: number;
  end: number;
  chars: number;
  fullChars: number;
  text: string;
  /** Every completed branch this exact window was delivered to, in branch order. */
  readByBranchIds: string[];
}

/**
 * The passages this run actually delivered to its evidence stages, unchanged, so a later stage judges
 * a claim against the source text an extractor read rather than against the short quote it chose. A
 * quote is a citation: it is allowed not to repeat the method, the sample size or the condition the
 * same window states, and a verifier shown only the quote has been rejecting details that were in fact
 * read. Nothing here is new evidence — no source is re-read, no passage is selected afresh and no text
 * is ever manufactured or reflowed.
 *
 * Only `completed` branches contribute: what a failed or skipped branch was allotted was never turned
 * into admitted evidence. Every window is re-derived from the stored body before it is emitted — the
 * source must exist and have a body, the reading's hash must equal the source's hash and that hash must
 * equal the hash of the body itself, the offsets must be whole characters inside that body, and the
 * recorded text must be the exact slice — and any mismatch fails the run instead of shipping a passage
 * whose provenance no longer holds. Identical windows delivered to several branches appear once with
 * every reader named; `sourceIds`, when given, keeps the catalogue to the sources a payload is about.
 * Pure, and deterministic in first-delivered order.
 */
export function buildSourceContextCatalog(
  branches: Array<Pick<ResearchBranchState, "branchId" | "status" | "readWindows">>,
  sources: Array<Pick<LedgerSource, "sourceId" | "canonicalText" | "contentHash">>,
  sourceIds?: readonly string[],
): SourceContextEntry[] {
  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const wanted = sourceIds === undefined ? null : new Set(sourceIds);
  const delivered = new Map<string, SourceContextEntry>();
  for (const branch of branches) {
    if (branch.status !== "completed") continue;
    for (const reading of branch.readWindows ?? []) {
      if (wanted !== null && !wanted.has(reading.sourceId)) continue;
      const source = sourceById.get(reading.sourceId) ?? fail("source_context_unknown_source");
      const body = source.canonicalText ?? fail("source_context_source_without_body");
      const contentHash = source.contentHash ?? fail("source_context_source_without_body");
      if (reading.contentHash !== contentHash || contentHash !== sha256(body)) fail("source_context_hash_mismatch");
      for (const window of reading.windows) {
        if (!Number.isSafeInteger(window.start) || !Number.isSafeInteger(window.end)
          || window.start < 0 || window.end <= window.start || window.end > body.length) {
          fail("source_context_window_out_of_bounds");
        }
        if (body.slice(window.start, window.end) !== window.text) fail("source_context_window_text_mismatch");
        const key = JSON.stringify([reading.sourceId, contentHash, window.start, window.end]);
        const known = delivered.get(key);
        if (known !== undefined) {
          if (!known.readByBranchIds.includes(branch.branchId)) known.readByBranchIds.push(branch.branchId);
          continue;
        }
        delivered.set(key, {
          contextId: "", sourceId: reading.sourceId, contentHash,
          start: window.start, end: window.end, chars: window.text.length, fullChars: body.length,
          text: window.text, readByBranchIds: [branch.branchId],
        });
      }
    }
  }
  return [...delivered.values()].map((entry, index) => ({ ...entry, contextId: `w${index + 1}` }));
}

/**
 * The one note that says what a source context is and what it is not, written once so the verification,
 * the re-verification and the revision are all told the same thing.
 */
const SOURCE_CONTEXT_NOTE =
  "The actual excerpt windows this run's completed evidence stages were handed for these sources, each "
  + "listed once with the branches it was delivered to. Join an entry to a support by sourceId and "
  + "contentHash; offsets are UTF-16 indices into the canonical body of that hash, so every support "
  + "quote still sits exactly where its quoteSpan says. Read these windows as source text: a claim's "
  + "own text and its limitations stay an earlier stage's untrusted summary, and it is this context, not "
  + "that summary, that settles a detail a short quote leaves out. The windows are a selection, not a "
  + "whole source, and they may overlap, so only the actual start and end ranges establish what was "
  + "covered: do not infer whole-source coverage from summed lengths. Material outside the supplied "
  + "ranges was not assessed, so something absent from them is unread material, never proof that the "
  + "whole paper lacks the evidence, nor that the source or the wider literature does not contain it.";

/**
 * The independent verification stage: every paragraph, the claims it cites with their quotes and
 * provenance, the exact source passages the completed evidence stages read for those sources, the whole
 * facet inventory and every branch's own gap observations, each of which the verifier must reconcile
 * against the complete cited evidence rather than read as an absence in the corpus. The inputs are
 * written before the stage is asked for a verdict, so a stage that times out still leaves behind
 * exactly what it was given.
 *
 * `recheck` re-verifies a revised draft under its own stage id and its own input artifact: it is a
 * fresh full pass over every paragraph and every facet, judged by the same instructions, never a
 * review of the diff and never an inheritance of the first pass's verdicts.
 */
async function verify(
  run: DeepResearchRun, paragraphs: RenderReportInput["paragraphs"], recheck = false,
): Promise<ResearchVerificationOutput> {
  const evidence = buildVerificationEvidence(paragraphs, run.claims, run.ledger.sources);
  const inputs = {
    question: run.input.question, scope: run.input.scope, cutoffDate: run.input.cutoffDate,
    paragraphs: evidence.paragraphs, claims: evidence.claims, sources: evidence.sources,
    // Only the sources this draft actually cites: a passage read for a source no cited support names
    // is not part of what the report stands on.
    sourceContexts: buildSourceContextCatalog(
      run.branches, run.ledger.sources, evidence.sources.map((source) => source.sourceId)),
    facets: run.facetInventory(),
    branchGapObservations: run.gaps.map((gap) => ({
      gapId: gap.gapId, branchId: gap.branchId, facetIds: gap.facetIds, text: gap.text,
    })),
    notes: {
      claims: "One entry per claim the draft cites; resolve a paragraph's claimIds against it. A claim several paragraphs cite appears once and lists every one of them in paragraphIds.",
      sources: "One entry per source a cited support names; resolve a support's sourceId against it. Provided-file metadata is the caller's unverified claim.",
      sourceContexts: SOURCE_CONTEXT_NOTE,
      branchGapObservations: "What one branch could not settle from the excerpt windows it was handed. A local observation about that branch's reading, never a finding that the material does not exist.",
    },
  };
  await run.json(
    recheck ? "verification-recheck-input.json" : "verification-input.json", inputs,
    recheck ? "research-verification-recheck-input" : "research-verification-input",
  );
  return run.stage<ResearchVerificationOutput>(
    recheck ? VERIFICATION_RECHECK_STAGE_ID : VERIFICATION_STAGE_ID,
    verificationInstructions(), inputs, researchVerificationSchema,
  );
}

export interface RevisionEligibility {
  eligible: boolean;
  /** Why no revision was attempted, or null when one is. */
  reason: string | null;
  /** The paragraphs the verifier did not clear, in document order. */
  targetParagraphIds: string[];
}
/**
 * Whether this run may spend one bounded repair on the draft it has. A revision is offered only for
 * the failure it can actually address: paragraphs the verifier judged unverified, and the issues it
 * listed against them. Every other reason disqualifies the draft outright — a duplicated, unknown or
 * omitted paragraph or facet verdict, a report with no covered facet or no cited claim, and an
 * earlier stage that failed all mean the run does not have a trustworthy assessment to repair
 * against, and rewriting prose would not make one. Passing `check.reasons` through this filter is
 * also what makes the rest of the check's guarantees usable: once the only reasons are
 * `paragraph_unverified` and `verifier_issues`, the membership, coverage and cited-claim checks are
 * known to have held for this verdict.
 *
 * Two model stages must be left, the revision and its full re-verification, because a repair that
 * cannot be verified again is worse than none. Pure.
 */
export function canReviseResearch(input: {
  verification: ResearchVerificationOutput;
  check: VerificationCheck;
  /** Every paragraph of the draft, in document order. */
  paragraphIds: string[];
  stageFailures: string[];
  remainingModelStages: number;
  softStopped: boolean;
}): RevisionEligibility {
  const REPAIRABLE = ["paragraph_unverified", "verifier_issues"];
  const none = (reason: string): RevisionEligibility => ({ eligible: false, reason, targetParagraphIds: [] });
  if (input.stageFailures.length) return none("earlier_stage_failed");
  if (input.check.ok) return none("verification_passed");
  if (input.check.reasons.some((reason) => !REPAIRABLE.includes(reason))) return none("verification_not_repairable");
  const unverified = new Set(input.verification.paragraphs
    .filter((entry) => entry.verdict !== "supported").map((entry) => entry.paragraphId));
  const targetParagraphIds = input.paragraphIds.filter((paragraphId) => unverified.has(paragraphId));
  if (!targetParagraphIds.length) return none("no_unverified_paragraph");
  if (input.remainingModelStages < 2) return none("model_stage_budget_insufficient");
  if (input.softStopped) return none("time_budget_exhausted");
  return { eligible: true, reason: null, targetParagraphIds };
}

/**
 * Substitutes the revised bodies into the draft. Every targeted paragraph must be updated exactly
 * once and nothing else may be touched: an update for a paragraph the host did not flag, a second
 * update for the same paragraph, a targeted paragraph left out, a claim id that is not in the ledger
 * or a body carrying its own citation marker or URL rejects the whole revision rather than being
 * partially applied or edited into shape. Headings, order and paragraph ids are the host's and are
 * copied verbatim, as is every untargeted paragraph; only text and claimIds can change. Pure, and
 * fails closed.
 */
export function applyResearchRevision(
  paragraphs: RenderReportInput["paragraphs"],
  revision: ResearchRevisionOutput,
  allowedParagraphIds: string[],
  knownClaimIds: string[],
): RenderReportInput["paragraphs"] {
  const drafted = new Set(paragraphs.map((paragraph) => paragraph.paragraphId));
  const allowed = new Set(allowedParagraphIds.filter((paragraphId) => drafted.has(paragraphId)));
  if (allowed.size !== allowedParagraphIds.length) fail("revision_target_not_in_draft");
  const known = new Set(knownClaimIds);
  const updates = new Map<string, ResearchRevisionOutput["updates"][number]>();
  for (const update of revision.updates) {
    if (!allowed.has(update.paragraphId)) {
      fail(drafted.has(update.paragraphId) ? "revision_touched_unflagged_paragraph" : "revision_unknown_paragraph");
    }
    if (updates.has(update.paragraphId)) fail("revision_duplicate_paragraph");
    if (trimmed(update.text) === null) fail("revision_blank_paragraph");
    if (new Set(update.claimIds).size !== update.claimIds.length) fail("revision_duplicate_claim");
    if (update.claimIds.some((claimId) => !known.has(claimId))) fail("revision_cited_unknown_claim");
    if (CITATION_MARKER.test(update.text) || INLINE_URL.test(update.text)) {
      fail("revision_wrote_unregistered_citation");
    }
    updates.set(update.paragraphId, update);
  }
  if (updates.size !== allowed.size) fail("revision_omitted_target_paragraph");
  return paragraphs.map((paragraph) => {
    const update = updates.get(paragraph.paragraphId);
    return update === undefined
      ? { ...paragraph, claimIds: [...paragraph.claimIds] }
      : {
        paragraphId: paragraph.paragraphId, heading: paragraph.heading,
        text: update.text, claimIds: [...update.claimIds],
      };
  });
}

/**
 * What the revision stage is handed: the whole draft for context with the ids it may rewrite, the
 * first pass's per-paragraph verdicts and issues, and the complete claim ledger — not just the
 * claims already cited, because attaching an existing claim that was overlooked is one of the three
 * repairs — each with its quotes, spans, hashes and recorded limitations, plus one entry per source
 * those supports name with the same provenance the verifier sees and the exact passages the completed
 * evidence stages read for those sources. No canonical body is included: a repair works from the quotes
 * that were actually admitted and the passages that were actually delivered, and nothing here licenses
 * new retrieval.
 */
function revisionInputs(
  run: DeepResearchRun, title: string, paragraphs: RenderReportInput["paragraphs"],
  verification: ResearchVerificationOutput, targetParagraphIds: string[],
): JsonObject {
  const sources = new Map<string, VerificationSourceView>();
  const claims = run.claims.map((claim) => {
    for (const support of claim.supports) {
      if (sources.has(support.sourceId)) continue;
      const source = run.sourceById(support.sourceId) ?? fail("revision_inputs_missing_source");
      sources.set(support.sourceId, {
        sourceId: source.sourceId, origin: source.origin, title: source.title,
        publicationDate: source.publicationDate ?? "unknown", cutoffStatus: source.cutoffStatus,
        metadataOrigin: source.origin === "provided" ? "provided-unverified" : source.metadataOrigin,
      });
    }
    return {
      claimId: claim.claimId, branchId: claim.branchId, text: claim.text, facetIds: [...claim.facetIds],
      limitations: [...claim.limitations],
      supports: claim.supports.map((support) => ({
        sourceId: support.sourceId, quote: support.quote,
        quoteSpan: { start: support.start, end: support.end }, contentHash: support.contentHash,
      })),
    };
  });
  return {
    question: run.input.question, scope: run.input.scope, cutoffDate: run.input.cutoffDate,
    language: run.input.language, title,
    paragraphs: paragraphs.map((paragraph) => ({
      paragraphId: paragraph.paragraphId, heading: paragraph.heading, text: paragraph.text,
      claimIds: [...paragraph.claimIds],
    })),
    targetParagraphIds: [...targetParagraphIds],
    verification: {
      paragraphs: verification.paragraphs.map((entry) => ({ ...entry })),
      issues: [...verification.issues],
    },
    claims, sources: [...sources.values()],
    // Every source the whole ledger's supports name, because any admitted claim may be attached here.
    sourceContexts: buildSourceContextCatalog(run.branches, run.ledger.sources, [...sources.keys()]),
    notes: {
      targetParagraphIds: "Return exactly one update for each of these paragraph ids and none for any other. Every other paragraph, and every heading, position and title, is kept by the host.",
      claims: "The complete ledger of admitted claims, cited or not. Resolve a claimId against it; a claim not listed here does not exist for this stage, and no further research is possible.",
      sources: "One entry per source a claim support names. Provided-file metadata is the caller's unverified claim.",
      sourceContexts: SOURCE_CONTEXT_NOTE,
    },
  };
}

interface RunOutcome {
  paragraphs: RenderReportInput["paragraphs"];
  title: string;
  verification: ResearchVerificationOutput | null;
  check: VerificationCheck | null;
  stageFailures: string[];
  followupSkipped: string | null;
  /** The claims the draft actually cites and the sources their supports name. */
  citedClaimIds: string[];
  citedSourceIds: string[];
  /** The run's global gap list, filled in once verification has been judged. */
  globalGaps: RenderReportInput["gaps"];
  /**
   * The one bounded repair attempt, recorded in the run summary only. It says what was rewritten or
   * why nothing was; the published result keeps reporting the verification that actually stands.
   */
  revision: { attempted: boolean; targetParagraphIds: string[]; skipReason: string | null };
}

/**
 * What the report itself stands on: the admitted claims its paragraphs cite and the sources those
 * claims quote, deduplicated in first-cited order. A claim admitted elsewhere in the run but cited
 * nowhere in the draft is part of the catalogue, not part of what the report says, so the published
 * counts are taken from here rather than from every ledger entry.
 */
function citedEvidence(
  run: DeepResearchRun, paragraphs: RenderReportInput["paragraphs"],
): { claimIds: string[]; sourceIds: string[] } {
  const claimById = new Map(run.claims.map((claim) => [claim.claimId, claim]));
  const claimIds: string[] = [];
  const sourceIds: string[] = [];
  for (const paragraph of paragraphs) {
    for (const claimId of paragraph.claimIds) {
      const claim = claimById.get(claimId);
      if (claim === undefined || claimIds.includes(claimId)) continue;
      claimIds.push(claimId);
      for (const support of claim.supports) {
        if (!sourceIds.includes(support.sourceId)) sourceIds.push(support.sourceId);
      }
    }
  }
  return { claimIds, sourceIds };
}

/**
 * The gaps this run leaves open globally, which is a different question from what any one branch
 * could not settle in the windows it was handed. A branch observation is local: another branch may
 * have answered the same point, so those observations are kept in the evidence artifacts and are not
 * republished here as unresolved. What is global is a facet the independent verifier judged a gap
 * after reading the whole draft, and a branch that never completed, whose share of the question was
 * therefore never investigated at all.
 *
 * The verifier's judgement is the only thing that can say a facet is covered, so when verification is
 * absent or did not clear its own membership and coverage checks, this list is explicitly incomplete
 * rather than short: an empty facet-gap list from a stage that never returned means nothing was
 * assessed, not that nothing is open. Pure.
 */
export function globalGaps(
  branches: Array<Pick<ResearchBranchState, "branchId" | "facets" | "status" | "reason">>,
  verification: Pick<ResearchVerificationOutput, "facetCoverage"> | null,
  check: Pick<VerificationCheck, "ok" | "reasons"> | null,
): RenderReportInput["gaps"] {
  const gaps: RenderReportInput["gaps"] = [];
  for (const facet of verification?.facetCoverage ?? []) {
    if (facet.status !== "gap") continue;
    const description = branches.flatMap((branch) => branch.facets).find((candidate) => candidate.facetId === facet.facetId)?.description;
    gaps.push({ label: `${facet.facetId}${description ? ` (${description})` : ""}`, reason: facet.reason });
  }
  if (verification === null || check === null || !check.ok) {
    const why = verification === null
      ? "the independent verification stage did not return a coverage assessment"
      : `the verification returned did not pass the host's own checks (${(check?.reasons ?? ["not_checked"]).join(", ") || "unknown"})`;
    gaps.push({
      label: "coverage-assessment-incomplete",
      reason: `Which facets this run actually settled was never established, because ${why}. Treat the gaps listed here as incomplete rather than as the full set, and the branch reading observations in the evidence appendix as unreviewed.`,
    });
  }
  for (const branch of branches) {
    if (branch.status !== "completed") gaps.push({ label: branch.branchId, reason: `Branch not completed: ${branch.reason ?? "unknown reason"}.` });
  }
  return gaps;
}

/** The one global gap list this run publishes, wherever it is published. */
function runGlobalGaps(run: DeepResearchRun, outcome: RunOutcome): RenderReportInput["gaps"] {
  return globalGaps(run.branches, outcome.verification, outcome.check);
}

/**
 * The immutable evidence artifacts, written for a failing run as well as a successful one so a
 * partial result stays inspectable. The report itself is written by the caller of this function,
 * as `report.md` only when verification actually cleared it.
 */
async function persistEvidence(run: DeepResearchRun, outcome: RunOutcome, status: string): Promise<{
  sourcesPath: string; claimsPath: string; researchTreePath: string; runSummaryPath: string;
}> {
  const globalGapList = runGlobalGaps(run, outcome);
  const sources = await run.json("sources.json", {
    cutoffDate: run.ledger.cutoffDate,
    provenanceLabels: {
      provided: "Metadata parsed locally from the caller's own file text; unverified.",
      dateUnknown: "cutoffStatus \"unknown\" means the publication date could not be resolved, not that it is within the cutoff.",
      identity: "A source entry records what was supplied or returned. It does not prove the source is authentic or that a claim it supports is true.",
    },
    sources: run.ledger.sources, diagnostics: run.ledger.diagnostics,
  }, "research-sources");
  const claims = await run.json("claims.json", {
    note: "Claim-to-source map. Each support quotes its source verbatim at the recorded UTF-16 span of the body whose hash is given, and that span lay wholly inside a read window its branch was handed.",
    gapNote: "The gaps below are local branch reading observations: what one branch could not settle from the excerpt windows it was handed. They are not necessarily unresolved for the run — another branch may have settled the same point, and one of them being listed here never means the material does not exist. The run's global gap list is unresolvedGaps in run-summary.json.",
    claims: run.claims, gaps: run.gaps,
    contradictions: run.branches.flatMap((branch) => branch.contradictions.map((text) => ({ branchId: branch.branchId, text }))),
  }, "research-claims");
  const tree = await run.json("research-tree.json", {
    question: run.input.question,
    branches: run.branches.map(branchSnapshot),
    followupReview: { skipped: outcome.followupSkipped },
  }, "research-tree");
  const summary = await run.json("run-summary.json", {
    status, question: run.input.question, scope: run.input.scope, exclusions: run.input.exclusions,
    cutoffDate: run.input.cutoffDate, language: run.input.language,
    inputManifest: run.planning.map((view) => ({ sourceId: view.sourceId, path: view.path, bytes: view.bytes, readable: view.readable })),
    inputHashes: run.ledger.sources.filter((source) => source.origin === "provided")
      .map((source) => ({ sourceId: source.sourceId, path: source.providedPath, sha256: source.expectedSha256, contentHash: source.contentHash })),
    budget: run.budget.usage(),
    branchCount: run.branches.length,
    // How much of each source a branch actually saw. A source can be catalogued and stored in full
    // here while only part of it was ever delivered to a stage, so the two counts stay separate.
    sourceReading: {
      perBranchChars: BRANCH_READ_CHARS, perSourceChars: SOURCE_READ_CHARS,
      note: "Every evidence stage was handed exact excerpt windows of a source body, never the whole body when it exceeded the allowance. Full bodies and their hashes stay in sources.json; the delivered window text is in each branch's read-windows.json.",
      branches: run.branches.filter((branch) => branch.readWindows !== undefined).map((branch) => ({
        branchId: branch.branchId,
        sources: (branch.readWindows ?? []).map((entry) => ({
          sourceId: entry.sourceId, fullChars: entry.fullChars, readChars: entry.readChars,
          excerpted: entry.excerpted, windowCount: entry.windows.length,
        })),
      })),
    },
    citedClaimCount: outcome.citedClaimIds.length, citedSourceCount: outcome.citedSourceIds.length,
    citedClaimIds: [...outcome.citedClaimIds], citedSourceIds: [...outcome.citedSourceIds],
    // The one global gap list, and separately how many local branch reading observations exist. The
    // two are never added together: an observation is about one branch's excerpts, not about the run.
    unresolvedGaps: globalGapList,
    unresolvedGapCount: globalGapList.length,
    branchGapObservationCount: run.gaps.length,
    gapNote: "unresolvedGaps is what this run leaves open globally: the facets the independent verifier judged gaps, the branches that never completed, and an explicit entry when coverage was never assessed. branchGapObservationCount counts the per-branch reading observations recorded in claims.json, which are not necessarily unresolved for the run.",
    // Catalogue totals: what the run admitted anywhere, which the report's own counts never use.
    admittedClaimCount: run.claims.length, catalogueSourceCount: run.ledger.sources.length,
    verification: outcome.verification, verificationCheck: outcome.check,
    // The verification recorded above is the one that stands. When a revision ran, the first pass
    // and its check stay in verification-initial.json and the rewritten bodies in draft-revised.json.
    revision: {
      attempted: outcome.revision.attempted,
      targetParagraphIds: [...outcome.revision.targetParagraphIds],
      skipReason: outcome.revision.skipReason,
      note: "At most one repair of the paragraphs the first verification did not clear, followed by a full independent re-verification of the whole draft.",
    },
    stageFailures: outcome.stageFailures, retrievalIssues: run.issues, diagnostics: run.diagnostics,
    labels: {
      providedMetadata: "unverified caller claims parsed locally from each provided file",
      sourceIdentity: "source identity is not proof that a supported claim is true",
    },
    upstream: {
      inspiration: GPT_RESEARCHER_URL, commit: GPT_RESEARCHER_COMMIT, license: GPT_RESEARCHER_LICENSE,
      note: "Approach reference only: no upstream Python is imported or executed, and this workflow is not a port of that project.",
    },
  }, "research-run-summary");
  return { sourcesPath: sources.path, claimsPath: claims.path, researchTreePath: tree.path, runSummaryPath: summary.path };
}

/** The whole investigation. Raced against the hard deadline by the caller. */
async function pipeline(run: DeepResearchRun): Promise<{ outcome: RunOutcome; reportPath: string; paths: Awaited<ReturnType<typeof persistEvidence>> }> {
  const outcome: RunOutcome = {
    paragraphs: [], title: "", verification: null, check: null, stageFailures: [], followupSkipped: null,
    citedClaimIds: [], citedSourceIds: [], globalGaps: [],
    revision: { attempted: false, targetParagraphIds: [], skipReason: null },
  };
  await run.loadProvidedSources();
  await run.json("input-manifest.json", {
    question: run.input.question, scope: run.input.scope, exclusions: run.input.exclusions,
    cutoffDate: run.input.cutoffDate, language: run.input.language, budget: { ...run.input.budget },
    requestedPaths: run.input.inputPaths,
    provided: run.planning.map((view) => ({
      sourceId: view.sourceId, path: view.path, title: view.title, authors: view.authors,
      publicationDate: view.publicationDate, bytes: view.bytes, readable: view.readable,
      sha256: run.sourceById(view.sourceId)?.expectedSha256 ?? null,
    })),
    note: "Provided metadata is the caller's unverified claim, parsed locally from each file's own text.",
  }, "research-input-manifest");
  const planned = await planResearch(run);
  await runBranches(run, planned, outcome.stageFailures);
  const initial = run.branches.filter((branch) => branch.kind === "initial");
  const review = await reviewGaps(run, initial);
  outcome.followupSkipped = review.skipped;
  if (review.planned.length) await runBranches(run, review.planned, outcome.stageFailures);
  await saveEvidenceCheckpoint(run, "gap-review");
  run.guard();
  if (!run.claims.length) {
    const paths = await persistEvidence(run, outcome, "failed_no_admitted_claim");
    run.note("run_failed", `No claim survived admission; evidence is preserved in ${paths.claimsPath}.`);
    fail("no_admitted_claim");
  }
  const drafted = await synthesize(run);
  outcome.title = drafted.title;
  outcome.paragraphs = drafted.paragraphs;
  let cited = citedEvidence(run, drafted.paragraphs);
  outcome.citedClaimIds = cited.claimIds;
  outcome.citedSourceIds = cited.sourceIds;
  run.note("cited_evidence", `The draft cites ${cited.claimIds.length} of ${run.claims.length} admitted claim(s), drawing on ${cited.sourceIds.length} of ${run.ledger.sources.length} catalogued source(s).`);
  await run.json("draft.json", { title: drafted.title, paragraphs: drafted.paragraphs }, "research-draft");
  await saveEvidenceCheckpoint(run, "synthesis");
  let verification = await verify(run, drafted.paragraphs);
  let check = checkVerification(verification, drafted.paragraphs.map((paragraph) => paragraph.paragraphId), run.facetIds(), cited.claimIds.length);
  outcome.verification = verification;
  outcome.check = check;
  // The first pass is pinned before any repair is attempted, so what the verifier said about the
  // drafted text survives whatever the revision does, including a revision that fails the run.
  await run.json("verification-initial.json", { verification, check }, "research-verification-initial");
  const eligibility = canReviseResearch({
    verification, check, paragraphIds: drafted.paragraphs.map((paragraph) => paragraph.paragraphId),
    stageFailures: outcome.stageFailures, remainingModelStages: run.budget.remainingModelStages(),
    softStopped: run.softStopped(),
  });
  outcome.revision.skipReason = eligibility.reason;
  if (eligibility.eligible) {
    // One attempt, never a loop: the repaired draft is re-verified in full and that verdict stands,
    // so a revision that does not clear the draft fails the run exactly as an unrepaired one does.
    outcome.revision.attempted = true;
    outcome.revision.targetParagraphIds = eligibility.targetParagraphIds;
    const inputs = revisionInputs(run, drafted.title, drafted.paragraphs, verification, eligibility.targetParagraphIds);
    await run.json("revision-input.json", inputs, "research-revision-input");
    const revised = await run.stage<ResearchRevisionOutput>(
      REVISION_STAGE_ID, revisionInstructions(run.input.language), inputs, researchRevisionSchema);
    await run.json("revision-output.json", revised, "research-revision-output");
    const paragraphs = applyResearchRevision(
      drafted.paragraphs, revised, eligibility.targetParagraphIds, run.claims.map((claim) => claim.claimId));
    outcome.paragraphs = paragraphs;
    await run.json("draft-revised.json", { title: drafted.title, paragraphs }, "research-draft-revised");
    run.note("revision_applied", `One bounded revision rewrote ${eligibility.targetParagraphIds.length} unverified paragraph(s); the whole draft is then verified again independently.`);
    cited = citedEvidence(run, paragraphs);
    outcome.citedClaimIds = cited.claimIds;
    outcome.citedSourceIds = cited.sourceIds;
    verification = await verify(run, paragraphs, true);
    check = checkVerification(verification, paragraphs.map((paragraph) => paragraph.paragraphId), run.facetIds(), cited.claimIds.length);
    outcome.verification = verification;
    outcome.check = check;
  }
  outcome.globalGaps = runGlobalGaps(run, outcome);
  const verified = check.ok && outcome.stageFailures.length === 0;
  const paths = await persistEvidence(run, outcome, verified ? "completed" : "failed_verification");
  const report = renderResearchReport({
    title: outcome.title, language: run.input.language, paragraphs: outcome.paragraphs,
    claims: run.claims, sources: run.ledger.sources, gaps: outcome.globalGaps,
    appendixPath: paths.claimsPath, coveragePath: paths.runSummaryPath, treePath: paths.researchTreePath,
    verified,
  });
  if (!verified) {
    const partial = await run.trySave("report.partial.md", report, "text/markdown", "research-report-partial");
    run.note("run_failed", `Verification did not clear the draft (${[...check.reasons, ...outcome.stageFailures].join(", ")}); the partial report is at ${partial ?? "an unwritten path"}.`);
    await run.trySave("verification.json", jsonText({ verification, check, stageFailures: outcome.stageFailures }), "application/json", "research-verification");
    fail(check.ok ? "stage_failed_before_completion" : "verification_incomplete");
  }
  await run.json("verification.json", { verification, check }, "research-verification");
  const published = await run.save("report.md", report, "text/markdown", "research-report");
  return { outcome, reportPath: published.path, paths };
}

export const deepResearchDefinition = definition as WorkflowDefinition;

/**
 * Entry point. The whole pipeline is raced against one hard wall-clock deadline whose timer marks the
 * run expired before it rejects, so every fenced await refuses to write, admit or claim anything
 * afterwards. A failure re-throws a generic code; artifacts already registered with the host stay
 * registered, and no incomplete run returns a result envelope.
 */
export async function runDeepResearch(rawInput: unknown, ctx: WorkflowContext) {
  const input = parseDeepResearchInput(rawInput);
  const run = new DeepResearchRun(ctx, input);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        run.expired = true;
        reject(new DeepResearchFailure("deadline_exceeded"));
      }, input.budget.maxDurationMs);
      timer.unref?.();
    });
    const { outcome, reportPath, paths } = await Promise.race([pipeline(run), deadline]);
    return {
      summary: `Investigated "${input.question}" across ${run.branches.length} research branch(es): ` +
        `the report cites ${outcome.citedClaimIds.length} source-supported claim(s) drawn from ` +
        `${outcome.citedSourceIds.length} source(s), ${outcome.globalGaps.length} unresolved gap(s) after ` +
        `independent verification, from ${run.gaps.length} per-branch reading observation(s). ` +
        "Provided-file metadata remains an unverified caller claim.",
      artifacts: run.artifacts,
      issues: [...run.issues, ...run.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`)],
      data: {
        status: "completed" as const, question: input.question, reportPath,
        sourcesPath: paths.sourcesPath, claimsPath: paths.claimsPath,
        researchTreePath: paths.researchTreePath, runSummaryPath: paths.runSummaryPath,
        branchCount: run.branches.length,
        // Only what the report actually cites; the catalogue totals stay in the run summary.
        sourceCount: outcome.citedSourceIds.length, claimCount: outcome.citedClaimIds.length,
        // The same global list the report and the run summary publish, never the per-branch
        // observations: those stay in claims.json, counted separately in run-summary.json, and the
        // declared output schema admits no extra field here.
        unresolvedGaps: outcome.globalGaps.map((gap) => `${gap.label}: ${gap.reason}`),
      },
    };
  } catch (error) {
    // The run stops here for everyone before anything else: late branch work must not write or admit
    // anything, and cancellation must never wait on a closeout write. No final write is attempted on
    // this path — the sequenced branch/stage checkpoints already on disk are the record of what was
    // admitted, and any artifact already registered with the host stays registered.
    run.stopped = true;
    if (error instanceof DeepResearchFailure) throw error;
    ctx.signal.throwIfAborted();
    run.note("run_failed", "The run ended with an unexpected error; see the persisted evidence artifacts.");
    throw new DeepResearchFailure("run_failed");
  } finally {
    clearTimeout(timer);
  }
}

export const deepResearchWorkflow = defineWorkflow({ definition: deepResearchDefinition, run: runDeepResearch });
