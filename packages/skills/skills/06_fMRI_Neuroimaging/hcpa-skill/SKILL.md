---
name: hcpa-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the HCP Aging (HCP-A) dataset, including dataset download, BIDS organization, and multimodal processing of sMRI, fMRI, and dMRI. Triggers include: 'HCP Aging', 'HCP-A', 'process HCP Aging data', 'HCP Aging sMRI fMRI', or any request to run the HCP-A multimodal pipeline."
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
# HCP-A Skill (Dataset-Orchestration Layer)

## Overview

`hcpa-skill` is the NeuroClaw orchestration skill for the **HCP Aging (HCP-A)** dataset.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for data reorganization, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input HCP-A data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`hcpa_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| Data download | Download HCP-A from ConnectomeDB | `claw-shell` | Raw HCP-A files |
| BIDS staging | Reorganize HCP-A native layout to BIDS | `scripts/reorganize_hcpa.py` | BIDS-compliant dataset |
| sMRI processing | Brain extraction, tissue segmentation, cortical reconstruction | `smri-skill` | `smri_output/` derivatives |
| fMRI processing | Preprocessing, denoising, connectivity, task GLM | `fmri-skill` | `fmri_output/` derivatives |
| dMRI processing | Eddy correction, tensor metrics, tractography | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Cognitive, health, demographic data | `scripts/extract_hcpa_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/hcpa_qc_summary.py` | QC summary + exclusion list |

---

## Download Stage (Mandatory First Step)

### Source
HCP-A data is distributed through **ConnectomeDB**:
- Website: https://db.humanconnectome.org/
- Requires ConnectomeDB account and data use agreement
- Part of the HCP Lifespan initiative

### Dataset Characteristics
- **Cohort**: ~700+ adults ages 36-100 years
- **Modalities**: T1w, T2w, dMRI, rs-fMRI, task-fMRI
- **Focus**: Normal aging, cognitive decline, brain structure-function changes across the lifespan
- **Unique feature**: Complements HCP-YA to cover the full adult lifespan (22-100 years)

### Download Inputs to Confirm in Plan
- ConnectomeDB credentials/token
- Target modalities (all, structural, functional, diffusion)
- Subject list scope (full or custom subset)
- Destination directory with sufficient disk space

---

## HCP-A Task Paradigms

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

### Script: `scripts/reorganize_hcpa.py`

Converts HCP-A native directory structure to BIDS-compliant layout.

```bash
python skills/hcpa-skill/scripts/reorganize_hcpa.py \
  --input /path/to/HCPA/raw \
  --output /path/to/HCPA/bids \
  --participants /path/to/subject_list.txt
```

Features:
- Subject ID normalization: HCP format to BIDS `sub-` labels
- Session handling: multiple visits if applicable
- Modality routing: T1w, T2w, dMRI, rs-fMRI, task-fMRI
- Sidecar JSON generation from HCP metadata
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Core Workflow (Never Bypassed)

1. Identify user target: full HCP-A processing, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_hcpa.py`.
6. Delegate to `smri-skill` for structural MRI processing.
7. Delegate to `fmri-skill` for functional MRI processing.
8. Delegate to `dwi-skill` for diffusion MRI processing.
9. If phenotype extraction is requested, run `scripts/extract_hcpa_phenotype.py`.
10. If QC summary is requested, run `scripts/hcpa_qc_summary.py`.
11. Save outputs into `hcpa_output/`.

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
hcpa_output/
├── raw/                    # Downloaded original HCP-A files
├── bids/                   # BIDS-staged data
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives
├── dwi/                    # Diffusion MRI derivatives
├── phenotype/              # Merged phenotype tables
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Download + orchestration logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local HCP-A data staging.

- If the task starts from raw HCP-A data already present on disk and only asks for BIDS-style staging:
  - Skip the mandatory download stage
  - Default to the narrow path `local raw HCP-A discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- HCP-A complements HCP-YA to cover the full adult lifespan (22-100 years).
- HCP-A processing is resource intensive; plan storage and compute accordingly.
- Age range: 36-100 years; includes both cognitively normal and impaired participants.
- For HCP-native preprocessing, optionally delegate to `hcppipeline-tool`.
- `hcpa-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end HCP Aging workflow.
- User asks to download HCP-A and run sMRI/fMRI/DTI processing.
- User needs BIDS staging for HCP-A data.
- User asks to extract HCP-A phenotype data (cognitive, health, demographic).

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
- HCP Aging: https://www.humanconnectome.org/study/hcp-lifespan-aging
- ConnectomeDB: https://db.humanconnectome.org/
- Bookheimer et al. (2019): The Lifespan Human Connectome Project in Aging

Created At: 2026-05-06 13:02 HKT
Last Updated At: 2026-05-06 13:02 HKT
Author: chengwang96
