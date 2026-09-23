import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@brainpilot/plugin-sdk/workflow";
import {
  aggregateReviews, collectSearchTasks, compareReviews, generateCitationKey,
  hasFormattingIssues, injectCitations, paperBeforeCutoff, paperWritingInputSchema,
  preflightPaperWriting, renderBibliography, repairUnsupportedCitations, roundHalfEven, runPaperWriting,
  selectScholarMatch, titleSimilarity, type PaperData,
  scholarSearch, candidateHasResearchEvidence, researchPaperBeforeCutoff, verifyWebResearchPaper,
} from "../workflows/paper-writing.js";
import {
  outlineInstructions, sectionWritingInstructions, refinementInstructions,
  reviewerInstructions, literatureWritingInstructions, formatReviewInstructions, adaptRefinementInput,
} from "../workflows/prompts/paper-writing.js";

afterEach(() => vi.unstubAllGlobals());
const hash = (source: string) => createHash("sha256").update(source).digest("hex");
/** pdfTeX's real wording for a bare natbib command that the bundled `cite` package does not define. */
const undefinedCitationCompileLog = "Undefined control sequence.\nl.14 ... \\citep\n    {Ref1}";
/** The same compiler error, but the citation only appears on the continuation line of another failure. */
const unrelatedCompileLog = "Undefined control sequence.\nl.10 \\badmacro\n    followed by \\citep{Ref1}";
const input = { raw_materials_dir: "raw", latex_template_dir: "template", research_cutoff: "2024-11" };
const emptyOutline = () => ({ plotting_plan: [] as Record<string, unknown>[], intro_related_work_plan: { introduction_strategy: { search_directions: [] as string[] }, related_work_strategy: { subsections: [] as Record<string, unknown>[] } }, section_plan: [] as Record<string, unknown>[] });
const review = (overall: number, clarity = 2) => ({
  Summary: "Synthetic unit-test review.", Strengths: ["Clear"], Weaknesses: ["Limited"], Questions: [], Limitations: ["Synthetic data"],
  "Ethical Concerns": false, Decision: "Reject", Originality: 2, Quality: 2, Clarity: clarity, Significance: 2,
  Soundness: 2, Presentation: 2, Contribution: 2, Overall: overall, Confidence: 3,
});

describe("repairUnsupportedCitations", () => {
  it("rewrites only the bare natbib commands and leaves every other character untouched", () => {
    const source = [
      String.raw`We sampled $n = 8$ runs with $p = 0.42$ significance.`,
      String.raw`The design follows \citet{A} and extends \citep{B,C}.`,
      String.raw`Earlier results appear in \cite{D}.`,
      String.raw`% TODO: consider adding \citep{Comment} here later.`,
    ].join("\n");
    const expected = [
      String.raw`We sampled $n = 8$ runs with $p = 0.42$ significance.`,
      String.raw`The design follows \cite{A} and extends \cite{B,C}.`,
      String.raw`Earlier results appear in \cite{D}.`,
      String.raw`% TODO: consider adding \citep{Comment} here later.`,
    ].join("\n");

    expect(repairUnsupportedCitations(source, undefinedCitationCompileLog)).toEqual({
      source: expected,
      replacements: 2,
    });
  });

  it.each([
    ["the compile error is about an unrelated macro", String.raw`Text \citep{Ref1} here.`, unrelatedCompileLog],
    ["the citation carries an optional argument", String.raw`Text \citep[see][p.~3]{Ref1} here.`, undefinedCitationCompileLog],
    ["the document defines the macro itself", String.raw`\newcommand{\citep}[1]{[#1]}` + "\n" + String.raw`Text \citep{Ref1} here.`, undefinedCitationCompileLog],
    ["the citation sits inside a verbatim block", "\\begin{verbatim}\n\\citep{Ref1}\n\\end{verbatim}", undefinedCitationCompileLog],
    ["natbib is loaded", String.raw`\usepackage{natbib}` + "\n" + String.raw`Text \citep{Ref1} here.`, undefinedCitationCompileLog],
    ["biblatex is loaded", String.raw`\usepackage{biblatex}` + "\n" + String.raw`Text \citep{Ref1} here.`, undefinedCitationCompileLog],
    ["the source only uses plain \\cite", String.raw`Text \cite{Ref1} here.`, undefinedCitationCompileLog],
  ])("declines to repair when %s", (_case, source, log) => {
    expect(repairUnsupportedCitations(source, log)).toBeUndefined();
  });
});

