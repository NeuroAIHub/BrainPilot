---
name: nifd-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Neuroimaging in Frontotemporal Dementia (NIFD) dataset, including BIDS validation, multimodal processing of sMRI, rs-fMRI, and dMRI, phenotype extraction, and QC integration. Triggers include: 'NIFD', 'frontotemporal dementia', 'FTD', 'bvFTD', 'PPA', 'process NIFD data', or any request to run the NIFD multimodal pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - dwi-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - brain-visualization
  - pet-skill
---
# NIFD Skill (Dataset-Orchestration Layer)

## Overview

`nifd-skill` is the NeuroClaw orchestration skill for the **Neuroimaging in Frontotemporal Dementia (NIFD)** dataset, collected at the UCSF Memory and Aging Center.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input NIFD data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`nifd_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate NIFD BIDS structure | `scripts/validate_nifd.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation, cortical thickness | `smri-skill` | `smri_output/` derivatives |
| rs-fMRI processing | Preprocessing, denoising, connectivity | `fmri-skill` | `fmri_output/` connectivity |
| dMRI processing | Diffusion preprocessing, tensor metrics, tractography | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Diagnosis, cognitive scores, clinical measures | `scripts/extract_nifd_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/nifd_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~120 participants
  - **bvFTD**: Behavioral variant frontotemporal dementia
  - **svPPA**: Semantic variant primary progressive aphasia
  - **nfvPPA**: Nonfluent variant primary progressive aphasia
  - **Healthy controls**: Age-matched
- **Scanner**: 3T Siemens TIM Trio
- **Modalities**: T1w sMRI, rs-fMRI, dMRI/DTI
- **Clinical**: CDR, MMSE, neuropsychological battery
- **Access**: OpenNeuro ds004403 (or UCSF MAC portal)
- **Format**: BIDS-compliant

---

## Supported Modalities

| Modality | Description | Details |
|---|---|---|
| T1w | High-resolution structural MRI | 1mm isotropic, cortical thickness/atrophy |
| rs-fMRI | Resting-state functional MRI | Functional connectivity, network degeneration |
| dMRI | Diffusion-weighted imaging | DTI, white matter tract integrity |

---

## NIFD Diagnostic Groups

| Group | Description | Typical N |
|---|---|---|
| bvFTD | Behavioral variant FTD | ~40 |
| svPPA | Semantic variant PPA | ~20 |
| nfvPPA | Nonfluent variant PPA | ~15 |
| Control | Healthy age-matched controls | ~45 |

---

## BIDS Preparation

### Script: `scripts/validate_nifd.py`

Validates NIFD BIDS structure and generates a compliance report.

```bash
python skills/nifd-skill/scripts/validate_nifd.py \
  --input /path/to/NIFD/bids \
  --output /path/to/nifd_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Diagnostic group completeness check
- Modality completeness (T1w, rs-fMRI, dMRI)
- Missing data identification

---

## Core Workflow (Never Bypassed)

1. Identify user target: full NIFD processing, imaging subset, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_nifd.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. Delegate to `fmri-skill` for rs-fMRI processing (functional connectivity).
7. Delegate to `dwi-skill` for dMRI processing (white matter integrity).
8. If phenotype extraction is requested, run `scripts/extract_nifd_phenotype.py`.
9. If QC summary is requested, run `scripts/nifd_qc_summary.py`.
10. Save outputs into `nifd_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical thickness | `smri_output/` derivatives |
| rs-fMRI | `fmri-skill` | preprocessing, denoising, connectivity | `fmri_output/` connectivity |
| dMRI | `dwi-skill` | diffusion preprocessing, tensor metrics, tractography | `dwi_output/` metrics |

---

## Standard Output Layout

```
nifd_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (rs-fMRI connectivity)
├── dwi/                    # Diffusion MRI derivatives (DTI metrics)
├── phenotype/              # Merged phenotype tables (diagnosis, cognitive)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local NIFD data validation.

- If the task starts from NIFD data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local NIFD discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- NIFD is a clinical cohort; patient data requires careful handling.
- Diagnostic groups (bvFTD, svPPA, nfvPPA) have distinct atrophy patterns; group-level analyses should account for heterogeneity.
- Cortical thickness and voxel-based morphometry are commonly used structural measures.
- Network degeneration hypothesis: FTD targets specific large-scale networks.
- `nifd-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end NIFD workflow.
- User asks to process NIFD neuroimaging data.
- User needs BIDS validation for NIFD data.
- User asks to extract NIFD phenotype data (diagnosis, cognitive scores).
- User asks for frontotemporal dementia neuroimaging analysis.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `fmri-skill` → functional MRI preprocessing and analysis
- `dwi-skill` → diffusion MRI preprocessing
- `pet-skill` → PET imaging (tau-PET, amyloid-PET if available)
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- NIFD: UCSF Memory and Aging Center
- Frontotemporal Dementia: FTDC clinical diagnostic criteria
- OpenNeuro ds004403

Created At: 2026-05-06 13:55 HKT
Last Updated At: 2026-05-06 13:55 HKT
Author: chengwang96
