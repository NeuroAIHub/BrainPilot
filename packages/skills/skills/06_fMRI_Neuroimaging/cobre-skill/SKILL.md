---
name: cobre-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the COBRE dataset, including download, BIDS organization, and processing of sMRI and rs-fMRI data for schizophrenia research. Triggers include: 'COBRE', 'process COBRE', 'COBRE schizophrenia', 'COBRE fMRI', or any request to run the COBRE pipeline. This is the NeuroClaw dataset-orchestration layer for COBRE."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - bids-organizer
  - claw-shell
---
# COBRE Skill (Dataset-Orchestration Layer)

## Overview
`cobre-skill` is the NeuroClaw orchestration skill for the **COBRE (Center for Biomedical Research Excellence)** dataset.

COBRE contains 147 participants: 72 schizophrenia patients and 75 healthy controls, with T1w structural and rs-fMRI data. It is commonly used as a benchmark for brain disorder classification.

It coordinates a fixed three-phase workflow:
1. Download COBRE data from the FCP/INDI repository.
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill` and `fmri-skill`.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract COBRE phenotype data (diagnosis, demographics, handedness).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
COBRE data is distributed through the **FCP/INDI** repository:
- Website: https://fcon_1000.projects.nitrc.org/indi/retro/cobre.html

### Supported COBRE Data Packages
- **Imaging data**: T1w, rs-fMRI (NIfTI format)
- **Phenotype data**: CSV files with diagnosis, demographics, handedness
- **Participants**: 147 total (72 schizophrenia, 75 healthy controls)

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- Download tool installation and execution: `claw-shell`
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- Subject list scope (full or custom subset)
- Whether to download raw data or preprocessed derivatives
- Destination directory with sufficient disk space

---

## Narrow Path: COBRE Raw NIfTI -> BIDS Staging

Use this path when the task only asks to reorganize raw COBRE NIfTI files into a BIDS-style dataset and does not require preprocessing or downstream analysis.

### Expected narrow-path behavior
1. Detect COBRE-style subject IDs (numeric) and normalize to BIDS labels such as `sub-NNNNN`.
2. Route modalities:
   - T1w -> `anat/*_T1w`
   - rs-fMRI/BOLD -> `func/*_task-rest_bold`
3. Preserve or rename matching JSON sidecars when available.
4. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`.

---

## Core Workflow (Never Bypassed)
1. Identify user target: full COBRE download, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_cobre.py`.
6. Delegate to modality skills:
   - `smri-skill` for structural MRI (T1w)
   - `fmri-skill` for resting-state fMRI (rs-fMRI)
7. If phenotype extraction is requested, run `scripts/extract_cobre_phenotype.py`.
8. If QC summary is requested, run `scripts/cobre_qc_summary.py`.
9. Save outputs into a COBRE-centered structure under `cobre_output/`.

---

## BIDS Preparation

### Script: `scripts/reorganize_cobre.py`

Converts COBRE raw directory structure to BIDS-compliant layout.

```bash
python skills/cobre-skill/scripts/reorganize_cobre.py \
  --input /path/to/cobre_raw \
  --output /path/to/cobre_bids \
  --phenotype /path/to/cobre_raw/phenotype/cobre_phenotypic.csv
```

---

## Phenotype Extraction

### Script: `scripts/extract_cobre_phenotype.py`

```bash
python skills/cobre-skill/scripts/extract_cobre_phenotype.py \
  --phenotype-dir /path/to/cobre_raw/phenotype \
  --output /path/to/cobre_output/phenotype/merged_phenotype.csv \
  --imaging-ids /path/to/cobre_output/bids/participants.tsv
```

---

## QC Integration

### Script: `scripts/cobre_qc_summary.py`

```bash
python skills/cobre-skill/scripts/cobre_qc_summary.py \
  --fmriprep-dir /path/to/cobre_output/fmriprep \
  --output /path/to/cobre_output/qc/qc_summary.csv \
  --exclude-output /path/to/cobre_output/qc/exclude_list.csv \
  --fd-threshold 0.3
```

---

## Recommended Output Layout
All assets should be organized under `./cobre_output/`:
- `cobre_output/raw/` (downloaded original COBRE files)
- `cobre_output/bids/` (staged BIDS data)
- `cobre_output/smri/` (links or copies from `smri_output/`)
- `cobre_output/fmri/` (links or copies from `fmri_output/`)
- `cobre_output/phenotype/` (merged phenotype tables)
- `cobre_output/qc/` (QC summaries and exclusion lists)
- `cobre_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local COBRE data staging or organization.

- If the task starts from raw COBRE data already present on disk and only asks for BIDS-style staging / organization:
  - skip the mandatory download stage
  - default to the narrow path `local raw COBRE discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- COBRE is a single-site dataset from the University of New Mexico; no site effects to address.
- COBRE has a small sample size (147 subjects); cross-validation strategies should account for this.
- Diagnosis labels: schizophrenia (1) vs. healthy control (2).
- COBRE data does not include task-fMRI; only resting-state fMRI is available.
- `cobre-skill` is orchestration-only; detailed preprocessing logic remains in `smri-skill` and `fmri-skill`.

---

## When to Call This Skill
- User asks for end-to-end COBRE workflow.
- User asks to download COBRE data and then run sMRI/rs-fMRI processing.
- User needs BIDS staging for raw COBRE NIfTI files.
- User asks to extract COBRE phenotype data.
- User needs COBRE-specific QC summaries and exclusion lists.
- User wants to run schizophrenia classification with BrainGNN or other models on COBRE.

---

## Complementary / Related Skills
- `smri-skill`
- `fmri-skill`
- `bids-organizer`
- `fmriprep-tool`
- `freesurfer-tool`
- `brain_gnn`
- `neurostorm`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- COBRE: https://fcon_1000.projects.nitrc.org/indi/retro/cobre.html
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 01:54 HKT
Last Updated At: 2026-05-06 01:54 HKT
Author: chengwang96
