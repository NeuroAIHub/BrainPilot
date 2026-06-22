---
name: brain-visualization
description: "Use this skill whenever the user wants to visualize neuroimaging analysis results, including 3D brain connectivity networks, atlas-based regional activation summaries, or FreeSurfer cortical surface meshes with anatomical colors. Triggers include: 'brain visualization', 'visualize connectome', '3D brain network', 'zALFF visualization', 'brain activation map', 'FreeSurfer PLY export', 'surface mesh rendering', or any request to turn neuroimaging outputs into interpretable figures or 3D models."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - nibabel-skill
  - nilearn-tool
---
# Brain Visualization

## Overview

`brain-visualization` is the NeuroClaw skill for turning processed neuroimaging outputs into publication-friendly figures and 3D assets.

It focuses on three common visualization tasks drawn from the methods demonstrated in the referenced rs-fMRI tutorial:
- 3D brain connectivity visualization from atlas coordinates and ROI-to-ROI connectivity matrices
- atlas-based brain region activation ranking and coordinate export from zALFF-like volumetric maps
- FreeSurfer cortical surface export to colored PLY meshes for downstream 3D rendering

This skill is intended for analysis outputs that already exist. It does not replace preprocessing or statistical modeling skills such as `fmri-skill`, `nilearn-tool`, `freesurfer-tool`, or `fsl-tool`.

## Agent Reference Rule

When implementing or adapting visualization workflows, the agent should first consult the curated reference snippets in `skills/brain-visualization/scripts/` instead of copying directly from the tutorial scripts with hard-coded paths.

Reference snippets available:
- `scripts/connectome_reference.py` -> atlas coordinate extraction + strongest-edge connectome plotting
- `scripts/zalff_summary_reference.py` -> MNI resampling + zALFF regional summary + coordinate export
- `scripts/freesurfer_ply_reference.py` -> FreeSurfer surface + annotation to colored PLY export

These snippets are distilled from `rs-fMRI-Pipeline-Tutorial/` and are intended as the preferred starting point for new agent-generated code in this skill.

## Quick Reference

| Task | What needs to be visualized | Typical input | Expected output |
|------|-----------------------------|---------------|-----------------|
| 3D connectome figure | strongest ROI-to-ROI connections on a template brain | atlas NIfTI + connectivity matrix (`.npy` / `.csv`) + template T1 | static network figure (`.png`) |
| Regional activation summary | top active atlas regions with MNI coordinates | BOLD-derived zALFF or similar volumetric map + atlas + labels | ranked CSV table + coordinate table |
| FreeSurfer surface export | anatomical cortical mesh with region colors | `lh.pial` / `rh.pial` + `.annot` files | colored mesh (`.ply`) |
| Publication-ready snapshots | compact figures for reports or manuscripts | any of the above | PNG figures and tabular summaries |

## Core Visualization Patterns

### 1. 3D Brain Network Visualization

Recommended when the user has a connectivity matrix and wants an interpretable whole-brain figure.

Typical approach:
- Load an atlas image such as AAL3 and derive ROI coordinates with Nilearn.
- Load a symmetric functional connectivity matrix.
- Zero the diagonal and keep only the strongest edges for readability.
- Plot the network on a standard-space template using `nilearn.plotting.plot_connectome`.

Typical Python stack:
- `numpy`
- `nibabel`
- `matplotlib`
- `nilearn`

Example command pattern:

```bash
python skills/brain-visualization/scripts/connectome_reference.py \
	--atlas path/to/AAL3v1.nii \
	--template path/to/mni_icbm152_t1_tal_nlin_sym_09a.nii \
	--matrix path/to/fc_matrix.npy \
	--output outputs/3D_brain_network.png
```

Recommended outputs:
- `3D_brain_network_AAL166_strongest.png`

### 2. Atlas-Based Regional Activation Summary

Recommended when the user wants a ranked list of active regions rather than only a voxelwise map.

