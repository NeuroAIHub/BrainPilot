---
name: hcpep-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the HCP Early Psychosis (HCP-EP) dataset, including dataset download, BIDS organization, and multimodal processing of sMRI, fMRI, and dMRI. Triggers include: 'HCP Early Psychosis', 'HCP-EP', 'process HCP Early Psychosis data', 'HCP EP sMRI fMRI', or any request to run the HCP-EP multimodal pipeline."
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
  - hcppipeline-tool
---
# HCP-EP Skill (Dataset-Orchestration Layer)

## Overview

`hcpep-skill` is the NeuroClaw orchestration skill for the **HCP Early Psychosis (HCP-EP)** dataset.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for data reorganization, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input HCP-EP data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`hcpep_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| Data download | Download HCP-EP from ConnectomeDB | `claw-shell` | Raw HCP-EP files |
| BIDS staging | Reorganize HCP-EP native layout to BIDS | `scripts/reorganize_hcpep.py` | BIDS-compliant dataset |
| sMRI processing | Brain extraction, tissue segmentation, cortical reconstruction | `smri-skill` | `smri_output/` derivatives |
| fMRI processing | Preprocessing, denoising, connectivity, task GLM | `fmri-skill` | `fmri_output/` derivatives |
| dMRI processing | Eddy correction, tensor metrics, tractography | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Clinical, diagnostic, cognitive data | `scripts/extract_hcpep_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/hcpep_qc_summary.py` | QC summary + exclusion list |

---

## Download Stage (Mandatory First Step)

### Source
HCP-EP data is distributed through **ConnectomeDB**:
- Website: https://db.humanconnectome.org/
- Requires ConnectomeDB account and data use agreement
- Part of the HCP Clinical initiative

### Dataset Characteristics
- **Cohort**: ~250 participants (early psychosis and healthy controls)
- **Modalities**: T1w, T2w, dMRI, rs-fMRI, task-fMRI
- **Focus**: Early psychosis (schizophrenia spectrum, bipolar disorder), neural circuit disruptions
- **Unique feature**: Clinical cohort with matched healthy controls for case-control comparisons

### Diagnostic Groups
- Early psychosis patients (schizophrenia spectrum, bipolar with psychotic features)
- Healthy controls (age-, sex-, and education-matched)
- All patients are within 5 years of psychosis onset

### Download Inputs to Confirm in Plan
- ConnectomeDB credentials/token
- Target modalities (all, structural, functional, diffusion)
- Subject list scope (full or custom subset)
- Destination directory with sufficient disk space

---

## HCP-EP Task Paradigms

| Task | Description | Duration |
|---|---|---|
| MOTOR | Finger tapping, toe movement, tongue movement | ~3 min |
| EMOTION | Faces and shapes matching | ~2 min |
| GAMBLING | Card guessing with reward/loss | ~3 min |
| LANGUAGE | Story comprehension and math | ~4 min |
| RELATIONAL | Relational reasoning matching | ~3 min |
| SOCIAL | Social cognition (mentalizing) movie clips | ~3 min |
| WM | Working memory (faces, places, tools, body parts) | ~5 min |
| REST | Resting-state (eyes open) | ~15 min × 4 runs |

---

## BIDS Preparation

### Script: `scripts/reorganize_hcpep.py`

Converts HCP-EP native directory structure to BIDS-compliant layout.

```bash
python skills/hcpep-skill/scripts/reorganize_hcpep.py \
  --input /path/to/HCPEP/raw \
  --output /path/to/HCPEP/bids \
  --participants /path/to/subject_list.txt
```

Features:
- Subject ID normalization: HCP format to BIDS `sub-` labels
- Diagnostic group labeling (patient vs. control)
- Modality routing: T1w, T2w, dMRI, rs-fMRI, task-fMRI
- Sidecar JSON generation from HCP metadata
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Core Workflow (Never Bypassed)

1. Identify user target: full HCP-EP processing, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_hcpep.py`.
6. Delegate to `smri-skill` for structural MRI processing.
7. Delegate to `fmri-skill` for functional MRI processing.
8. Delegate to `dwi-skill` for diffusion MRI processing.
9. If phenotype extraction is requested, run `scripts/extract_hcpep_phenotype.py`.
10. If QC summary is requested, run `scripts/hcpep_qc_summary.py`.
11. Save outputs into `hcpep_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w/T2w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction, ROI morphometry | `smri_output/` derivatives |
| fMRI (rs-fMRI/task-fMRI) | `fmri-skill` | preprocessing, denoising, ROI time series, connectivity, task GLM | `fmri_output/` derivatives |
| dMRI (DWI) | `dwi-skill` | eddy correction, tensor metrics, tractography, connectome | `dwi_output/` metrics |

---

## Standard Output Layout

```
hcpep_output/
├── raw/                    # Downloaded original HCP-EP files
├── bids/                   # BIDS-staged data
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives
├── dwi/                    # Diffusion MRI derivatives
├── phenotype/              # Merged phenotype tables (diagnosis, clinical, cognitive)
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Download + orchestration logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local HCP-EP data staging.

- If the task starts from raw HCP-EP data already present on disk and only asks for BIDS-style staging:
  - Skip the mandatory download stage
  - Default to the narrow path `local raw HCP-EP discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- HCP-EP is a clinical cohort; patient data requires careful handling and de-identification.
- Early psychosis patients may have higher motion artifacts; QC thresholds may need adjustment.
- Case-control matching should be verified before group comparisons.
- For HCP-native preprocessing, optionally delegate to `hcppipeline-tool`.
- `hcpep-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end HCP Early Psychosis workflow.
- User asks to download HCP-EP and run sMRI/fMRI/DTI processing.
- User needs BIDS staging for HCP-EP data.
- User asks to extract HCP-EP phenotype data (diagnosis, clinical, cognitive).

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `fmri-skill` → functional MRI preprocessing and analysis
- `dwi-skill` → diffusion MRI preprocessing and analysis
- `hcppipeline-tool` → HCP-native minimal preprocessing pipelines
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- HCP Early Psychosis: https://www.humanconnectome.org/study/hcp-early-psychosis
- ConnectomeDB: https://db.humanconnectome.org/
- Heckers et al. (2024): The HCP Early Psychosis project

Created At: 2026-05-06 13:02 HKT
Last Updated At: 2026-05-06 13:02 HKT
Author: chengwang96
