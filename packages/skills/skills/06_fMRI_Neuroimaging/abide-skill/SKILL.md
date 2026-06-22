---
name: abide-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the ABIDE (Autism Brain Imaging Data Exchange) dataset, including download, BIDS organization, and processing of sMRI and rs-fMRI data. Triggers include: 'ABIDE', 'ABIDE data', 'process ABIDE', 'ABIDE fMRI', 'ABIDE sMRI', 'autism imaging', or any request to run the ABIDE pipeline. This is the NeuroClaw dataset-orchestration layer for ABIDE."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - bids-organizer
  - claw-shell
---
# ABIDE Skill (Dataset-Orchestration Layer)

## Overview
`abide-skill` is the NeuroClaw orchestration skill for the **ABIDE (Autism Brain Imaging Data Exchange)** dataset.

It coordinates a fixed three-phase workflow:
1. Download ABIDE data from the FCP/INDI repository or NITRC.
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill` and `fmri-skill`.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract and merge ABIDE phenotype tables (diagnosis, age, sex, site, FIQ, ADOS, etc.).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
ABIDE data is distributed through the **FCP/INDI** repository:
- ABIDE I: https://fcon_1000.projects.nitrc.org/indi/abide/
- ABIDE II: https://fcon_1000.projects.nitrc.org/indi/abide_II.html
- NITRC mirror: https://www.nitrc.org/projects/fcp_indi/

### Supported ABIDE Data Packages
- **ABIDE I**: 1,112 subjects from 17 international sites (539 ASD, 573 controls)
- **ABIDE II**: 1,044 subjects from 19 sites
- **Phenotype data**: CSV files with demographics, diagnosis, cognitive scores
- **Preprocessed derivatives** (optional): CPAC, DPARSF, CCS, NeuroMark pipelines

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- Download tool installation and execution: `claw-shell`
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- Target ABIDE version (I, II, or both)
- Target subset (full cohort, specific sites, or ASD/control only)
- Subject list scope (full or custom IDs)
- Whether to download raw data or preprocessed derivatives
- Destination directory with sufficient disk space

---

## Narrow Path: ABIDE Raw NIfTI -> BIDS Staging

Use this path when the task only asks to reorganize raw ABIDE NIfTI files into a BIDS-style dataset and does not require preprocessing, ROI extraction, phenotype merging, or downstream analysis.

### When this narrow path should dominate
- The task objective is limited to ABIDE NIfTI staging, BIDS renaming, sidecar handling, and dataset-level metadata.
- Inputs are already local ABIDE NIfTI files or ABIDE-style subject/site folders.
- The required deliverable is a direct staging script or command sequence, not a plan for fMRIPrep or downstream analysis.

### Narrow-path contract
- Do not widen the solution to fMRIPrep, ROI extraction, phenotype merging, or downstream analysis unless the task explicitly requires them.
- Treat this as a direct file-organization problem: scan ABIDE subject/site layout, normalize subject labels, map modalities to BIDS names, copy or symlink NIfTI plus matching sidecars, and write dataset-level metadata plus staging logs.
- If the task is benchmark-style, prefer a single direct end-to-end staging script over a confirmation-first orchestration plan.

### Expected narrow-path behavior
1. Detect ABIDE-style subject IDs (numeric, e.g., `0050642`) and normalize to BIDS labels such as `sub-0050642`.
2. Detect site information and encode as BIDS session or metadata (e.g., `ses-NYU`, or site column in `participants.tsv`).
3. Route modalities:
   - T1w -> `anat/*_T1w`
   - rs-fMRI/BOLD -> `func/*_task-rest_bold`
4. Preserve or rename matching JSON sidecars when available; if metadata is absent, create only the minimal dataset files required by the task and log the limitation.
5. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`, `README`, and a manifest or skipped-file report.

---

## Core Workflow (Never Bypassed)
1. Identify user target: full ABIDE download, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_abide.py`.
6. Delegate to modality skills:
   - `smri-skill` for structural MRI (T1w)
   - `fmri-skill` for resting-state fMRI (rs-fMRI)
7. If phenotype extraction is requested, run `scripts/extract_abide_phenotype.py`.
8. If QC summary is requested, run `scripts/abide_qc_summary.py`.
9. Save outputs into an ABIDE-centered structure under `abide_output/`.

---

## Input Layout (Example)

Subject `0050642` from site NYU:

```
abide_raw/
  NYU/
    0050642/
      session_1/
        anat_1/
          anat.nii.gz
        func_1/
          func.nii.gz
  phenotype/
    ABIDE_phenotypic.csv
```

Or flat layout:

```
abide_raw/
  0050642/
    anat/
      T1w.nii.gz
    func/
      rest_bold.nii.gz
```

---

## BIDS Preparation

### Script: `scripts/reorganize_abide.py`

Converts ABIDE raw directory structure to BIDS-compliant layout.

```bash
python skills/abide-skill/scripts/reorganize_abide.py \
  --input /path/to/abide_raw \
  --output /path/to/abide_bids \
  --phenotype /path/to/abide_raw/phenotype/ABIDE_phenotypic.csv
```

Features:
- Subject ID normalization: numeric ABIDE IDs to BIDS `sub-NNNNNNN`
- Site extraction and encoding in `participants.tsv`
- Modality routing: T1w, rs-fMRI
- Sidecar JSON preservation and validation
- `dataset_description.json` and `participants.tsv` generation with phenotype metadata
- Dry-run mode: `--dry-run` to preview without copying

---

## Multimodal Processing Delegation

After BIDS staging completes, `abide-skill` delegates by modality:

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction, ROI morphometry | `smri_output/` derivatives and stats |
| rs-fMRI | `fmri-skill` | preprocessing, denoising, ROI time series, connectivity | `fmri_output/` derivatives, timeseries, connectivity |

### Delegation Strategy
- If user asks for full ABIDE analysis: run sMRI -> fMRI in ordered phases.
- If user asks for one modality only: call only the corresponding modality skill.
- If compute resources are adequate and the user approves parallel runs: run modality pipelines in parallel.

---

## Phenotype Extraction

### Script: `scripts/extract_abide_phenotype.py`

Extracts and merges ABIDE phenotype tables for downstream analysis.

```bash
python skills/abide-skill/scripts/extract_abide_phenotype.py \
  --phenotype-dir /path/to/abide_raw/phenotype \
  --output /path/to/abide_output/phenotype/merged_phenotype.csv \
  --columns subject,DX_GROUP,AGE_AT_SCAN,SEX,FIQ,VIQ,PIQ,site \
  --imaging-ids /path/to/abide_output/bids/participants.tsv
```

Features:
- Reads ABIDE phenotype CSV files (ABIDE I and II compatible)
- Standardizes column names (DX_GROUP: 1=ASD, 2=control)
- Column selection and renaming
- Site encoding and grouping
- Missing value handling
- Cross-reference with imaging subject list
- Outputs merged CSV ready for statistical analysis or model training

---

## QC Integration

### Script: `scripts/abide_qc_summary.py`

Generates per-subject QC summaries and exclusion lists.

```bash
python skills/abide-skill/scripts/abide_qc_summary.py \
  --fmriprep-dir /path/to/abide_output/fmriprep \
  --freesurfer-dir /path/to/abide_output/smri/freesurfer \
  --raw-qc /path/to/abide_raw/phenotype/ABIDE_phenotypic.csv \
  --output /path/to/abide_output/qc/qc_summary.csv \
  --exclude-output /path/to/abide_output/qc/exclude_list.csv \
  --fd-threshold 0.3 \
  --coverage-threshold 0.8
```

Features:
- Reads fMRIPrep confounds (framewise displacement, DVARS)
- Reads FreeSurfer recon-all QC metrics
- Incorporates ABIDE QC flags (QC_RATER_1, func_perc_fd, anat_rater_1, etc.)
- Applies exclusion criteria: motion threshold (FD), coverage threshold, structural quality
- Per-site QC summary for site-effect assessment
- Outputs per-subject QC summary CSV and exclusion list CSV

---

## Recommended Output Layout
All assets should be organized under `./abide_output/`:
- `abide_output/raw/` (downloaded original ABIDE files)
- `abide_output/bids/` (staged BIDS data)
- `abide_output/staging/` (optional normalized staging intermediate)
- `abide_output/smri/` (links or copies from `smri_output/`)
- `abide_output/fmri/` (links or copies from `fmri_output/`)
- `abide_output/phenotype/` (merged phenotype tables)
- `abide_output/qc/` (QC summaries and exclusion lists)
- `abide_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local ABIDE data staging or organization.

- If the task starts from raw ABIDE data already present on disk and only asks for BIDS-style staging / organization:
  - skip the mandatory download stage
  - do not automatically delegate to `smri-skill` or `fmri-skill`
  - default to the narrow path `local raw ABIDE discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.
- Preserve the ABIDE-centered output contract under `abide_output/bids/` when the task is specifically a staging benchmark.
- Only use the full multimodal orchestration and confirmation-heavy workflow when the prompt explicitly asks for download, end-to-end ABIDE processing, or post-staging structural / functional analysis.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.
- If download fails for partial subjects, continue batch with clear failure report and retry list.

---

## Important Notes and Limitations
- ABIDE data from different sites may have varying acquisition parameters; site effects should be accounted for in analysis.
- ABIDE subject IDs are numeric and vary in length across sites.
- ABIDE I and II have different phenotype table formats; the extraction script handles both.
- ABIDE provides preprocessed derivatives from multiple pipelines (CPAC, DPARSF, CCS); raw data processing via fMRIPrep is recommended for reproducibility.
- ABIDE data does not include task-fMRI; only resting-state fMRI is available.
- `abide-skill` is orchestration-only; detailed preprocessing logic remains in `smri-skill` and `fmri-skill`.

---

## When to Call This Skill
- User asks for end-to-end ABIDE workflow.
- User asks to download ABIDE data and then run sMRI/rs-fMRI processing.
- User needs BIDS staging for raw ABIDE NIfTI files.
- User asks to extract and merge ABIDE phenotype tables.
- User asks for ABIDE-specific QC summaries and exclusion lists.
- User needs a single entry point for ABIDE multimodal orchestration.

---

## Complementary / Related Skills
- `smri-skill`
- `fmri-skill`
- `bids-organizer`
- `fmriprep-tool`
- `freesurfer-tool`
- `neurostorm`
- `brain_gnn`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- ABIDE I: https://fcon_1000.projects.nitrc.org/indi/abide/
- ABIDE II: https://fcon_1000.projects.nitrc.org/indi/abide_II.html
- Di Martino et al., 2014, *The autism brain imaging data exchange: towards a large-scale evaluation of the intrinsic brain architecture in autism*
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 01:45 HKT
Last Updated At: 2026-05-06 01:45 HKT
Author: chengwang96
