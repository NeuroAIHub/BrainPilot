#!/usr/bin/env node
/**
 * Pure, model-free stage accounting for the real writing acceptance driver.
 *
 * This module exists so the driver's final-attempt gate can be exercised
 * without a live model, provider, host tool or network. It answers one
 * question: did the attempt that actually produced the final manuscript
 * complete every required stage, judged from observed stage telemetry alone?
 *
 * Historical, superseded attempt errors are reported as recovered telemetry.
 * They never fail a later complete attempt, and an earlier attempt's success
 * never covers a missing final-attempt stage. A stage counts only when it
 * submitted a structured result; a stage that merely completed a prompt (for
 * example after a timeout retry) without a valid submission does not count.
 */
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FAILED_STAGE_STATUSES = new Set(["failed", "model_error"]);

/** Stages that the attempt producing the final manuscript must have submitted. */
export const REQUIRED_FINAL_ATTEMPT_STAGES = [
  { id: "outline", pattern: /^attempt-(\d+)-outline$/u },
  { id: "literature-writing", pattern: /^attempt-(\d+)-literature-writing$/u },
  { id: "section-writing", pattern: /^attempt-(\d+)-section-writing$/u },
  { id: "refinement", pattern: /^attempt-(\d+)-refinement-[123]$/u },
  { id: "format-review", pattern: /^attempt-(\d+)-format-review-1$/u },
];

/** Derive the final attempt number from the real final source path. */
export function finalAttemptFromTexPath(finalTexPath) {
  const matches = [...String(finalTexPath ?? "").matchAll(/(?:^|[/\\:])attempt-(\d+)(?=[/\\:]|$)/gu)];
  const last = matches.at(-1);
  if (!last) return undefined;
  const attempt = Number(last[1]);
  return Number.isSafeInteger(attempt) && attempt > 0 ? attempt : undefined;
}

function attemptOfStage(stageId) {
  const match = /(?:^|:)attempt-(\d+)(?:-|:|$)/u.exec(String(stageId ?? ""));
  if (!match) return undefined;
  const attempt = Number(match[1]);
  return Number.isSafeInteger(attempt) && attempt > 0 ? attempt : undefined;
}

/** The only terminal stop reasons that prove the model finished the turn on its own terms. */
const ACCEPTED_TERMINAL_STOP_REASONS = new Set(["toolUse", "stop"]);

/**
 * A stage conveys a real result only when it ended in the completed state,
 * submitted exactly one structured result, and closed on an accepted terminal
 * stop reason. Running, creating, unknown and missing statuses are unproven,
 * and a stage that submitted twice did not deliver a single unambiguous result.
 * The terminal stop reason matters on its own because the driver marks a row
 * completed whenever no error was raised, so an aborted, truncated or otherwise
 * unfinished turn can carry a valid-looking submission; only the last reason is
 * decisive, so an error recovered by a later valid turn still counts.
 */
export function isSubmittedSuccess(stage) {
  if (stage?.status !== "completed" || Number(stage?.submittedResults) !== 1) return false;
  const stopReasons = Array.isArray(stage?.stopReasons) ? stage.stopReasons : [];
  return stopReasons.length > 0 && ACCEPTED_TERMINAL_STOP_REASONS.has(String(stopReasons[stopReasons.length - 1]));
}

function hasErrorRecord(records, attempt) {
  return records.some(stage => attemptOfStage(stage.stageId) === attempt && FAILED_STAGE_STATUSES.has(String(stage.status)));
}

/** Review versions the workflow can report, in the order the pipeline visits them. */
const REVIEW_VERSIONS = ["initial", "v1", "v2", "v3"];

/** A review group carries a decision only when all three reviewers plus the meta reviewer reported. */
const REVIEW_MEMBERS = ["reviewer-1", "reviewer-2", "reviewer-3", "meta"];

const REVIEW_STAGE_PATTERN = /^attempt-\d+-review-(initial|v[123])-(reviewer-[123]|meta)$/u;

