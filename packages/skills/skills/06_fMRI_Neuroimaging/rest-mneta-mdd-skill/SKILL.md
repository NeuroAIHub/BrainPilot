---
name: rest-mneta-mdd-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the REST-meta-MDD (Resting-State Meta-Major Depressive Disorder) dataset, including BIDS validation, processing of rs-fMRI, phenotype extraction, and QC integration. Triggers include: 'REST-meta-MDD', 'MDD', 'Major Depressive Disorder', 'depression resting-state', 'process REST-meta-MDD', or any request to run the REST-meta-MDD pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - fmri-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - smri-skill
  - brain-visualization
---
# REST-meta-MDD Skill (Dataset-Orchestration Layer)

## Overview

`rest-mneta-mdd-skill` is the NeuroClaw orchestration skill for the **REST-meta-MDD (Resting-State Meta-Major Depressive Disorder)** dataset, a large-scale multi-site consortium project pooling resting-state fMRI data from 17 research sites across China.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input REST-meta-MDD data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`rest_mdd_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate REST-meta-MDD BIDS structure | `scripts/validate_rest_mdd.py` | Validation report |
| rs-fMRI processing | Preprocessing, denoising, connectivity | `fmri-skill` | `fmri_output/` connectivity |
| Phenotype extraction | Diagnosis, clinical measures, site info | `scripts/extract_rest_mdd_phenotype.py` | Merged phenotype CSV |
| Site harmonization | Multi-site effect correction | `scripts/harmonize_sites.py` | Harmonized data |
| QC summary | Per-subject quality control | `scripts/rest_mdd_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~3,600+ participants
  - **MDD patients**: ~1,837 Major Depressive Disorder patients
  - **Healthy controls**: ~1,779 age/sex-matched controls
- **Sites**: 17 research sites across China
- **Scanner**: Multi-site (various 3T scanners)
- **Modalities**: rs-fMRI (primary), T1w sMRI (some sites)
- **Clinical**: Diagnosis (SCID), HAMD, HAMA, medication status
- **Access**: Chinese Data Sharing Platform, REST-meta-MDD consortium
- **Format**: NIfTI (community BIDS conversion available)
- **Reference**: Yan et al. (2019), Science Bulletin

---

## Supported Modalities

| Modality | Description | Details |
|---|---|---|
| rs-fMRI | Resting-state functional MRI | Eyes closed, 5-10 min |
| T1w | Structural MRI (some sites) | 1mm isotropic |

---

## REST-meta-MDD Clinical Measures

| Measure | Description | Domain |
|---|---|---|
| Diagnosis | MDD vs. Healthy Control (SCID-based) | Clinical status |
| HAMD | Hamilton Depression Rating Scale | Depression severity |
| HAMA | Hamilton Anxiety Rating Scale | Anxiety severity |
| Medication | Medication status (medicated vs. drug-naive) | Treatment |
| Site | Data collection site (1-17) | Multi-site |
| Age | Age at scan | Demographics |
| Sex | Biological sex | Demographics |
| Education | Years of education | Demographics |

---

## BIDS Preparation

### Script: `scripts/validate_rest_mdd.py`

Validates REST-meta-MDD BIDS structure and generates a compliance report.

```bash
python skills/rest-mneta-mdd-skill/scripts/validate_rest_mdd.py \
  --input /path/to/REST-meta-MDD/bids \
  --output /path/to/rest_mdd_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Site identification and completeness check
- Diagnostic group labeling (MDD vs. control)
- Modality completeness (rs-fMRI required, T1w optional)

---

## Core Workflow (Never Bypassed)

1. Identify user target: full REST-meta-MDD processing, rs-fMRI only, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_rest_mdd.py`.
5. Delegate to `fmri-skill` for rs-fMRI processing.
6. If T1w data available, delegate to `smri-skill`.
7. If phenotype extraction is requested, run `scripts/extract_rest_mdd_phenotype.py`.
8. If site harmonization is requested, run `scripts/harmonize_sites.py`.
9. If QC summary is requested, run `scripts/rest_mdd_qc_summary.py`.
10. Save outputs into `rest_mdd_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| rs-fMRI | `fmri-skill` | preprocessing, denoising, connectivity | `fmri_output/` connectivity |
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation | `smri_output/` derivatives |

---

## Standard Output Layout

```
rest_mdd_output/
├── bids/                   # BIDS-staged data (or validation report)
├── fmri/                   # Functional MRI derivatives (rs-fMRI connectivity)
├── smri/                   # Structural MRI derivatives (if available)
├── phenotype/              # Merged phenotype tables (diagnosis, clinical, site)
├── harmonized/             # Site-harmonized data (ComBat or similar)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Multi-Site Harmonization

REST-meta-MDD is a multi-site dataset (17 sites). Site effects are a major confound:

- **ComBat**: Commonly used batch effect correction for neuroimaging data
- **Site-wise z-scoring**: Normalize metrics within site before pooling
- **Mixed-effects models**: Include site as random effect in statistical analyses
- The `scripts/harmonize_sites.py` script provides reference implementations

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local REST-meta-MDD data validation.

- If the task starts from REST-meta-MDD data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local REST-meta-MDD discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- Multi-site data (17 sites) requires careful site effect handling.
- Scanner heterogeneity across sites introduces variability.
- rs-fMRI is the primary modality; structural data is limited.
- MDD diagnosis is SCID-based across all sites.
- Large sample size (~3,600) provides good statistical power for case-control analyses.
- Medication status is an important confound; subgroup analyses (medicated vs. drug-naive) are recommended.
- `rest-mneta-mdd-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end REST-meta-MDD workflow.
- User asks to process REST-meta-MDD resting-state fMRI data.
- User needs BIDS validation for REST-meta-MDD data.
- User asks to extract REST-meta-MDD phenotype data (diagnosis, HAMD, site).
- User asks for depression neuroimaging analysis or multi-site harmonization.

---

## Complementary / Related Skills
- `fmri-skill` → functional MRI preprocessing and analysis
- `smri-skill` → structural MRI preprocessing (if available)
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- REST-meta-MDD: Chinese Data Sharing Platform
- Yan et al. (2019): Reduced default mode network functional connectivity in patients with recurrent major depressive disorder. Science Bulletin.
- REST-meta-MDD consortium

Created At: 2026-05-06 13:55 HKT
Last Updated At: 2026-05-06 13:55 HKT
Author: chengwang96
