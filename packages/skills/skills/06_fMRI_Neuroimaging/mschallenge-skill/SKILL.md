---
name: mschallenge-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Longitudinal MS Lesion Segmentation Challenge dataset, including data validation, multimodal processing of T1w, T2w, FLAIR, and PD, lesion segmentation, and QC integration. Triggers include: 'MS Lesion Challenge', 'MS Lesion', 'ISBI MS', 'longitudinal MS', 'multiple sclerosis lesion', or any request to run the MS lesion segmentation pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - nibabel-skill
  - claw-shell
complementary_skills:
  - brain-visualization
---
# MS Challenge Skill (Dataset-Orchestration Layer)

## Overview

`mschallenge-skill` is the NeuroClaw orchestration skill for the **Longitudinal MS Lesion Segmentation Challenge** dataset.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for data validation, lesion analysis, and QC.

**Core workflow (never bypassed):**
1. Identify input MS Challenge data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`mschallenge_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| Data validation | Validate MS Challenge directory structure | `scripts/validate_mschallenge.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation | `smri-skill` | `smri_output/` derivatives |
| Lesion analysis | Lesion volume, count, location analysis | `scripts/analyze_lesions.py` | Lesion statistics CSV |
| Longitudinal analysis | Lesion change tracking across timepoints | `scripts/longitudinal_lesion.py` | Longitudinal change report |
| QC summary | Per-subject quality control | `scripts/mschallenge_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Origin**: ISBI 2015 Longitudinal MS Lesion Segmentation Challenge
- **Training**: 5 subjects, each with 2 timepoints (longitudinal)
- **Testing**: 14 subjects (hidden ground truth), 4-6 timepoints each
- **Modalities**: T1w, T2w, FLAIR, PD (co-registered)
- **Ground truth**: Manual lesion segmentation masks (training only)
- **Resolution**: ~0.5 × 0.5 × 0.5 mm (isotropic)
- **Preprocessing**: Skull-stripped, co-registered to common space
- **Reference**: Carass et al. (2017), NeuroImage

---

## Supported Modalities

| Modality | Description | Use in MS |
|---|---|---|
| T1w | T1-weighted structural | Brain atrophy, gray matter lesions |
| T2w | T2-weighted | White matter lesion detection |
| FLAIR | Fluid-Attenuated Inversion Recovery | Periventricular lesion detection |
| PD | Proton Density | Complementary lesion contrast |

---

## Directory Structure (Native)

```
training/
├── subject01/
│   ├── time01/
│   │   ├── subject01_time01_T1.nii.gz
│   │   ├── subject01_time01_T2.nii.gz
│   │   ├── subject01_time01_FLAIR.nii.gz
│   │   ├── subject01_time01_PD.nii.gz
│   │   └── subject01_time01_lesion.nii.gz  (ground truth)
│   └── time02/
│       └── ...
```

---

## BIDS Preparation

### Script: `scripts/validate_mschallenge.py`

Validates MS Challenge directory structure and generates a compliance report.

```bash
python skills/mschallenge-skill/scripts/validate_mschallenge.py \
  --input /path/to/MSChallenge/training \
  --output /path/to/mschallenge_output/qc/validation.csv
```

Features:
- Directory structure validation
- Modality completeness check (T1w, T2w, FLAIR, PD)
- Ground truth mask presence verification
- Longitudinal timepoint consistency
- Missing data identification

---

## Core Workflow (Never Bypassed)

1. Identify user target: full MS Challenge processing, lesion analysis, or validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run data validation using `scripts/validate_mschallenge.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. If lesion analysis is requested, run `scripts/analyze_lesions.py`.
7. If longitudinal analysis is requested, run `scripts/longitudinal_lesion.py`.
8. If QC summary is requested, run `scripts/mschallenge_qc_summary.py`.
9. Save outputs into `mschallenge_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w/T2w/FLAIR/PD) | `smri-skill` | brain extraction, tissue segmentation | `smri_output/` derivatives |
| Lesion masks | `nibabel-skill` | lesion volume, count, location | Lesion statistics |

---

## Standard Output Layout

```
mschallenge_output/
├── raw/                    # Original MS Challenge files
├── validation/             # Validation reports
├── smri/                   # Structural MRI derivatives
├── lesions/                # Lesion analysis results
│   ├── lesion_stats.csv
│   └── longitudinal_change.csv
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local MS Challenge data validation.

- If the task starts from MS Challenge data already present on disk and only asks for validation:
  - Skip the download stage
  - Default to the narrow path `local MS Challenge discovery -> validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- MS Challenge is a longitudinal dataset; consider timepoint effects in analysis.
- Ground truth masks are only available for training subjects.
- All images are preprocessed (skull-stripped, co-registered).
- Lesion segmentation is the primary task; standard brain morphometry may be affected by lesions.
- The challenge is designed for benchmarking; results should be compared with published baselines.
- `mschallenge-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end MS Lesion Challenge workflow.
- User asks to validate MS Challenge data structure.
- User asks for lesion volume and count analysis.
- User asks for longitudinal lesion change tracking.
- User asks for MS lesion segmentation benchmarking.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `nibabel-skill` → NIfTI I/O and mask manipulation
- `brain-visualization` → lesion overlay visualization
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- Carass et al. (2017): Longitudinal multiple sclerosis lesion segmentation: Resource and challenge. NeuroImage.
- ISBI 2015 MS Lesion Challenge: https://smart-stats-tools.org/lesion-challenge

Created At: 2026-05-06 13:31 HKT
Last Updated At: 2026-05-06 13:31 HKT
Author: chengwang96
