---
name: adhd200-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the ADHD-200 dataset, including download, BIDS organization, and processing of sMRI and rs-fMRI data. Triggers include: 'ADHD-200', 'ADHD200', 'process ADHD data', 'ADHD fMRI', or any request to run the ADHD-200 pipeline. This is the NeuroClaw dataset-orchestration layer for ADHD-200."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - bids-organizer
  - claw-shell
---
# ADHD-200 Skill (Dataset-Orchestration Layer)

## Overview
`adhd200-skill` is the NeuroClaw orchestration skill for the **ADHD-200** dataset.

It coordinates a fixed three-phase workflow:
1. Download ADHD-200 data from the FCP/INDI repository.
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill` and `fmri-skill`.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract and merge ADHD-200 phenotype tables (diagnosis, ADHD measures, demographics, medication).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
ADHD-200 data is distributed through the **FCP/INDI** repository:
- Website: https://fcon_1000.projects.nitrc.org/indi/adhd200/

### Supported ADHD-200 Data Packages
- **Imaging data**: T1w, rs-fMRI (NIfTI format) from 8 imaging sites
- **Phenotype data**: CSV files with diagnosis, ADHD measures, demographics, medication history, QC measures
- **Sites**: Peking, Brown, NYU, KKI, NeuroImage, OHSU, Pitt, Washington University

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- Download tool installation and execution: `claw-shell`
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- Target subset (full cohort, specific sites, or ADHD/control only)
- Subject list scope (full or custom IDs)
- Destination directory with sufficient disk space

---

## Narrow Path: ADHD-200 Raw NIfTI -> BIDS Staging

Use this path when the task only asks to reorganize raw ADHD-200 NIfTI files into a BIDS-style dataset and does not require preprocessing, ROI extraction, phenotype merging, or downstream analysis.

### When this narrow path should dominate
- The task objective is limited to ADHD-200 NIfTI staging, BIDS renaming, sidecar handling, and dataset-level metadata.
- Inputs are already local ADHD-200 NIfTI files or ADHD-200-style subject/site folders.
- The required deliverable is a direct staging script or command sequence, not a plan for fMRIPrep or downstream analysis.

### Narrow-path contract
- Do not widen the solution to fMRIPrep, ROI extraction, phenotype merging, or downstream analysis unless the task explicitly requires them.
- Treat this as a direct file-organization problem: scan ADHD-200 subject/site layout, normalize subject labels, map modalities to BIDS names, copy or symlink NIfTI plus matching sidecars, and write dataset-level metadata plus staging logs.
- If the task is benchmark-style, prefer a single direct end-to-end staging script over a confirmation-first orchestration plan.

### Expected narrow-path behavior
1. Detect ADHD-200-style subject IDs (numeric, e.g., `0010002`) and normalize to BIDS labels such as `sub-0010002`.
2. Detect site information and encode in `participants.tsv`.
3. Route modalities:
   - T1w -> `anat/*_T1w`
   - rs-fMRI/BOLD -> `func/*_task-rest_bold`
4. Preserve or rename matching JSON sidecars when available.
5. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`, `README`, and a manifest or skipped-file report.

---

## Core Workflow (Never Bypassed)
1. Identify user target: full ADHD-200 download, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_adhd200.py`.
6. Delegate to modality skills:
   - `smri-skill` for structural MRI (T1w)
   - `fmri-skill` for resting-state fMRI (rs-fMRI)
7. If phenotype extraction is requested, run `scripts/extract_adhd200_phenotype.py`.
8. If QC summary is requested, run `scripts/adhd200_qc_summary.py`.
9. Save outputs into an ADHD-200-centered structure under `adhd200_output/`.

---

## Input Layout (Example)

Subject `0010002` from site Peking:

```
adhd200_raw/
  Peking/
    0010002/
      anat/
        anat.nii.gz
      func/
        rest.nii.gz
  phenotype/
    ADHD200_..._phenotypic.csv
```

---

## BIDS Preparation

### Script: `scripts/reorganize_adhd200.py`

Converts ADHD-200 raw directory structure to BIDS-compliant layout.

```bash
python skills/adhd200-skill/scripts/reorganize_adhd200.py \
  --input /path/to/adhd200_raw \
  --output /path/to/adhd200_bids \
  --phenotype /path/to/adhd200_raw/phenotype/ADHD200_phenotypic.csv
```

Features:
- Subject ID normalization: numeric ADHD-200 IDs to BIDS `sub-NNNNNNN`
- Site extraction and encoding in `participants.tsv`
- Modality routing: T1w, rs-fMRI
- `dataset_description.json` and `participants.tsv` generation with phenotype metadata
- Dry-run mode: `--dry-run` to preview without copying

---

## Multimodal Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction | `smri_output/` |
| rs-fMRI | `fmri-skill` | preprocessing, denoising, ROI time series, connectivity | `fmri_output/` |

---

## Phenotype Extraction

### Script: `scripts/extract_adhd200_phenotype.py`

```bash
python skills/adhd200-skill/scripts/extract_adhd200_phenotype.py \
  --phenotype-dir /path/to/adhd200_raw/phenotype \
  --output /path/to/adhd200_output/phenotype/merged_phenotype.csv \
  --columns subject,DX,AGE,SEX,ADHD_Index,Inatt,HyperImp \
  --imaging-ids /path/to/adhd200_output/bids/participants.tsv
```

---

## QC Integration

### Script: `scripts/adhd200_qc_summary.py`

```bash
python skills/adhd200-skill/scripts/adhd200_qc_summary.py \
  --fmriprep-dir /path/to/adhd200_output/fmriprep \
  --freesurfer-dir /path/to/adhd200_output/smri/freesurfer \
  --output /path/to/adhd200_output/qc/qc_summary.csv \
  --exclude-output /path/to/adhd200_output/qc/exclude_list.csv \
  --fd-threshold 0.3
```

---

## Recommended Output Layout
All assets should be organized under `./adhd200_output/`:
- `adhd200_output/raw/` (downloaded original files)
- `adhd200_output/bids/` (staged BIDS data)
- `adhd200_output/smri/` (links or copies from `smri_output/`)
- `adhd200_output/fmri/` (links or copies from `fmri_output/`)
- `adhd200_output/phenotype/` (merged phenotype tables)
- `adhd200_output/qc/` (QC summaries and exclusion lists)
- `adhd200_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local ADHD-200 data staging or organization.

- If the task starts from raw ADHD-200 data already present on disk and only asks for BIDS-style staging / organization:
  - skip the mandatory download stage
  - default to the narrow path `local raw ADHD-200 discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- ADHD-200 has heterogeneous acquisition parameters across 8 sites; site effects must be addressed in analysis.
- ADHD-200 subject IDs are numeric and vary in length across sites.
- Diagnosis labels vary by site (ADHD-combined, ADHD-inattentive, ADHD-hyperactive, typically developing).
- ADHD-200 data does not include task-fMRI; only resting-state fMRI is available.
- `adhd200-skill` is orchestration-only; detailed preprocessing logic remains in `smri-skill` and `fmri-skill`.

---

## When to Call This Skill
- User asks for end-to-end ADHD-200 workflow.
- User asks to download ADHD-200 data and then run sMRI/rs-fMRI processing.
- User needs BIDS staging for raw ADHD-200 NIfTI files.
- User asks to extract and merge ADHD-200 phenotype tables.
- User needs ADHD-200-specific QC summaries and exclusion lists.

---

## Complementary / Related Skills
- `smri-skill`
- `fmri-skill`
- `bids-organizer`
- `fmriprep-tool`
- `freesurfer-tool`
- `brain_gnn`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- ADHD-200: https://fcon_1000.projects.nitrc.org/indi/adhd200/
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 01:50 HKT
Last Updated At: 2026-05-06 01:50 HKT
Author: chengwang96
