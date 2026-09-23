import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyResearchRevision, buildSourceContextCatalog, buildVerificationEvidence, canReviseResearch,
  checkVerification, globalGaps, locateExactQuote, ResearchBudget,
} from "../workflows/deep-research.js";

/** Only the fields these helpers read; the casts keep the fixtures to that much. */
type Verification = Parameters<typeof checkVerification>[0];
type Limits = ConstructorParameters<typeof ResearchBudget>[0];

const QUOTE = "sleep restriction reduced n-back accuracy by nine percent";
const verification = (overrides: Record<string, unknown> = {}) => ({
  paragraphs: [{ paragraphId: "p1", verdict: "supported" }, { paragraphId: "p2", verdict: "supported" }],
  facetCoverage: [{ facetId: "f1", status: "covered" }, { facetId: "f2", status: "gap", reason: "no trial reported it" }],
  issues: [], ...overrides,
} as unknown as Verification);
const check = (overrides?: Record<string, unknown>, citedClaims = 1) =>
  checkVerification(verification(overrides), ["p1", "p2"], ["f1", "f2"], citedClaims);
const limits = (overrides: Partial<Record<string, number>> = {}) => ({
  maxBranches: 2, maxFollowups: 1, maxModelStages: 1, maxResearchCalls: 1, maxExtractUrls: 3, ...overrides,
} as unknown as Limits);

describe("locateExactQuote", () => {
  it("returns the single span of an exact quote and nothing for a missing or repeated one", () => {
    const body = `Methods paragraph. ${QUOTE} Discussion follows.`;
    expect(locateExactQuote(body, `  ${QUOTE}  `)).toEqual({ quote: QUOTE, start: 19, end: 19 + QUOTE.length });
    expect(body.slice(19, 19 + QUOTE.length)).toBe(QUOTE);
    expect(locateExactQuote(body, "sleep restriction improved n-back accuracy greatly")).toBeNull();
    expect(locateExactQuote(`${body} ${QUOTE}`, QUOTE)).toBeNull();
  });
});

describe("checkVerification", () => {
  it("clears a draft whose paragraphs are all supported and which cites at least one claim", () => {
    expect(check()).toEqual({ ok: true, reasons: [], gapFacetIds: ["f2"] });
  });

  it("rejects a draft that cites none of the admitted claims", () => {
    const result = check(undefined, 0);
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain("no_cited_claim");
  });

  it("rejects unknown, duplicated and omitted paragraph or facet ids", () => {
    const result = check({
      paragraphs: [{ paragraphId: "p1", verdict: "supported" }, { paragraphId: "p1", verdict: "supported" }],
      facetCoverage: [{ facetId: "f1", status: "covered" }, { facetId: "f9", status: "covered" }],
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      "paragraph_duplicated", "paragraph_omitted", "facet_unknown", "facet_omitted",
    ]));
  });

  it("rejects an unverified paragraph and an all-gap facet verdict", () => {
    const unverified = check({
      paragraphs: [{ paragraphId: "p1", verdict: "unsupported" }, { paragraphId: "p2", verdict: "supported" }],
    });
    expect(unverified.ok).toBe(false);
    expect(unverified.reasons).toContain("paragraph_unverified");

    const allGap = check({
      facetCoverage: [{ facetId: "f1", status: "gap", reason: "none" }, { facetId: "f2", status: "gap", reason: "none" }],
    });
    expect(allGap.ok).toBe(false);
    expect(allGap.reasons).toContain("no_facet_covered");
    expect(allGap.gapFacetIds).toEqual(["f1", "f2"]);
  });
});

