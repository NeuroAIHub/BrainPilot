---
name: pet-skill
description: "Use this skill whenever the user wants to process PET neuroimaging data including spatial normalization to T1w/MNI space, SUVR computation, reference region quantification, partial volume correction, or tracer-specific workflows (PiB amyloid, FDG metabolism, tau). Triggers include: 'PET', 'PET processing', 'SUVR', 'amyloid PET', 'FDG PET', 'tau PET', 'PiB', 'flortaucipir', 'reference region', 'partial volume correction', or any request involving PET neuroimaging data."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: modality
dependencies:
  - fsl-tool
  - freesurfer-tool
  - nibabel-skill
  - claw-shell
complementary_skills:
  - smri-skill
  - fmri-skill
  - brain-visualization
---
# PET Skill (Modality Layer)

## Overview

`pet-skill` is the NeuroClaw **modality-layer** interface skill responsible for all PET neuroimaging data processing tasks.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills: `fsl-tool`, `freesurfer-tool`, `nibabel-skill`, and `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for SUVR computation and reference region extraction.

**Core workflow (never bypassed):**
1. Identify input PET data and tracer type (PiB, FDG, tau, or other).
2. Ensure T1w structural data is available (via `smri-skill` if not yet processed).
3. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
4. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
5. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
6. After execution, save all outputs in a clean directory structure (`pet_output/`).

**Research use only.**

---

## Quick Reference (Common PET Tasks)

| Task | What needs to be done | Delegate to which tool skill | Expected output |
|---|---|---|---|
| PET-to-T1w coregistration | Register dynamic or static PET frame to T1w using rigid-body alignment | `fsl-tool` (FLIRT) | PET in T1w native space |
| T1w-to-MNI normalization | Warp T1w (and co-registered PET) to MNI152 template | `fsl-tool` (FNIRT) or `smri-skill` | PET in MNI152 standard space |
| Reference region extraction | Extract mean signal from anatomically defined reference region (e.g., cerebellar cortex, pons, whole cerebellum) | `fsl-tool` + `freesurfer-tool` + `nibabel-skill` | Reference region mean time-activity curve |
| SUVR computation | Compute Standardized Uptake Value Ratio = target ROI / reference region | `scripts/compute_suvr.py` | Per-region SUVR values (CSV) |
| Partial volume correction | Apply geometric transfer matrix (GTM) or region-based PVC methods | `fsl-tool` + custom | PVC-corrected ROI values |
| Dynamic PET modeling | Kinetic modeling (e.g., Logan plot, SUVR with dynamic frames) | Custom analysis | DVR or SUVR over time |
| Tracer-specific workflow | PiB (amyloid, cerebellar cortex ref), FDG (metabolism, pons ref), tau (flortaucipir, cerebellar cortex ref) | Full pipeline | Tracer-appropriate SUVR maps |

---

## Tracer-Specific Reference Regions

| Tracer | Target | Reference Region | SUVR Threshold (amyloid+) |
|---|---|---|---|
| **PiB** (¹¹C-Pittsburgh Compound B) | Amyloid-β deposition | Cerebellar cortex (gray matter) | SUVR > 1.42 or > 1.21 (centiloid-adjusted) |
| **FDG** (¹⁸F-Fluorodeoxyglucose) | Glucose metabolism (hypometabolism pattern) | Pons or whole cerebellum | Lower SUVR = worse metabolism |
| **Tau** (¹⁸F-Flortaucipir / AV-1451) | Tau neurofibrillary tangles | Cerebellar cortex (gray matter) | SUVR > 1.2–1.3 (region-dependent) |

---

## Core Processing Pipeline

### Stage 1: T1w Preprocessing (via `smri-skill`)
- Brain extraction, tissue segmentation, cortical parcellation (FreeSurfer)
- Required for reference region definition and PVC

### Stage 2: PET-to-T1w Coregistration (via `fsl-tool`)
- Rigid-body registration of mean PET frame to T1w using FLIRT
- Apply transformation to full dynamic or static PET series

### Stage 3: Reference Region Definition
- Use FreeSurfer parcellation to extract reference region mask in T1w space
- Common references: cerebellar cortex (`Cerebellum_Cortex` in Desikan-Killiany), pons
- Project mask to PET space or keep in T1w space with partial volume correction

### Stage 4: SUVR Computation (via `scripts/compute_suvr.py`)
- Extract mean signal from target ROI and reference region
- SUVR = mean(target) / mean(reference)
- Output per-region SUVR values as CSV

### Stage 5 (Optional): Spatial Normalization to MNI
- Warp PET (in T1w space) to MNI152 using T1w-to-MNI warp
- Enable group-level voxelwise analysis

---

## Scripts

### `scripts/compute_suvr.py`
Computes SUVR from a PET image and ROI/reference masks.

```bash
python skills/pet-skill/scripts/compute_suvr.py \
  --pet /path/to/pet_in_t1w_space.nii.gz \
  --target-mask /path/to/target_roi_mask.nii.gz \
  --ref-mask /path/to/reference_region_mask.nii.gz \
  --output /path/to/pet_output/suvr_values.csv