Typical approach:
- Resample BOLD-derived data into MNI space.
- Compute ALFF or zALFF-like summary statistics.
- Use `NiftiLabelsMasker` to extract atlas-level regional values.
- Rank regions and export the top regions with MNI coordinates.

Typical Python stack:
- `numpy`
- `pandas`
- `nibabel`
- `nilearn`

Example command pattern:

```bash
python skills/brain-visualization/scripts/zalff_summary_reference.py \
	--bold path/to/rest_bold.nii.gz \
	--atlas path/to/AAL3v1.nii \
	--labels path/to/AAL3v1.nii.txt \
	--mask path/to/mni_mask.nii.gz \
	--output-dir outputs/active_brain_results
```

Recommended outputs:
- `TOP10_active_regions.csv`
- `top10_coordinates.csv`
- `all_brain_regions_activity.csv`

### 3. FreeSurfer Colored Surface Export

Recommended when the user needs a mesh that can be opened in Blender, MeshLab, or downstream 3D pipelines.

Typical approach:
- Read FreeSurfer geometry from `lh.pial` / `rh.pial`.
- Read anatomical labels from `lh.aparc.annot` / `rh.aparc.annot`.
- Map vertex labels to RGB colors from the annotation color table.
- Export ASCII PLY with per-vertex color fields.

Typical Python stack:
- `nibabel`
- `numpy`

Example command pattern:

```bash
python skills/brain-visualization/scripts/freesurfer_ply_reference.py \
	--surf path/to/lh.pial \
	--annot path/to/lh.aparc.annot \
	--output outputs/lh_colored.ply
```

Recommended outputs:
- left hemisphere colored mesh (`.ply`)
- right hemisphere colored mesh (`.ply`)

## Installation

Install the common visualization dependencies in the existing `neuroclaw` environment:

```bash
conda activate neuroclaw
conda install -n neuroclaw -c conda-forge numpy pandas nibabel nilearn matplotlib networkx -y
```

Optional packages depending on workflow:

```bash
conda install -n neuroclaw -c conda-forge scipy seaborn plotly -y
```

If FreeSurfer surface export is needed, ensure FreeSurfer outputs already exist and `nibabel` can access the surface and annotation files.

## When to Call This Skill

- The user has already produced a connectivity matrix and wants a 3D connectome figure.
- The user needs atlas-level summaries of resting-state activation metrics such as zALFF.
- The user wants to export FreeSurfer cortical surfaces into colored 3D meshes.
- The user is preparing figures or supplementary materials for papers, presentations, or reports.

## Complementary / Related Skills

- `fmri-skill` -> preprocessing and fMRI workflow planning
- `nilearn-tool` -> ROI extraction, connectivity computation, seed maps, GLM support
- `freesurfer-tool` -> anatomical reconstruction and parcellation generation
- `paper-writing` -> convert generated figures/tables into manuscript assets

## Important Notes & Limitations

- This skill is for visualization and result packaging, not raw image preprocessing.
- Connectivity figures should usually threshold or sparsify edges; plotting full dense matrices produces unreadable figures.
- Atlas labels, atlas volume, and connectivity matrix dimensions must match.
- MNI-space summary workflows assume the volume has already been aligned or resampled appropriately.
- FreeSurfer colored PLY export depends on valid `.annot` files; missing or mismatched annotations will degrade vertex coloring.

## Reference

This skill is adapted from the visualization ideas and example workflows in:
- rs-fMRI-Pipeline-Tutorial: https://github.com/Karcen/rs-fMRI-Pipeline-Tutorial

Key referenced methods in the local tutorial copy:
- 3D brain network plotting with AAL atlas and Nilearn
- MNI152 zALFF regional activation ranking
- FreeSurfer colored cortical surface export to PLY

Curated reference snippets in this skill:
- `skills/brain-visualization/scripts/connectome_reference.py`
- `skills/brain-visualization/scripts/zalff_summary_reference.py`
- `skills/brain-visualization/scripts/freesurfer_ply_reference.py`

---
Created At: 2026-04-14 00:15 HKT  
Last Updated At: 2026-04-14 00:40 HKT  
Author: chengwang96