describe("buildVerificationEvidence", () => {
  type Claims = Parameters<typeof buildVerificationEvidence>[1];
  type Sources = Parameters<typeof buildVerificationEvidence>[2];
  const claims: Claims = [
    {
      claimId: "c1", branchId: "b1", text: "Ten nights of sleep restriction reduced n-back accuracy in 24 healthy adults.",
      facetIds: ["f1", "f2"], limitations: ["single laboratory", "no clinical population"],
      supports: [
        { sourceId: "s1", quote: QUOTE, start: 19, end: 19 + QUOTE.length, contentHash: "hash-s1" },
        { sourceId: "s2", quote: "accuracy fell in the restricted arm", start: 4, end: 39, contentHash: "hash-s2" },
      ],
    },
    {
      claimId: "c2", branchId: "b2", text: "Recovery sleep restored accuracy within two nights.",
      facetIds: ["f2"], limitations: [],
      supports: [{ sourceId: "s2", quote: "two recovery nights restored baseline", start: 80, end: 117, contentHash: "hash-s2" }],
    },
    {
      claimId: "c3", branchId: "b2", text: "An admitted claim the draft never cites.",
      facetIds: ["f3"], limitations: [],
      supports: [{ sourceId: "s3", quote: "never quoted in the draft", start: 0, end: 25, contentHash: "hash-s3" }],
    },
  ];
  const sources: Sources = [
    { sourceId: "s1", origin: "tavily", title: "Sleep restriction trial", publicationDate: "2023-04-01", cutoffStatus: "eligible", metadataOrigin: "observed" },
    { sourceId: "s2", origin: "provided", title: "Caller's own notes", publicationDate: null, cutoffStatus: "unknown", metadataOrigin: "provided" },
    { sourceId: "s3", origin: "brainpilot-library", title: null, publicationDate: "2020-01-01", cutoffStatus: "eligible", metadataOrigin: "observed" },
  ];
  const paragraphs = [
    { paragraphId: "p1", heading: "Findings", text: "Accuracy fell.", claimIds: ["c1", "c2"] },
    { paragraphId: "p2", heading: "Recovery", text: "It came back.", claimIds: ["c2", "c1"] },
    { paragraphId: "p3", heading: "Scope", text: "Method only.", claimIds: [] },
  ];

  it("lists each cited claim once in first-cited order with its metadata and every support intact", () => {
    const evidence = buildVerificationEvidence(paragraphs, claims, sources);
    expect(evidence.paragraphs).toEqual(paragraphs);
    expect(evidence.claims.map((claim) => claim.claimId)).toEqual(["c1", "c2"]);
    expect(evidence.claims[0]).toEqual({
      claimId: "c1", branchId: "b1", text: claims[0]!.text, facetIds: ["f1", "f2"],
      limitations: ["single laboratory", "no clinical population"],
      paragraphIds: ["p1", "p2"],
      supports: [
        { sourceId: "s1", quote: QUOTE, quoteSpan: { start: 19, end: 19 + QUOTE.length }, contentHash: "hash-s1" },
        { sourceId: "s2", quote: "accuracy fell in the restricted arm", quoteSpan: { start: 4, end: 39 }, contentHash: "hash-s2" },
      ],
    });
    expect(evidence.claims[1]!.paragraphIds).toEqual(["p1", "p2"]);
  });

  it("omits an uncited claim and its source, and labels provided metadata as unverified", () => {
    const evidence = buildVerificationEvidence(paragraphs, claims, sources);
    expect(evidence.claims.some((claim) => claim.claimId === "c3")).toBe(false);
    expect(evidence.sources.map((source) => source.sourceId)).toEqual(["s1", "s2"]);
    expect(evidence.sources[1]).toEqual({
      sourceId: "s2", origin: "provided", title: "Caller's own notes", publicationDate: "unknown",
      cutoffStatus: "unknown", metadataOrigin: "provided-unverified",
    });
  });

  it("fails the run rather than dropping a claim or a source it cannot resolve", () => {
    expect(() => buildVerificationEvidence([{ paragraphId: "p1", heading: "H", text: "T", claimIds: ["c9"] }], claims, sources))
      .toThrow(/verification_evidence_missing_claim/u);
    expect(() => buildVerificationEvidence(paragraphs, claims, sources.filter((source) => source.sourceId !== "s2")))
      .toThrow(/verification_evidence_missing_source/u);
  });
});

