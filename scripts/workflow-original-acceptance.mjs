#!/usr/bin/env node
/**
 * TEST ONLY — run on 208/Linux after building this checkout.
 * Default PaperWritingWorkflow + SessionManager + WorkflowHost are real.
 * Model sessions and Semantic Scholar responses are deterministic mocks.
 * TeX compilation, PDF text extraction and page rendering MUST be native.
 * No approval/action driver, real provider, or external network is used.
 */
import assert from "node:assert/strict";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "linux") throw new Error("Run this acceptance driver only on the designated 208 Linux host.");
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--output" || !args[1]) {
  throw new Error("Usage: node scripts/workflow-original-acceptance.mjs --output <NEW-directory>");
}
const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDir = join(checkout, "scripts", "fixtures", "workflow-original");
const output = resolve(args[1]);
await mkdir(output, { recursive: false, mode: 0o700 });
const dataRoot = join(output, "data"); await mkdir(dataRoot, { mode: 0o700 });
Object.assign(process.env, { BP_MOCK: "1", BP_LOCAL_MODE: "1", BP_DATA_DIR: dataRoot,
  BP_KB_ROOT: join(output, "knowledge-base"), PI_CODING_AGENT_DIR: join(output, "pi-agent"),
  SEMANTIC_SCHOLAR_API_KEY: "", S2_API_KEY: "" });

const boundary = "TEST ONLY: scripted Principal/tool selection, mocked model sessions and Semantic Scholar metadata; real default writing workflow, runtime lifecycle, filesystem, TeX compilation, PDF extraction and rendering. No scientific-quality or real-model-routing claim.";
const s2Fixture = JSON.parse(await readFile(join(fixtureDir, "semantic-scholar.json"), "utf8"));
const baseTemplate = await readFile(join(fixtureDir, "latex_template", "template.tex"), "utf8");
const stages = [];
const networkCalls = [];
const principalCalls = [];
const events = [];
const disposedStages = new Set();
let citationKey;
let manager;
let sessionId;
let run;
const previousFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const allowed = url.origin === "https://api.semanticscholar.org" && /^\/graph\/v1\/paper\/search\/?$/.test(url.pathname);
  networkCalls.push({ origin: url.origin, path: url.pathname, allowed, query: allowed ? url.searchParams.get("query") : undefined,
    limit: allowed ? Number(url.searchParams.get("limit")) : undefined });
  if (!allowed) throw new Error(`Real network is disabled in this driver: ${url.origin}${url.pathname}`);
  init?.signal?.throwIfAborted();
  return Response.json({ total: s2Fixture.data.length, offset: 0, data: structuredClone(s2Fixture.data) });
};

const binding = { model: { id: "original-pipeline-mock", provider: "fixture-only", api: "openai-completions", input: ["text", "image"] },
  modelRuntime: { fixtureOnly: true }, thinkingLevel: "off" };
const upstreamTail = "Strict Knowledge Isolation & Anonymity";
const principalTerminal = "A previously accepted workflow has settled";

function outline() {
  return {
    plotting_plan: [],
    intro_related_work_plan: {
      introduction_strategy: { hook_hypothesis: "A synthetic workflow fixture needs clear evidence.", problem_gap_hypothesis: "Only the supplied two-condition comparison is available.",
        search_directions: ["Synthetic workflow validation context", "Synthetic workflow validation surveys", "Synthetic workflow validation foundations"] },
      related_work_strategy: { overview: "Distinguish fixture context from scientific validation.", subsections: [
        { subsection_title: "2.1 Workflow validation", methodology_cluster: "Execution checks", sota_investigation_mission: "Find context only.", limitation_hypothesis: "Software tests do not establish empirical effects.", limitation_search_queries: ["Synthetic workflow validation limitations"], bridge_to_our_method: "Report only the fixture." },
        { subsection_title: "2.2 Structured outputs", methodology_cluster: "Artifact checks", sota_investigation_mission: "Find context only.", limitation_hypothesis: "An editable file is not a quality score.", limitation_search_queries: ["Synthetic workflow validation artifacts"], bridge_to_our_method: "Inspect actual files." },
      ] },
    },
    section_plan: [
      { section_title: "Methods", subsections: [{ subsection_title: "Fixture setup", content_bullets: ["Use the existing synthetic condition labels."], citation_hints: ["Synthetic Workflow Validation"] }] },
      { section_title: "Results", subsections: [{ subsection_title: "Observed fixture values", content_bullets: ["A=0.71, B=0.73; preserve the non-significant test."], citation_hints: [] }] },
    ],
  };
}

