---
name: kmeans
description: "Use this model doc whenever the user wants to perform brain parcellation using K-means. This is a non-deep-learning unsupervised route focused on parcel discovery, voxel or vertex grouping, and atlas-like region generation from neuroimaging features."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - smri-skill
  - nilearn-tool
  - run_models
---
# K-means Model Doc

## Overview
K-means is a classical non-deep-learning method for data-driven brain parcellation.

- Model family: non-deep-learning unsupervised clustering method
- Typical objectives:
  - partition voxels, vertices, or ROI features into data-driven brain parcels
  - build subject-level or group-level parcellations from functional or structural similarity
  - export parcel labels and cluster summaries
- Primary input: preprocessed neuroimaging features, optional mask
- Primary output: parcel label map, cluster summaries, optional centroid outputs

In NeuroClaw, this document is model-level guidance for K-means-based brain parcellation workflows rather than supervised prediction.

Upstream preparation should usually be delegated to:
- `fmri-skill` for rs-fMRI or task-fMRI feature preparation when parcellation is function-driven
- `smri-skill` for structural feature preparation when parcellation is anatomy-driven
- `nilearn-tool` for concrete masking, feature matrix preparation, and K-means-based parcel export

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

### 2) K-means route
Representative operations:
- prepare voxel-wise, vertex-wise, or ROI-wise feature matrix
- choose target number of parcels
- fit K-means to assign each spatial unit to a parcel
- export parcel label map and centroid summaries

Example execution route:
```bash
# delegated through claw-shell after features are prepared
python skills/nilearn-tool/scripts/kmeans_parcellation_reference.py \
  --input-list path/to/image_list.txt \
  --mask path/to/group_mask.nii.gz \
  --n-clusters 200 \
  --output-dir run_models_output/kmeans
```

---

## Input / Output Contract

### Required inputs
- feature matrix or aligned neuroimaging image list
- requested clustering target such as parcel count

### Optional inputs
- mask image
- subject grouping or cohort definition
- initialization parameters

### Produced outputs
- parcel label image or table
- cluster size summary
- optional cluster centroids or representative signals

---

## Recommended Delegation

- imaging preprocessing and feature preparation -> `fmri-skill` and/or `smri-skill`
- concrete implementation of K-means -> `nilearn-tool`
- shell execution and logging -> `claw-shell`

No execution before explicit plan confirmation.

---

## When to Use K-means

- The user wants data-driven brain region partitioning rather than using a predefined atlas.
- The goal is to derive parcel labels for downstream connectivity, decoding, or visualization.
- A classical unsupervised clustering baseline is preferred over deep learning.
- The user wants fixed parcel count with simple optimization.

---

## Limitations and Notes

- Clustering quality depends strongly on preprocessing, feature definition, and spatial normalization.
- K-means is sensitive to initialization and requires a fixed cluster count.
- Data-driven parcellations may vary across cohorts and may not align directly with standard atlases.

---

## Reference

- Thirion B, Varoquaux G, Dohmatob E, Poline JB. Which fMRI clustering gives good brain parcellations?
- Nilearn regions and parcellations documentation: https://nilearn.github.io/stable/connectivity/region_extraction.html

Created At: 2026-04-14 00:37 HKT
Last Updated At: 2026-04-14 00:45 HKT
Author: chengwang96