describe("buildSourceContextCatalog", () => {
  type Branches = Parameters<typeof buildSourceContextCatalog>[0];
  type Sources = Parameters<typeof buildSourceContextCatalog>[1];
  /** A stored source, hashed exactly the way the ledger hashes the body it admitted. */
  const stored = (sourceId: string, canonicalText: string) => ({
    sourceId, canonicalText, contentHash: createHash("sha256").update(canonicalText, "utf8").digest("hex"),
  });
  const S1 = stored("s1", `Methods: 24 healthy adults completed a ten-night protocol. ${QUOTE} Discussion follows.`);
  const S2 = stored("s2", "Recovery: two recovery nights restored baseline accuracy in the same cohort.");
  /** Where the sentence a support would quote begins; the details sit in the window before it. */
  const SPLIT = S1.canonicalText.indexOf(QUOTE);
  const END = S1.canonicalText.length;
  const reading = (source: ReturnType<typeof stored>, ...spans: Array<[number, number]>) => ({
    sourceId: source.sourceId, contentHash: source.contentHash, fullChars: source.canonicalText.length,
    readChars: spans.reduce((total, [start, end]) => total + (end - start), 0), excerpted: true,
    windows: spans.map(([start, end]) => ({ start, end, text: source.canonicalText.slice(start, end) })),
  });
  const branch = (
    branchId: string, status: "completed" | "failed" | "skipped", readWindows: ReturnType<typeof reading>[],
  ): Branches[number] => ({ branchId, status, readWindows });

  it("hands on the exact windows a completed branch read, with the branch that read them", () => {
    const catalog = buildSourceContextCatalog([branch("b1", "completed", [reading(S1, [0, SPLIT], [SPLIT, END])])], [S1, S2]);

    expect(catalog).toHaveLength(2);
    expect(catalog[0]).toEqual({
      contextId: "w1", sourceId: "s1", contentHash: S1.contentHash, start: 0, end: SPLIT,
      chars: SPLIT, fullChars: END, text: S1.canonicalText.slice(0, SPLIT), readByBranchIds: ["b1"],
    });
    expect(catalog[1]!.contextId).toBe("w2");
    // The detail a short support quote leaves out was read, and the quote still lands exactly where
    // its recorded span says it does, now inside a window rather than only in the ledger.
    expect(catalog[0]!.text).toContain("24 healthy adults");
    expect(catalog[1]!.text.slice(SPLIT - catalog[1]!.start, SPLIT - catalog[1]!.start + QUOTE.length)).toBe(QUOTE);
  });

  it("lists an identical window once and names every completed branch it was delivered to", () => {
    const catalog = buildSourceContextCatalog([
      branch("b1", "completed", [reading(S1, [0, SPLIT])]),
      branch("b2", "completed", [reading(S1, [0, SPLIT], [SPLIT, END])]),
    ], [S1]);

    expect(catalog.map((entry) => [entry.contextId, entry.start, entry.readByBranchIds])).toEqual([
      ["w1", 0, ["b1", "b2"]],
      ["w2", SPLIT, ["b2"]],
    ]);
  });

  it("reads nothing from a branch that failed or was skipped, whatever it was allotted", () => {
    const never = { ...reading(S1, [0, SPLIT]), windows: [{ start: 0, end: END + 500, text: "never delivered" }] };
    const catalog = buildSourceContextCatalog([
      branch("b1", "failed", [reading(S1, [0, SPLIT])]),
      branch("b2", "skipped", [never]),
      branch("b3", "completed", [reading(S2, [0, 20])]),
    ], [S1, S2]);

    // A window an incomplete branch was allotted is not evidence anything read it, so it is neither
    // published nor checked: only the completed branch's own reading reaches the catalogue.
    expect(catalog.map((entry) => ({ sourceId: entry.sourceId, readByBranchIds: entry.readByBranchIds })))
      .toEqual([{ sourceId: "s2", readByBranchIds: ["b3"] }]);
  });

  const rejected: Array<{ case: string; branches: Branches; sources: Sources; code: string }> = [
    {
      case: "the recorded text is no longer the slice the offsets name",
      branches: [branch("b1", "completed", [{
        ...reading(S1, [0, SPLIT]),
        windows: [{ start: 0, end: SPLIT, text: `${S1.canonicalText.slice(0, SPLIT - 6)}, all men.` }],
      }])],
      sources: [S1], code: "source_context_window_text_mismatch",
    },
    {
      case: "the reading's hash is not the hash the source now carries",
      branches: [branch("b1", "completed", [{ ...reading(S1, [0, SPLIT]), contentHash: "not-the-stored-hash" }])],
      sources: [S1], code: "source_context_hash_mismatch",
    },
    {
      case: "the stored body no longer hashes to the hash both sides agree on",
      branches: [branch("b1", "completed", [reading(S1, [0, SPLIT])])],
      sources: [{ ...S1, canonicalText: `${S1.canonicalText} Appended after admission.` }],
      code: "source_context_hash_mismatch",
    },
    {
      case: "a window reaches past the end of the body",
      branches: [branch("b1", "completed", [{
        ...reading(S1, [0, SPLIT]), windows: [{ start: 0, end: END + 1, text: S1.canonicalText }],
      }])],
      sources: [S1], code: "source_context_window_out_of_bounds",
    },
    {
      case: "a window's offsets are not whole forward characters",
      branches: [branch("b1", "completed", [{
        ...reading(S1, [0, SPLIT]), windows: [{ start: 1.5, end: SPLIT, text: S1.canonicalText.slice(1.5, SPLIT) }],
      }])],
      sources: [S1], code: "source_context_window_out_of_bounds",
    },
    {
      case: "the source a branch read is not in the ledger",
      branches: [branch("b1", "completed", [reading(S1, [0, SPLIT])])],
      sources: [S2], code: "source_context_unknown_source",
    },
    {
      case: "the source has no stored body to slice",
      branches: [branch("b1", "completed", [reading(S1, [0, SPLIT])])],
      sources: [{ sourceId: "s1", canonicalText: null, contentHash: null }],
      code: "source_context_source_without_body",
    },
  ];
  it.each(rejected)("fails closed when $case", ({ branches, sources, code }) => {
    expect(() => buildSourceContextCatalog(branches, sources)).toThrow(new RegExp(code, "u"));
  });

  it("keeps the catalogue to the sources it was asked for without touching its inputs", () => {
    const branches = [branch("b1", "completed", [reading(S1, [0, SPLIT]), reading(S2, [0, 20])])];
    const before = structuredClone(branches);

    const catalog = buildSourceContextCatalog(branches, [S1, S2], ["s2"]);

    expect(catalog.map((entry) => [entry.contextId, entry.sourceId, entry.text]))
      .toEqual([["w1", "s2", S2.canonicalText.slice(0, 20)]]);
    // The delivered windows are the run's own quote provenance: they are read, never rewritten.
    expect(branches).toEqual(before);
  });
});

