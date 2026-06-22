---
name: detrending
description: "Use this model doc whenever the user wants to perform neuroimaging signal denoising with classical detrending methods. This is a non-deep-learning preprocessing route focused on removing low-frequency drift and linear trends from time series before downstream analysis."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - nilearn-tool
  - run_models
---
# Detrending Model Doc

## Overview
Detrending is a classical non-deep-learning method for neuroimaging signal denoising.

- Model family: non-deep-learning preprocessing and denoising method
- Typical objectives:
  - remove low-frequency drift and temporal trends
  - stabilize time series before connectivity, decoding, or statistical analysis
  - prepare cleaner voxel-wise or ROI-wise time series for downstream workflows
- Primary input: preprocessed fMRI time series, optional confounds, optional mask, TR
- Primary output: cleaned BOLD image, cleaned ROI time series, optional QC summaries

In NeuroClaw, this document is model-level guidance for detrending workflows rather than predictive modeling.

Upstream preparation should usually be delegated to:
- `fmri-skill` for modality-level denoising planning and validated preprocessing sequences
- `nilearn-tool` for concrete detrending and cleaned time series export

**Research use only.**

---

## Quick Start

### 1) Prepare denoising inputs
Expected inputs:
- preprocessed BOLD image
- repetition time (`TR`)
- optional confounds TSV
- optional brain mask

If images are not preprocessed yet, delegate to `fmri-skill` first.

### 2) Detrending route
Representative operations:
- load preprocessed image or extracted ROI time series
- remove constant and linear temporal trends
- optionally combine detrending with confound regression or standardization
- export cleaned image or time series table

Example execution route:
```bash
# delegated through claw-shell after preprocessing is confirmed
python skills/nilearn-tool/scripts/denoise_timeseries_reference.py \
  --bold path/to/sub-001_rest_preproc_bold.nii.gz \
  --confounds path/to/sub-001_confounds.tsv \
  --tr 2.0 \
  --detrend \
  --output-dir run_models_output/detrending
```

---

## Input / Output Contract

### Required inputs
- preprocessed BOLD image or extracted time series
- TR when combined with temporal cleaning workflow metadata

### Optional inputs
- confounds table
- mask image
- standardization options

### Produced outputs
- cleaned BOLD image or cleaned time series
- optional QC summary of detrending settings

---

## Recommended Delegation

- modality-level denoising plan -> `fmri-skill`
- concrete implementation of detrending -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use Detrending

- The user wants signal cleaning rather than statistical modeling or prediction.
- The goal is to remove drift before connectivity or decoding.
- The workflow needs standardized temporal preprocessing before ROI extraction.
- A classical transparent denoising baseline is preferred over learned denoising methods.
- The user explicitly asks for detrending or drift removal.

---

## Limitations and Notes

- Detrending alone does not remove motion or physiological confounds unless combined with regression.
- Detrending choices should be reported because they directly affect downstream analyses.
- Aggressive cleaning sequences can alter downstream effect estimates if applied without task awareness.

---

## Reference

- Ciric R et al. Benchmarking of participant-level confound regression strategies for the control of motion artifact in studies of functional connectivity.
- Nilearn signal cleaning documentation: https://nilearn.github.io/stable/modules/generated/nilearn.image.clean_img.html

Created At: 2026-04-14 00:40 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96