# Empirical validation and audit gap

## Status and scope

The current benchmark and grader cannot be changed in the near term. This note
records the resulting evidence gap and the mitigations that can be implemented
inside BrainPilot's Agent and Auditor workflows.

The issue was exposed by the BCI Competition IV 2a benchmark run at commit
`6a15f064`: the delivered model passed shape, import-purity, parameter-count,
random-label memorization, deterministic-evaluation, protocol-compliance, and
artifact audits, but achieved near-chance private cross-session performance.
The available aggregate metrics were highly consistent with widespread
single-class prediction, while the grader did not retain enough prediction-level
evidence to prove that mechanism per subject.

## Observed failure pattern

1. Real training-session GDF files were visible, but their MNE/MOABB readers were
   absent.
2. Dependency installation was treated as requiring user authorization, so the
   workflow continued with synthetic tensors instead of representative data.
3. Literature and general-domain estimates selected one architecture, which was
   then frozen into a precise protocol.
4. Engineer, Experimentalist, and Auditor independently established operational
   correctness and protocol fidelity, but no stage established real-data task
   validity.
5. The audit emitted PASS even though the evidence supported only “runs as
   specified,” not “learns EEG” or “generalizes across sessions.”

This is an evidence-type failure: more documentation or independent repetition
of the same operational checks increases confidence in the wrong proposition.

## Constraints outside current scope

Until the benchmark or grader can be changed, the workflow cannot rely on it to:

- provide preprocessed agent-visible arrays;
- guarantee that data-reader dependencies are installed;
- save per-subject prediction counts, entropy, confusion matrices, training and
  validation curves, or selected epochs;
- expose private-session diagnostics before final scoring.

Aggregate accuracy, kappa, and mean macro-F1 are insufficient to identify a
specific collapse mechanism with certainty.

## Local mitigations

1. Engineer may now install task-relevant language dependencies and modify a
   workspace-local or active project environment without user authorization.
   Missing dependencies must not silently force synthetic validation.
2. Auditor must classify evidence as operational or empirical and audit those
   claims separately.
3. A model-suitability, transfer, robustness, or superiority claim without
   representative real-data evidence is `unverified`, regardless of protocol
   compliance, synthetic learnability, or packaging success.
4. Model selection should compare the incumbent baseline with proposed
   candidates on the same visible real-data split and budget. Literature alone
   cannot establish the local ranking.
5. Visible-data runs should save class counts, class coverage, prediction entropy,
   confusion matrices, per-group metrics, training/validation curves, and selected
   epochs even when the external grader does not.
6. Cross-condition claims require a matching split or an explicit proxy such as
   run/time blocks, held-out conditions, external sessions, or shift stress tests.
   Random validation inside one session supports only same-session claims.
7. Audit scientific parameters in physical units after resampling or unit
   conversion. Sample-count fidelity is not time-scale fidelity.

## Collapse diagnostic caution

For a balanced `K`-class test set, a constant predictor has accuracy `1/K`,
kappa `0`, and macro-F1 `2 / (K * (K + 1))` under the usual zero-division
convention. For four classes this is accuracy `0.25`, kappa `0`, and macro-F1
`0.1`. Matching these values is strong evidence of possible class collapse, but
it does not prove constant predictions without prediction-level artifacts.

Audits must therefore use “consistent with” or “suspected” when only aggregate
metrics exist, identify the missing prediction diagnostics, and avoid presenting
an architectural mechanism such as normalization drift as proven without an
ablation or direct measurement.

## Future benchmark/grader work

When those components become editable, prefer preprocessed visible arrays or a
pinned reader environment, and retain per-subject curves, selected epochs,
prediction distributions, logits/probabilities, and confusion matrices. These
remain deferred improvements, not assumptions of the current audit workflow.
