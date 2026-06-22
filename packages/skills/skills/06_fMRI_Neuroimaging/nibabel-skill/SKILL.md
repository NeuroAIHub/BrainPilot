---
name: nibabel-skill
description: "Use this skill whenever NeuroClaw needs concrete nibabel operations for neuroimaging files: loading and validating NIfTI images, inspecting shapes and affine matrices, saving derived images, converting voxel coordinates to MNI/world coordinates, or reading FreeSurfer geometry and annotation files. Triggers include: 'nibabel', 'inspect NIfTI', 'read affine', 'save nifti', 'voxel to MNI', 'atlas coordinates', 'read FreeSurfer surface', 'read annot', or any request focused on low-level neuroimaging I/O rather than full preprocessing."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: tool
dependencies: []
---
# Nibabel Skill

## Overview

`nibabel-skill` is the NeuroClaw tool skill for low-level neuroimaging file I/O and geometry handling.

It is the right skill when the task is about reading or writing NIfTI data, checking image dimensions and affine matrices, extracting atlas-space coordinates, or interacting with FreeSurfer surface and annotation files.

This skill is intentionally narrower than `nilearn-tool` and `brain-visualization`:
- `nibabel-skill` focuses on file structures, affines, voxel/world coordinates, and surface geometry I/O
- `nilearn-tool` focuses on signal processing, masking, ROI time series, and statistical image workflows
- `brain-visualization` focuses on final figure generation and mesh export workflows

The content is distilled from nibabel-centric patterns that appear repeatedly in `rs-fMRI-Pipeline-Tutorial/`, especially:
- NIfTI discovery and validation in the multimodal pipeline
- affine-based ROI center conversion in zALFF regional summaries
- FreeSurfer geometry and annotation loading for colored surface export

## Agent Reference Rule

When the agent needs nibabel-based code, it should start from the curated snippets in `skills/nibabel-skill/scripts/` instead of copying tutorial files with hard-coded paths.

Reference snippets available:
- `scripts/nifti_inspection_reference.py` -> load NIfTI, inspect shape/dtype/affine, save a copied image
- `scripts/atlas_coordinate_reference.py` -> compute atlas ROI centers and convert voxel coordinates to world coordinates
- `scripts/freesurfer_io_reference.py` -> read FreeSurfer geometry/annotation and summarize mesh/color-table metadata

## Quick Reference

| Task | What it does | Typical input | Expected output |
|------|--------------|---------------|-----------------|
| NIfTI inspection | Loads an image and reports shape, dtype, affine, zooms | `.nii` / `.nii.gz` | metadata summary |
| NIfTI save/export | Saves processed arrays back to NIfTI with an affine | array + affine | output image |
| Atlas coordinate extraction | Converts ROI voxel centers to atlas/world coordinates | labeled atlas NIfTI | CSV / printed coordinates |
| FreeSurfer surface I/O | Reads `.pial`, `.white`, `.annot` and summarizes geometry | surface + annot files | geometry summary |

## Installation

Install nibabel-related dependencies in the existing `neuroclaw` environment:

```bash
conda activate neuroclaw
conda install -n neuroclaw -c conda-forge nibabel numpy pandas -y
```

Optional companion packages for downstream workflows:

```bash
conda install -n neuroclaw -c conda-forge nilearn scipy matplotlib -y
```

## Core Usage Patterns

### 1. NIfTI Inspection and Validation

Recommended when the user needs to verify whether a NIfTI file is 3D or 4D, whether the affine looks valid, or whether an image can be reused in later steps.

Typical nibabel operations:
- `nib.load(...)`
- `img.shape`
- `img.affine`
- `img.get_fdata()`
- `img.header.get_zooms()`
- `nib.Nifti1Image(...)`
- `nib.save(...)`

Example command pattern:

```bash
python skills/nibabel-skill/scripts/nifti_inspection_reference.py \
  --image path/to/image.nii.gz \
  --copy-output outputs/image_copy.nii.gz
```

