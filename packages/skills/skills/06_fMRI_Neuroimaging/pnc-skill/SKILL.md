---
name: pnc-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Philadelphia Neurodevelopmental Cohort (PNC) dataset, including BIDS validation, multimodal processing of sMRI, rs-fMRI, task-fMRI, and dMRI, phenotype extraction, and QC integration. Triggers include: 'PNC', 'Philadelphia Neurodevelopmental Cohort', 'process PNC data', 'PNC fMRI', or any request to run the PNC multimodal pipeline."
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
---
# PNC Skill (Dataset-Orchestration Layer)

## Overview

`pnc-skill` is the NeuroClaw orchestration skill for the **Philadelphia Neurodevelopmental Cohort (PNC)** dataset, a large-scale collaborative study between the University of Pennsylvania and the Children's Hospital of Philadelphia.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input PNC data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`pnc_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate PNC BIDS structure | `scripts/validate_pnc.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation | `smri-skill` | `smri_output/` derivatives |
| rs-fMRI processing | Preprocessing, denoising, connectivity | `fmri-skill` | `fmri_output/` connectivity |
| task-fMRI processing | Go/No-Go, emotion, memory task GLM | `fmri-skill` | `fmri_output/` task results |
| dMRI processing | Diffusion preprocessing, tensor metrics | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Cognitive, psychiatric, demographic | `scripts/extract_pnc_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/pnc_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~9,000+ youth aged 8-21 years
- **Scanner**: 3T Siemens TIM Trio
- **Modalities**: T1w sMRI, rs-fMRI, task-fMRI, dMRI/DTI
- **Task paradigms**: Go/No-Go, Fraternal Twins, Penn Line Orientation, Penn Word Memory
- **Clinical**: Psychiatric assessment, cognitive battery (Penn CNB)
- **Access**: NIMH Data Archive (NDA), OpenNeuro ds000030 (BIDS subset)
- **Format**: BIDS-compliant (community conversion)
- **Reference**: Satterthwaite et al. (2014), NeuroImage

---

## Supported Modalities

| Modality | Description | Tasks/Conditions |
|---|---|---|
| T1w | High-resolution structural MRI | 1mm isotropic |
| rs-fMRI | Resting-state functional MRI | Eyes open |
| task-fMRI | Task-based functional MRI | Go/No-Go, Emotion, Line Orientation, Word Memory |
| dMRI | Diffusion-weighted imaging | DTI, white matter tractography |

---

## PNC Task Paradigms

| Task | Description | Cognitive Domain |
|---|---|---|
| Go/No-Go | Response inhibition / impulse control | Executive function |
| Fraternal Twins | Emotion recognition | Social cognition |
| Penn Line Orientation | Spatial processing | Visuospatial |
| Penn Word Memory | Memory encoding/retrieval | Episodic memory |

---

## BIDS Preparation

### Script: `scripts/validate_pnc.py`

Validates PNC BIDS structure and generates a compliance report.

```bash
python skills/pnc-skill/scripts/validate_pnc.py \
  --input /path/to/PNC/bids \
  --output /path/to/pnc_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Modality completeness check (T1w, rs-fMRI, task-fMRI, dMRI)
- Age range verification (8-21 years)
- Task paradigm presence check

---

## Core Workflow (Never Bypassed)

1. Identify user target: full PNC processing, imaging subset, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_pnc.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. Delegate to `fmri-skill` for rs-fMRI and task-fMRI processing.
7. Delegate to `dwi-skill` for dMRI processing.
8. If phenotype extraction is requested, run `scripts/extract_pnc_phenotype.py`.
9. If QC summary is requested, run `scripts/pnc_qc_summary.py`.
10. Save outputs into `pnc_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation | `smri_output/` derivatives |
| rs-fMRI | `fmri-skill` | preprocessing, denoising, connectivity | `fmri_output/` connectivity |
| task-fMRI | `fmri-skill` | task GLM, activation analysis | `fmri_output/` task results |
| dMRI | `dwi-skill` | diffusion preprocessing, tensor metrics | `dwi_output/` metrics |

---

## Standard Output Layout

```
pnc_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (rs + task)
├── dwi/                    # Diffusion MRI derivatives
├── phenotype/              # Merged phenotype tables (cognitive, psychiatric)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local PNC data validation.

- If the task starts from PNC data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local PNC discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- PNC is a developmental cohort; analyses should account for age effects (8-21 years).
- Pediatric data may require adjusted preprocessing parameters (e.g., higher motion thresholds).
- Penn CNB (Computerized Neurocognitive Battery) provides rich cognitive phenotyping.
- Psychiatric assessment includes DSM-based diagnoses.
- Large sample size enables well-powered developmental analyses.
- `pnc-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end PNC workflow.
- User asks to process PNC neuroimaging data.
- User needs BIDS validation for PNC data.
- User asks to extract PNC phenotype data (cognitive, psychiatric, demographic).
- User asks for developmental neuroimaging analysis.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `fmri-skill` → functional MRI preprocessing and analysis
- `dwi-skill` → diffusion MRI preprocessing
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- PNC: https://www.med.upenn.edu/bbl/
- Satterthwaite et al. (2014): Neuroimaging of the Philadelphia Neurodevelopmental Cohort. NeuroImage.
- OpenNeuro ds000030
- NIMH Data Archive: https://nda.nih.gov/

Created At: 2026-05-06 13:55 HKT
Last Updated At: 2026-05-06 13:55 HKT
Author: chengwang96
