---
name: oasis-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the OASIS (Open Access Series of Imaging Studies) dataset, including BIDS validation, multimodal processing of sMRI, and phenotype extraction for aging and Alzheimer's disease research. Triggers include: 'OASIS', 'OASIS-1', 'OASIS-2', 'OASIS-3', 'process OASIS data', 'Alzheimer', or any request to run the OASIS pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - fmri-skill
  - asl-skill
  - pet-skill
  - brain-visualization
---
# OASIS Skill (Dataset-Orchestration Layer)

## Overview

`oasis-skill` is the NeuroClaw orchestration skill for the **OASIS (Open Access Series of Imaging Studies)** dataset, founded by the Knight Alzheimer Disease Research Center at Washington University.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input OASIS data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`oasis_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate OASIS BIDS structure | `scripts/validate_oasis.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation, cortical thickness | `smri-skill` | `smri_output/` derivatives |
| Phenotype extraction | CDR, MMSE, demographic data | `scripts/extract_oasis_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/oasis_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **OASIS-1 (Cross-sectional)**: ~416 subjects aged 18-96
  - T1w MRI, some with very mild to mild AD
- **OASIS-2 (Longitudinal)**: ~150 subjects aged 60-96
  - Multiple sessions, non-demented and demented
- **OASIS-3**: ~1,000+ subjects, longitudinal spanning ~20 years
  - T1w, PET (amyloid, tau), ASL
- **Scanner**: 1.5T Siemens Vision
- **Clinical**: CDR (Clinical Dementia Rating), MMSE, demographics
- **Access**: OpenNeuro ds000014 (OASIS-1), www.oasis-brains.org (OASIS-3)
- **Format**: BIDS-compliant (OASIS-1), raw + derivatives (OASIS-3)

---

## Supported Modalities

| Modality | Description | Versions |
|---|---|---|
| T1w | High-resolution structural MRI | OASIS-1, 2, 3 |
| PET | Amyloid (PIB/AV45), Tau (AV1451) | OASIS-3 |
| ASL | Arterial spin labeling perfusion | OASIS-3 |
| fMRI | Functional MRI | OASIS-3 (limited) |

---

## OASIS Clinical Measures

| Measure | Description | Range |
|---|---|---|
| CDR | Clinical Dementia Rating | 0 (normal), 0.5 (very mild), 1 (mild), 2 (moderate), 3 (severe) |
| MMSE | Mini-Mental State Examination | 0-30 (higher = better) |
| Age | Age at scan | 18-96 years |
| Sex | Biological sex | M/F |
| SES | Socioeconomic status | 1-5 |

---

## BIDS Preparation

### Script: `scripts/validate_oasis.py`

Validates OASIS BIDS structure and generates a compliance report.

```bash
python skills/oasis-skill/scripts/validate_oasis.py \
  --input /path/to/OASIS/bids \
  --output /path/to/oasis_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Version detection (OASIS-1 vs OASIS-2 vs OASIS-3)
- Modality completeness check
- CDR/MMSE availability verification

---

## Core Workflow (Never Bypassed)

1. Identify user target: full OASIS processing, sMRI only, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_oasis.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. If PET data available (OASIS-3), delegate to `pet-skill`.
7. If ASL data available (OASIS-3), delegate to `asl-skill`.
8. If phenotype extraction is requested, run `scripts/extract_oasis_phenotype.py`.
9. If QC summary is requested, run `scripts/oasis_qc_summary.py`.
10. Save outputs into `oasis_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical thickness | `smri_output/` derivatives |
| PET | `pet-skill` | SUVR computation, reference region selection | `pet_output/` SUVR maps |
| ASL | `asl-skill` | CBF quantification | `asl_output/` CBF maps |

---

## Standard Output Layout

```
oasis_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── pet/                    # PET derivatives (SUVR maps)
├── asl/                    # ASL derivatives (CBF maps)
├── phenotype/              # Merged phenotype tables (CDR, MMSE, demographics)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local OASIS data validation.

- If the task starts from OASIS data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local OASIS discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- OASIS-1 is the most commonly used version; OASIS-3 adds PET and longitudinal data.
- Age range is very wide (18-96); analyses should account for age effects.
- CDR is the primary dementia staging tool; MMSE provides additional cognitive screening.
- OASIS-1 uses 1.5T scanner; resolution is lower than modern 3T/7T datasets.
- `oasis-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end OASIS workflow.
- User asks to process OASIS structural MRI data.
- User needs BIDS validation for OASIS data.
- User asks to extract OASIS phenotype data (CDR, MMSE, demographics).
- User asks for Alzheimer's disease neuroimaging analysis.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `pet-skill` → PET imaging (amyloid, tau)
- `asl-skill` → arterial spin labeling perfusion
- `fmri-skill` → functional MRI (if available)
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- OASIS: https://www.oasis-brains.org/
- Marcus et al. (2007): Open Access Series of Imaging Studies (OASIS). Journal of Cognitive Neuroscience.
- OpenNeuro ds000014

Created At: 2026-05-06 13:55 HKT
Last Updated At: 2026-05-06 13:55 HKT
Author: chengwang96