describe("canReviseResearch", () => {
  type EligibilityInput = Parameters<typeof canReviseResearch>[0];
  const PARAGRAPH_IDS = ["p1", "p2"];
  const FACET_IDS = ["f1", "f2"];
  const supported = (paragraphId: string): Verification["paragraphs"][number] =>
    ({ paragraphId, verdict: "supported", reason: "every statement follows from its cited claims" });
  const unverified = (paragraphId: string): Verification["paragraphs"][number] =>
    ({ paragraphId, verdict: "unverified", reason: "asserts more than its quotes show" });
  const covered = (facetId: string): Verification["facetCoverage"][number] =>
    ({ facetId, status: "covered", reason: "a cited claim reports it" });
  const gap = (facetId: string): Verification["facetCoverage"][number] =>
    ({ facetId, status: "gap", reason: "no cited claim reports it" });
  const assessment = (
    paragraphs: Verification["paragraphs"],
    facetCoverage: Verification["facetCoverage"] = [covered("f1"), gap("f2")],
    issues: string[] = [],
  ): Verification => ({ paragraphs, facetCoverage, issues });
  /** Eligibility is always decided against the host's real check of that same verification. */
  const decide = (
    assessed: Verification,
    overrides: Partial<Omit<EligibilityInput, "verification" | "check" | "paragraphIds">> = {},
    citedClaimCount = 2,
  ) => canReviseResearch({
    verification: assessed,
    check: checkVerification(assessed, PARAGRAPH_IDS, FACET_IDS, citedClaimCount),
    paragraphIds: PARAGRAPH_IDS, stageFailures: [], remainingModelStages: 4, softStopped: false, ...overrides,
  });

  it("offers one repair for the paragraphs the verifier did not clear, in document order", () => {
    const assessed = assessment([unverified("p2"), unverified("p1")]);
    expect(checkVerification(assessed, PARAGRAPH_IDS, FACET_IDS, 2).reasons).toEqual(["paragraph_unverified"]);
    // Two stages must be left: the repair itself and the full re-verification that follows it.
    expect(decide(assessed, { remainingModelStages: 2 }))
      .toEqual({ eligible: true, reason: null, targetParagraphIds: ["p1", "p2"] });
  });

  it("still offers the repair when the verifier also listed issues against the draft", () => {
    const assessed = assessment([supported("p1"), unverified("p2")], undefined, ["p2 asserts more than its quote shows"]);
    expect(checkVerification(assessed, PARAGRAPH_IDS, FACET_IDS, 2).reasons)
      .toEqual(["paragraph_unverified", "verifier_issues"]);
    expect(decide(assessed)).toEqual({ eligible: true, reason: null, targetParagraphIds: ["p2"] });
  });

  const declined: Array<{
    case: string;
    assessed: Verification;
    overrides?: Partial<Omit<EligibilityInput, "verification" | "check" | "paragraphIds">>;
    citedClaimCount?: number;
    reason: string;
  }> = [
    {
      case: "an earlier stage of the run failed", assessed: assessment([supported("p1"), unverified("p2")]),
      overrides: { stageFailures: ["evidence_stage_failed:b1"] }, reason: "earlier_stage_failed",
    },
    {
      case: "the verification already cleared the draft",
      assessed: assessment([supported("p1"), supported("p2")]), reason: "verification_passed",
    },
    {
      case: "one paragraph verdict is unknown and another is missing",
      assessed: assessment([unverified("p1"), supported("p9")]), reason: "verification_not_repairable",
    },
    {
      case: "the draft cites none of the admitted claims", assessed: assessment([supported("p1"), unverified("p2")]),
      citedClaimCount: 0, reason: "verification_not_repairable",
    },
    {
      case: "no facet was covered anywhere in the report",
      assessed: assessment([supported("p1"), unverified("p2")], [gap("f1"), gap("f2")]),
      reason: "verification_not_repairable",
    },
    {
      case: "issues were listed but every paragraph was cleared",
      assessed: assessment([supported("p1"), supported("p2")], undefined, ["a quote does not back its claim"]),
      reason: "no_unverified_paragraph",
    },
    {
      case: "only one model stage is left, too few to repair and re-verify",
      assessed: assessment([supported("p1"), unverified("p2")]),
      overrides: { remainingModelStages: 1 }, reason: "model_stage_budget_insufficient",
    },
    {
      case: "the time budget left only the write reserve", assessed: assessment([supported("p1"), unverified("p2")]),
      overrides: { softStopped: true }, reason: "time_budget_exhausted",
    },
  ];
  it.each(declined)("declines to spend a repair when $case", ({ assessed, overrides, citedClaimCount, reason }) => {
    expect(decide(assessed, overrides ?? {}, citedClaimCount ?? 2))
      .toEqual({ eligible: false, reason, targetParagraphIds: [] });
  });
});