```

---

## Standard Output Layout

```
pet_output/
├── coregistration/          # PET-to-T1w registration matrices and resampled PET
├── suvr/                    # SUVR maps and per-region CSV values
│   ├── suvr_values.csv
│   └── suvr_map.nii.gz
├── pvc/                     # Partial volume corrected values (if requested)
├── mni/                     # PET in MNI152 space (if normalization requested)
├── qc/                      # Coregistration quality, reference region coverage
└── logs/
```

---

## Installation (Handled by dependency-planner)

No manual installation required at this layer.
When first used, `pet-skill` automatically calls `dependency-planner` to ensure `fsl-tool`, `freesurfer-tool`, `nibabel-skill`, and `claw-shell` are ready.

---

## Important Notes & Limitations

- PET images are typically low-resolution (~2–4 mm); coregistration to high-resolution T1w is essential.
- Reference region selection is tracer-dependent; using the wrong reference region invalidates SUVR.
- Partial volume correction is recommended for atrophy-prone populations (e.g., Alzheimer's disease).
- Dynamic PET requires frame timing information from DICOM headers or sidecar JSON.
- Static PET (single late frame) is sufficient for most clinical SUVR analyses.
- This skill is for research workflows; not for clinical decision-making.

---

## When to Call This Skill

- After `smri-skill` when T1w structural preprocessing is complete and PET data needs processing.
- When the user needs SUVR computation from amyloid (PiB), metabolism (FDG), or tau PET data.
- When PET-to-T1w coregistration or normalization to MNI space is required.
- When partial volume correction is requested for ROI-based PET quantification.
- When dataset skills (e.g., `aibl-skill`, `adni-skill`) delegate PET processing.

---

## Complementary / Related Skills

- `smri-skill` → T1w structural preprocessing (brain extraction, parcellation)
- `fmri-skill` → if PET is used alongside fMRI for multimodal analysis
- `fsl-tool` → FLIRT (coregistration), FNIRT (normalization), PETPVC (partial volume correction)
- `freesurfer-tool` → cortical/subcortical parcellation for ROI definition
- `nibabel-skill` → NIfTI I/O for mask manipulation
- `brain-visualization` → PET overlay visualization
- `aibl-skill` → AIBL dataset (PiB, FDG, tau PET)
- `adni-skill` → ADNI dataset (PET data available)

---

## Reference
- Klunk et al. (2004): PiB amyloid imaging
- Landau et al. (2012): Amyloid imaging with PiB and florbetapir
- Baker et al. (2017): AV-1451 tau PET imaging
- BIDS PET extension: https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/09-positron-emission-tomography.html
- FSL: https://fsl.fmrib.ox.ac.uk/fsl/
- FreeSurfer: https://surfer.nmr.mgh.harvard.edu/

Created At: 2026-05-06 12:19 HKT
Last Updated At: 2026-05-06 12:19 HKT
Author: chengwang96
