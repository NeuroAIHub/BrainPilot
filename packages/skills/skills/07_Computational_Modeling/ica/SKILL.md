---
name: ica
description: "Use this model doc whenever the user wants to perform resting-state network decomposition using ICA. This is a non-deep-learning unsupervised route focused on extracting intrinsic connectivity networks, component maps, and subject-level time series from resting-state fMRI."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - nilearn-tool
  - run_models
---
# ICA Model Doc

## Overview
ICA is a classical non-deep-learning method for resting-state network decomposition.

- Model family: non-deep-learning unsupervised decomposition method
- Typical objectives:
  - identify intrinsic connectivity networks from resting-state fMRI
  - extract spatial component maps and subject-level time series
  - derive component-level connectivity or subject summaries for downstream analysis
- Primary input: preprocessed resting-state fMRI, optional mask, optional group subject list
- Primary output: component maps, subject time series, component loadings, optional connectomes or reports

In NeuroClaw, this document is model-level guidance for ICA-based resting-state decomposition workflows rather than phenotype prediction.

Upstream preparation should usually be delegated to:
- `fmri-skill` for rs-fMRI preprocessing, nuisance regression, filtering, and standard-space alignment
- `nilearn-tool` for concrete ICA fitting and component export

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

### 2) ICA route
Representative operations:
- load subject-level or group-level rs-fMRI images
- fit ICA to estimate intrinsic connectivity components
- export component spatial maps and subject time series
- optionally compute component-level correlations

Example execution route:
```bash
# delegated through claw-shell after preprocessing is confirmed
python skills/nilearn-tool/scripts/rest_ica_reference.py \
  --input-list path/to/rest_bold_list.txt \
  --mask path/to/group_mask.nii.gz \
  --n-components 20 \
  --output-dir run_models_output/ica
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
- concrete implementation of ICA -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use ICA

- The user wants resting-state network decomposition rather than task activation analysis.
- The goal is to identify intrinsic connectivity networks from rs-fMRI.
- The user wants subject-level component time series for downstream connectivity or clustering.
- Interpretability of spatial networks is more important than supervised phenotype prediction.
- A lightweight classical unsupervised method is preferred over deep learning.

---

## Limitations and Notes

- Results are sensitive to preprocessing quality, head motion, filtering, and masking choices.
- The number of components strongly influences decomposition granularity.
- ICA is unsupervised and does not directly provide statistical group inference.
- Downstream comparisons across groups usually require additional statistical analysis after decomposition.

---

## Reference

- Beckmann CF, Smith SM. Probabilistic independent component analysis for functional magnetic resonance imaging.
- Nilearn decomposition documentation: https://nilearn.github.io/stable/connectivity/resting_state_networks.html

Created At: 2026-04-14 00:31 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96