describe("applyResearchRevision", () => {
  type Draft = Parameters<typeof applyResearchRevision>[0];
  type Revision = Parameters<typeof applyResearchRevision>[1];
  type Update = Revision["updates"][number];
  const NARROWED = "In 24 healthy adults, ten nights of restriction reduced n-back accuracy.";
  const KNOWN_CLAIM_IDS = ["c1", "c2", "c3"];
  const draft = (): Draft => [
    { paragraphId: "p1", heading: "Scope", text: "What this report covers.", claimIds: [] },
    { paragraphId: "p2", heading: "Findings", text: "Sleep loss halves accuracy in everyone.", claimIds: ["c1"] },
    { paragraphId: "p3", heading: "Recovery", text: "Accuracy returns after recovery sleep.", claimIds: ["c2"] },
  ];
  const update = (overrides: Partial<Update> = {}): Update => ({
    paragraphId: "p2", text: NARROWED, claimIds: ["c1", "c2"],
    reason: "narrowed the assertion to the population the cited quotes report", ...overrides,
  });

  it("rewrites every targeted paragraph and copies the rest of the draft through unchanged", () => {
    const paragraphs = draft();
    const revision: Revision = {
      updates: [
        update(),
        update({ paragraphId: "p3", text: "No admitted claim speaks to recovery.", claimIds: [] }),
      ],
    };
    const result = applyResearchRevision(paragraphs, revision, ["p2", "p3"], KNOWN_CLAIM_IDS);

    expect(result.map((paragraph) => paragraph.paragraphId)).toEqual(["p1", "p2", "p3"]);
    expect(result.map((paragraph) => paragraph.heading)).toEqual(["Scope", "Findings", "Recovery"]);
    expect(result[1]).toEqual({ paragraphId: "p2", heading: "Findings", text: NARROWED, claimIds: ["c1", "c2"] });
    expect(result[2]).toEqual({
      paragraphId: "p3", heading: "Recovery", text: "No admitted claim speaks to recovery.", claimIds: [],
    });
    // The untargeted paragraph is carried over whole, as a copy rather than the drafted object itself.
    expect(result[0]).toEqual(paragraphs[0]);
    expect(result[0]).not.toBe(paragraphs[0]);
    expect(result[1]!.claimIds).not.toBe(revision.updates[0]!.claimIds);
    expect(paragraphs).toEqual(draft());
    expect(revision.updates[0]).toEqual(update());
  });

  const targeting: Array<{ case: string; updates: Update[]; allowed: string[]; code: string }> = [
    {
      case: "a second update for the same paragraph",
      updates: [update(), update({ text: "Another rewrite of the same body." })],
      allowed: ["p2"], code: "revision_duplicate_paragraph",
    },
    {
      case: "a targeted paragraph left unrepaired",
      updates: [update()], allowed: ["p2", "p3"], code: "revision_omitted_target_paragraph",
    },
    {
      case: "an update for a paragraph that is not in the draft",
      updates: [update({ paragraphId: "p9" })], allowed: ["p2"], code: "revision_unknown_paragraph",
    },
    {
      case: "an update for a drafted paragraph the host did not flag",
      updates: [update({ paragraphId: "p3" })], allowed: ["p2"], code: "revision_touched_unflagged_paragraph",
    },
    {
      case: "a target list naming a paragraph outside the draft",
      updates: [update()], allowed: ["p2", "p9"], code: "revision_target_not_in_draft",
    },
    {
      case: "a target list naming the same paragraph twice",
      updates: [update()], allowed: ["p2", "p2"], code: "revision_target_not_in_draft",
    },
  ];
  it.each(targeting)("rejects the whole revision for $case", ({ updates, allowed, code }) => {
    expect(() => applyResearchRevision(draft(), { updates }, allowed, KNOWN_CLAIM_IDS))
      .toThrow(new RegExp(code, "u"));
  });

  const bodies: Array<{ case: string; overrides: Partial<Update>; code: string }> = [
    { case: "a claim id that is not in the ledger", overrides: { claimIds: ["c1", "c9"] }, code: "revision_cited_unknown_claim" },
    { case: "the same claim id twice", overrides: { claimIds: ["c1", "c1"] }, code: "revision_duplicate_claim" },
    { case: "a blank body", overrides: { text: "  \n \t " }, code: "revision_blank_paragraph" },
    {
      case: "its own footnote marker", overrides: { text: "Accuracy fell in the restricted arm.[^1]" },
      code: "revision_wrote_unregistered_citation",
    },
    {
      case: "an inline URL", overrides: { text: "The trial is reported at https://example.org/trial." },
      code: "revision_wrote_unregistered_citation",
    },
  ];
  it.each(bodies)("rejects a revised paragraph carrying $case", ({ overrides, code }) => {
    expect(() => applyResearchRevision(draft(), { updates: [update(overrides)] }, ["p2"], KNOWN_CLAIM_IDS))
      .toThrow(new RegExp(code, "u"));
  });
});

