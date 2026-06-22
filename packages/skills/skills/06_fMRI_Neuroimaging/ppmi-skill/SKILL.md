---
name: ppmi-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Parkinson's Progression Markers Initiative (PPMI) dataset, including BIDS validation, multimodal processing of sMRI, rs-fMRI, and dMRI, phenotype extraction, and QC integration. Triggers include: 'PPMI', 'Parkinson', 'Parkinson disease', 'process PPMI data', 'PPMI fMRI', or any request to run the PPMI multimodal pipeline."
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
# PPMI Skill (Dataset-Orchestration Layer)

## Overview

`ppmi-skill` is the NeuroClaw orchestration skill for the **Parkinson's Progression Markers Initiative (PPMI)** dataset, launched by The Michael J. Fox Foundation.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input PPMI data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`ppmi_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate PPMI BIDS structure | `scripts/validate_ppmi.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation | `smri-skill` | `smri_output/` derivatives |
| rs-fMRI processing | Preprocessing, denoising, connectivity | `fmri-skill` | `fmri_output/` connectivity |
| dMRI processing | Diffusion preprocessing, tensor metrics | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Motor scores, cognitive, biomarkers | `scripts/extract_ppmi_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/ppmi_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~2,000+ participants
  - **PD patients**: Parkinson's disease (early stage, drug-naive)
  - **Prodromal**: REM sleep behavior disorder, hyposmia
  - **Healthy controls**: Age-matched
- **Scanner**: 3T Siemens (multi-site)
- **Modalities**: T1w sMRI, rs-fMRI, dMRI/DTI, DaTscan SPECT
- **Clinical**: MDS-UPDRS, MoCA, UPSIT, REM sleep, DAT imaging
- **Access**: LONI IDA (ida.loni.usc.edu), PPMI data portal
- **Format**: BIDS-compliant (community conversion)
- **Reference**: Marek et al. (2011), Lancet Neurology

---

## Supported Modalities

| Modality | Description | Details |
|---|---|---|
| T1w | High-resolution structural MRI | 1mm isotropic, substantia nigra volumetry |
| rs-fMRI | Resting-state functional MRI | Basal ganglia connectivity |
| dMRI | Diffusion-weighted imaging | DTI, nigrostriatal tract integrity |
| DaTscan | SPECT dopamine transporter | Striatal binding ratios |

---

## PPMI Clinical Measures

| Measure | Description | Domain |
|---|---|---|
| MDS-UPDRS | Movement Disorder Society Unified PD Rating Scale | Motor function |
| MoCA | Montreal Cognitive Assessment | Global cognition |
| UPSIT | University of Pennsylvania Smell Identification Test | Olfaction |
| RBD | REM Sleep Behavior Disorder screening | Sleep |
| H&Y | Hoehn and Yahr staging | Disease stage |
| DAT | Dopamine transporter binding (SPECT) | Dopaminergic function |

---

## BIDS Preparation

### Script: `scripts/validate_ppmi.py`

Validates PPMI BIDS structure and generates a compliance report.

```bash
python skills/ppmi-skill/scripts/validate_ppmi.py \
  --input /path/to/PPMI/bids \
  --output /path/to/ppmi_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Diagnostic group completeness (PD, prodromal, control)
- Modality completeness (T1w, rs-fMRI, dMRI)
- Clinical measure availability check

---

## Core Workflow (Never Bypassed)

1. Identify user target: full PPMI processing, imaging subset, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_ppmi.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. Delegate to `fmri-skill` for rs-fMRI processing.
7. Delegate to `dwi-skill` for dMRI processing.
8. If phenotype extraction is requested, run `scripts/extract_ppmi_phenotype.py`.
9. If QC summary is requested, run `scripts/ppmi_qc_summary.py`.
10. Save outputs into `ppmi_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation | `smri_output/` derivatives |
| rs-fMRI | `fmri-skill` | preprocessing, denoising, connectivity | `fmri_output/` connectivity |
| dMRI | `dwi-skill` | diffusion preprocessing, tensor metrics | `dwi_output/` metrics |

---

## Standard Output Layout

```
ppmi_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (rs-fMRI connectivity)
├── dwi/                    # Diffusion MRI derivatives (DTI metrics)
├── phenotype/              # Merged phenotype tables (motor, cognitive, biomarkers)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local PPMI data validation.

- If the task starts from PPMI data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local PPMI discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- PPMI is a multi-site study; site effects should be modeled in group analyses.
- Early-stage PD patients are often drug-naive, which is valuable for studying untreated disease.
- DaTscan SPECT provides dopaminergic imaging but may not follow standard BIDS conventions.
- Longitudinal design enables progression modeling.
- Large sample size and rich clinical phenotyping make PPMI ideal for biomarker discovery.
- `ppmi-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end PPMI workflow.
- User asks to process PPMI neuroimaging data.
- User needs BIDS validation for PPMI data.
- User asks to extract PPMI phenotype data (MDS-UPDRS, MoCA, DAT).
- User asks for Parkinson's disease neuroimaging analysis.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `fmri-skill` → functional MRI preprocessing and analysis
- `dwi-skill` → diffusion MRI preprocessing
- `pet-skill` → PET imaging (if available)
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- PPMI: https://www.ppmi-info.org/
- Marek et al. (2011): The Parkinson Progression Marker Initiative (PPMI). Lancet Neurology.
- LONI IDA: https://ida.loni.usc.edu/

Created At: 2026-05-06 13:55 HKT
Last Updated At: 2026-05-06 13:55 HKT
Author: chengwang96
