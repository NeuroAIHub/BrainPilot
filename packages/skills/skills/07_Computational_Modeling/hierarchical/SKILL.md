---
name: hierarchical
description: "Use this model doc whenever the user wants to perform brain parcellation using Hierarchical clustering. This is a non-deep-learning unsupervised route focused on multi-scale parcel discovery, voxel or vertex grouping, and atlas-like region generation from neuroimaging features."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - smri-skill
  - nilearn-tool
  - run_models
---
# Hierarchical Model Doc

## Overview
Hierarchical clustering is a classical non-deep-learning method for data-driven brain parcellation.

- Model family: non-deep-learning unsupervised clustering method
- Typical objectives:
  - partition voxels, vertices, or ROI features into data-driven brain parcels
  - build subject-level or group-level parcellations from functional or structural similarity
  - export parcel labels and merge summaries across scales
- Primary input: preprocessed neuroimaging features, optional mask, optional similarity or connectivity representation
- Primary output: parcel label map, cluster summaries, optional dendrogram outputs

In NeuroClaw, this document is model-level guidance for Hierarchical-clustering-based brain parcellation workflows rather than supervised prediction.

Upstream preparation should usually be delegated to:
- `fmri-skill` for rs-fMRI or task-fMRI feature preparation when parcellation is function-driven
- `smri-skill` for structural feature preparation when parcellation is anatomy-driven
- `nilearn-tool` for concrete masking, feature matrix preparation, and hierarchical parcel export

**Research use only.**

---

## Quick Start

### 1) Prepare parcellation inputs
Expected inputs:
- preprocessed feature matrix or image list
- optional brain mask
- optional subject list or cohort manifest
- target parcel number or clustering granularity

If these are not ready, delegate preprocessing to `fmri-skill` or `smri-skill` first.

### 2) Hierarchical route
Representative operations:
- prepare aligned feature representation
- compute similarity or distance structure across spatial units
- fit agglomerative / Ward-style hierarchical clustering
- export parcel labels and optional dendrogram or merge summaries

Example execution route:
```bash
# delegated through claw-shell after features are prepared
python skills/nilearn-tool/scripts/hierarchical_parcellation_reference.py \
  --input-list path/to/image_list.txt \
  --mask path/to/group_mask.nii.gz \
  --n-clusters 200 \
  --output-dir run_models_output/hierarchical
```

---

## Input / Output Contract

### Required inputs
- feature matrix or aligned neuroimaging image list
- requested clustering target such as parcel count

### Optional inputs
- mask image
- connectivity or similarity matrix
- spatial adjacency constraints
- subject grouping or cohort definition
- linkage parameters

### Produced outputs
- parcel label image or table
- cluster size summary
- optional hierarchical merge information or dendrogram summary

---

## Recommended Delegation

- imaging preprocessing and feature preparation -> `fmri-skill` and/or `smri-skill`
- concrete implementation of Hierarchical clustering -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use Hierarchical Clustering

- The user wants data-driven brain region partitioning rather than using a predefined atlas.
- The goal is to derive parcel labels for downstream connectivity, decoding, or visualization.
- A classical unsupervised clustering baseline is preferred over deep learning.
- The user wants multi-scale organization or merge structure.

---

## Limitations and Notes

- Clustering quality depends strongly on preprocessing, feature definition, and spatial normalization.
- Hierarchical clustering can be computationally expensive for large voxel spaces.
- Data-driven parcellations may vary across cohorts and may not align directly with standard atlases.

---

## Reference

- Bellec P et al. Multi-level bootstrap analysis of stable clusters in resting-state fMRI.
- Nilearn regions and parcellations documentation: https://nilearn.github.io/stable/connectivity/region_extraction.html

Created At: 2026-04-14 00:37 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96