describe("globalGaps", () => {
  type Branches = Parameters<typeof globalGaps>[0];
  const branches: Branches = [
    { branchId: "b1", facets: [{ facetId: "f1", description: "dose-response" }, { facetId: "f2", description: "recovery" }], status: "completed", reason: null },
    { branchId: "b2", facets: [{ facetId: "f3", description: "children" }], status: "failed", reason: "search returned nothing usable" },
  ];
  const cleared = { ok: true, reasons: [] };

  it("publishes verifier facet gaps and incomplete branches, and no per-branch reading observation", () => {
    const gaps = globalGaps(branches, {
      facetCoverage: [
        { facetId: "f1", status: "covered", reason: "two trials reported it" },
        { facetId: "f2", status: "gap", reason: "no cited claim reports recovery" },
      ],
    }, cleared);
    expect(gaps).toEqual([
      { label: "f2 (recovery)", reason: "no cited claim reports recovery" },
      { label: "b2", reason: "Branch not completed: search returned nothing usable." },
    ]);
    expect(gaps.some((gap) => gap.label.startsWith("g"))).toBe(false);
  });

  it("marks coverage unassessed when verification is missing or did not clear the host's checks", () => {
    const missing = globalGaps(branches, null, null);
    expect(missing[0]!.label).toBe("coverage-assessment-incomplete");
    expect(missing[0]!.reason).toContain("did not return a coverage assessment");
    expect(missing.map((gap) => gap.label)).toEqual(["coverage-assessment-incomplete", "b2"]);

    const rejected = globalGaps(branches, { facetCoverage: [{ facetId: "f1", status: "covered", reason: "mentioned" }] },
      { ok: false, reasons: ["facet_omitted", "verifier_issues"] });
    const incomplete = rejected.find((gap) => gap.label === "coverage-assessment-incomplete");
    expect(incomplete?.reason).toContain("facet_omitted, verifier_issues");
  });
});