/** The refinement stage that pairs with each post-refinement review version. */
const REFINEMENT_FOR_VERSION = new Map([["v1", "refinement-1"], ["v2", "refinement-2"], ["v3", "refinement-3"]]);

/**
 * Critical stages judged only when the final attempt actually ran them, named
 * without the attempt prefix. Presence is never required here: a later
 * refinement or a format fix may legitimately never be visited. When a row does
 * exist it must be unique and successful. Stages that must always be present are
 * covered by REQUIRED_FINAL_ATTEMPT_STAGES and the review-group rules instead.
 */
const CRITICAL_STAGE_IDS = [
  "outline", "literature-writing", "section-writing", "refinement-1", "refinement-2", "refinement-3",
  "format-review-1", "format-fix-1",
];

/**
 * Account the required stages against the final attempt only.
 * @returns {{
 *   finalAttempt: number | undefined,
 *   required: Array<{ id: string, satisfied: boolean, submittedStages: string[] }>,
 *   completeFinalAttempt: boolean,
 *   finalAttemptHasError: boolean,
 *   visionUsedFinalAttempt: boolean,
 *   recoveredAttempts: number[],
 *   historicalAttempts: number[],
 *   reviewGroups: Array<{ version: string, members: string[], complete: boolean, missing: string[] }>,
 *   initialReviewComplete: boolean,
 *   postRefinementReviewComplete: boolean,
 *   attemptedReviewsComplete: boolean,
 *   attemptedCriticalStagesValid: boolean,
 *   invalidCriticalStages: string[],
 *   reason: string | undefined,
 * }}
 */