function citationFrom(input) {
  const records = input.collected_papers;
  const key = Array.isArray(records) ? records[0]?.citation_key : Object.keys(input.citation_map ?? {})[0];
  if (key) citationKey = key;
  assert(citationKey, "a real pipeline-generated citation key must reach the writer");
  assert(/^[A-Za-z0-9_-]+$/.test(citationKey), "the fixture citation key must be TeX-safe");
  return citationKey;
}

function introductionTemplate(key) {
  return baseTemplate
    .replace("% FILL_INTRODUCTION", `Synthetic fixture data are used only for execution validation. The supplied library includes a mock reference~\\cite{${key}}.`)
    .replace("% FILL_RELATED_WORK", `This fixture compares no published scientific method. Its reference metadata are synthetic~\\cite{${key}}.`);
}

function manuscript(marker, key) {
  const results = String.raw`The accuracies are 0.71 and 0.73. The pre-specified comparison was not significant.
\begin{table}[h]
\centering
\begin{tabular}{lr}
\toprule
Condition & Accuracy \\
\midrule
A & 0.71 \\
B & 0.73 \\
\bottomrule
\end{tabular}
\caption{Synthetic fixture values.}
\end{table}
\paragraph{Execution marker} ${marker}.`;
  return introductionTemplate(key)
    .replace("% FILL_ABSTRACT", "Synthetic fixture data exercise the original writing pipeline and native PDF tools; no empirical research claim is made.")
    .replace("% FILL_METHODS", "We report only the two fixture conditions supplied in the experimental log.")
    .replace("% FILL_RESULTS", results)
    .replace("% FILL_DISCUSSION", "The values and reference are synthetic. They support software-path inspection, not scientific conclusions.")
    .replace("% FILL_CONCLUSION", "The fixture preserves supplied values while exercising deterministic workflow control.");
}

function review(version, reviewerIndex) {
  const baseline = { initial: 5, v1: 6, v2: 6, v3: 5 }[version];
  assert(baseline !== undefined, `unexpected review version ${version}`);
  const subscore = version === "initial" ? 2 : version === "v3" ? 4 : 3;
  const overall = reviewerIndex === undefined ? 10 : baseline + reviewerIndex - 2;
  return { Summary: `Scripted evaluation of ${version}; this is not a quality assessment.`, Strengths: ["The fixture is readable."], Weaknesses: ["Clarify presentation."],
    Originality: reviewerIndex === undefined ? 1 : subscore, Quality: reviewerIndex === undefined ? 1 : subscore,
    Clarity: reviewerIndex === undefined ? 1 : version === "v2" ? 4 : subscore,
    Significance: reviewerIndex === undefined ? 1 : subscore, Questions: ["Can the explanation be clearer?"], Limitations: ["Synthetic fixture only."],
    "Ethical Concerns": false, Soundness: reviewerIndex === undefined ? 1 : subscore, Presentation: reviewerIndex === undefined ? 1 : subscore,
    Contribution: reviewerIndex === undefined ? 1 : subscore, Overall: overall, Confidence: reviewerIndex === undefined ? 1 : 4,
    Decision: overall >= 6 ? "Accept" : "Reject" };
}

