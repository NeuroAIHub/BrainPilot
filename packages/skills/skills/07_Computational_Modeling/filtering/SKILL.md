---
name: filtering
description: "Use this model doc whenever the user wants to perform neuroimaging signal denoising with classical temporal filtering methods. This is a non-deep-learning preprocessing route focused on temporal cleaning, frequency selection, and preparation of cleaner time series for downstream analysis."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - nilearn-tool
  - run_models
---
# Filtering Model Doc

## Overview
Filtering is a classical non-deep-learning method for neuroimaging signal denoising.

- Model family: non-deep-learning preprocessing and denoising method
- Typical objectives:
  - remove unwanted frequency content from BOLD time series
  - retain frequency bands relevant to resting-state or task analysis
  - prepare cleaner voxel-wise or ROI-wise time series for downstream connectivity, decoding, or statistical analysis
- Primary input: preprocessed fMRI time series, optional confounds, optional mask, TR
- Primary output: denoised BOLD image, cleaned ROI time series, optional QC summaries

In NeuroClaw, this document is model-level guidance for temporal filtering workflows rather than predictive modeling.

Upstream preparation should usually be delegated to:
- `fmri-skill` for modality-level denoising planning and validated preprocessing sequences
- `nilearn-tool` for concrete filtering and cleaned image export

**Research use only.**

---

## Quick Start

### 1) Prepare denoising inputs
Expected inputs:
- preprocessed BOLD image
- repetition time (`TR`)
- optional confounds TSV
- optional brain mask
- optional requested frequency band

If images are not preprocessed yet, delegate to `fmri-skill` first.

### 2) Filtering route
Representative operations:
- load preprocessed BOLD time series
- apply temporal high-pass / low-pass or band-pass filtering
- optionally combine filtering with standardization or confound regression
- export denoised image and cleaned summaries

Example execution route:
```bash
# delegated through claw-shell after preprocessing is confirmed
python skills/nilearn-tool/scripts/preprocess_bold_reference.py \
  --bold path/to/sub-001_rest_preproc_bold.nii.gz \
  --tr 2.0 \
  --high-pass 0.01 \
  --low-pass 0.08 \
  --output run_models_output/filtering/sub-001_rest_filtered_bold.nii.gz
```

---

## Input / Output Contract

### Required inputs
- preprocessed BOLD image or extracted time series
- TR for temporal filtering

### Optional inputs
- confounds table
- mask image
- high-pass / low-pass frequency settings
- standardization or smoothing options

### Produced outputs
- denoised BOLD image
- cleaned ROI or voxel time series
- optional QC summary of filtering settings

---

## Recommended Delegation

- modality-level denoising plan -> `fmri-skill`
- concrete implementation of filtering -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use Filtering

- The user wants signal cleaning rather than statistical modeling or prediction.
- The goal is to remove unwanted frequency content before connectivity or decoding.
- The workflow needs standardized temporal preprocessing before ROI extraction.
- A classical transparent denoising baseline is preferred over learned denoising methods.
- The user explicitly asks for band-pass filtering, high-pass filtering, or low-pass filtering.

---

## Limitations and Notes

- Filtering choices depend strongly on TR, study design, and whether the data are resting-state or task-fMRI.
- Over-aggressive filtering can remove meaningful task-related or physiological signals.
- Temporal cleaning parameters should be reported because they directly affect downstream analyses.

---

## Reference

- Lindquist MA. The statistical analysis of fMRI data.
- Nilearn signal cleaning documentation: https://nilearn.github.io/stable/modules/generated/nilearn.image.clean_img.html

Created At: 2026-04-14 00:40 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96