---
name: hcpd-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the HCP Development (HCP-D) dataset, including dataset download, BIDS organization, and multimodal processing of sMRI, fMRI, and dMRI. Triggers include: 'HCP Development', 'HCP-D', 'process HCP Development data', 'HCP Development sMRI fMRI', or any request to run the HCP-D multimodal pipeline."
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
# HCP-D Skill (Dataset-Orchestration Layer)

## Overview

`hcpd-skill` is the NeuroClaw orchestration skill for the **HCP Development (HCP-D)** dataset.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for data reorganization, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input HCP-D data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`hcpd_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| Data download | Download HCP-D from ConnectomeDB | `claw-shell` | Raw HCP-D files |
| BIDS staging | Reorganize HCP-D native layout to BIDS | `scripts/reorganize_hcpd.py` | BIDS-compliant dataset |
| sMRI processing | Brain extraction, tissue segmentation, cortical reconstruction | `smri-skill` | `smri_output/` derivatives |
| fMRI processing | Preprocessing, denoising, connectivity, task GLM | `fmri-skill` | `fmri_output/` derivatives |
| dMRI processing | Eddy correction, tensor metrics, tractography | `dwi-skill` | `dwi_output/` metrics |
| Phenotype extraction | Cognitive, behavioral, developmental data | `scripts/extract_hcpd_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/hcpd_qc_summary.py` | QC summary + exclusion list |

---

## Download Stage (Mandatory First Step)

### Source
HCP-D data is distributed through **ConnectomeDB**:
- Website: https://db.humanconnectome.org/
- Requires ConnectomeDB account and data use agreement
- Part of the HCP Lifespan initiative

### Dataset Characteristics
- **Cohort**: ~600+ children and adolescents ages 5-21 years
- **Modalities**: T1w, T2w, dMRI, rs-fMRI, task-fMRI
- **Focus**: Brain development, maturation of neural circuits, cognitive and emotional development
- **Unique feature**: Covers the developmental period from childhood to early adulthood

### Download Inputs to Confirm in Plan
- ConnectomeDB credentials/token
- Target modalities (all, structural, functional, diffusion)
- Subject list scope (full or custom subset)
- Destination directory with sufficient disk space

---

## HCP-D Task Paradigms

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

### Script: `scripts/reorganize_hcpd.py`

Converts HCP-D native directory structure to BIDS-compliant layout.

```bash
python skills/hcpd-skill/scripts/reorganize_hcpd.py \
  --input /path/to/HCPD/raw \
  --output /path/to/HCPD/bids \
  --participants /path/to/subject_list.txt
```

Features:
- Subject ID normalization: HCP format to BIDS `sub-` labels
- Age-band session handling if applicable
- Modality routing: T1w, T2w, dMRI, rs-fMRI, task-fMRI
- Sidecar JSON generation from HCP metadata
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Core Workflow (Never Bypassed)

1. Identify user target: full HCP-D processing, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_hcpd.py`.
6. Delegate to `smri-skill` for structural MRI processing.
7. Delegate to `fmri-skill` for functional MRI processing.
8. Delegate to `dwi-skill` for diffusion MRI processing.
9. If phenotype extraction is requested, run `scripts/extract_hcpd_phenotype.py`.
10. If QC summary is requested, run `scripts/hcpd_qc_summary.py`.
11. Save outputs into `hcpd_output/`.

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
hcpd_output/
├── raw/                    # Downloaded original HCP-D files
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

For benchmark-style prompts, do not force the full orchestration when the task only asks for local HCP-D data staging.

- If the task starts from raw HCP-D data already present on disk and only asks for BIDS-style staging:
  - Skip the mandatory download stage
  - Default to the narrow path `local raw HCP-D discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- HCP-D covers ages 5-21 years; pediatric processing may require age-specific templates and atlases.
- Head motion is typically higher in pediatric populations; QC thresholds may need adjustment.
- HCP-D complements HCP-YA (22-35) and HCP-A (36-100) to cover the full lifespan.
- For HCP-native preprocessing, optionally delegate to `hcppipeline-tool`.
- `hcpd-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end HCP Development workflow.
- User asks to download HCP-D and run sMRI/fMRI/DTI processing.
- User needs BIDS staging for HCP-D data.
- User asks to extract HCP-D phenotype data (cognitive, behavioral, developmental).

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
- HCP Development: https://www.humanconnectome.org/study/hcp-lifespan-development
- ConnectomeDB: https://db.humanconnectome.org/
- Somerville et al. (2018): The Lifespan Human Connectome Project in Development

Created At: 2026-05-06 13:02 HKT
Last Updated At: 2026-05-06 13:02 HKT
Author: chengwang96
