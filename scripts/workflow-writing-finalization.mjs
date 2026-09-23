#!/usr/bin/env node
/**
 * Pure, model-free finalization accounting for the writing acceptance run.
 *
 * Stage metadata can report `completed` with one submit and still leave the run
 * unusable: the stage lifecycle can fail teardown after the result was produced,
 * an incomplete refinement review round keeps the older manuscript and review,
 * or the final attempt's peer review can error and be persisted as an error
 * artifact. PaperOrchestra retains the previous valid review in each of those
 * cases, so the existence of a compiled PDF is never evidence that the final
 * attempt was actually reviewed, finalized and cleanly closed.
 *
 * This module answers only that lifecycle question. It inspects no scientific
 * scores and requires no positive improvement: an ordinary REJECTED_* content or
 * formatting outcome is a complete, legitimate finalization outcome.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { finalAttemptFromTexPath } from "./workflow-writing-acceptance.mjs";

const PEER_REVIEW_ERROR_ROLE = "peer-review-error";
const REVIEW_INCOMPLETE_OUTCOME = "REVIEW_INCOMPLETE";
/**
 * The controlled wordings the stage lifecycle uses when teardown failed. The
 * second also covers the timeout form ("exceeded its time limit; cleanup
 * incomplete: ..."). Cleanup failures are never scoped to one attempt here: a
 * stage that did not release its transport or dispose its handle is not
 * recovered by a later attempt, so the run is blocked wherever it happened.
 */
const CLEANUP_FAILURE_PATTERNS = [
  /produced a result but its cleanup did not complete:/u,
  /(?:^|[;\s])cleanup incomplete:/u,
];

/** Source-ordered [label, entry] pairs for either a worklog object or an array. */
function worklogEntries(worklog) {
  if (Array.isArray(worklog)) return worklog.map((entry, index) => [String(entry?.round ?? index), entry]);
  if (worklog && typeof worklog === "object") return Object.entries(worklog);
  return [];
}

/** A runtime issue as text; unknown shapes contribute nothing rather than a match. */
function issueText(issue) {
  if (typeof issue === "string") return issue;
  if (issue && typeof issue === "object") return String(issue.message ?? issue.error ?? "");
  return "";
}

/**
 * Account the lifecycle finalization of the writing run.
 *
 * @returns {{
 *   complete: boolean,
 *   finalAttempt: number | undefined,
 *   incompleteReviewRounds: string[],
 *   reviewErrorArtifacts: string[],
 *   cleanupIssues: string[],
 *   reasons: string[],
 * }}
 */
export function accountWritingFinalization({ finalTexPath, contentWorklog, artifacts, runtimeIssues } = {}) {
  const finalAttempt = finalAttemptFromTexPath(finalTexPath);
  const artifactList = Array.isArray(artifacts) ? artifacts.filter(item => item && typeof item === "object") : [];

  const incompleteReviewRounds = worklogEntries(contentWorklog)
    .filter(([, entry]) => String(entry?.outcome ?? "").trim() === REVIEW_INCOMPLETE_OUTCOME)
    .map(([label]) => label)
    .sort();

  // An error artifact belongs to the final attempt when the artifact path parser
  // resolves to it; an unidentifiable path is treated as belonging to the run,
  // because an unexplained final-attempt review error must not read as clean.
  const reviewErrorArtifacts = artifactList
    .filter(artifact => String(artifact.role ?? "").trim().toLowerCase() === PEER_REVIEW_ERROR_ROLE)
    .filter(artifact => {
      const attempt = finalAttemptFromTexPath(artifact.path);
      return attempt === undefined || attempt === finalAttempt;
    })
    .map(artifact => String(artifact.path ?? ""))
    .sort();

  const cleanupIssues = (Array.isArray(runtimeIssues) ? runtimeIssues : [])
    .map(issueText)
    .filter(text => CLEANUP_FAILURE_PATTERNS.some(pattern => pattern.test(text)))
    .sort();

  const reasons = [];
  if (finalAttempt === undefined) {
    reasons.push("The final source path does not identify an attempt; finalization cannot be attributed to a final attempt.");
  }
  if (incompleteReviewRounds.length > 0) {
    reasons.push("Incomplete review rounds are recorded in the content worklog: " +
      incompleteReviewRounds.join(", ") + "; the older manuscript and review were retained.");
  }
  if (reviewErrorArtifacts.length > 0) {
    reasons.push("The final attempt persisted peer review errors: " + reviewErrorArtifacts.join(", ") + ".");
  }
  if (cleanupIssues.length > 0) {
    reasons.push("Stage cleanup did not complete anywhere in this run and is not proven recovered: " +
      cleanupIssues.join(" | "));
  }

  return {
    complete: finalAttempt !== undefined && incompleteReviewRounds.length === 0 &&
      reviewErrorArtifacts.length === 0 && cleanupIssues.length === 0,
    finalAttempt, incompleteReviewRounds, reviewErrorArtifacts, cleanupIssues, reasons,
  };
}

