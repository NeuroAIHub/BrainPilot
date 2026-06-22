---
name: nsd-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Natural Scenes Dataset (NSD), including data access, BIDS validation, multimodal processing of task-fMRI and structural MRI, stimulus metadata extraction, and QC integration. Triggers include: 'NSD', 'Natural Scenes Dataset', 'process NSD data', 'NSD fMRI', 'visual neuroscience', or any request to run the NSD multimodal pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - brain-visualization
  - nibabel-skill
---
# NSD Skill (Dataset-Orchestration Layer)

## Overview

`nsd-skill` is the NeuroClaw orchestration skill for the **Natural Scenes Dataset (NSD)**.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, stimulus extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input NSD data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`nsd_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate NSD BIDS structure | `scripts/validate_nsd.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation | `smri-skill` | `smri_output/` derivatives |
| task-fMRI processing | Visual task GLM, voxel-wise encoding | `fmri-skill` | `fmri_output/` task results |
| Stimulus extraction | COCO image metadata, annotations | `scripts/extract_nsd_stimulus.py` | Stimulus metadata CSV |
| QC summary | Per-subject quality control | `scripts/nsd_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: 8 healthy adults (subj01-subj08)
- **Scanner**: 7T Siemens MAGNETOM
- **Resolution**: 1.8mm isotropic voxels
- **Sessions**: ~30-40 scanning sessions per subject
- **Total fMRI**: ~30 hours per subject
- **Stimuli**: ~73,000 natural scene images from COCO dataset
- **Access**: OSF (Open Science Framework) and Amazon S3
- **Reference**: Allen et al. (2021), Nature Neuroscience

---

## Supported Modalities

| Modality | Description | Details |
|---|---|---|
| T1w | High-resolution structural MRI | 7T anatomical scans |
| task-fMRI | Visual task fMRI | Natural scene viewing with fixation task |
| dMRI | Diffusion-weighted imaging | White matter tractography |
| Retinotopy | Retinotopic mapping | Visual area identification |
| Eye-tracking | Gaze position data | During image viewing |

---

## NSD Task Paradigms

| Task | Description | Duration |
|---|---|---|
| NSD | Natural scene viewing (COCO images) | ~30-40 sessions × ~15 min each |
| FIXATION | Fixation task during image presentation | Continuous |

---

## COCO Stimulus Metadata

The NSD uses images from the COCO (Common Objects in Context) dataset:
- ~73,000 unique natural scene images
- Each image has: 5 captions, 80 object categories, segmentation masks
- Images are presented for 3 seconds each
- Subjects perform a fixation task (detect image repeat)

---

## BIDS Preparation

### Script: `scripts/validate_nsd.py`

Validates NSD BIDS structure and generates a compliance report.

```bash
python skills/nsd-skill/scripts/validate_nsd.py \
  --input /path/to/NSD/bids \
  --output /path/to/nsd_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Subject completeness check (8 subjects)
- Session count validation (~30-40 sessions per subject)
- Stimulus file presence verification
- Missing data identification

---

## Core Workflow (Never Bypassed)

1. Identify user target: full NSD processing, imaging subset, stimulus extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_nsd.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. Delegate to `fmri-skill` for task-fMRI processing (natural scene viewing).
7. If stimulus extraction is requested, run `scripts/extract_nsd_stimulus.py`.
8. If QC summary is requested, run `scripts/nsd_qc_summary.py`.
9. Save outputs into `nsd_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction | `smri_output/` derivatives |
| task-fMRI | `fmri-skill` | preprocessing, denoising, voxel-wise encoding | `fmri_output/` task results |
| dMRI | `fmri-skill` | diffusion preprocessing, tensor metrics | `dwi_output/` metrics |

---

## Standard Output Layout

```
nsd_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (natural scene viewing)
├── stimulus/               # COCO stimulus metadata
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local NSD data validation.

- If the task starts from NSD data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local NSD discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- NSD is a high-resolution 7T dataset; processing requires significant compute resources.
- 8 subjects with dense repeated measures (~30 hours of fMRI each).
- Visual neuroscience focus: standard task GLM may not apply; consider voxel-wise encoding models.
- COCO stimulus metadata is essential for stimulus-response analyses.
- Cortical surface-based representations using FreeSurfer outputs.
- `nsd-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end NSD workflow.
- User asks to process NSD task-fMRI data.
- User needs BIDS validation for NSD data.
- User asks to extract NSD stimulus metadata (COCO images, captions, categories).
- User asks for visual cortex analysis or voxel-wise encoding.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `fmri-skill` → functional MRI preprocessing and analysis
- `nibabel-skill` → NIfTI I/O and surface data
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- NSD: https://naturalscenesdataset.org/
- Allen et al. (2021): A massive 7T fMRI dataset to bridge cognitive neuroscience and artificial intelligence. Nature Neuroscience.
- COCO: https://cocodataset.org/

Created At: 2026-05-06 13:31 HKT
Last Updated At: 2026-05-06 13:31 HKT
Author: chengwang96