### 2. Atlas ROI Coordinate Extraction

Recommended when the task is to convert ROI labels into approximate world or MNI coordinates.

Typical nibabel operations:
- load labeled atlas volumes with `nib.load(...)`
- find ROI voxels with `numpy.argwhere(...)`
- compute ROI centers with `numpy.median(...)`
- convert voxel indices to world coordinates with `nib.affines.apply_affine(...)`

Example command pattern:

```bash
python skills/nibabel-skill/scripts/atlas_coordinate_reference.py \
  --atlas path/to/AAL3v1.nii \
  --labels path/to/AAL3v1.nii.txt \
  --output outputs/atlas_roi_centers.csv
```

### 3. FreeSurfer Geometry and Annotation I/O

Recommended when the task is to inspect or reuse FreeSurfer surfaces and annotation color tables before later visualization/export steps.

Typical nibabel operations:
- `nibabel.freesurfer.read_geometry(...)`
- `nibabel.freesurfer.read_annot(...)`

Example command pattern:

```bash
python skills/nibabel-skill/scripts/freesurfer_io_reference.py \
  --surf path/to/lh.pial \
  --annot path/to/lh.aparc.annot
```

## Curated Reference Scripts

### `scripts/nifti_inspection_reference.py`

Purpose:
- load NIfTI files safely
- inspect dimensionality, dtype, zooms, and affine
- optionally save a copy using the original affine and header

Relevant tutorial sources:
- `rs-fMRI-Pipeline-Tutorial/multimodal_brain_connectivity_pipeline.py`
- `rs-fMRI-Pipeline-Tutorial/MNI152_zALFF_Brain_Region_Activation_Analysis.py`

### `scripts/atlas_coordinate_reference.py`

Purpose:
- extract ROI ids from a labeled atlas
- map ROI voxel centers into atlas/world coordinates
- export a structured CSV table for downstream use

Relevant tutorial sources:
- `rs-fMRI-Pipeline-Tutorial/MNI152_zALFF_Brain_Region_Activation_Analysis.py`

### `scripts/freesurfer_io_reference.py`

Purpose:
- inspect FreeSurfer mesh size and annotation coverage
- summarize vertex counts, face counts, label ids, and available colors
- serve as the low-level I/O basis for mesh export workflows

Relevant tutorial sources:
- `rs-fMRI-Pipeline-Tutorial/export_colored_ply_from_freesurfer.py`

## Important Notes & Limitations

- `nibabel-skill` is not a replacement for preprocessing tools such as FSL, fMRIPrep, or Nilearn workflows.
- Affine correctness matters: voxel coordinates are meaningless without the right affine transform.
- Atlas label files and atlas volumes may not align perfectly by naming convention; always validate label counts.
- FreeSurfer `.annot` label ids are not always a direct 0..N index into user expectations; inspect the returned tables carefully.

## When to Call This Skill

- The agent needs to read or validate a NIfTI image before running downstream analysis.
- The user asks for affine, shape, dtype, or voxel/world coordinate inspection.
- The task involves extracting ROI centers from an atlas volume.
- The task involves reading FreeSurfer surfaces or annotations before mesh export.

## Complementary / Related Skills

- `nilearn-tool` -> higher-level masking, ROI extraction, connectivity, GLM workflows
- `brain-visualization` -> final connectome figures and PLY export workflows
- `freesurfer-tool` -> full structural processing and recon-all workflows

## Reference

This skill is adapted from the nibabel-related code patterns in:
- rs-fMRI-Pipeline-Tutorial: https://github.com/Karcen/rs-fMRI-Pipeline-Tutorial

Curated reference snippets in this skill:
- `skills/nibabel-skill/scripts/nifti_inspection_reference.py`
- `skills/nibabel-skill/scripts/atlas_coordinate_reference.py`
- `skills/nibabel-skill/scripts/freesurfer_io_reference.py`

---
Created At: 2026-04-14 00:23 HKT  
Last Updated At: 2026-04-14 00:23 HKT  
Author: chengwang96