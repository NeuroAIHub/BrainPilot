---
name: audit-data-integrity
description: Audit scientific data semantics, sample and label alignment, leakage, group splits, preprocessing boundaries, and train-to-inference transforms. Use for any result based on datasets, feature matrices, tensors, repeated observations, or learned preprocessing.
---

# Audit Data Integrity

Inspect existing code, contracts, manifests, and logs; do not recompute missing
results. Report each applicable check as `pass`, `flaw`, or `unverified`, with a
specific evidence path or exact missing evidence.

## Checks

1. Establish the semantic meaning and order of every source axis. Trace each
   `transpose`, `reshape`, `ravel`, `flatten`, `stack`, concatenation, cache, and
   reload that can change sample identity. Shape equality alone is insufficient.
2. Verify that every feature row remains aligned with its label, subject,
   condition, session, bin, and other grouping identifiers. Look for explicit
   value-level assertions on representative samples.
3. Verify train/test independence at the real sampling unit. Check subject,
   session, site, family, temporal, repeated-measure, and augmentation leakage as
   applicable.
4. Verify that imputation, scaling, feature selection, dimensionality reduction,
   resampling, threshold selection, and model selection are fitted only within
   training folds.
5. Establish the value domain and transform contract. Confirm that training,
   exported artifacts, manifests, and inference use the same clipping,
   missing-value handling, transform, and feature order.

For a bounded parallel review, give a `method-reviewer` the data contract,
pipeline files, and validation evidence. Ask for evidence and candidate findings,
not a verdict.