export function accountFinalAttempt({ stages, finalTexPath } = {}) {
  const records = Array.isArray(stages) ? stages.filter(stage => stage && typeof stage === "object") : [];
  const finalAttempt = finalAttemptFromTexPath(finalTexPath);
  const required = REQUIRED_FINAL_ATTEMPT_STAGES.map(({ id, pattern }) => {
    const submittedStages = records.filter(stage => {
      const match = pattern.exec(String(stage.stageId ?? ""));
      return Boolean(match) && Number(match[1]) === finalAttempt && isSubmittedSuccess(stage);
    }).map(stage => stage.stageId);
    return { id, satisfied: finalAttempt !== undefined && submittedStages.length > 0, submittedStages };
  });
  const allAttempts = [...new Set(records.map(stage => attemptOfStage(stage.stageId)).filter(attempt => attempt !== undefined))]
    .sort((a, b) => a - b);

  const finalRows = finalAttempt === undefined
    ? []
    : records.filter(stage => attemptOfStage(stage.stageId) === finalAttempt);
  const rowCounts = new Map();
  for (const stage of finalRows) {
    const id = String(stage.stageId ?? "");
    rowCounts.set(id, (rowCounts.get(id) ?? 0) + 1);
  }
  const plainNames = new Set(CRITICAL_STAGE_IDS);
  const isValidRow = id => rowCounts.get(id) === 1 &&
    finalRows.some(stage => String(stage.stageId ?? "") === id && isSubmittedSuccess(stage));
  const invalidCriticalStages = [...rowCounts.keys()]
    .filter(id => (REVIEW_STAGE_PATTERN.test(id) || plainNames.has(id.replace(/^attempt-\d+-/u, ""))) && !isValidRow(id))
    .sort();
  const attemptedCriticalStagesValid = finalAttempt !== undefined && invalidCriticalStages.length === 0;

  const validMembers = new Map();
  for (const id of rowCounts.keys()) {
    const match = REVIEW_STAGE_PATTERN.exec(id);
    if (!match) continue;
    const members = validMembers.get(match[1]) ?? new Set();
    if (isValidRow(id)) members.add(match[2]);
    validMembers.set(match[1], members);
  }
  const reviewGroups = REVIEW_VERSIONS.filter(version => validMembers.has(version)).map(version => {
    const members = validMembers.get(version);
    const missing = REVIEW_MEMBERS.filter(member => !members.has(member))
      .map(member => "attempt-" + finalAttempt + "-review-" + version + "-" + member);
    return { version, members: REVIEW_MEMBERS.filter(member => members.has(member)), complete: missing.length === 0, missing };
  });
  const initialReviewComplete = reviewGroups.some(group => group.version === "initial" && group.complete);
  const attemptedVersionGroups = reviewGroups.filter(group => REFINEMENT_FOR_VERSION.has(group.version));
  const attemptedReviewsComplete = finalAttempt !== undefined && reviewGroups.every(group => group.complete);
  const postRefinementReviewComplete = attemptedVersionGroups.some(group => group.complete &&
    isValidRow("attempt-" + finalAttempt + "-" + REFINEMENT_FOR_VERSION.get(group.version)));

  const completeFinalAttempt = finalAttempt !== undefined && required.every(stage => stage.satisfied) &&
    initialReviewComplete && attemptedReviewsComplete && postRefinementReviewComplete && attemptedCriticalStagesValid;
  const finalAttemptHasError = finalAttempt !== undefined &&
    records.some(stage => attemptOfStage(stage.stageId) === finalAttempt && FAILED_STAGE_STATUSES.has(String(stage.status)));
  const visionUsedFinalAttempt = finalAttempt !== undefined && records.some(stage =>
    attemptOfStage(stage.stageId) === finalAttempt && Number(stage.imageCount ?? 0) > 0 && isSubmittedSuccess(stage));
  const recoveredAttempts = completeFinalAttempt
    ? allAttempts.filter(attempt => attempt < finalAttempt && hasErrorRecord(records, attempt))
    : [];
  const unsatisfied = required.filter(stage => !stage.satisfied).map(stage => stage.id);
  const issues = [];
  if (unsatisfied.length > 0) issues.push("missing required stages: " + unsatisfied.join(", "));
  if (!initialReviewComplete) {
    const initial = reviewGroups.find(group => group.version === "initial");
    issues.push("the initial review group is incomplete: " + (initial ? initial.missing.join(", ") : "no review member reported"));
  }
  if (!attemptedReviewsComplete) {
    issues.push("attempted review groups are incomplete: " +
      reviewGroups.filter(group => !group.complete).flatMap(group => group.missing).join(", "));
  }
  if (!postRefinementReviewComplete) issues.push("no complete review group pairs with a successful refinement stage");
  if (invalidCriticalStages.length > 0) issues.push("invalid critical stages: " + invalidCriticalStages.join(", "));
  const reason = completeFinalAttempt
    ? undefined
    : finalAttempt === undefined
      ? "The final source path does not identify an attempt; required-stage accounting cannot be satisfied."
      : "The final attempt (" + finalAttempt + ") did not satisfy the accounting rules: " + issues.join("; ") + ".";
  return {
    finalAttempt, required, completeFinalAttempt, finalAttemptHasError, visionUsedFinalAttempt,
    recoveredAttempts, historicalAttempts: allAttempts.filter(attempt => attempt !== finalAttempt),
    reviewGroups, initialReviewComplete, postRefinementReviewComplete, attemptedReviewsComplete,
    attemptedCriticalStagesValid, invalidCriticalStages, reason,
  };
}

