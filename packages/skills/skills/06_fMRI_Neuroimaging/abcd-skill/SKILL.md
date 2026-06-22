---
name: abcd-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the ABCD Study dataset, including download via NIMH Data Archive, BIDS organization, and multimodal processing of sMRI, fMRI, and dMRI. Triggers include: 'ABCD Study', 'ABCD data', 'process ABCD', 'ABCD fMRI', 'ABCD sMRI', 'ABCD diffusion', or any request to run the ABCD multimodal pipeline. This is the NeuroClaw dataset-orchestration layer for ABCD."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - dwi-skill
  - bids-organizer
  - claw-shell
---
# ABCD Skill (Dataset-Orchestration Layer)

## Overview
`abcd-skill` is the NeuroClaw orchestration skill for the **ABCD Study (Adolescent Brain Cognitive Development)** dataset.

It coordinates a fixed three-phase workflow:
1. Download ABCD data from the NIMH Data Archive (NDA).
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill`, `fmri-skill`, and `dwi-skill`.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract and merge ABCD phenotype tables (mental health, cognition, substance use, etc.).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
ABCD data is distributed through the **NIMH Data Archive (NDA)**:
- Website: https://abcdstudy.org/
- Data access: https://nda.nih.gov/ (requires NDA account and data use agreement)

### Supported ABCD Data Packages
- **ABCD Study 5.1** (latest release): includes imaging, phenotype, and biospecimen data
- **Imaging data**: T1w, T2w, dMRI, rs-fMRI, task-fMRI (NIfTI format)
- **Phenotype data**: tab-delimited files (abcd_p_tab, mental_health, cbcl, etc.)
- **Derived imaging data**: FreeSurfer, fMRIPrep outputs (if available from NDA)

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- NDA download tool installation and execution: `claw-shell`
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- NDA credentials/authorized access
- Target data package (imaging only, phenotype only, or both)
- Subject list scope (full cohort or custom subset)
- ABCD release version (e.g., 5.1)
- Destination directory with sufficient disk space (ABCD imaging data can exceed 10 TB for full cohort)

---

## Narrow Path: ABCD Raw NIfTI -> BIDS Staging

Use this path when the task only asks to reorganize raw ABCD NIfTI files into a BIDS-style dataset and does not require preprocessing, ROI extraction, phenotype merging, or downstream analysis.

### When this narrow path should dominate
- The task objective is limited to ABCD NIfTI staging, BIDS renaming, sidecar handling, and dataset-level metadata.
- Inputs are already local ABCD NIfTI files or ABCD-style subject/session folders.
- The required deliverable is a direct staging script or command sequence, not a plan for fMRIPrep or downstream analysis.

### Narrow-path contract
- Do not widen the solution to fMRIPrep, ROI extraction, phenotype merging, or downstream analysis unless the task explicitly requires them.
- Treat this as a direct file-organization problem: scan ABCD subject/session layout, normalize subject labels, map modalities to BIDS names, copy or symlink NIfTI plus matching sidecars, and write dataset-level metadata plus staging logs.
- If the task is benchmark-style, prefer a single direct end-to-end staging script over a confirmation-first orchestration plan.

### Expected narrow-path behavior
1. Detect ABCD-style subject IDs (NDAR format, e.g., `NDAR_INVXXXXXXXX`) and normalize to BIDS labels such as `sub-NDARINVXXXXXXXX`.
2. Detect visit/timepoint information and normalize to session labels such as `ses-baselineYear1Arm1`, `ses-2YearFollowUpYArm1`, etc.
3. Route modalities:
   - T1w -> `anat/*_T1w`
   - T2w -> `anat/*_T2w`
   - dMRI/DWI -> `dwi/*_dwi`
   - rs-fMRI -> `func/*_task-rest_bold`
   - task-fMRI -> `func/*_task-<taskname>_bold`
4. Preserve or rename matching JSON sidecars when available; if metadata is absent, create only the minimal dataset files required by the task and log the limitation.
5. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`, `README`, and a manifest or skipped-file report.

---

## Core Workflow (Never Bypassed)
1. Identify user target: full ABCD download, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_abcd.py`.
6. Delegate sequentially or in parallel to:
   - `smri-skill` for structural MRI (T1w, T2w)
   - `fmri-skill` for functional MRI (rs-fMRI, task-fMRI)
   - `dwi-skill` for diffusion MRI (dMRI)
7. If phenotype extraction is requested, run `scripts/extract_abcd_phenotype.py`.
8. If QC summary is requested, run `scripts/abcd_qc_summary.py`.
9. Save outputs into an ABCD-centered structure under `abcd_output/`.

---

## Input Layout (Example)

Subject `NDAR_INVXXXXXXXX` (multimodal imaging + phenotype):

```
abcd_raw/
  ndar_subject01/
    baselineYear1Arm1/
      T1w/
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_T1w.nii.gz
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_T1w.json
      T2w/
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_T2w.nii.gz
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_T2w.json
      dwi/
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_dwi.nii.gz
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_dwi.bval
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_dwi.bvec
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_dwi.json
      func/
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_task-rest_bold.nii.gz
        sub-NDARINVXXXXXXXX_ses-baselineYear1Arm1_task-rest_bold.json
  phenotype/
    abcd_p_tab.csv
    mental_health.csv
    cbcl.csv
```

---

## BIDS Preparation

### Script: `scripts/reorganize_abcd.py`

Converts ABCD raw directory structure to BIDS-compliant layout.

```bash
python skills/abcd-skill/scripts/reorganize_abcd.py \
  --input /path/to/abcd_raw \
  --output /path/to/abcd_bids \
  --participants-file /path/to/abcd_raw/phenotype/abcd_p_tab.csv
```

Features:
- Subject ID normalization: NDAR format to BIDS `sub-NDARINVXXXXXXXX`
- Session mapping: ABCD event names to BIDS `ses-` labels
- Modality routing: T1w, T2w, dMRI, rs-fMRI, task-fMRI
- Sidecar JSON preservation and validation
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Multimodal Processing Delegation

After BIDS staging completes, `abcd-skill` delegates by modality:

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w/T2w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction, ROI morphometry | `smri_output/` derivatives and stats |
| fMRI (rs-fMRI/task-fMRI) | `fmri-skill` | preprocessing, denoising, ROI time series, connectivity | `fmri_output/` derivatives, timeseries, connectivity |
| dMRI | `dwi-skill` | diffusion preprocessing, tensor metrics, tractography/connectome | `dwi_output/` metrics and tract files |

### Delegation Strategy
- If user asks for full multimodal ABCD analysis: run sMRI -> fMRI -> dMRI in ordered phases.
- If user asks for one modality only: call only the corresponding modality skill.
- If compute resources are adequate and the user approves parallel runs: run modality pipelines in parallel after shared prerequisites are ready.

---

## Phenotype Extraction

### Script: `scripts/extract_abcd_phenotype.py`

Extracts and merges ABCD phenotype tables for downstream analysis.

```bash
python skills/abcd-skill/scripts/extract_abcd_phenotype.py \
  --phenotype-dir /path/to/abcd_raw/phenotype \
  --output /path/to/abcd_output/phenotype/merged_phenotype.csv \
  --columns src_subject_id,eventname,sex,age,cbcl_total,ksads_dx \
  --imaging-ids /path/to/abcd_output/bids/participants.tsv
```

Features:
- Reads ABCD tab-delimited phenotype files
- Column selection and renaming
- Visit/event alignment (baselineYear1Arm1, 2YearFollowUpYArm1, etc.)
- Missing value handling (filter or impute)
- Cross-reference with imaging subject list to keep only subjects with both imaging and phenotype data
- Outputs merged CSV ready for statistical analysis or model training

---

## QC Integration

### Script: `scripts/abcd_qc_summary.py`

Generates per-subject QC summaries and exclusion lists.

```bash
python skills/abcd-skill/scripts/abcd_qc_summary.py \
  --fmriprep-dir /path/to/abcd_output/fmriprep \
  --freesurfer-dir /path/to/abcd_output/smri/freesurfer \
  --raw-qc /path/to/abcd_raw/phenotype/abcd_imgincl01.csv \
  --output /path/to/abcd_output/qc/qc_summary.csv \
  --exclude-output /path/to/abcd_output/qc/exclude_list.csv \
  --fd-threshold 0.3 \
  --coverage-threshold 0.8
```

Features:
- Reads fMRIPrep confounds (framewise displacement, DVARS)
- Reads FreeSurfer recon-all QC metrics
- Incorporates ABCD native QC flags (imgincl01: include_t1, include_dti, etc.)
- Applies exclusion criteria: motion threshold (FD), coverage threshold, structural quality
- Outputs per-subject QC summary CSV and exclusion list CSV

---

## Recommended Output Layout
All assets should be organized under `./abcd_output/`:
- `abcd_output/raw/` (downloaded original ABCD files)
- `abcd_output/bids/` (staged BIDS data)
- `abcd_output/staging/` (optional normalized staging intermediate)
- `abcd_output/smri/` (links or copies from `smri_output/`)
- `abcd_output/fmri/` (links or copies from `fmri_output/`)
- `abcd_output/dwi/` (links or copies from `dwi_output/`)
- `abcd_output/phenotype/` (merged phenotype tables)
- `abcd_output/qc/` (QC summaries and exclusion lists)
- `abcd_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local ABCD data staging or organization.

- If the task starts from raw ABCD data already present on disk and only asks for BIDS-style staging / organization:
  - skip the mandatory download stage
  - do not automatically delegate to `smri-skill`, `fmri-skill`, or `dwi-skill`
  - default to the narrow path `local raw ABCD discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.
- Preserve the ABCD-centered output contract under `abcd_output/bids/` when the task is specifically a staging benchmark.
- Only use the full multimodal orchestration and confirmation-heavy workflow when the prompt explicitly asks for download, end-to-end multimodal ABCD processing, or post-staging structural / functional / diffusion analysis.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.
- If download fails for partial subjects, continue batch with clear failure report and retry list.

---

## Important Notes and Limitations
- ABCD multimodal processing is resource intensive (CPU, RAM, and storage). Full cohort imaging data exceeds 10 TB.
- NDA download requires authenticated access and compliance with the ABCD Data Use Agreement.
- ABCD subject IDs use NDAR format; normalization to BIDS labels must be consistent across all stages.
- ABCD has multiple follow-up timepoints (baselineYear1Arm1 through 4YearFollowUpYArm1); session handling must account for longitudinal structure.
- ABCD phenotype tables use tab-delimited format with specific column naming conventions; column names may change across releases.
- `abcd-skill` is orchestration-only; detailed preprocessing logic remains in `smri-skill`, `fmri-skill`, and `dwi-skill`.
- For highest-fidelity preprocessing, optionally delegate to `fmriprep-tool` and `hcppipeline-tool` as alternative routes.

---

## When to Call This Skill
- User asks for end-to-end ABCD Study workflow.
- User asks to download ABCD data and then run sMRI/fMRI/dMRI processing.
- User needs BIDS staging for raw ABCD NIfTI files.
- User asks to extract and merge ABCD phenotype tables.
- User asks for ABCD-specific QC summaries and exclusion lists.
- User needs a single entry point for ABCD multimodal orchestration.

---

## Complementary / Related Skills
- `smri-skill`
- `fmri-skill`
- `dwi-skill`
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
- ABCD Study: https://abcdstudy.org/
- NIMH Data Archive: https://nda.nih.gov/
- ABCD BIDS App: https://github.com/ABCD-STUDY/abcd-bids-tfmri
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 01:30 HKT
Last Updated At: 2026-05-06 01:30 HKT
Author: chengwang96
