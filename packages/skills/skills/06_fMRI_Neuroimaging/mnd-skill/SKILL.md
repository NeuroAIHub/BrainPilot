---
name: mnd-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Motor Neuron Disease (MND) dataset from OpenNeuro ds005874, including BIDS validation, multimodal processing of rs-fMRI and task-fMRI, phenotype extraction, and QC integration. Triggers include: 'MND', 'Motor Neuron Disease', 'ALS', 'Amyotrophic Lateral Sclerosis', 'process MND data', 'MND fMRI', or any request to run the MND multimodal pipeline."
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
---
# MND Skill (Dataset-Orchestration Layer)

## Overview

`mnd-skill` is the NeuroClaw orchestration skill for the **Motor Neuron Disease (MND)** dataset from OpenNeuro ds005874.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input MND data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`mnd_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate MND BIDS structure | `scripts/validate_mnd.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation | `smri-skill` | `smri_output/` derivatives |
| rs-fMRI processing | Preprocessing, denoising, connectivity | `fmri-skill` | `fmri_output/` derivatives |
| task-fMRI processing | Motor task GLM, activation analysis | `fmri-skill` | `fmri_output/` task results |
| Phenotype extraction | Diagnosis, clinical measures | `scripts/extract_mnd_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/mnd_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: 59 participants
  - **Patient group**: Motor Neuron Disease (e.g., ALS) patients
  - **Control group**: Healthy age-matched controls
- **Modalities**: rs-fMRI, task-fMRI (motor tasks)
- **Format**: BIDS-compliant
- **Access**: OpenNeuro ds005874
- **License**: CC0

---

## Supported Modalities

| Modality | Description | Tasks/Conditions |
|---|---|---|
| rs-fMRI | Resting-state functional MRI | Eyes open/closed |
| task-fMRI | Task-based functional MRI | Motor tasks (finger tapping, hand grip) |

---

## MND Task Paradigms

| Task | Description | Duration |
|---|---|---|
| REST | Resting-state (eyes open/closed) | ~8 min |
| MOTOR | Motor tasks (finger tapping, hand grip) | ~5 min |

---

## BIDS Preparation

### Script: `scripts/validate_mnd.py`

Validates MND BIDS structure and generates a compliance report.

```bash
python skills/mnd-skill/scripts/validate_mnd.py \
  --input /path/to/MND/bids \
  --output /path/to/mnd_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Modality completeness check (rs-fMRI, task-fMRI)
- Participant group labeling (patient vs. control)
- Missing data identification

---

## Core Workflow (Never Bypassed)

1. Identify user target: full MND processing, imaging subset, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_mnd.py`.
5. Delegate to `smri-skill` for structural MRI processing (if available).
6. Delegate to `fmri-skill` for functional MRI processing (resting-state and motor task).
7. If phenotype extraction is requested, run `scripts/extract_mnd_phenotype.py`.
8. If QC summary is requested, run `scripts/mnd_qc_summary.py`.
9. Save outputs into `mnd_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation | `smri_output/` derivatives |
| rs-fMRI | `fmri-skill` | preprocessing, denoising, connectivity | `fmri_output/` connectivity |
| task-fMRI | `fmri-skill` | motor task GLM, activation analysis | `fmri_output/` task results |

---

## Standard Output Layout

```
mnd_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (rest + motor)
├── phenotype/              # Merged phenotype tables (diagnosis, clinical)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local MND data validation.

- If the task starts from MND data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local MND discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- MND is a clinical cohort; patient data requires careful handling.
- Case-control matching should be verified before group comparisons.
- Motor tasks are designed to probe motor network function; standard motor task GLM applies.
- The dataset is relatively small (59 participants); statistical power may be limited.
- `mnd-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end MND workflow.
- User asks to process MND fMRI data.
- User needs BIDS validation for MND data.
- User asks to extract MND phenotype data (diagnosis, clinical measures).
- User asks for motor network analysis in MND patients.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `fmri-skill` → functional MRI preprocessing and analysis
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- OpenNeuro ds005874: https://openneuro.org/datasets/ds005874

Created At: 2026-05-06 13:31 HKT
Last Updated At: 2026-05-06 13:31 HKT
Author: chengwang96