function responseFor(stageId, input, instructions, images) {
  assert(stageId.startsWith("attempt-1-"), `the main scenario must not hide a failure behind an outer retry: ${stageId}`);
  if (/(?:-outline$|-literature-writing$|-section-writing$|-refinement-\d+$)/.test(stageId)) {
    assert(instructions.includes(upstreamTail), `upstream isolation/anonymity tail missing in ${stageId}`);
  }
  if (stageId === "attempt-1-outline") return outline();
  if (/^attempt-1-literature-discovery-\d+-try-1$/.test(stageId)) return {
    section_name: "Synthetic fixture discovery", candidates: [{ title: s2Fixture.data[0].title, year: 2023, reason: "Synthetic metadata for a deterministic test." }],
  };
  if (stageId === "attempt-1-literature-writing") return { latex: introductionTemplate(citationFrom(input)) };
  if (stageId === "attempt-1-section-writing") return { latex: manuscript("VERSION ZERO", citationFrom(input)) };
  const evaluation = /^attempt-1-review-(initial|v[123])-(reviewer-([123])|meta)$/.exec(stageId);
  if (evaluation) {
    const version = evaluation[1]; assert.equal(input.version, version);
    if (evaluation[3]) {
      assert(typeof input.paper_text === "string" && /synthetic fixture/i.test(input.paper_text), "reviewers must receive text extracted from an actual PDF");
      assert(!input.paper_text.includes("\\documentclass"), "PDF review must not silently use raw TeX");
    } else assert.equal(input.reviews.length, 3, "meta-review must receive three completed reviews");
    return review(version, evaluation[3] ? Number(evaluation[3]) : undefined);
  }
  const refinement = /^attempt-1-refinement-([123])$/.exec(stageId);
  if (refinement) {
    assert(images.length > 0, "content refinement must receive real page images from the current compiled PDF");
    return { latex: manuscript(["", "CONTENT ONE", "CONTENT TWO", "REJECTED THREE"][Number(refinement[1])], citationKey),
      worklog: { addressed_weaknesses: ["Changed fixture presentation."], integrated_answers: ["Clarified the supplied observations."], actions_taken: [`Prepared candidate ${refinement[1]}.`] } };
  }
  if (stageId === "attempt-1-format-review-1") {
    assert(images.length > 0, "format review must receive actual rendered page images");
    assert(input.latex.includes("CONTENT TWO") && !input.latex.includes("REJECTED THREE"), "format review must use the accepted candidate after rollback");
    return { figure_and_tables: { "Table 1": { detected_issue: "Synthetic formatting test: adjust column padding.", suggested_fix: "Set tabcolsep to 6pt." } }, other_issues: [] };
  }
  if (stageId === "attempt-1-format-fix-1") {
    assert(input.latex.includes("CONTENT TWO") && !input.latex.includes("REJECTED THREE"));
    return { latex: input.latex.replace("\\setlength{\\tabcolsep}{4pt}", "\\setlength{\\tabcolsep}{6pt}")
      .replace("\\end{document}", "% FORMATTED FINAL\n\\end{document}") };
  }
  throw new Error(`Unexpected model stage: ${stageId}`);
}

async function waitFor(predicate, timeoutMs = 240_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Original-pipeline acceptance timed out");
    await new Promise(resolveWait => setTimeout(resolveWait, 50));
  }
}

