---
name: spacenet
description: "Use this model doc whenever the user wants to perform disease classification with SpaceNet. This is a non-deep-learning supervised route focused on voxel-wise neuroimaging-based case-control prediction with sparse and interpretable weight maps."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - smri-skill
  - nilearn-tool
  - run_models
---
# SpaceNet Model Doc

## Overview
SpaceNet is a classical non-deep-learning method for neuroimaging-based disease classification.

- Model family: non-deep-learning supervised classification method
- Typical objectives:
  - classify patient vs control groups from voxel-wise neuroimaging maps
  - build sparse discriminative models in aligned image space
  - export predictive scores, evaluation metrics, and interpretable weight maps
- Primary input: aligned subject images, labels, optional covariates, optional mask
- Primary output: class predictions, decision scores, cross-validation metrics, coefficient maps

In NeuroClaw, this document is model-level guidance for SpaceNet-based disease classification workflows rather than deep learning phenotype prediction.

Upstream preparation should usually be delegated to:
- `fmri-skill` for fMRI preprocessing and voxel-wise feature preparation
- `smri-skill` for structural feature extraction when disease classification uses sMRI
- `nilearn-tool` for concrete SpaceNet fitting and coefficient map export

**Research use only.**

---

## Quick Start

### 1) Prepare disease classification inputs
Expected inputs:
- subject-level labels such as patient / control
- aligned subject-level voxel maps
- optional covariates such as age, sex, site
- optional train / validation / test split definition

If features are not ready, delegate preprocessing to `fmri-skill` or `smri-skill` first.

### 2) SpaceNet route
Representative operations:
- prepare subject-level voxel maps in aligned space
- fit SpaceNet for sparse discriminative disease classification
- export predictions and coefficient maps
- visualize discriminative regions for interpretation

Example execution route:
```bash
# delegated through claw-shell after voxel maps are prepared
python skills/nilearn-tool/scripts/spacenet_classifier_reference.py \
  --input-list path/to/image_list.txt \
  --labels path/to/labels.csv \
  --target diagnosis \
  --mask path/to/group_mask.nii.gz \
  --output-dir run_models_output/spacenet
```

---

## Input / Output Contract

### Required inputs
- subject-level labels for disease classification
- aligned neuroimaging image list

### Optional inputs
- confounds or covariates table
- train / validation / test split file
- mask image for voxel-wise models
- hyperparameter settings such as C, l1 ratio, or number of CV folds

### Produced outputs
- predicted labels and decision scores
- cross-validation metrics such as accuracy, AUC, sensitivity, specificity
- fitted model artifact or coefficient table
- coefficient map for interpretation

---

## Recommended Delegation

- imaging preprocessing and feature preparation -> `fmri-skill` and/or `smri-skill`
- concrete implementation of SpaceNet -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use SpaceNet

- The user wants classical disease classification instead of a deep learning model.
- The dataset size is moderate and model interpretability matters.
- The user wants voxel-wise discriminative maps and sparse spatial regularization.
- The task is case-control prediction, diagnosis support, or cross-validated disease discrimination.

---

## Limitations and Notes

- SpaceNet requires well-aligned images in a common space and can be computationally heavier than ROI-based methods.
- Site effects and confounds can dominate disease classification if not controlled properly.
- Small sample sizes can lead to optimistic estimates unless split strategy is rigorously managed.

---

## Reference

- Varoquaux G, Gramfort A, Poline JB, Thirion B. Brain covariance selection: better individual functional connectivity models using population prior.
- Nilearn decoding documentation: https://nilearn.github.io/stable/decoding/index.html

Created At: 2026-04-14 00:34 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96