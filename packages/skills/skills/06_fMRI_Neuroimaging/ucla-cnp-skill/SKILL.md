---
name: ucla-cnp-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the UCLA CNP (Consortium for Neuropsychiatric Phenomics) dataset, including BIDS validation, multimodal processing of sMRI, task-fMRI, and dMRI, phenotype extraction, and QC integration. Triggers include: 'UCLA CNP', 'Consortium Neuropsychiatric Phenomics', 'process UCLA CNP', or any request to run the UCLA CNP multimodal pipeline."
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
# UCLA CNP Skill (Dataset-Orchestration Layer)

## Overview

`ucla-cnp-skill` is the NeuroClaw orchestration skill for the **UCLA CNP (Consortium for Neuropsychiatric Phenomics)** dataset, led by Russell Poldrack and colleagues at UCLA.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input UCLA CNP data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`ucla_cnp_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate UCLA CNP BIDS structure | `scripts/validate_ucla_cnp.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation | `smri-skill` | `smri_output/` derivatives |
| task-fMRI processing | Task GLM, activation analysis | `fmri-skill` | `fmri_output/` task results |
| dMRI processing | Diffusion preprocessing, tractography | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Diagnosis, cognitive, behavioral | `scripts/extract_ucla_cnp_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/ucla_cnp_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~270 participants
  - **Healthy controls**: Age-matched
  - **ADHD**: Attention deficit hyperactivity disorder
  - **Bipolar disorder**: Bipolar I/II
  - **Schizophrenia**: Schizophrenia spectrum
- **Scanner**: 3T Siemens TIM Trio (UCLA)
- **Modalities**: T1w sMRI, task-fMRI, dMRI/DTI
- **Tasks**: Multiple cognitive tasks (stop-signal, spatial working memory, etc.)
- **Clinical**: Extensive cognitive battery, diagnostic assessments
- **Access**: OpenNeuro ds000030
- **Format**: BIDS-compliant
- **Reference**: Poldrack et al. (2016), Scientific Data

---

## Supported Modalities

| Modality | Description | Tasks/Conditions |
|---|---|---|
| T1w | High-resolution structural MRI | 1mm isotropic |
| task-fMRI | Task-based functional MRI | Stop-signal, spatial WM, face memory, etc. |
| dMRI | Diffusion-weighted imaging | DTI, white matter tractography |

---

## UCLA CNP Task Paradigms

| Task | Description | Cognitive Domain |
|---|---|---|
| Stop-signal | Response inhibition | Executive function |
| Spatial working memory | Spatial WM maintenance | Working memory |
| Face memory | Face encoding/retrieval | Episodic memory |
| Balloon analog risk | Risk taking behavior | Decision making |
| Monetary incentive | Reward processing | Motivation |

---

## UCLA CNP Diagnostic Groups

| Group | Description | Typical N |
|---|---|---|
| Control | Healthy age-matched | ~130 |
| ADHD | Attention deficit | ~50 |
| Bipolar | Bipolar disorder | ~45 |
| Schizophrenia | Schizophrenia spectrum | ~45 |

---

## BIDS Preparation

### Script: `scripts/validate_ucla_cnp.py`

Validates UCLA CNP BIDS structure and generates a compliance report.

```bash
python skills/ucla-cnp-skill/scripts/validate_ucla_cnp.py \
  --input /path/to/UCLA-CNP/bids \
  --output /path/to/ucla_cnp_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Diagnostic group completeness check
- Modality completeness (T1w, task-fMRI, dMRI)
- Task paradigm presence verification

---

## Core Workflow (Never Bypassed)

1. Identify user target: full UCLA CNP processing, imaging subset, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_ucla_cnp.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. Delegate to `fmri-skill` for task-fMRI processing.
7. Delegate to `dwi-skill` for dMRI processing.
8. If phenotype extraction is requested, run `scripts/extract_ucla_cnp_phenotype.py`.
9. If QC summary is requested, run `scripts/ucla_cnp_qc_summary.py`.
10. Save outputs into `ucla_cnp_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation | `smri_output/` derivatives |
| task-fMRI | `fmri-skill` | task GLM, activation analysis | `fmri_output/` task results |
| dMRI | `dwi-skill` | diffusion preprocessing, tensor metrics | `dwi_output/` metrics |

---

## Standard Output Layout

```
ucla_cnp_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (task-fMRI)
├── dwi/                    # Diffusion MRI derivatives
├── phenotype/              # Merged phenotype tables (diagnosis, cognitive)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local UCLA CNP data validation.

- If the task starts from UCLA CNP data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local UCLA CNP discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- UCLA CNP has 4 diagnostic groups; group comparisons should account for sample size differences.
- Multiple cognitive tasks enable rich cognitive phenotyping.
- OpenNeuro ds000030 is a widely used benchmark dataset for BIDS tools.
- Extensive cognitive battery enables linking brain structure/function to behavior.
- `ucla-cnp-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end UCLA CNP workflow.
- User asks to process UCLA CNP neuroimaging data.
- User needs BIDS validation for UCLA CNP data.
- User asks to extract UCLA CNP phenotype data (diagnosis, cognitive).
- User asks for multi-disorder neuroimaging analysis.

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
- UCLA CNP: https://www.humanconnectome.org/
- Poldrack et al. (2016): A phenomic analysis of the UCLA Consortium for Neuropsychiatric Phenomics LA5c Study. Scientific Data.
- OpenNeuro ds000030

Created At: 2026-05-06 14:21 HKT
Last Updated At: 2026-05-06 14:21 HKT
Author: chengwang96