describe("Semantic Scholar transport", () => {
  it("passes the configured service key without exposing it in the returned search evidence", async () => {
    vi.stubEnv("SEMANTIC_SCHOLAR_API_KEY", "test-s2-key");
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ "x-api-key": "test-s2-key" });
      return Response.json({ data: [{ title: "A source" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    try {
      const result = await scholarSearch("A source", 3, new AbortController().signal);
      expect(result.results).toEqual([{ title: "A source" }]);
      expect(JSON.stringify(result)).not.toContain("test-s2-key");
    } finally { vi.unstubAllEnvs(); }
  });
});
const paper = (overrides: Partial<PaperData> = {}): PaperData => ({
  citation_key: "Author2024AlphaMethod", title: "Alpha method", authors: ["A. Author"], venue: "Test venue", year: 2024,
  abstract: "An externally returned abstract.", citation_count: 3, found_in_section: "Introduction", reason: "Relevant background",
  journal: null, volume: null, pages: null, publication_date: "2024-01-01", source_url: "https://api.semanticscholar.org/graph/v1/paper/search",
  paper_id: "s2-id", ...overrides,
});

describe("pinned upstream method and prompts", () => {
  it("retains substantive stage prompts while adapting the response envelope and removing limitation suppression", () => {
    const outline = outlineInstructions("2024-11");
    expect(outline.length).toBeGreaterThan(10_000);
    expect(outline).toContain("EVERY SINGLE dataset, optimizer, metric");
    expect(outline).toContain("plotting_plan");
    expect(outline).toContain("intro_related_work_plan");
    expect(outline).toContain("section_plan");
    expect(outline).toContain("2024-11");
    expect(outline).toContain("that scope takes precedence");
    expect(sectionWritingInstructions).toContain("You are responsible for creating LaTeX tables.");
    expect(sectionWritingInstructions).toContain("You can refine the captions if necessary.");
    expect(refinementInstructions).toContain("Always provide the FULL LaTeX code.");
    expect(refinementInstructions).toContain("simply ignore those specific requests");
    expect(refinementInstructions).not.toContain("Never explicitly state a limitation.");
    expect(refinementInstructions).not.toContain("sentence-level");
    expect(reviewerInstructions).toContain("Knowledgeability:");
    expect(reviewerInstructions).toContain("Rubrics for Overall Rating");
    expect(literatureWritingInstructions(10, "2024-11")).toContain("cite at least 9");
    expect(formatReviewInstructions("Use one column.")).toContain("EVERY SINGLE figure and table");
    expect(formatReviewInstructions("Use one column.")).toContain("Use one column.");
  });

  it("requires native refinement submission while preserving every byte of supplied manuscript material", () => {
    const material = "review: preserve p=0.42; no new experiments\n\\begin{document}source\\end{document}\n";
    const original = material + "3. Output the JSON Worklog first, then the Full Revised LaTeX.\n";
    const adapted = adaptRefinementInput(original);
    expect(adapted.slice(0, material.length)).toBe(material);
    expect(adapted).toContain('submit_result tool once with {"result":');
    expect(adapted).not.toContain("Output the JSON Worklog first");
    expect(adaptRefinementInput(adapted)).toBe(adapted);
    expect(() => adaptRefinementInput(material)).toThrow("Unrecognized refinement");
    expect(refinementInstructions).not.toContain("two distinct code blocks");
    expect(refinementInstructions).toContain('submit_result tool once with {"result":');
    expect(refinementInstructions).toContain("MUST be verified against `experimental_log.md`");
    expect(refinementInstructions).toContain("Use ONLY keys from `citation_map.json`");
    expect(refinementInstructions).toContain("### IMPORTANT NOTES");
    expect(refinementInstructions).toContain("Strict Knowledge Isolation & Anonymity");
    expect(refinementInstructions).toContain("### SINGLE-PASS COMPLETION");
    expect(refinementInstructions).toContain("Reviewer statements are feedback, not additional evidence");
    expect(refinementInstructions).toContain("record the unresolved request and its reason in worklog.actions_taken");
    expect(refinementInstructions).toContain("Submit the complete revised LaTeX after this pass");
    expect(refinementInstructions.indexOf("### SINGLE-PASS COMPLETION"))
      .toBeGreaterThan(refinementInstructions.indexOf("### IMPORTANT NOTES"));
  });

  it("requires the upstream four input roles and rejects provider or unsupported PlotOn overrides", async () => {
    expect(paperWritingInputSchema.safeParse({ ...input, writer_model_name: "other" }).success).toBe(false);
    expect(paperWritingInputSchema.safeParse({ ...input, use_plotting: true }).success).toBe(false);
    expect(paperWritingInputSchema.safeParse({ materials: [] }).success).toBe(false);
    const readText = vi.fn(async (path: string) => {
      if (path.endsWith("guidelines.md")) throw new Error("ENOENT: guidelines.md");
      return "Provided source";
    });
    const checks = await preflightPaperWriting(input, { readText, signal: new AbortController().signal });
    expect(checks[0]?.status).toBe("fail");
    expect(readText.mock.calls.map(([path]) => path)).toEqual(["raw/idea_sparse.md", "raw/experimental_log.md", "template/template.tex", "template/guidelines.md"]);
    expect((await preflightPaperWriting(input, { readText: async () => "", signal: new AbortController().signal }))[0]?.status).toBe("pass");
    const controller = new AbortController(); controller.abort(new Error("Stop"));
    await expect(preflightPaperWriting(input, { readText, signal: controller.signal })).rejects.toThrow("Stop");
  });

  it("keeps macro, micro and mandatory-citation task groups and section assignment", () => {
    const outline = {
      plotting_plan: [],
      intro_related_work_plan: {
        introduction_strategy: { hook_hypothesis: "Hook", problem_gap_hypothesis: "Gap", search_directions: ["macro", "macro"] },
        related_work_strategy: { subsections: [{ subsection_title: "A", methodology_cluster: "cluster", limitation_search_queries: ["micro"] }] },
      },
      section_plan: [{ section_title: "Methods", subsections: [{ subsection_title: "Data", content_bullets: ["dataset"], citation_hints: ["canonical dataset"] }] }],
    };
    const tasks = collectSearchTasks(outline);
    expect(tasks.map(task => [task.section, task.focus, task.search_type])).toEqual([
      ["Introduction", "macro", "exploration"], ["Related Work: A", "micro", "exploration"], ["Methods - Data", "canonical dataset", "targeted"],
    ]);
    const mapped = injectCitations(outline, [paper(), paper({ citation_key: "Dataset2024", found_in_section: "Methods - Data" })]);
    expect((mapped.intro_related_work_plan.introduction_strategy as Record<string, unknown>).citation_candidates).toEqual(["Author2024AlphaMethod"]);
    const sub = ((mapped.section_plan[0] as Record<string, unknown>).subsections as Array<Record<string, unknown>>)[0]!;
    expect(sub.citation_candidates).toEqual(["Dataset2024"]);
    expect(sub).not.toHaveProperty("citation_hints");
    expect(outline.section_plan[0]!.subsections[0]).toHaveProperty("citation_hints");
  });

  it("matches title similarity, year bonus, cutoff and BibTeX collision behavior", () => {
    expect(titleSimilarity("Alpha method", "ALPHA METHOD")).toBe(100);
    expect(titleSimilarity("abc", "xyz")).toBe(0);
    expect(paperBeforeCutoff({ publicationDate: "2024-11-01" }, "2024-11")).toBe(false);
    expect(paperBeforeCutoff({ publicationDate: "2024-10-31" }, "2024-11")).toBe(true);
    expect(paperBeforeCutoff({ year: 2024 }, "2024-11")).toBe(true);
    expect(paperBeforeCutoff({ year: 2024 }, "2024-01")).toBe(false);
    expect(selectScholarMatch("Alpha method", 2024, [{ title: "Alpha method", year: 2024, publicationDate: "2025-01-01" }], "2024-11")).toBeUndefined();
    expect(selectScholarMatch("Alpha method", 2024, [{ title: "Alpha method", year: 2024 }], "2024-11")?.title).toBe("Alpha method");
    expect(generateCitationKey(["Jane Smith"], 2024, "The study of alpha methods")).toBe("Smith2024AlphaMethods");
    const papers = [paper(), paper({ title: "A different paper" })];
    const bibliography = renderBibliography(papers);
    expect(papers[1]!.citation_key).toBe("Author2024AlphaMethoda");
    expect(bibliography).toContain("@inproceedings");
    expect(bibliography).toContain("booktitle={Test venue}");
  });

  it("uses ensemble scores instead of meta scores and preserves original acceptance/stop rules", () => {
    expect(roundHalfEven(2.5)).toBe(2); expect(roundHalfEven(3.5)).toBe(4);
    expect(aggregateReviews([review(4), review(5), review(6)], review(10)).Overall).toBe(5);
    expect(compareReviews(review(5), review(6)).outcome).toBe("ACCEPTED_SCORE_INCREASE");
    expect(compareReviews(review(6), review(5)).outcome).toBe("REJECTED_SCORE_DECREASE");
    expect(compareReviews(review(6, 3), review(6, 2)).outcome).toBe("REJECTED_DEGRADATION");
    expect(compareReviews(review(6, 2), review(6, 3)).outcome).toBe("ACCEPTED_NEUTRAL_IMPROVEMENT");
    expect(compareReviews(review(6, 2), review(6, 2)).outcome).toBe("ACCEPTED_NEUTRAL_IMPROVEMENT");
    expect(compareReviews({ ...review(6), Confidence: 5 }, { ...review(6), Confidence: 1 }).outcome).toBe("ACCEPTED_NEUTRAL_IMPROVEMENT");
    expect(hasFormattingIssues({ figure_and_tables: { "Figure 1": { detected_issue: "None" } }, other_issues: [] })).toBe(false);
    expect(hasFormattingIssues({ figure_and_tables: {}, other_issues: [{ detected_issue: "Overflow" }] })).toBe(true);
  });
});

function context(options: {
  firstScore?: number; failedCompiles?: string[]; failBaselineCount?: number;
  formattingIssues?: boolean; outline?: ReturnType<typeof emptyOutline>; sectionLatex?: string; formattedLatex?: string;
  researchEvidence?: Record<string, unknown>; researchFailure?: string; sourceReading?: Record<string, unknown>;
  discoveryRetry?: boolean; discoveryEmpty?: boolean; discoveryUnsupported?: boolean;
  compileFailureLog?: string; failReviewStage?: string;
  researchExecute?: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>;
} = {}) {
  const files = new Map<string, string>();
  let baselineCount = 0;
  const artifact = (path: string, content: string, role: string, mediaType = "application/json") => {
    const published = "workflow-runs/wf-test/" + path;
    if (files.has(published) && files.get(published) !== content) throw new Error("Attempted to overwrite artifact");
    files.set(published, content);
    return { path: published, sha256: hash(content), producerRunId: "wf-test", role, mediaType };
  };
  const runAgent = vi.fn(async (request: { stageId: string; inputs: unknown; images?: string[] }) => {
    const stage = request.stageId;
    const inputs = request.inputs as Record<string, unknown>;
    if (stage.endsWith("-outline")) return options.outline ?? emptyOutline();
    if (stage.includes("-literature-discovery-")) {
      // A real first-try failure exercises the workflow's own retry loop, not a definitive empty answer.
      if (options.discoveryRetry && stage.endsWith("-try-1")) throw new Error("Transient discovery agent failure");
      // A definitive empty answer is accepted on the first try; the task is never retried.
      if (options.discoveryEmpty) return { section_name: "Introduction", candidates: [] };
      // Non-empty but unsupported candidates are not definitive, so the task retries every attempt.
      if (options.discoveryUnsupported) return { section_name: "Introduction", candidates: [{ title: "Unsupported candidate", year: 2024, reason: "Background" }] };
      return { section_name: "Introduction", candidates: [{ title: "Alpha method", year: 2024, reason: "Background" }] };
    }
    if (stage.includes("-literature-source-reading-")) return options.sourceReading ?? { papers: [] };
    if (stage.endsWith("-literature-writing")) return { latex: "\\documentclass{article}\n\\begin{document}\nIntroduction.\n\\end{document}\n" };
    if (stage.endsWith("-section-writing")) return { latex: options.sectionLatex ?? "\\documentclass{article}\n\\begin{document}\nBASELINE\n\\end{document}\n" };
    if (/-review-(?:initial|v\d+)-(?:reviewer-\d+|meta)$/u.test(stage)) {
      // A real review stage can end without a submitted result; the selector names exactly one.
      if (options.failReviewStage && stage.endsWith(options.failReviewStage)) throw new Error("Review stage ended without a result");
      const version = String(inputs.version);
      const overall = version === "initial" ? 5 : version === "v1" ? (options.firstScore ?? 6) : version === "v2" ? 6 : 5;
      const clarity = version === "v2" ? 3 : 2;
      if (stage.endsWith("-meta")) return review(10, 1);
      const n = Number(stage.at(-1));
      return review(overall + n - 2, clarity);
    }
    if (/-refinement-\d+$/u.test(stage)) return {
      latex: "\\documentclass{article}\n\\begin{document}\nCANDIDATE_" + String(inputs.version) + "\n\\end{document}\n",
      worklog: { addressed_weaknesses: [], integrated_answers: [], actions_taken: ["Revise existing text"] },
    };
    if (stage.endsWith("-format-review-1")) return { figure_and_tables: {}, other_issues: options.formattingIssues === false ? [] : [{ detected_issue: "Spacing", suggested_fix: "Adjust spacing" }] };
    if (stage.endsWith("-format-fix-1")) return { latex: options.formattedLatex ?? String(inputs.latex) + "% FORMAT_FIXED\n" };
    throw new Error("Unexpected stage " + stage);
  });
  const runTool = vi.fn(async ({ name, input }: { name: string; input: unknown }) => {
    const args = input as Record<string, unknown>;
    if (name === "research_search" || name === "research_resolve") {
      if (options.researchFailure) throw new Error(options.researchFailure);
      const data = options.researchExecute ? await options.researchExecute(name, args) : options.researchEvidence;
      return { data: data ?? { localPapers: [], webResults: [], pages: [], issues: [], retrievedAt: "2026-09-13T00:00:00Z" }, artifacts: [] };
    }
    if (name === "list_files") return { data: { files: [] }, artifacts: [] };
    if (name === "copy_files") return {
      data: {},
      artifacts: (args.files as Array<{ sourcePath: string; targetPath: string }>).map(file => {
        const content = files.get(file.sourcePath);
        if (content === undefined) throw new Error("Missing copy source");
        return artifact(file.targetPath, content, "copied-file", file.targetPath.endsWith(".pdf") ? "application/pdf" : "text/plain");
      }),
    };
    if (name === "compile_latex") {
      const stem = String(args.stem);
      if (stem.endsWith("-baseline")) baselineCount++;
      if (options.failedCompiles?.some(value => stem.endsWith(value)) || (stem.endsWith("-baseline") && baselineCount <= (options.failBaselineCount ?? 0))) {
        return { data: { success: false, log: options.compileFailureLog ?? "Synthetic compile failure for control-flow testing" }, artifacts: [] };
      }
      const pdf = artifact(stem + ".pdf", "%PDF-unit-test-only\n" + String(args.source), "compiled-pdf", "application/pdf");
      return { data: { success: true, pdfPath: pdf.path, text: "Synthetic extracted paper text for control-flow tests. ".repeat(3) + String(args.source), log: "" }, artifacts: [pdf] };
    }
    if (name === "render_pdf") return { data: { imagePaths: [String(args.pdfPath) + ".png"] }, artifacts: [] };
    throw new Error("Unexpected host tool");
  });
  const ctx = {
    runId: "wf-test", modelBinding: { id: "pi", providerId: "test", modelId: "same", thinkingLevel: "low" },
    signal: new AbortController().signal, emit: vi.fn(), runAgent, runTool,
    readText: async (path: string) => {
      if (path.endsWith("info.json")) throw new Error("ENOENT");
      return path.endsWith("template.tex") ? "\\documentclass{article}\n\\begin{document}\n\\end{document}" : "Existing experimental material and venue guidelines.";
    },
    writeArtifact: async ({ path, content, role, mediaType }: { path: string; content: string; role: string; mediaType: string }) => artifact(path, content, role, mediaType),
  } as unknown as WorkflowContext;
  return { ctx, files, runAgent, runTool };
}

describe("original PaperOrchestra PlotOff orchestration (mock host tools)", () => {
  it("runs all original phases, three-reviewer ensembles, acceptance/reversion and one format fix", async () => {
    const f = context();
    const result = await runPaperWriting(input, f.ctx);
    const data = result.data;
    expect(data).toMatchObject({ status: "completed", plottingMode: "off", finalScore: 6, upstreamCommit: "ca1b3fa01c2970fc7cda32d16245db38d57b3f56" });
    const manuscript = f.files.get(data.finalTexPath)!;
    expect(manuscript).toContain("CANDIDATE_v2");
    expect(manuscript).toContain("FORMAT_FIXED");
    expect(manuscript).not.toContain("CANDIDATE_v3");
    const refinedPdf = result.artifacts.find(item => item.path.endsWith("/attempt-1/final_refined_paper.pdf"));
    expect(refinedPdf).toBeDefined();
    expect(refinedPdf?.sha256).toBe(result.artifacts.find(item => item.path === data.finalPdfPath)?.sha256);
    const log = JSON.parse(f.files.get(data.contentWorklogPath)!);
    expect(Object.values(log).map((entry) => (entry as { outcome: string }).outcome)).toEqual([
      "ACCEPTED_SCORE_INCREASE", "ACCEPTED_NEUTRAL_IMPROVEMENT", "REJECTED_SCORE_DECREASE",
    ]);
    expect(JSON.parse(f.files.get(data.formatWorklogPath)!).v1.outcome).toBe("ACCEPTED_COMPILE_SUCCESS");
    const stages = f.runAgent.mock.calls.map(([request]) => request.stageId);
    expect(stages.filter(stage => stage.includes("-reviewer-"))).toHaveLength(12);
    expect(stages.filter(stage => stage.endsWith("-meta"))).toHaveLength(4);
    expect(stages.filter(stage => stage.includes("-format-fix-"))).toHaveLength(1);
    expect(result.artifacts.some(item => /revision-set|approval/iu.test(item.path))).toBe(false);
    for (const [request] of f.runAgent.mock.calls) {
      expect(request).not.toHaveProperty("model"); expect(request).not.toHaveProperty("provider");
    }
    const refinement = f.runAgent.mock.calls.find(([r]) => r.stageId.endsWith("-refinement-1"))![0];
    expect(refinement.images).toEqual(["workflow-runs/wf-test/attempt-1-baseline.pdf.png"]);
    // Only the five document-generation stages (whole-document or whole-manuscript output) widen the shared budget.
    const requests = f.runAgent.mock.calls.map(([request]) => request as { stageId: string; timeoutMs?: number });
    const isDocumentGeneration = (stage: string) => stage.endsWith("-outline")
      || stage.endsWith("-literature-writing") || stage.endsWith("-section-writing")
      || /-refinement-\d+$/u.test(stage) || stage.endsWith("-format-fix-1");
    const timed = requests.filter(request => isDocumentGeneration(request.stageId));
    expect(timed.map(request => request.stageId).slice().sort()).toEqual([
      "attempt-1-format-fix-1", "attempt-1-literature-writing", "attempt-1-outline",
      "attempt-1-refinement-1", "attempt-1-refinement-2", "attempt-1-refinement-3", "attempt-1-section-writing",
    ]);
    for (const request of timed) expect(request.timeoutMs).toBe(1_200_000);
    const untimed = requests.filter(request => !isDocumentGeneration(request.stageId));
    expect(untimed.length).toBeGreaterThan(0);
    expect(untimed.every(request => !("timeoutMs" in request))).toBe(true);
    const refinementInput = refinement.inputs as { prompt: string; version: string };
    expect(Object.keys(refinementInput).sort()).toEqual(["prompt", "version"]);
    expect(refinementInput.version).toBe("v1");
    expect(refinementInput.prompt).toContain("--- CURRENT LATEX SOURCE ---");
    expect(refinementInput.prompt).toContain("BASELINE");
    expect(refinementInput.prompt).toContain("--- CURRENT REVIEWER FEEDBACK (Score: 5) ---");
    expect(refinementInput.prompt).toContain("Synthetic unit-test review.");
    expect(refinementInput.prompt).toContain("--- CITATION MAP (Reference Truth) ---");
  });

  it("skips a failed candidate compilation and keeps the accepted source if formatting fails", async () => {
    const f = context({ failedCompiles: ["-refinement-1", "-format-1"] });
    const result = await runPaperWriting(input, f.ctx);
    const log = JSON.parse(f.files.get(result.data.contentWorklogPath)!);
    expect(log.v1).toBeUndefined();
    expect(log.v2.outcome).toBe("ACCEPTED_SCORE_INCREASE");
    expect(JSON.parse(f.files.get(result.data.formatWorklogPath)!).v1.outcome).toBe("REJECTED_COMPILE_FAILURE");
    expect(f.files.get(result.data.finalTexPath)).not.toContain("FORMAT_FIXED");
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.includes("-review-v1-"))).toBe(false);
  });

  it("stops on the first score decrease and skips the format-fix call when no issue is detected", async () => {
    const f = context({ firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(f.files.get(result.data.finalTexPath)).toContain("BASELINE");
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.endsWith("-refinement-2"))).toBe(false);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.endsWith("-format-fix-1"))).toBe(false);
  });

  it("rejects a format fix that rewrites the bibliography and keeps the previous manuscript", async () => {
    const initialLatex = "\\documentclass{article}\n\\begin{document}\nBASELINE \\cite{MNE}\n\\bibliography{references}\n\\end{document}\n";
    // The fix keeps the citation but swaps the bibliography for an inline list that also invents Altman.
    const formattedLatex = "\\documentclass{article}\n\\begin{document}\nBASELINE \\cite{MNE}\n"
      + "\\begin{thebibliography}{9}\n\\bibitem{MNE} Gramfort et al. MNE software.\n\\bibitem{Altman} Altman. Invented entry.\n\\end{thebibliography}\n\\end{document}\n";
    const f = context({ firstScore: 4, sectionLatex: initialLatex, formattedLatex });
    const result = await runPaperWriting(input, f.ctx);

    // The rejected candidate is still archived verbatim for inspection.
    const candidatePath = [...f.files.keys()].find(path => path.endsWith("/formatted_candidate_v1.tex"));
    expect(candidatePath).toBeDefined();
    expect(f.files.get(candidatePath!)).toBe(formattedLatex);
    // A rejected reference change is never compiled.
    expect(f.runTool.mock.calls.some(([call]) => call.name === "compile_latex"
      && String((call.input as { stem: unknown }).stem) === "attempt-1-format-1")).toBe(false);

    expect(f.files.get(result.data.finalTexPath)).toBe(initialLatex);
    expect(result.artifacts.find(item => item.path === result.data.finalPdfPath)?.sha256)
      .toBe(result.artifacts.find(item => item.path.endsWith("/attempt-1-baseline.pdf"))?.sha256);

    const formatLog = JSON.parse(f.files.get(result.data.formatWorklogPath)!);
    expect(formatLog.v1.outcome).toBe("REJECTED_REFERENCE_CHANGE");
    expect(formatLog.v1.reasonCodes.length).toBeGreaterThan(0);
    expect(result.issues.some(issue => /previous manuscript.*retained/.test(issue))).toBe(true);
  });

  it("keeps the last reviewed version when a refinement review cannot complete, without inventing a score", async () => {
    const f = context({ failReviewStage: "-review-v1-meta", formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    // The initial review is the last complete one, so it stays the final score, source and PDF.
    expect(result.data.finalScore).toBe(5);
    expect(result.data.finalReviewPath).toContain("/peer_reviews/review_v0.json");
    const manuscript = f.files.get(result.data.finalTexPath)!;
    expect(manuscript).toContain("BASELINE");
    expect(manuscript).not.toContain("CANDIDATE_v1");
    expect(result.artifacts.find(item => item.path === result.data.finalPdfPath)?.sha256)
      .toBe(result.artifacts.find(item => item.path.endsWith("/attempt-1-baseline.pdf"))?.sha256);

    // The three completed reviewer reports survive the failed meta stage.
    const ensemblePath = [...f.files.keys()].find(path => path.endsWith("/peer_reviews/ensemble_v1.json"))!;
    expect(JSON.parse(f.files.get(ensemblePath)!)).toHaveLength(3);
    const errorPath = [...f.files.keys()].find(path => path.endsWith("/peer_reviews/review_v1_error.json"))!;
    const errorReview = JSON.parse(f.files.get(errorPath)!);
    expect(Object.keys(errorReview)).toEqual(["Error"]);
    expect(errorReview.Error).toContain("Review stage ended without a result");

    const log = JSON.parse(f.files.get(result.data.contentWorklogPath)!);
    expect(log.v1).toMatchObject({ round: 1, outcome: "REVIEW_INCOMPLETE" });
    expect(log.v1.error).toContain("Review stage ended without a result");
    expect(log.v1).not.toHaveProperty("scores_after");
    expect(Object.values(log).map(entry => (entry as { outcome: string }).outcome)).toEqual(["REVIEW_INCOMPLETE"]);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.endsWith("-refinement-2"))).toBe(false);
    expect(f.runAgent.mock.calls.filter(([r]) => r.stageId.endsWith("-outline"))).toHaveLength(1);
  });

  it("retries the bounded outer attempts and rejects when the initial review never completes", async () => {
    const f = context({ failReviewStage: "-review-initial-meta", formattingIssues: false });
    await expect(runPaperWriting(input, f.ctx)).rejects.toThrow(/failed after 3 attempts/u);
    expect(f.runAgent.mock.calls.filter(([r]) => r.stageId.endsWith("-outline"))).toHaveLength(3);
    const errorPaths = [...f.files.keys()].filter(path => path.endsWith("/peer_reviews/review_initial_error.json"));
    expect(errorPaths).toHaveLength(3);
    for (const path of errorPaths) expect(Object.keys(JSON.parse(f.files.get(path)!))).toEqual(["Error"]);
    // No graded review and no completed manuscript may be produced from an incomplete review.
    expect([...f.files.keys()].some(path => /\/peer_reviews\/review_v\d+\.json$/u.test(path))).toBe(false);
    expect([...f.files.keys()].some(path => path.endsWith("/final_refined_paper.tex"))).toBe(false);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.includes("-refinement-"))).toBe(false);
  });

  it("does not insert a new citation regex gate before the original review/refinement stages", async () => {
    const initial = "\\documentclass{article}\n\\begin{document}\nA citation to inspect \\cite{needs_review}.\n\\end{document}\n";
    const f = context({ sectionLatex: initial, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(result.data.status).toBe("completed");
    const initialReview = f.runAgent.mock.calls.find(([request]) => request.stageId === "attempt-1-review-initial-reviewer-1")?.[0];
    expect((initialReview?.inputs as { paper_text: string }).paper_text).toContain("needs_review");
    expect(f.runAgent.mock.calls.filter(([request]) => request.stageId.endsWith("-outline"))).toHaveLength(1);
  });

  it("retries the whole pipeline after a failed baseline compile using isolated attempt artifacts", async () => {
    const f = context({ failBaselineCount: 1, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(f.runAgent.mock.calls.filter(([r]) => r.stageId.endsWith("-outline"))).toHaveLength(2);
    expect(result.data.finalTexPath).toContain("/attempt-2/");
    expect(result.artifacts.some(item => item.path.endsWith("attempt-1/failure.json"))).toBe(true);
  });

  it("repairs the bare citation once in place and keeps the raw draft alongside the repaired manuscript", async () => {
    const original = "\\documentclass{article}\n\\begin{document}\nBASELINE with \\citep{Ref1}.\n\\end{document}\n";
    const repaired = original.replace(String.raw`\citep{Ref1}`, String.raw`\cite{Ref1}`);
    const f = context({
      sectionLatex: original, failBaselineCount: 1, compileFailureLog: undefinedCitationCompileLog,
      firstScore: 4, formattingIssues: false,
    });
    const result = await runPaperWriting(input, f.ctx);
    expect(f.runAgent.mock.calls.filter(([r]) => r.stageId.endsWith("-outline"))).toHaveLength(1);
    const baselineStems = f.runTool.mock.calls
      .filter(([call]) => call.name === "compile_latex")
      .map(([call]) => String((call.input as { stem: unknown }).stem))
      .filter(stem => stem.includes("-baseline"));
    expect(baselineStems).toEqual(["attempt-1-baseline", "attempt-1-baseline-citation-repair"]);

    const rawPath = [...f.files.keys()].find(path => path.endsWith("/latex_writeup/raw_draft_paper.tex"))!;
    expect(f.files.get(rawPath)).toBe(original);
    const repairedPath = [...f.files.keys()].find(path => path.endsWith("/latex_writeup/citation_repaired_draft.tex"))!;
    expect(f.files.get(repairedPath)).toBe(repaired);
    const repairReportPath = [...f.files.keys()].find(path => path.endsWith("/latex_writeup/citation_repair.json"))!;
    expect(JSON.parse(f.files.get(repairReportPath)!)).toMatchObject({
      original_sha256: hash(original), repaired_sha256: hash(repaired), replacements: 1,
    });

    const initialReview = f.runAgent.mock.calls.find(([r]) => r.stageId === "attempt-1-review-initial-reviewer-1")?.[0];
    expect((initialReview?.inputs as { paper_text: string }).paper_text).toContain(String.raw`\cite{Ref1}`);
    const finalTex = f.files.get(result.data.finalTexPath)!;
    expect(finalTex).toContain(String.raw`\cite{Ref1}`);
    expect(finalTex).not.toContain(String.raw`\citep{Ref1}`);
    const finalPdf = f.files.get(result.data.finalPdfPath)!;
    expect(finalPdf.startsWith("%PDF-unit-test-only\n")).toBe(true);
    expect(finalPdf).toContain(String.raw`\cite{Ref1}`);
    expect(finalPdf).not.toContain(String.raw`\citep{Ref1}`);
  });

  it("never retries the citation repair recursively and gives up after the bounded outer attempts", async () => {
    const f = context({
      sectionLatex: "\\documentclass{article}\n\\begin{document}\nBASELINE with \\citep{Ref1}.\n\\end{document}\n",
      failedCompiles: ["-baseline", "-baseline-citation-repair"], compileFailureLog: undefinedCitationCompileLog,
    });
    await expect(runPaperWriting(input, f.ctx)).rejects.toThrow();
    const baselineStems = f.runTool.mock.calls
      .filter(([call]) => call.name === "compile_latex")
      .map(([call]) => String((call.input as { stem: unknown }).stem))
      .filter(stem => stem.includes("-baseline"));
    for (const attempt of [1, 2, 3]) {
      expect(baselineStems.filter(stem => stem === "attempt-" + String(attempt) + "-baseline")).toHaveLength(1);
      expect(baselineStems.filter(stem => stem === "attempt-" + String(attempt) + "-baseline-citation-repair")).toHaveLength(1);
    }
    expect(baselineStems).toHaveLength(6);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.includes("-review-initial-"))).toBe(false);
  });

  it("uses the enabled local library without external HTTP or fabricated public URLs", async () => {
    const fetcher = vi.fn(async () => { throw new Error("No external requests are allowed in a library-only run"); });
    vi.stubGlobal("fetch", fetcher);
    const outline = emptyOutline();
    outline.intro_related_work_plan.introduction_strategy.search_directions = ["alpha method"];
    const f = context({ outline, firstScore: 4, formattingIssues: false, researchEvidence: {
      localPapers: [{ title: "Alpha method", year: 2024, publicationDate: "2024-01-01", authors: ["A. Author"],
        abstract: "A verified abstract.", venue: "Test", source: "brainpilot-library" }],
      webResults: [], pages: [], issues: [], retrievedAt: "2026-09-13T00:00:00Z",
    } });
    const result = await runPaperWriting(input, f.ctx);
    expect(fetcher).not.toHaveBeenCalled();
    expect(f.runTool.mock.calls.filter(([call]) => call.name === "research_search")).toHaveLength(1);
    expect(f.runTool.mock.calls.some(([call]) => call.name === "research_resolve")).toBe(false);
    const citations = JSON.parse(f.files.get(result.data.citationMapPath)!);
    expect(citations.Author2024AlphaMethod.abstract).toBe("A verified abstract.");
    const papersPath = [...f.files.keys()].find(path => path.endsWith("/literature_agent_output/papers.json"))!;
    const papers = JSON.parse(f.files.get(papersPath)!);
    expect(papers[0]).toMatchObject({ source_kind: "brainpilot-library", source_url: null, public_url: null });
    expect(papers[0].metadata_sha256).toMatch(/^[a-f0-9]{64}$/u);
    const evidencePath = [...f.files.keys()].find(path => path.endsWith("/literature_agent_output/verification.json"))!;
    expect(JSON.parse(f.files.get(evidencePath)!)[0].accepted_metadata.authors).toEqual(["A. Author"]);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.includes("-literature-discovery-1-try-1"))).toBe(true);
  });

  it("keeps an unavailable or disabled research integration explicit and never falls back to S2", async () => {
    const fetcher = vi.fn(async () => { throw new Error("No S2 fallback"); });
    vi.stubGlobal("fetch", fetcher);
    const outline = emptyOutline();
    outline.intro_related_work_plan.introduction_strategy.search_directions = ["alpha method"];
    const f = context({ outline, researchFailure: "RESEARCH_DISABLED: source tools are disabled", firstScore: 4, formattingIssues: false });
    await expect(runPaperWriting(input, f.ctx)).rejects.toThrow("All configured research sources are unavailable");
    expect(fetcher).not.toHaveBeenCalled();
    const diagnostics = [...f.files.entries()].filter(([path]) => /\/(?:discovery|verification)\.json$/u.test(path));
    expect(diagnostics).toHaveLength(6);
    expect(diagnostics.some(([, content]) => content.includes("RESEARCH_DISABLED"))).toBe(true);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.includes("-literature-source-reading-"))).toBe(false);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.endsWith("-literature-writing") || r.stageId.endsWith("-section-writing"))).toBe(false);
    expect(f.runTool.mock.calls.some(([r]) => r.name === "compile_latex")).toBe(false);
  });

  it("fails before manuscript writing and preserves diagnostics when all source failures arrive as normalized evidence", async () => {
    const outline = emptyOutline();
    outline.intro_related_work_plan.introduction_strategy.search_directions = ["alpha method"];
    const f = context({ outline, researchEvidence: { localPapers: [], webResults: [], pages: [],
      sourceAvailability: { library: false, tavilySearch: true, tavilyExtract: true },
      issues: ["library_unavailable", "tavily_quota_exceeded"], retrievedAt: "2026-09-13T00:00:00Z" } });
    await expect(runPaperWriting(input, f.ctx)).rejects.toThrow("All configured research sources are unavailable");
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.endsWith("-literature-writing") || r.stageId.endsWith("-section-writing"))).toBe(false);
    const diagnostics = [...f.files.entries()].filter(([path]) => /\/(?:discovery|verification)\.json$/u.test(path));
    expect(diagnostics).toHaveLength(6);
    expect(diagnostics.every(([, content]) => content.includes("tavily_quota_exceeded"))).toBe(true);
  });

  it("rejects a model's online metadata when its abstract quote is absent from the extracted page", async () => {
    const outline = emptyOutline();
    outline.intro_related_work_plan.introduction_strategy.search_directions = ["alpha method"];
    const url = "https://example.test/paper/alpha";
    const page = "Alpha method\nA. Author. Published October 1, 2024.\nThe actual abstract is an existing empirical observation.";
    const f = context({ outline, firstScore: 4, formattingIssues: false, researchEvidence: {
      localPapers: [], webResults: [{ title: "Alpha method", url, content: "Alpha method by A. Author" }],
      pages: [{ url, content: page }], issues: [], retrievedAt: "2026-09-13T00:00:00Z",
    }, sourceReading: { papers: [{ title: "Alpha method", authors: ["A. Author"], year: 2024,
      publication_date: "2024-10-01", venue: null, abstract: "An invented abstract unsupported by the page.", source_url: url,
      support_quotes: { title: "Alpha method", authors_year: "A. Author. Published October 1, 2024.",
        publication_date: "Published October 1, 2024.", abstract: "An invented abstract unsupported by the page." },
    }] } });
    const result = await runPaperWriting(input, f.ctx);
    expect(JSON.parse(f.files.get(result.data.citationMapPath)!)).toEqual({});
    expect(f.runTool.mock.calls.some(([call]) => call.name === "research_resolve")).toBe(true);
    const saved = [...f.files.entries()].find(([path]) => path.endsWith("/literature_agent_output/verification.json"))![1];
    expect(saved).toContain("support quote does not occur");
    expect(JSON.parse(saved)[0].evidence.pages[0].content).toBe(page);
  });

  it.each([
    { label: "authors", incomplete: { authors: [] } },
    { label: "abstract", incomplete: { abstract: "" } },
    { label: "year", incomplete: { year: undefined } },
    { label: "same-year publication month", incomplete: { publicationDate: "2024" } },
  ])("skips a library record missing $label instead of filling it from the model candidate", async ({ incomplete }) => {
    const outline = emptyOutline();
    outline.intro_related_work_plan.introduction_strategy.search_directions = ["alpha method"];
    const f = context({ outline, firstScore: 4, formattingIssues: false, researchEvidence: {
      localPapers: [{ title: "Alpha method", year: 2024, publicationDate: "2024-01-01", authors: ["A. Author"],
        abstract: "An abstract extracted from the paper.", source: "brainpilot-library", ...incomplete }],
      webResults: [], pages: [], issues: [], retrievedAt: "2026-09-13T00:00:00Z",
    } });
    const result = await runPaperWriting(input, f.ctx);
    expect(JSON.parse(f.files.get(result.data.citationMapPath)!)).toEqual({});
    expect(result.issues.some(issue => issue.includes("no source-supported title"))).toBe(true);
  });
});

