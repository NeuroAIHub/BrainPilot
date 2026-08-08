---
name: audit-code-artifact
description: Audit scientific implementation, exported-model equivalence, dependency completeness, manifests, packaging, and isolated inference. Use when claims depend on code, trained artifacts, evaluators, or deployable entry points.
---

# Audit Code and Artifact

Inspect existing files and test outputs read-only. Do not execute the scientific
pipeline or manufacture missing validation evidence.

## Checks

1. Trace critical values across data loading, preprocessing, fitting, export, and
   inference. Check defaults, branches, feature order, transforms, and manifest
   declarations against the scientific protocol.
2. Require existing numeric evidence that the reference pipeline, exported model
   or raw weights, and final entry point produce equivalent predictions on fixed
   samples within a stated tolerance.
3. Require an existing clean-directory or evaluator-like smoke test using only
   collected artifacts and declared dependencies.
4. Check for undeclared local modules, absolute workspace paths, environment
   variables, auxiliary files, incompatible versions, and entry-point assumptions.
5. Separate implementation correctness from scientific adequacy: a correctly
   packaged artifact does not establish that its model or validation is suitable.

For a bounded parallel review, use `code-reviewer` for concrete implementation
defects and `repo-scout` only when imports or artifact dependencies must first be
mapped. Ask for evidence and candidate findings, not a verdict.