/** Deterministic, zero-network self-check of the accounting rules. */
export function runWritingAcceptanceSelfCheck() {
  const stageRecord = (stageId, { submitted = 1, status = "completed", images = 0, stopReasons = ["toolUse"] } = {}) =>
    ({ stageId, submittedResults: submitted, status, imageCount: images, stopReasons });
  const reviewRows = (attempt, version) => [
    stageRecord("attempt-" + attempt + "-review-" + version + "-reviewer-1"),
    stageRecord("attempt-" + attempt + "-review-" + version + "-reviewer-2"),
    stageRecord("attempt-" + attempt + "-review-" + version + "-reviewer-3"),
    stageRecord("attempt-" + attempt + "-review-" + version + "-meta"),
  ];
  const texPath = attempt => "workflow-runs/wf-acceptance/attempt-" + attempt + "/final_refined_paper.tex";
  const cases = [];

  // 1. A complete final attempt passes even though an earlier attempt errored.
  const historical = [
    stageRecord("attempt-1-outline", { submitted: 0, status: "failed" }),
    stageRecord("attempt-1-section-writing", { submitted: 0, status: "model_error" }),
  ];
  const complete = [
    stageRecord("attempt-2-outline"), stageRecord("attempt-2-literature-writing"), stageRecord("attempt-2-section-writing"),
    ...reviewRows(2, "initial"),
    stageRecord("attempt-2-refinement-1", { images: 2 }), stageRecord("attempt-2-format-review-1", { images: 2 }),
    ...reviewRows(2, "v1"),
  ];
  const recoveredCase = accountFinalAttempt({ stages: [...historical, ...complete], finalTexPath: texPath(2) });
  assert.equal(recoveredCase.completeFinalAttempt, true);
  assert.equal(recoveredCase.finalAttempt, 2);
  assert.equal(recoveredCase.finalAttemptHasError, false);
  assert.equal(recoveredCase.visionUsedFinalAttempt, true);
  assert.deepEqual(recoveredCase.recoveredAttempts, [1]);
  cases.push("final_attempt_complete_with_historical_failure_passes");

  // 2. An earlier complete attempt does not cover a missing final-attempt stage.
  const oldSuccess = [
    stageRecord("attempt-1-outline"), stageRecord("attempt-1-literature-writing"), stageRecord("attempt-1-section-writing"),
    ...reviewRows(1, "initial"),
    stageRecord("attempt-1-refinement-1"), stageRecord("attempt-1-format-review-1"),
    ...reviewRows(1, "v1"),
  ];
  const coveredCase = accountFinalAttempt({ stages: [...oldSuccess, stageRecord("attempt-2-outline")], finalTexPath: texPath(2) });
  assert.equal(coveredCase.completeFinalAttempt, false);
  assert.equal(coveredCase.finalAttempt, 2);
  assert.deepEqual(coveredCase.required.filter(stage => !stage.satisfied).map(stage => stage.id),
    ["literature-writing", "section-writing", "refinement", "format-review"]);
  cases.push("earlier_success_does_not_cover_missing_final_stage");

  // 3. A failed refinement without a replacement submission fails the final attempt.
  const failedRefine = accountFinalAttempt({ stages: [
    stageRecord("attempt-1-outline"), stageRecord("attempt-1-literature-writing"), stageRecord("attempt-1-section-writing"),
    stageRecord("attempt-1-refinement-1", { submitted: 0, status: "failed" }), stageRecord("attempt-1-format-review-1"),
  ], finalTexPath: texPath(1) });
  assert.equal(failedRefine.completeFinalAttempt, false);
  assert.equal(failedRefine.finalAttemptHasError, true);
  assert.equal(failedRefine.required.find(stage => stage.id === "refinement").satisfied, false);
  cases.push("failed_refinement_without_replacement_fails");

  // 4. A completed prompt (e.g. a timeout retry) without a valid submit is not accepted.
  const timeoutOnly = accountFinalAttempt({ stages: [
    stageRecord("attempt-1-outline", { submitted: 0, stopReasons: ["timeout"] }),
    stageRecord("attempt-1-literature-writing", { submitted: 0, stopReasons: ["timeout"] }),
    stageRecord("attempt-1-section-writing", { submitted: 0, stopReasons: ["timeout"] }),
    stageRecord("attempt-1-refinement-1", { submitted: 0, stopReasons: ["timeout"] }),
    stageRecord("attempt-1-format-review-1", { submitted: 0, stopReasons: ["timeout"] }),
  ], finalTexPath: texPath(1) });
  assert.equal(timeoutOnly.completeFinalAttempt, false);
  assert.equal(timeoutOnly.required.every(stage => !stage.satisfied), true);
  cases.push("timeout_retry_without_valid_submit_is_rejected");

  // 5. An unidentifiable final source path cannot pass required-stage accounting.
  const unknownPath = accountFinalAttempt({ stages: complete, finalTexPath: "workflow-runs/wf-acceptance/final_refined_paper.tex" });
  assert.equal(unknownPath.finalAttempt, undefined);
  assert.equal(unknownPath.completeFinalAttempt, false);
  cases.push("unidentifiable_final_path_fails");

  // 6. A non-required stage error inside the final attempt is telemetry, not a blocker,
  //    so long as every required stage of that attempt still submitted a result.
  const inAttemptRetry = accountFinalAttempt({ stages: [
    ...historical,
    stageRecord("attempt-2-literature-discovery", { submitted: 0, status: "failed" }),
    ...complete,
  ], finalTexPath: texPath(2) });
  assert.equal(inAttemptRetry.completeFinalAttempt, true);
  assert.equal(inAttemptRetry.finalAttemptHasError, true);
  assert.equal(inAttemptRetry.recoveredAttempts.includes(2), false);
  assert.deepEqual(inAttemptRetry.recoveredAttempts, [1]);
  cases.push("non_required_final_attempt_error_does_not_block_required_completion");

  // 7. A reference-style prior success with a missing required final stage stays unsuccessful
  //    (case 2 restated with an in-attempt error present, to pin the interaction).
  const priorSuccessWithGap = accountFinalAttempt({ stages: [
    ...oldSuccess,
    stageRecord("attempt-2-outline"), stageRecord("attempt-2-literature-discovery", { submitted: 0, status: "model_error" }),
  ], finalTexPath: texPath(2) });
  assert.equal(priorSuccessWithGap.finalAttemptHasError, true);
  assert.equal(priorSuccessWithGap.completeFinalAttempt, false);
  cases.push("in_attempt_error_never_covers_missing_required_final_stage");

  // 8. A stage that is not in the completed state, or that did not submit exactly
  //    one result, cannot satisfy a required final-attempt stage. Each variant
  //    replaces the final refinement submission of an otherwise complete attempt.
  const refinementVariants = [
    { label: "status_creating", record: stageRecord("attempt-2-refinement-1", { status: "creating" }) },
    { label: "status_running", record: stageRecord("attempt-2-refinement-1", { status: "running" }) },
    { label: "status_unknown", record: stageRecord("attempt-2-refinement-1", { status: "unknown" }) },
    { label: "status_missing", record: { stageId: "attempt-2-refinement-1", submittedResults: 1, imageCount: 0, stopReasons: [] } },
    { label: "submitted_two", record: stageRecord("attempt-2-refinement-1", { submitted: 2 }) },
    { label: "submitted_zero", record: stageRecord("attempt-2-refinement-1", { submitted: 0 }) },
    { label: "stop_reasons_empty", record: stageRecord("attempt-2-refinement-1", { stopReasons: [] }) },
    { label: "stop_reason_missing", record: { stageId: "attempt-2-refinement-1", submittedResults: 1, status: "completed", imageCount: 0 } },
    { label: "stop_reason_aborted", record: stageRecord("attempt-2-refinement-1", { stopReasons: ["aborted"] }) },
    { label: "stop_reason_error", record: stageRecord("attempt-2-refinement-1", { stopReasons: ["error"] }) },
    { label: "stop_reason_length", record: stageRecord("attempt-2-refinement-1", { stopReasons: ["length"] }) },
    { label: "stop_reason_unknown", record: stageRecord("attempt-2-refinement-1", { stopReasons: ["unknown"] }) },
    { label: "stop_reason_valid_then_aborted", record: stageRecord("attempt-2-refinement-1", { stopReasons: ["toolUse", "aborted"] }) },
  ];
  for (const { label, record } of refinementVariants) {
    const stages = [...historical, ...complete.filter(stage => !String(stage.stageId).startsWith("attempt-2-refinement")), record];
    const variant = accountFinalAttempt({ stages, finalTexPath: texPath(2) });
    assert.equal(variant.completeFinalAttempt, false, label + " must not complete the final attempt");
    assert.equal(variant.required.find(stage => stage.id === "refinement").satisfied, false, label + " must not satisfy the refinement stage");
  }
  cases.push("non_completed_status_or_inexact_submission_never_satisfies_required_stage");

  // 9. Only the last stop reason is decisive: an error recovered by a later valid
  //    turn still submits a real result, and a plain "stop" close is accepted too.
  const recoveredStopReasons = accountFinalAttempt({ stages: [
    ...historical,
    ...complete.filter(stage => !String(stage.stageId).startsWith("attempt-2-refinement")),
    stageRecord("attempt-2-refinement-1", { images: 2, stopReasons: ["error", "toolUse"] }),
  ], finalTexPath: texPath(2) });
  assert.equal(recoveredStopReasons.completeFinalAttempt, true);
  assert.equal(recoveredStopReasons.required.find(stage => stage.id === "refinement").satisfied, true);
  assert.equal(recoveredStopReasons.visionUsedFinalAttempt, true);

  const plainStopClose = accountFinalAttempt({ stages: [
    ...historical,
    ...complete.filter(stage => !String(stage.stageId).startsWith("attempt-2-refinement")),
    stageRecord("attempt-2-refinement-1", { stopReasons: ["stop"] }),
  ], finalTexPath: texPath(2) });
  assert.equal(plainStopClose.completeFinalAttempt, true);
  cases.push("last_stop_reason_decides_recovered_error_still_submits");

  /** The complete attempt-2 rows minus every row whose id satisfies the predicate. */
  const withoutRows = predicate => complete.filter(stage => !predicate(String(stage.stageId)));
  const groupOf = (result, version) => result.reviewGroups.find(group => group.version === version);

  // 10. A review group is a decision only when the meta reviewer reported: dropping the
  //     v1 meta row leaves no complete post-refinement group and names the missing member.
  const missingV1Meta = accountFinalAttempt({
    stages: withoutRows(id => id === "attempt-2-review-v1-meta"), finalTexPath: texPath(2),
  });
  assert.equal(missingV1Meta.completeFinalAttempt, false);
  assert.equal(missingV1Meta.postRefinementReviewComplete, false);
  assert.equal(missingV1Meta.attemptedReviewsComplete, false);
  assert.deepEqual(groupOf(missingV1Meta, "v1").missing, ["attempt-2-review-v1-meta"]);
  cases.push("missing_post_refinement_meta_reviewer_fails_and_is_named");

  // 11. A present-but-unsubmitted review row is an invalid critical stage, named in full.
  const unsubmittedV1Meta = accountFinalAttempt({
    stages: [...withoutRows(id => id === "attempt-2-review-v1-meta"), stageRecord("attempt-2-review-v1-meta", { submitted: 0 })],
    finalTexPath: texPath(2),
  });
  assert.equal(unsubmittedV1Meta.completeFinalAttempt, false);
  assert.equal(unsubmittedV1Meta.attemptedCriticalStagesValid, false);
  assert.deepEqual(unsubmittedV1Meta.invalidCriticalStages, ["attempt-2-review-v1-meta"]);
  cases.push("unsubmitted_review_row_is_an_invalid_critical_stage");

  // 12. The initial review group is judged on its own members, not on a later group.
  const missingInitialMeta = accountFinalAttempt({
    stages: withoutRows(id => id === "attempt-2-review-initial-meta"), finalTexPath: texPath(2),
  });
  assert.equal(missingInitialMeta.initialReviewComplete, false);
  assert.equal(missingInitialMeta.completeFinalAttempt, false);
  assert.deepEqual(groupOf(missingInitialMeta, "initial").missing, ["attempt-2-review-initial-meta"]);
  cases.push("missing_initial_meta_reviewer_fails_initial_group");

  // 13. A refinement that was never reviewed afterwards does not close the loop: the
  //     required refinement stage is satisfied, yet no group pairs with it.
  const refinementWithoutReview = accountFinalAttempt({
    stages: withoutRows(id => id.startsWith("attempt-2-review-v1-")), finalTexPath: texPath(2),
  });
  assert.equal(refinementWithoutReview.required.find(stage => stage.id === "refinement").satisfied, true);
  assert.equal(refinementWithoutReview.postRefinementReviewComplete, false);
  assert.equal(refinementWithoutReview.completeFinalAttempt, false);
  cases.push("refinement_without_a_following_review_group_fails");

  // 14. An attempted later review round must finish too, even when an earlier round
  //     already paired with its refinement.
  const partialV2 = accountFinalAttempt({
    stages: [...complete, stageRecord("attempt-2-refinement-2"), stageRecord("attempt-2-review-v2-reviewer-1")],
    finalTexPath: texPath(2),
  });
  assert.equal(partialV2.postRefinementReviewComplete, true);
  assert.equal(partialV2.attemptedReviewsComplete, false);
  assert.equal(partialV2.completeFinalAttempt, false);
  assert.deepEqual(groupOf(partialV2, "v2").missing,
    ["attempt-2-review-v2-reviewer-2", "attempt-2-review-v2-reviewer-3", "attempt-2-review-v2-meta"]);
  cases.push("partially_attempted_later_review_round_fails");

  // 15. An attempted later refinement that failed is an invalid critical stage, even
  //     though the earlier refinement already satisfied the required stage.
  const failedV2Refinement = accountFinalAttempt({
    stages: [...complete, stageRecord("attempt-2-refinement-2", { submitted: 0, status: "failed" })],
    finalTexPath: texPath(2),
  });
  assert.equal(failedV2Refinement.completeFinalAttempt, false);
  assert.equal(failedV2Refinement.finalAttemptHasError, true);
  assert.deepEqual(failedV2Refinement.invalidCriticalStages, ["attempt-2-refinement-2"]);
  cases.push("failed_later_refinement_is_an_invalid_critical_stage");

  // 16. Several accepted terminal stop reasons on one row are fine; the row still
  //     submits a single result and its images still count as vision use.
  const multiStopRow = accountFinalAttempt({
    stages: [
      ...withoutRows(id => id.startsWith("attempt-2-refinement")),
      stageRecord("attempt-2-refinement-1", { images: 2, stopReasons: ["stop", "toolUse"] }),
    ],
    finalTexPath: texPath(2),
  });
  assert.equal(multiStopRow.completeFinalAttempt, true);
  assert.equal(multiStopRow.visionUsedFinalAttempt, true);
  cases.push("multiple_accepted_stop_reasons_on_one_row_still_submit");

  // 17. The optional format fix is never required (case 1 passes without it), but when
  //     the attempt did run it the row must be a single valid submission.
  const validFormatFix = accountFinalAttempt({
    stages: [...complete, stageRecord("attempt-2-format-fix-1")], finalTexPath: texPath(2),
  });
  assert.equal(validFormatFix.completeFinalAttempt, true);
  const failedFormatFix = accountFinalAttempt({
    stages: [...complete, stageRecord("attempt-2-format-fix-1", { submitted: 0, status: "failed" })],
    finalTexPath: texPath(2),
  });
  assert.equal(failedFormatFix.completeFinalAttempt, false);
  assert.deepEqual(failedFormatFix.invalidCriticalStages, ["attempt-2-format-fix-1"]);
  cases.push("optional_format_fix_is_judged_only_when_attempted");

  // 18. A critical stage reported twice did not deliver one unambiguous result.
  const duplicateOutline = accountFinalAttempt({
    stages: [...complete, stageRecord("attempt-2-outline")], finalTexPath: texPath(2),
  });
  assert.equal(duplicateOutline.completeFinalAttempt, false);
  assert.equal(duplicateOutline.attemptedCriticalStagesValid, false);
  assert.deepEqual(duplicateOutline.invalidCriticalStages, ["attempt-2-outline"]);
  cases.push("duplicate_critical_stage_row_fails_and_is_named");

  return { cases, passed: true };
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const result = runWritingAcceptanceSelfCheck();
  console.log(JSON.stringify({ selfCheck: "workflow-writing-acceptance", network: "none", ...result }));
}
