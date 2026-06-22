---
name: svm
description: "Use this model doc whenever the user wants to perform disease classification with SVM. This is a non-deep-learning supervised route focused on neuroimaging-based case-control prediction from ROI-wise or tabular features."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - smri-skill
  - nilearn-tool
  - run_models
---
# SVM Model Doc

## Overview
SVM is a classical non-deep-learning method for neuroimaging-based disease classification.

- Model family: non-deep-learning supervised classification method
- Typical objectives:
  - classify patient vs control groups from neuroimaging features
  - build discriminative models from ROI features or tabular summaries
  - export predictive scores and evaluation metrics
- Primary input: preprocessed fMRI / sMRI derived features, labels, optional covariates
- Primary output: class predictions, decision scores, cross-validation metrics

In NeuroClaw, this document is model-level guidance for SVM-based disease classification workflows rather than deep learning phenotype prediction.

Upstream preparation should usually be delegated to:
- `fmri-skill` for fMRI preprocessing and ROI / voxel feature preparation
- `smri-skill` for structural feature extraction when disease classification uses sMRI
- `nilearn-tool` for concrete SVM fitting on prepared feature tables

**Research use only.**

---

## Quick Start

### 1) Prepare disease classification inputs
Expected inputs:
- subject-level labels such as patient / control
- preprocessed imaging features
- optional covariates such as age, sex, site
- optional train / validation / test split definition

If features are not ready, delegate preprocessing to `fmri-skill` or `smri-skill` first.

### 2) SVM route
Representative operations:
- prepare ROI-wise or tabular neuroimaging features
- standardize features within the training fold
- fit linear or kernel SVM for disease classification
- export predictions, decision scores, and performance metrics

Example execution route:
```bash
# delegated through claw-shell after features are prepared
python skills/nilearn-tool/scripts/svm_classifier_reference.py \
  --features path/to/features.csv \
  --labels path/to/labels.csv \
  --target diagnosis \
  --cv 5 \
  --output-dir run_models_output/svm
```

---

## Input / Output Contract

### Required inputs
- subject-level labels for disease classification
- feature table or ROI summary matrix

### Optional inputs
- confounds or covariates table
- train / validation / test split file
- hyperparameter settings such as kernel, C, or number of CV folds

### Produced outputs
- predicted labels and decision scores
- cross-validation metrics such as accuracy, AUC, sensitivity, specificity
- fitted model artifact or coefficient table

---

## Recommended Delegation

- imaging preprocessing and feature preparation -> `fmri-skill` and/or `smri-skill`
- concrete implementation of SVM -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use SVM

- The user wants classical disease classification instead of a deep learning model.
- The dataset size is moderate and model interpretability matters.
- ROI-level features are already prepared and SVM is sufficient.
- The task is case-control prediction, diagnosis support, or cross-validated disease discrimination.

---

## Limitations and Notes

- SVM performance depends strongly on feature engineering, scaling, and leakage-free cross-validation.
- Site effects and confounds can dominate disease classification if not controlled properly.
- Small sample sizes can lead to optimistic estimates unless split strategy is rigorously managed.

---

## Reference

- Cortes C, Vapnik V. Support-vector networks.
- Nilearn decoding documentation: https://nilearn.github.io/stable/decoding/index.html

Created At: 2026-04-14 00:34 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96