describe("ResearchBudget", () => {
  it("enforces branch, stage, call and extraction limits and refunds only the unspent reservation", () => {
    const budget = new ResearchBudget(limits());
    expect([budget.admitBranch("initial"), budget.admitBranch("initial"), budget.admitBranch("initial")])
      .toEqual([true, true, false]);
    expect([budget.admitBranch("followup"), budget.admitBranch("followup")]).toEqual([true, false]);
    expect([budget.admitModelStage(), budget.admitModelStage()]).toEqual([true, false]);
    expect([budget.admitResearchCall(), budget.admitResearchCall()]).toEqual([true, false]);
    expect(budget.usage()).toMatchObject({ branches: 3, followups: 1, modelStages: 1, researchCalls: 1 });

    expect(budget.reserveExtractUrls(2)).toBe(2); // within the allowance
    expect(budget.reserveExtractUrls(5)).toBe(1); // capped by what is left
    expect(budget.reserveExtractUrls(1)).toBe(0);
    expect(budget.extractUrls).toBe(3);

    expect(budget.refundExtractUrls(2, 1)).toBe(1);
    expect(budget.refundExtractUrls(2, 5)).toBe(0); // reported more URLs than reserved
    expect(budget.refundExtractUrls(0, 0)).toBe(0);
    expect(budget.refundExtractUrls(2, 0)).toBe(2);
    expect(budget.extractUrls).toBe(0);
  });
});
