---
name: ixi-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the IXI (Information eXtraction from Images) dataset, including data download, BIDS organization, and multimodal processing of T1w, T2w, and MRA. Triggers include: 'IXI', 'IXI dataset', 'process IXI data', 'IXI MRI', or any request to run the IXI multimodal pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - nibabel-skill
---
# IXI Skill (Dataset-Orchestration Layer)

## Overview

`ixi-skill` is the NeuroClaw orchestration skill for the **IXI (Information eXtraction from Images)** dataset.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for data reorganization, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input IXI data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`ixi_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| Data download | Download IXI from brain-development.org | `claw-shell` | Raw IXI files |
| BIDS staging | Reorganize IXI native layout to BIDS | `scripts/reorganize_ixi.py` | BIDS-compliant dataset |
| sMRI processing | Brain extraction, tissue segmentation, cortical reconstruction | `smri-skill` | `smri_output/` derivatives |
| MRA processing | Vessel enhancement, angiography analysis | `nibabel-skill` | MRA derivatives |
| QC summary | Per-subject quality control | `scripts/ixi_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~600 healthy subjects
- **Sites**: 3 London hospitals with different scanners
  - **Hammersmith Hospital (HH)**: Philips 3T
  - **Guy's Hospital (Guy)**: Philips 1.5T
  - **Institute of Psychiatry (IOP)**: GE 1.5T
- **Modalities**: T1w, T2w, MRA (some subjects also have PD and DTI)
- **Format**: NIfTI (.nii.gz)
- **Access**: https://brain-development.org/ixi-dataset/

---

## Supported Modalities

| Modality | Description | Sites |
|---|---|---|
| T1w | High-resolution structural MRI | All 3 sites |
| T2w | T2-weighted structural MRI | All 3 sites |
| MRA | Magnetic Resonance Angiography | All 3 sites |
| PD | Proton Density (some subjects) | Selected sites |
| DTI | Diffusion Tensor Imaging (some subjects) | Selected sites |

---

## Site-Specific Scanner Information

| Site | Scanner | Field Strength | Notes |
|---|---|---|---|
| Hammersmith Hospital (HH) | Philips | 3T | Higher resolution, smaller voxel size |
| Guy's Hospital (Guy) | Philips | 1.5T | Standard resolution |
| Institute of Psychiatry (IOP) | GE | 1.5T | Standard resolution |

---

## BIDS Preparation

### Script: `scripts/reorganize_ixi.py`

Converts IXI native directory structure to BIDS-compliant layout.

```bash
python skills/ixi-skill/scripts/reorganize_ixi.py \
  --input /path/to/IXI/raw \
  --output /path/to/IXI/bids
```

Features:
- Subject ID normalization: IXI format (e.g., `IXI002`) to BIDS `sub-IXI002`
- Site detection from subject ID prefix
- Modality routing: T1w, T2w, MRA, PD, DTI
- Sidecar JSON generation with site-specific metadata
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Core Workflow (Never Bypassed)

1. Identify user target: full IXI processing, imaging subset, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_ixi.py`.
6. Delegate to `smri-skill` for structural MRI processing (T1w, T2w).
7. Process MRA if requested (vessel enhancement, angiography).
8. If QC summary is requested, run `scripts/ixi_qc_summary.py`.
9. Save outputs into `ixi_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w/T2w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction | `smri_output/` derivatives |
| MRA | `nibabel-skill` | vessel enhancement, angiography analysis | MRA derivatives |
| PD | `smri-skill` | proton density analysis | PD derivatives |
| DTI | `smri-skill` | diffusion tensor metrics | DTI derivatives |

---

## Standard Output Layout

```
ixi_output/
├── raw/                    # Downloaded original IXI files
├── bids/                   # BIDS-staged data
├── smri/                   # Structural MRI derivatives
├── mra/                    # MRA derivatives
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local IXI data staging.

- If the task starts from raw IXI data already present on disk and only asks for BIDS-style staging:
  - Skip the mandatory download stage
  - Default to the narrow path `local raw IXI discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- IXI is a multi-site dataset with different scanners; consider site effects in analysis.
- Site information can be inferred from subject ID prefix (HH, Guy, IOP).
- MRA data is unique to IXI; vessel analysis requires specialized tools.
- Some subjects may have missing modalities (PD, DTI).
- `ixi-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end IXI workflow.
- User asks to download IXI and run structural MRI processing.
- User needs BIDS staging for IXI data.
- User asks for multi-site brain MRI analysis.
- User asks for MRA vessel analysis.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `nibabel-skill` → NIfTI I/O and MRA processing
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- IXI Dataset: https://brain-development.org/ixi-dataset/
- Brain-development.org: https://brain-development.org/

Created At: 2026-05-06 13:31 HKT
Last Updated At: 2026-05-06 13:31 HKT
Author: chengwang96