/** Deterministic, zero-network self-check of the finalization rules. */
export function runWritingFinalizationSelfCheck() {
  const texPath = attempt => "workflow-runs/wf-finalization/attempt-" + attempt + "/final_refined_paper.tex";
  const finalTex = texPath(2);
  const finalSource = { role: "final-manuscript-source", path: finalTex };
  const finalPdf = { role: "pdf", path: "workflow-runs/wf-finalization/attempt-2/final_refined_paper.pdf" };
  const reviewError = attempt => ({
    role: "peer-review-error",
    path: "workflow-runs/wf-finalization/attempt-" + attempt + "/content_refinement_workdir/peer_reviews/review_v2_error.json",
  });
  const cleanWorklog = {
    v1: { round: 1, outcome: "ACCEPTED" },
    v2: { round: 2, outcome: "REJECTED_SCORE_DECREASE" },
  };
  const cleanRun = { finalTexPath: finalTex, contentWorklog: cleanWorklog, artifacts: [finalSource, finalPdf], runtimeIssues: [] };
  const cases = [];

  // 1. A clean final attempt with a compiled PDF and ordinary outcomes passes.
  const clean = accountWritingFinalization(cleanRun);
  assert.equal(clean.complete, true);
  assert.equal(clean.finalAttempt, 2);
  assert.deepEqual(clean.reasons, []);
  assert.deepEqual(clean.incompleteReviewRounds, [], "a clean worklog records no incomplete round");
  cases.push("clean_final_attempt_with_pdf_passes");

  // 2. A REVIEW_INCOMPLETE round blocks even though the PDF and metadata look finished.
  const incomplete = accountWritingFinalization({
    ...cleanRun,
    contentWorklog: { ...cleanWorklog, v3: { round: 3, outcome: "REVIEW_INCOMPLETE", error: "review failed" } },
  });
  assert.equal(incomplete.complete, false);
  assert.deepEqual(incomplete.incompleteReviewRounds, ["v3"]);
  assert.equal(incomplete.reasons.length, 1);
  cases.push("review_incomplete_round_fails");

  // 3. A final-attempt peer review error artifact blocks the run.
  const finalReviewError = accountWritingFinalization({ ...cleanRun, artifacts: [finalSource, finalPdf, reviewError(2)] });
  assert.equal(finalReviewError.complete, false);
  assert.deepEqual(finalReviewError.reviewErrorArtifacts, [reviewError(2).path]);
  cases.push("final_attempt_review_error_artifact_fails");

  // 4. An earlier attempt's ordinary review error is recovered telemetry and is ignored.
  const earlierReviewError = accountWritingFinalization({ ...cleanRun, artifacts: [finalSource, finalPdf, reviewError(1)] });
  assert.equal(earlierReviewError.complete, true);
  assert.deepEqual(earlierReviewError.reviewErrorArtifacts, []);
  cases.push("earlier_attempt_review_error_is_ignored");

  // 5. Both lifecycle cleanup wordings block the run, including when the failing
  //    stage belonged to an earlier attempt.
  const cleanupVariants = [
    { label: "result_cleanup_incomplete", issue: "Workflow stage produced a result but its cleanup did not complete: its dispose failed: dispose exploded", attempt: "attempt-2" },
    { label: "suffixed_cleanup_incomplete", issue: "Content refinement stopped at round 2: Workflow stage exceeded its time limit; cleanup incomplete: 1 provider request(s) may still be open", attempt: "attempt-2" },
    { label: "earlier_attempt_cleanup_incomplete", issue: "PaperOrchestra attempt 1 failed: Workflow stage produced a result but its cleanup did not complete: its abort did not return within the cleanup grace", attempt: "attempt-1" },
  ];
  for (const { label, issue, attempt } of cleanupVariants) {
    const blocked = accountWritingFinalization({ ...cleanRun, runtimeIssues: [issue] });
    assert.equal(blocked.complete, false, label + " must block finalization (" + attempt + ")");
    assert.deepEqual(blocked.cleanupIssues, [issue]);
    assert.equal(blocked.reviewErrorArtifacts.length, 0);
  }
  // A non-lifecycle issue mentioning only the word cleanup is not a cleanup failure.
  const unrelatedIssue = accountWritingFinalization({ ...cleanRun, runtimeIssues: ["Cleanup of temporary listings is not tracked for this host."] });
  assert.equal(unrelatedIssue.complete, true);
  cases.push("both_cleanup_failure_wordings_block");

  // 6. Ordinary rejected outcomes are complete finalizations: no run is blocked for
  //    scoring or compiling down, and no positive improvement is required.
  const rejected = accountWritingFinalization({
    ...cleanRun,
    contentWorklog: {
      v1: { round: 1, outcome: "REJECTED_SCORE_DECREASE" },
      v2: { round: 2, outcome: "REJECTED_COMPILE_FAILURE" },
      v3: { round: 3, outcome: "REJECTED_REFERENCE_CHANGE" },
    },
    runtimeIssues: ["Formatting reference preservation could not be confirmed (citation_keys_changed); the previous manuscript was retained."],
  });
  assert.equal(rejected.complete, true);
  assert.deepEqual(rejected.incompleteReviewRounds, []);
  cases.push("rejected_but_complete_outcomes_pass");

  // 7. An unidentifiable final source path fails even with a real PDF present.
  const unknownPath = accountWritingFinalization({ ...cleanRun, finalTexPath: "workflow-runs/wf-finalization/final_refined_paper.tex" });
  assert.equal(unknownPath.complete, false);
  assert.equal(unknownPath.finalAttempt, undefined);
  assert.equal(unknownPath.reasons.length, 1);
  cases.push("unidentifiable_final_path_fails");

  return { cases, passed: true };
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const result = runWritingFinalizationSelfCheck();
  console.log(JSON.stringify({ selfCheck: "workflow-writing-finalization", network: "none", ...result }));
}
