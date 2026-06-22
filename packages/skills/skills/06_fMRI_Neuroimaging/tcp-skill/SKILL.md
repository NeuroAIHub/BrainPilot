---
name: tcp-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Transdiagnostic Connectome Project (TCP) dataset, including BIDS validation, multimodal processing of sMRI, rs-fMRI, and dMRI, phenotype extraction, and QC integration. Triggers include: 'TCP', 'Transdiagnostic Connectome', 'process TCP data', 'TCP fMRI', or any request to run the TCP multimodal pipeline."
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
# TCP Skill (Dataset-Orchestration Layer)

## Overview

`tcp-skill` is the NeuroClaw orchestration skill for the **Transdiagnostic Connectome Project (TCP)** dataset, collected at Washington University in St. Louis.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input TCP data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`tcp_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate TCP BIDS structure | `scripts/validate_tcp.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation | `smri-skill` | `smri_output/` derivatives |
| rs-fMRI processing | Preprocessing, denoising, connectivity | `fmri-skill` | `fmri_output/` connectivity |
| dMRI processing | Diffusion preprocessing, tractography | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Psychiatric diagnosis, dimensional measures | `scripts/extract_tcp_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/tcp_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~600+ participants
  - Transdiagnostic approach: participants span multiple diagnostic categories
  - **Healthy controls**: Age-matched
  - **Psychiatric groups**: Depression, anxiety, psychosis spectrum, etc.
- **Scanner**: 3T Siemens (WashU)
- **Modalities**: T1w sMRI, rs-fMRI, dMRI/DTI
- **Clinical**: RDoC-informed dimensional measures, diagnostic assessments
- **Access**: NIMH Data Archive (NDA), OpenNeuro
- **Format**: BIDS-compliant
- **Reference**: Barch, Gordon et al., WashU

---

## Supported Modalities

| Modality | Description | Details |
|---|---|---|
| T1w | High-resolution structural MRI | 1mm isotropic, cortical thickness |
| rs-fMRI | Resting-state functional MRI | Eyes open, functional connectivity |
| dMRI | Diffusion-weighted imaging | DTI, white matter tractography |

---

## TCP Clinical Dimensions

| Domain | Measures | RDoC Construct |
|---|---|---|
| Negative valence | Anhedonia, anxiety | Negative valence systems |
| Positive valence | Reward processing | Positive valence systems |
| Cognitive | Working memory, executive function | Cognitive systems |
| Social | Social cognition | Social processes |
| Arousal | Arousal/regulatory systems | Arousal/regulatory systems |

---

## BIDS Preparation

### Script: `scripts/validate_tcp.py`

Validates TCP BIDS structure and generates a compliance report.

```bash
python skills/tcp-skill/scripts/validate_tcp.py \
  --input /path/to/TCP/bids \
  --output /path/to/tcp_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Modality completeness check (T1w, rs-fMRI, dMRI)
- Diagnostic group labeling
- Missing data identification

---

## Core Workflow (Never Bypassed)

1. Identify user target: full TCP processing, imaging subset, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_tcp.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. Delegate to `fmri-skill` for rs-fMRI processing.
7. Delegate to `dwi-skill` for dMRI processing.
8. If phenotype extraction is requested, run `scripts/extract_tcp_phenotype.py`.
9. If QC summary is requested, run `scripts/tcp_qc_summary.py`.
10. Save outputs into `tcp_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical thickness | `smri_output/` derivatives |
| rs-fMRI | `fmri-skill` | preprocessing, denoising, connectivity | `fmri_output/` connectivity |
| dMRI | `dwi-skill` | diffusion preprocessing, tensor metrics | `dwi_output/` metrics |

---

## Standard Output Layout

```
tcp_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (rs-fMRI connectivity)
├── dwi/                    # Diffusion MRI derivatives
├── phenotype/              # Merged phenotype tables (diagnosis, dimensional)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local TCP data validation.

- If the task starts from TCP data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local TCP discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- TCP uses a transdiagnostic approach; analyses should consider dimensional rather than categorical models.
- RDoC-informed phenotyping enables cross-diagnostic connectivity analyses.
- Connectome-based predictive modeling (CPM) is a commonly used analysis approach.
- Multi-diagnostic design requires careful handling of group comparisons.
- `tcp-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end TCP workflow.
- User asks to process TCP neuroimaging data.
- User needs BIDS validation for TCP data.
- User asks to extract TCP phenotype data (diagnostic, dimensional).
- User asks for transdiagnostic connectivity analysis.

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
- TCP: Washington University in St. Louis
- Barch, Gordon et al.: Transdiagnostic Connectome Project
- NIMH Data Archive: https://nda.nih.gov/

Created At: 2026-05-06 14:21 HKT
Last Updated At: 2026-05-06 14:21 HKT
Author: chengwang96
