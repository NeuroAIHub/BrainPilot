---
name: dictlearning
description: "Use this model doc whenever the user wants to perform resting-state network decomposition using DictLearning. This is a non-deep-learning unsupervised route focused on sparse component extraction, network map discovery, and subject-level time series from resting-state fMRI."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - nilearn-tool
  - run_models
---
# DictLearning Model Doc

## Overview
DictLearning is a classical non-deep-learning method for resting-state network decomposition.

- Model family: non-deep-learning unsupervised decomposition method
- Typical objectives:
  - identify sparse resting-state networks from preprocessed fMRI
  - extract dictionary component maps and subject-level time series
  - derive interpretable network summaries for downstream connectivity or clustering
- Primary input: preprocessed resting-state fMRI, optional mask, optional group subject list
- Primary output: dictionary component maps, subject time series, optional connectomes or reports

In NeuroClaw, this document is model-level guidance for DictLearning-based resting-state decomposition workflows rather than phenotype prediction.

Upstream preparation should usually be delegated to:
- `fmri-skill` for rs-fMRI preprocessing, nuisance regression, filtering, and standard-space alignment
- `nilearn-tool` for concrete DictLearning fitting and component export

**Research use only.**

---

## Quick Start

### 1) Prepare resting-state inputs
Expected inputs:
- preprocessed resting-state BOLD images
- optional confounds TSV files
- optional brain mask
- optional subject list or cohort manifest

If these are not ready, delegate to `fmri-skill` first.

### 2) DictLearning route
Representative operations:
- load preprocessed resting-state images
- fit sparse dictionary learning for network decomposition
- export dictionary component maps and subject time series
- optionally use outputs for connectome or clustering analysis

Example execution route:
```bash
# delegated through claw-shell after preprocessing is confirmed
python skills/nilearn-tool/scripts/rest_dictlearning_reference.py \
  --input-list path/to/rest_bold_list.txt \
  --mask path/to/group_mask.nii.gz \
  --n-components 20 \
  --output-dir run_models_output/dictlearning
```

---

## Input / Output Contract

### Required inputs
- preprocessed resting-state fMRI in subject space or standard space
- subject list or image list

### Optional inputs
- confounds table(s)
- mask image
- repetition time (`TR`)
- decomposition parameters such as number of components
- group/covariate table for downstream statistical analysis

### Produced outputs
- 4D component map image
- subject-level component time series
- component report figures and summary tables
- optional component correlation matrix / connectome

---

## Recommended Delegation

- resting-state preprocessing and denoising -> `fmri-skill`
- concrete implementation of DictLearning -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use DictLearning

- The user wants resting-state network decomposition rather than task activation analysis.
- The goal is to identify sparse intrinsic connectivity networks from rs-fMRI.
- The user wants subject-level component time series for downstream connectivity or clustering.
- Sparse and interpretable network components are preferred.
- A lightweight classical unsupervised method is preferred over deep learning.

---

## Limitations and Notes

- Results are sensitive to preprocessing quality, head motion, filtering, and masking choices.
- The number of components strongly influences decomposition granularity.
- DictLearning is unsupervised and does not directly provide statistical group inference.
- Downstream comparisons across groups usually require additional statistical analysis after decomposition.

---

## Reference

- Varoquaux G et al. Dictionary learning for resting-state fMRI atlas extraction.
- Nilearn decomposition documentation: https://nilearn.github.io/stable/connectivity/resting_state_networks.html

Created At: 2026-04-14 00:31 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96