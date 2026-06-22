---
name: glm
description: "Use this model doc whenever the user wants to run a classical General Linear Model (GLM) for task-evoked fMRI activation analysis. This is a non-deep-learning model route focused on design matrices, first-level/second-level statistics, and statistical maps."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - nilearn-tool
  - run_models
---
# GLM Model Doc

## Overview
GLM refers to the classical General Linear Model used for task-based fMRI activation analysis.

- Model family: non-deep-learning statistical model
- Typical objectives:
  - first-level GLM for subject/session-level task activation analysis
  - second-level GLM for group-level inference across subjects
- Primary input: preprocessed task fMRI, events, TR, optional confounds, optional brain mask
- Primary output: first-level contrast maps, second-level z maps, thresholded activation maps, region-level summaries

In NeuroClaw, this document is model-level guidance for statistical activation workflows rather than phenotype prediction.

Upstream preparation should usually be delegated to:
- `fmri-skill` for task-fMRI preprocessing and confounds preparation
- `nilearn-tool` for concrete GLM fitting, design matrix construction, and statistical map generation

**Research use only.**

---

## Quick Start

### 1) Prepare task-fMRI inputs
Expected inputs:
- preprocessed task BOLD image
- events TSV/CSV with onset, duration, trial type
- repetition time (`TR`)
- optional confounds TSV
- optional mask image

These should be prepared before model fitting. If not ready, delegate to `fmri-skill` first.

### 2) Typical first-level GLM flow
Representative operations:
- build design matrix from events and confounds
- fit first-level GLM per subject/session
- compute named contrasts such as `task > baseline`
- export z maps / effect size maps

Example execution route:
```bash
# delegated through claw-shell after preprocessing is confirmed
python skills/nilearn-tool/scripts/task_glm_reference.py \
  --bold path/to/sub-001_task-preproc_bold.nii.gz \
  --events path/to/sub-001_task-events.tsv \
  --confounds path/to/sub-001_confounds.tsv \
  --tr 2.0 \
  --contrast "task-baseline" \
  --output-dir run_models_output/glm/sub-001
```

### 3) Second-level GLM (group-level inference)
When multiple subjects are available, use second-level GLM for group-level inference.

Representative operations:
- collect subject-level contrast maps from first-level GLM
- build a group design matrix (for one-sample, two-sample, or covariate models)
- fit a second-level model across subjects
- export group z maps, thresholded figures, and statistical summaries

Typical use cases:
- one-sample group activation inference
- between-group comparison
- covariate-adjusted group analysis (for example age / sex / site)

Example execution route:
```bash
# delegated through claw-shell after subject-level contrasts are prepared
python skills/nilearn-tool/scripts/second_level_glm_reference.py \
  --contrast-maps path/to/contrast_map_list.txt \
  --design-matrix path/to/group_design_matrix.csv \
  --contrast group_mean \
  --output-dir run_models_output/glm/group_level
```

---

## Input / Output Contract

### Required inputs
- preprocessed task fMRI in subject space or standard space
- events table with onset / duration / condition labels
- TR

### Optional inputs
- confounds table
- mask image
- subject-level metadata for group models
- first-level contrast maps for second-level GLM
- group design matrix for second-level GLM

### Produced outputs
- design matrix figure or CSV snapshot
- first-level beta / contrast / z maps
- thresholded maps and glass-brain figures
- second-level group z maps and statistical summaries

---

## Recommended Delegation

- preprocessing and task-fMRI preparation -> `fmri-skill`
- concrete implementation of design matrices and GLM fitting -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

Recommended route split:
- first-level GLM -> subject/session-level task activation analysis
- second-level GLM -> group-level inference on first-level contrast maps

No execution before explicit plan confirmation.

---

## When to Use GLM Instead of Deep Learning

- The user wants classical task activation analysis rather than phenotype prediction.
- The goal is statistical inference on task conditions or contrasts.
- The user wants group-level inference across subjects rather than individual-level prediction.
- Sample size is limited and interpretability of condition effects is more important than representation learning.
- The required output is a contrast map, z map, or cluster-level inference report.

---

## Limitations and Notes

- GLM is primarily for task-fMRI, not resting-state phenotype modeling.
- Results are sensitive to event timing quality, motion confounds, and preprocessing decisions.
- Group-level inference requires consistent first-level contrast definitions across subjects.
- Second-level GLM requires aligned subject-level maps and a valid group design matrix.

---

## Reference

- Friston KJ et al. Statistical Parametric Mapping foundations for task-fMRI analysis.
- Nilearn GLM documentation: https://nilearn.github.io/stable/glm/index.html

Created At: 2026-04-14 00:28 HKT
Last Updated At: 2026-04-14 00:28 HKT
Author: chengwang96