describe("run-scoped BrainPilot research reuse", () => {
  const outlineWithRepeatedQuery = () => {
    const outline = emptyOutline();
    outline.intro_related_work_plan.introduction_strategy.search_directions = ["alpha method"];
    outline.section_plan = [{ section_title: "Methods", subsections: [{ subsection_title: "Setup", citation_hints: ["alpha method"] }] }];
    return outline;
  };
  const resultFor = (name: string) => ({
    localPapers: [{ title: "Alpha method", year: 2024, publicationDate: "2024-01-01", source: "brainpilot-library",
      ...(name === "research_resolve" ? { authors: ["A. Author"], abstract: "Independent source-resolution abstract." } : {}) }],
    webResults: [], pages: [], issues: [], retrievedAt: "2026-09-13T00:00:00Z",
  });

  it("reuses repeated-query discovery across agent and outer retries, while separately resolving metadata and isolating runs", async () => {
    const execute = vi.fn(async (name: string) => resultFor(name));
    const first = context({ outline: outlineWithRepeatedQuery(), researchExecute: execute, discoveryRetry: true,
      failBaselineCount: 1, firstScore: 4, formattingIssues: false });
    await runPaperWriting(input, first.ctx);
    expect(execute.mock.calls.map(([name]) => name)).toEqual(["research_search", "research_resolve"]);
    expect(first.runAgent.mock.calls.filter(([request]) => request.stageId.includes("-literature-discovery-"))).toHaveLength(8);
    const saved = [...first.files.entries()].filter(([path]) => path.endsWith("/literature_agent_output/papers.json"));
    expect(saved).toHaveLength(2);
    for (const [, content] of saved) expect(JSON.parse(content)).toMatchObject([{ abstract: "Independent source-resolution abstract." }]);
    expect(first.runTool.mock.calls.find(([request]) => request.name === "research_resolve")?.[0].input)
      .toEqual({ title: "Alpha method", urls: [] });

    const second = context({ outline: outlineWithRepeatedQuery(), researchExecute: execute, firstScore: 4, formattingIssues: false });
    await runPaperWriting(input, second.ctx);
    expect(execute.mock.calls.map(([name]) => name)).toEqual(["research_search", "research_resolve", "research_search", "research_resolve"]);
  });

  it("does not cache a failed discovery call or consume an outer attempt to retry it", async () => {
    let failed = false;
    const execute = vi.fn(async (name: string) => {
      if (name === "research_search" && !failed) { failed = true; throw new Error("Transient research source failure"); }
      return resultFor(name);
    });
    const f = context({ outline: outlineWithRepeatedQuery(), researchExecute: execute, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(execute.mock.calls.map(([name]) => name)).toEqual(["research_search", "research_search", "research_resolve"]);
    expect(f.runAgent.mock.calls.filter(([request]) => request.stageId.endsWith("-outline"))).toHaveLength(1);
    expect(Object.keys(JSON.parse(f.files.get(result.data.citationMapPath)!))).toHaveLength(1);
  });

  it("retries failed source resolution independently for a later section", async () => {
    let failed = false;
    const execute = vi.fn(async (name: string) => {
      if (name === "research_resolve" && !failed) { failed = true; throw new Error("Transient source-page failure"); }
      return resultFor(name);
    });
    const f = context({ outline: outlineWithRepeatedQuery(), researchExecute: execute, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(execute.mock.calls.map(([name]) => name)).toEqual(["research_search", "research_resolve", "research_resolve"]);
    expect(Object.keys(JSON.parse(f.files.get(result.data.citationMapPath)!))).toHaveLength(1);
    expect(result.issues.some(issue => issue.includes("Transient source-page failure"))).toBe(true);
  });

  it.each(["research_search", "research_resolve"])("evicts fully unavailable normalized %s evidence so a subsequent call can recover", async failingName => {
    let failed = false;
    const execute = vi.fn(async (name: string) => {
      if (name === failingName && !failed) {
        failed = true;
        return { localPapers: [], webResults: [], pages: [], issues: ["library_timeout", "tavily_unavailable"],
          sourceAvailability: { library: false, tavilySearch: false, tavilyExtract: false }, retrievedAt: "2026-09-13T00:00:00Z" };
      }
      return resultFor(name);
    });
    const f = context({ outline: outlineWithRepeatedQuery(), researchExecute: execute, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(execute.mock.calls.filter(([name]) => name === failingName)).toHaveLength(2);
    expect(Object.keys(JSON.parse(f.files.get(result.data.citationMapPath)!))).toHaveLength(1);
  });

  it("retains a healthy empty search in the cache and distinguishes it from source unavailability", async () => {
    const execute = vi.fn(async () => ({ localPapers: [], webResults: [], pages: [], issues: [],
      sourceAvailability: { library: true, tavilySearch: false, tavilyExtract: false }, retrievedAt: "2026-09-13T00:00:00Z" }));
    const f = context({ outline: outlineWithRepeatedQuery(), researchExecute: execute, failBaselineCount: 1, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.files.get(result.data.citationMapPath)!)).toEqual({});
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.endsWith("-literature-writing"))).toBe(true);
  });

  it("caches usable library evidence despite Tavily quota errors and retains the partial-source warning", async () => {
    const execute = vi.fn(async () => ({ ...resultFor("research_resolve"), issues: ["tavily_quota_exceeded"],
      sourceAvailability: { library: true, tavilySearch: true, tavilyExtract: true } }));
    const f = context({ outline: outlineWithRepeatedQuery(), researchExecute: execute, discoveryRetry: true,
      failBaselineCount: 1, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(Object.keys(JSON.parse(f.files.get(result.data.citationMapPath)!))).toHaveLength(1);
    expect(result.issues).toContain("tavily_quota_exceeded");
  });
});

describe("literature discovery selection", () => {
  const outlineWithDirection = () => {
    const outline = emptyOutline();
    outline.intro_related_work_plan.introduction_strategy.search_directions = ["alpha method"];
    return outline;
  };
  /** Healthy, non-empty search evidence: the fixture input never limits the discovery outcome. */
  const healthyEvidence = {
    localPapers: [{ title: "Alpha method", year: 2024, publicationDate: "2024-01-01", authors: ["A. Author"],
      abstract: "A test abstract.", venue: "Test", source: "brainpilot-library" }],
    webResults: [], pages: [], issues: [], retrievedAt: "2026-09-14T00:00:00Z",
  };

  it("accepts a definitive empty selection after a single discovery call despite non-empty search evidence", async () => {
    const f = context({ outline: outlineWithDirection(), researchEvidence: healthyEvidence,
      discoveryEmpty: true, firstScore: 4, formattingIssues: false });
    const result = await runPaperWriting(input, f.ctx);
    const discovery = f.runAgent.mock.calls.map(([request]) => request.stageId)
      .filter(stage => stage.includes("-literature-discovery-"));
    expect(discovery).toEqual(["attempt-1-literature-discovery-1-try-1"]);
    expect(f.runTool.mock.calls.some(([call]) => call.name === "research_resolve")).toBe(false);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.includes("-literature-source-reading-"))).toBe(false);
    expect(JSON.parse(f.files.get(result.data.citationMapPath)!)).toEqual({});
  });

  it("retries every try when the candidates are non-empty but unsupported by the search evidence", async () => {
    const f = context({ outline: outlineWithDirection(), researchEvidence: healthyEvidence,
      discoveryUnsupported: true, firstScore: 4, formattingIssues: false });
    await runPaperWriting(input, f.ctx);
    const discovery = f.runAgent.mock.calls.map(([request]) => request.stageId)
      .filter(stage => stage.includes("-literature-discovery-"));
    expect(discovery).toEqual([
      "attempt-1-literature-discovery-1-try-1", "attempt-1-literature-discovery-1-try-2", "attempt-1-literature-discovery-1-try-3",
    ]);
    expect(f.runAgent.mock.calls.some(([r]) => r.stageId.includes("-literature-source-reading-"))).toBe(false);
  });
});

describe("research evidence verification", () => {
  it("requires a real publication year and enough precision to establish the cutoff", () => {
    expect(researchPaperBeforeCutoff({}, "2024-11")).toBe(false);
    expect(researchPaperBeforeCutoff({ year: 2024 }, "2024-11")).toBe(false);
    expect(researchPaperBeforeCutoff({ year: 2023 }, "2024-11")).toBe(true);
    expect(researchPaperBeforeCutoff({ year: 2024, publicationDate: "2024-10" }, "2024-11")).toBe(true);
    expect(researchPaperBeforeCutoff({ year: 2024, publicationDate: "2024-11-01" }, "2024-11")).toBe(false);
    expect(researchPaperBeforeCutoff({ year: 2024, publicationDate: "2024-02-30" }, "2024-11")).toBe(false);
    expect(researchPaperBeforeCutoff({ year: 2023, publicationDate: "2024-01-01" }, "2024-11")).toBe(false);
  });

  it("admits candidates only when their titles occur in source evidence", () => {
    expect(candidateHasResearchEvidence("Alpha method", { localPapers: [{ title: "Alpha Method" }] })).toBe(true);
    expect(candidateHasResearchEvidence("Alpha method", { webResults: [{ title: "Publication page", content: "Alpha method — source abstract" }] })).toBe(true);
    expect(candidateHasResearchEvidence("Invented work", { webResults: [{ title: "Alpha method", content: "Different source" }] })).toBe(false);
    expect(candidateHasResearchEvidence("α method", { localPapers: [{ title: "β method" }] })).toBe(false);
  });

  it("accepts supported source-reading metadata and rejects changed authors, URL or date precision", () => {
    const url = "https://example.test/paper/alpha";
    const abstract = "The actual abstract is an existing empirical observation.";
    const content = "Alpha method\nA. Author. Published October 1, 2024.\n" + abstract;
    const extracted = { title: "Alpha method", authors: ["A. Author"], year: 2024, publication_date: "2024-10-01",
      venue: null, abstract, source_url: url, support_quotes: {
        title: "Alpha method", authors_year: "A. Author. Published October 1, 2024.",
        publication_date: "Published October 1, 2024.", abstract,
      } };
    const pages = [{ url, content }];
    expect(verifyWebResearchPaper("Alpha method", extracted, pages, "2024-11")).toBeUndefined();
    expect(verifyWebResearchPaper("Alpha method", { ...extracted, authors: ["Invented Scientist"] }, pages, "2024-11")).toContain("authors");
    expect(verifyWebResearchPaper("Alpha method", { ...extracted, authors: ["Li"] }, pages, "2024-11")).toContain("authors");
    expect(verifyWebResearchPaper("Alpha method", { ...extracted, authors: ["Z. Author"] }, pages, "2024-11")).toContain("authors");
    expect(verifyWebResearchPaper("Alpha method", { ...extracted, authors: ["Alice Author"] }, pages, "2024-11")).toContain("authors");
    const longerTitle = { ...extracted, support_quotes: { ...extracted.support_quotes, title: "Alpha method revisited" } };
    expect(verifyWebResearchPaper("Alpha method", longerTitle,
      [{ url, content: content.replace("Alpha method\n", "Alpha method revisited\n") }], "2024-11")).toContain("complete");
    // Both the extracted title and its quote can be consistently truncated.
    // The unchanged extraction must still fail against the longer source title.
    expect(verifyWebResearchPaper("Alpha method", extracted,
      [{ url, content: content.replace("Alpha method\n", "Alpha method revisited\n") }], "2024-11")).toContain("complete source title line");
    for (const titleLine of ["# Alpha method", "## **Alpha method** ##", "Title: Alpha method",
      '<h1>Alpha <em>method</em></h1>', "[Alpha method](https://example.test/paper/alpha)",
      "### **[Alpha method](https://example.test/paper/alpha)**", "**Title:** Alpha method"]) {
      expect(verifyWebResearchPaper("Alpha method", extracted,
        [{ url, content: content.replace("Alpha method\n", titleLine + "\n") }], "2024-11")).toBeUndefined();
    }
    for (const titleLine of ["Introduction to Alpha method", "Alpha method: a reassessment",
      "[Alpha method](https://example.test/paper/alpha) revisited", "Alpha method is mentioned in this paragraph."]) {
      expect(verifyWebResearchPaper("Alpha method", extracted,
        [{ url, content: content.replace("Alpha method\n", titleLine + "\n") }], "2024-11")).toContain("complete source title line");
    }
    expect(verifyWebResearchPaper("Alpha method", extracted,
      [{ url, content: content.replaceAll("\n", " ") }], "2024-11")).toContain("complete source title line");
    expect(verifyWebResearchPaper("Alpha method", { ...extracted, source_url: "https://example.test/invented" }, pages, "2024-11")).toContain("source URL");
    expect(verifyWebResearchPaper("Alpha method", { ...extracted, publication_date: "2024-01-01" }, pages, "2024-11")).toContain("precision");
    expect(verifyWebResearchPaper("Alpha method", { ...extracted, publication_date: null }, pages, "2024-11")).toContain("cutoff");
  });

  it("accepts a separately quoted byline and publication date year with a short abstract excerpt", () => {
    const url = "https://example.test/paper/baseline";
    const abstract = "Prior work established a baseline measurement that later studies extended. " +
      "The present experiment tests whether that baseline reproduces under a different stimulus. " +
      "We report a consistent effect across two independent cohorts.";
    const byline = "M. Author, B. Second, C. Third";
    const content = "Evidence backed baseline effect\n" + byline + "\nFront. Neurosci., 26 December 2013\n" + abstract;
    const extracted = { title: "Evidence backed baseline effect", authors: ["M. Author", "B. Second", "C. Third"],
      year: 2013, publication_date: "2013-12-26", venue: null, abstract, source_url: url, support_quotes: {
        title: "Evidence backed baseline effect", authors_year: byline,
        publication_date: "Front. Neurosci., 26 December 2013",
        abstract: "Prior work established a baseline measurement that later studies extended. " +
          "The present experiment tests whether that baseline reproduces under a different stimulus.",
      } };
    const pages = [{ url, content }];
    expect(verifyWebResearchPaper("Evidence backed baseline effect", extracted, pages, "2024-11")).toBeUndefined();
    expect(verifyWebResearchPaper("Evidence backed baseline effect",
      { ...extracted, authors: ["M. Author", "B. Second", "D. Invented"] }, pages, "2024-11")).toContain("authors");
    expect(verifyWebResearchPaper("Evidence backed baseline effect", { ...extracted, year: 2014 }, pages, "2024-11"))
      .toContain("publication year");
    expect(verifyWebResearchPaper("Evidence backed baseline effect",
      { ...extracted, support_quotes: { ...extracted.support_quotes, authors_year: "Front. Neurosci., 26 December 2013" } },
      pages, "2024-11")).toContain("authors");
    expect(verifyWebResearchPaper("Evidence backed baseline effect",
      { ...extracted, support_quotes: { ...extracted.support_quotes, publication_date: "Front. Neurosci., 26 December 2014" } },
      pages, "2024-11")).toContain("publication year");
    expect(verifyWebResearchPaper("Evidence backed baseline effect",
      { ...extracted, authors: ["M. Author", "B. Second", "C. Third", "E. Fourth"] }, pages, "2024-11")).toContain("authors");
    expect(verifyWebResearchPaper("Evidence backed baseline effect",
      { ...extracted, abstract: abstract + " An appended claim the source never printed." }, pages, "2024-11"))
      .toContain("abstract");
    expect(verifyWebResearchPaper("Evidence backed baseline effect",
      { ...extracted, support_quotes: { ...extracted.support_quotes, abstract: "A paraphrase of the results." } }, pages, "2024-11"))
      .toContain("abstract");
    expect(verifyWebResearchPaper("Evidence backed baseline effect",
      { ...extracted, abstract: "A short but unsupported abstract." }, pages, "2024-11")).toContain("abstract");
  });
});