try {
  const { SessionManager } = await import("../packages/runtime/dist/session-manager.js");
  const { mockAgentFactory } = await import("../packages/runtime/dist/agent-factory.js");
  const factory = async params => {
    if (!params.workflowModelBinding) {
      assert(!params.systemTools.some(tool => tool.name === "workflow_action"), "the original-flow host must not expose the removed approval action");
      const session = await mockAgentFactory(params);
      const prompt = session.prompt.bind(session);
      session.prompt = async (text, opts) => { principalCalls.push({ name: params.agentName, text }); return prompt(text, opts); };
      session.getWorkflowModelBinding = () => binding;
      session.subscribe(event => events.push({ agent: params.agentName, type: event.type, toolName: event.toolName }));
      return session;
    }
    assert.equal(params.workflowModelBinding.model.id, binding.model.id);
    assert.equal(params.workflowModelBinding.modelRuntime, binding.modelRuntime);
    assert.equal(params.thinkingLevel, binding.thinkingLevel);
    const stageId = /attempt-\d+-[^:]+/.exec(params.agentName)?.[0]; assert(stageId, "stage identity missing");
    const listeners = new Set(); let streaming = false; let aborted = false;
    return {
      sessionId: params.sessionId,
      get isStreaming() { return streaming; },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async prompt(text, opts) {
        streaming = true;
        try {
          assert(!aborted, "a cancelled mock model must not execute");
          const input = JSON.parse(text); const images = opts?.images ?? [];
          for (const image of images) {
            assert.equal(image.type, "image"); assert.equal(image.mimeType, "image/png");
            const bytes = Buffer.from(image.data, "base64");
            assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "the host must load genuine rendered PNG bytes");
            assert(bytes.length > 100);
          }
          const value = responseFor(stageId, input, params.systemPrompt, images);
          stages.push({ stageId, version: input.version, imageCount: images.length, instructionChars: params.systemPrompt.length,
            upstreamTail: params.systemPrompt.includes(upstreamTail), outputKeys: Object.keys(value) });
          const submit = params.systemTools.find(tool => tool.name === "submit_result"); assert(submit);
          await submit.execute({ result: value });
          for (const listener of listeners) listener({ type: "message_end", message: { role: "assistant", stopReason: "stop", usage: { input: 0, output: 0, totalTokens: 0 } } });
        } finally { streaming = false; }
      },
      setThinkingLevel() {}, async abort() { aborted = true; }, dispose() { disposedStages.add(stageId); },
    };
  };
  // No workflowImplementations override: use the production default registry.
  manager = new SessionManager({ dataRoot, persist: true, agentFactory: factory, maxConcurrentAgents: 1, memLimitBytes: null, workflowStageTimeoutMs: 30_000 });
  const writing = manager.listWorkflowDefinitions().find(item => item.id === "paper-writing"); assert(writing);
  assert.equal(writing.enabled, false);
  await manager.setWorkflowAvailability({ revision: 1, enabledWorkflowIds: ["paper-writing"] });
  const session = await manager.createSession({ title: "[TEST] Original PaperOrchestra flow", domainResources: "base", thinkingLevel: "off" });
  sessionId = session.id;
  const workspace = join(dataRoot, "workspaces", sessionId);
  await cp(fixtureDir, join(workspace, "original-fixture"), { recursive: true });
  const input = { raw_materials_dir: "/workspace/original-fixture/raw_materials", latex_template_dir: "/workspace/original-fixture/latex_template",
    research_cutoff: "2024-11", use_plotting: false };
  manager.subscribe(sessionId, event => events.push({ type: event.type, name: event.name }));
  await manager.sendMessage(sessionId, "Inspect the available fixture workflow. [[tool:workflow_search {}]]");
  await waitFor(() => manager.getSessionState(sessionId)?.workState.active === false);
  await manager.sendMessage(sessionId, `Execute the supplied synthetic manuscript fixture. [[tool:workflow_start ${JSON.stringify({ workflowId: "paper-writing", input })}]]`);
  await waitFor(() => manager.listWorkflowRuns(sessionId).length === 1);
  await waitFor(() => {
    const current = manager.listWorkflowRuns(sessionId)[0];
    return ["succeeded", "failed", "cancelled", "interrupted"].includes(current?.status) && manager.getSessionState(sessionId)?.workState.active === false;
  });
  [run] = manager.listWorkflowRuns(sessionId);
  assert.equal(run.status, "succeeded", run.error ?? "writing did not succeed");
  const data = run.result?.data; assert(data && typeof data === "object");
  assert.equal(data.status, "completed"); assert.equal(data.plottingMode, "off"); assert.equal(data.finalScore, 6);
  const artifactFile = path => {
    assert.equal(typeof path, "string");
    const target = resolve(workspace, path.startsWith("/workspace/") ? path.slice(11) : path);
    assert(target.startsWith(workspace + sep), "artifacts must belong to this fixture's workspace"); return target;
  };
  const finalTex = await readFile(artifactFile(data.finalTexPath), "utf8");
  const finalPdf = await readFile(artifactFile(data.finalPdfPath));
  assert(finalTex.includes("CONTENT TWO") && finalTex.includes("FORMATTED FINAL") && !finalTex.includes("REJECTED THREE"));
  assert(finalTex.includes("\\setlength{\\tabcolsep}{6pt}"));
  assert.equal(finalPdf.subarray(0, 5).toString(), "%PDF-"); assert(finalPdf.length > 1000);
  const contentWorklog = JSON.parse(await readFile(artifactFile(data.contentWorklogPath), "utf8"));
  assert.deepEqual(Object.values(contentWorklog).map(item => item.outcome), ["ACCEPTED_SCORE_INCREASE", "ACCEPTED_NEUTRAL_IMPROVEMENT", "REJECTED_SCORE_DECREASE"]);
  const formatWorklog = JSON.parse(await readFile(artifactFile(data.formatWorklogPath), "utf8"));
  assert.equal(Object.values(formatWorklog)[0]?.outcome, "ACCEPTED_COMPILE_SUCCESS");
  for (const stageId of ["attempt-1-outline", "attempt-1-literature-writing", "attempt-1-section-writing"]) {
    assert.equal(stages.filter(item => item.stageId === stageId).length, 1, `${stageId} must execute exactly once`);
  }
  for (const version of ["initial", "v1", "v2", "v3"]) {
    assert.equal(stages.filter(item => item.stageId.startsWith(`attempt-1-review-${version}-reviewer-`)).length, 3);
    assert.equal(stages.filter(item => item.stageId === `attempt-1-review-${version}-meta`).length, 1);
  }
  assert.equal(stages.filter(item => /^attempt-1-refinement-[123]$/.test(item.stageId)).length, 3);
  assert.equal(stages.filter(item => item.stageId === "attempt-1-format-review-1").length, 1);
  assert.equal(stages.filter(item => item.stageId === "attempt-1-format-fix-1").length, 1);
  assert(stages.filter(item => item.upstreamTail).length >= 6, "outline, literature, section and all refinements must retain the upstream tail");
  assert(stages.every(item => disposedStages.has(item.stageId)), "all stage sessions must be disposed");
  assert(networkCalls.length > 0 && networkCalls.every(call => call.allowed));
  assert(networkCalls.some(call => call.limit === 100), "discovery must obtain mocked search evidence");
  assert(networkCalls.some(call => call.limit === 3), "title verification must execute separately");
  assert(!events.some(event => event.type === "user_input_request" || event.toolName === "ask_user" || event.toolName === "workflow_action"));
  assert(!run.artifacts.some(artifact => /revision-set|revision-plan|approval\.json/.test(artifact.path)));
  assert(!("revisionSetPath" in data) && !("sourceHash" in data) && !("approvalRequestId" in data));
  assert.equal(principalCalls.filter(call => call.text.includes(principalTerminal)).length, 1);
  const pdfArtifacts = run.artifacts.filter(artifact => artifact.mediaType === "application/pdf");
  assert(pdfArtifacts.length >= 5, "baseline, three candidates and format candidate must actually compile");
  // render_pdf returns temporary page paths for model context; publishing them
  // as user artifacts is optional. Every delivered image payload was checked
  // for real PNG bytes in the factory above, including the format-review input.
  const imageArtifacts = run.artifacts.filter(artifact => artifact.mediaType === "image/png");
  const validatedRenderedImagePayloads = stages.reduce((total, stage) => total + stage.imageCount, 0);
  assert(validatedRenderedImagePayloads > 0, "native rendered images must reach the model stages");
  for (const artifact of pdfArtifacts) assert.equal((await readFile(artifactFile(artifact.path))).subarray(0, 5).toString(), "%PDF-");
  const sourceCounters = {
    outline: stages.filter(item => /-outline$/.test(item.stageId)).length,
    literatureDiscovery: stages.filter(item => /-literature-discovery-/.test(item.stageId)).length,
    literatureWriting: stages.filter(item => /-literature-writing$/.test(item.stageId)).length,
    sectionWriting: stages.filter(item => /-section-writing$/.test(item.stageId)).length,
    reviewers: stages.filter(item => /-reviewer-[123]$/.test(item.stageId)).length,
    metaReviews: stages.filter(item => /-meta$/.test(item.stageId)).length,
    fullDocumentRefinements: stages.filter(item => /^attempt-1-refinement-[123]$/.test(item.stageId)).length,
    formattingReviews: stages.filter(item => /-format-review-1$/.test(item.stageId)).length,
    formattingFixes: stages.filter(item => /-format-fix-1$/.test(item.stageId)).length,
  };
  const report = { boundary, result: "passed", upstreamCommit: data.upstreamCommit, sessionId, runId: run.id,
    mockModelCalls: stages.length, realProviderCalls: 0, realExternalHttpCalls: 0, mockedS2Calls: networkCalls.length,
    nativePdfArtifacts: pdfArtifacts.length, validatedRenderedImagePayloads, publishedImageArtifacts: imageArtifacts.length, finalScore: data.finalScore,
    contentOutcomes: Object.values(contentWorklog).map(item => item.outcome), finalTexPath: artifactFile(data.finalTexPath), finalPdfPath: artifactFile(data.finalPdfPath),
    humanApprovalRequests: 0, workflowActionCalls: 0, sourceCounters, stages, networkCalls, artifacts: run.artifacts };
  await writeFile(join(output, "original-acceptance-report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(output, "workflow-run.json"), JSON.stringify(run, null, 2));
  console.log(JSON.stringify({ result: "passed", boundary, report: join(output, "original-acceptance-report.json"), finalPdfPath: report.finalPdfPath }));
} catch (error) {
  const diagnostic = { boundary, result: "failed", message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined, sessionId, run: sessionId && manager?.listWorkflowRuns(sessionId)[0], stages, networkCalls, events };
  await writeFile(join(output, "original-acceptance-failure.json"), JSON.stringify(diagnostic, null, 2));
  console.error(JSON.stringify({ result: "failed", message: diagnostic.message, report: join(output, "original-acceptance-failure.json") }));
  process.exitCode = 1;
} finally {
  await manager?.shutdownAndSave();
  globalThis.fetch = previousFetch;
}
