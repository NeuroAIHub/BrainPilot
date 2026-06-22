---
name: hbn-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Healthy Brain Network (HBN) dataset, including download, BIDS organization, and multimodal processing of sMRI, dMRI, rs-fMRI, task-fMRI, and EEG data. Triggers include: 'HBN', 'Healthy Brain Network', 'process HBN', 'HBN fMRI', 'HBN EEG', or any request to run the HBN multimodal pipeline. This is the NeuroClaw dataset-orchestration layer for HBN."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - dwi-skill
  - eeg-skill
  - bids-organizer
  - claw-shell
---
# HBN Skill (Dataset-Orchestration Layer)

## Overview
`hbn-skill` is the NeuroClaw orchestration skill for the **Healthy Brain Network (HBN)** dataset.

It coordinates a fixed multi-phase workflow:
1. Download HBN data from the FCP/INDI repository.
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill`, `fmri-skill`, `dwi-skill`, and `eeg-skill`.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract and merge HBN phenotype tables (psychiatric, behavioral, cognitive, lifestyle, genetics, actigraphy).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
HBN data is distributed through the **FCP/INDI** repository:
- Website: https://fcon_1000.projects.nitrc.org/indi/cmi_healthy_brain_network/

### Supported HBN Data Packages
- **Imaging data**: T1w, T2w, dMRI, rs-fMRI, task-fMRI (NIfTI format)
- **EEG data**: resting-state and task EEG recordings
- **Phenotype data**: CSV/TSV files with psychiatric, behavioral, cognitive, lifestyle, genetics, actigraphy measures
- **Sites**: Rutgers University Brain Imaging Center (primary), with additional sites planned

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- Download tool installation and execution: `claw-shell`
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- Target subset (full cohort, specific sites, or age groups)
- Subject list scope (full or custom IDs)
- Destination directory with sufficient disk space

---

## Narrow Path: HBN Raw NIfTI -> BIDS Staging

Use this path when the task only asks to reorganize raw HBN NIfTI files into a BIDS-style dataset and does not require preprocessing, ROI extraction, phenotype merging, or downstream analysis.

### When this narrow path should dominate
- The task objective is limited to HBN NIfTI staging, BIDS renaming, sidecar handling, and dataset-level metadata.
- Inputs are already local HBN NIfTI files or HBN-style subject folders.
- The required deliverable is a direct staging script or command sequence, not a plan for fMRIPrep or downstream analysis.

### Narrow-path contract
- Do not widen the solution to fMRIPrep, ROI extraction, phenotype merging, or downstream analysis unless the task explicitly requires them.
- Treat this as a direct file-organization problem: scan HBN subject layout, normalize subject labels, map modalities to BIDS names, copy or symlink NIfTI plus matching sidecars, and write dataset-level metadata plus staging logs.
- If the task is benchmark-style, prefer a single direct end-to-end staging script over a confirmation-first orchestration plan.

### Expected narrow-path behavior
1. Detect HBN-style subject IDs (e.g., `NDARAA075AMK`) and normalize to BIDS labels such as `sub-NDARAA075AMK`.
2. Detect session information (e.g., `ses-1`, `ses-2`) from directory structure.
3. Route modalities:
   - T1w -> `anat/*_T1w`
   - T2w -> `anat/*_T2w`
   - dMRI -> `dwi/*_dwi`
   - rs-fMRI/BOLD -> `func/*_task-rest_bold`
   - task-fMRI/BOLD -> `func/*_task-<name>_bold`
   - EEG -> `eeg/*_eeg`
4. Preserve or rename matching JSON sidecars when available.
5. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`, `README`, and a manifest or skipped-file report.

---

## Core Workflow (Never Bypassed)
1. Identify user target: full HBN download, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_hbn.py`.
6. Delegate to modality skills:
   - `smri-skill` for structural MRI (T1w, T2w)
   - `fmri-skill` for functional MRI (rs-fMRI, task-fMRI)
   - `dwi-skill` for diffusion MRI (dMRI)
   - `eeg-skill` for EEG recordings
7. If phenotype extraction is requested, run `scripts/extract_hbn_phenotype.py`.
8. If QC summary is requested, run `scripts/hbn_qc_summary.py`.
9. Save outputs into an HBN-centered structure under `hbn_output/`.

---

## Input Layout (Example)

Subject `NDARAA075AMK`:

```
hbn_raw/
  NDARAA075AMK/
    ses-1/
      anat/
        sub-NDARAA075AMK_ses-1_T1w.nii.gz
      func/
        sub-NDARAA075AMK_ses-1_task-rest_bold.nii.gz
      dwi/
        sub-NDARAA075AMK_ses-1_dwi.nii.gz
      eeg/
        sub-NDARAA075AMK_ses-1_task-rest_eeg.set
    ses-2/
      ...
  phenotype/
    hbn_phenotype.csv
```

---

## BIDS Preparation

### Script: `scripts/reorganize_hbn.py`

Converts HBN raw directory structure to BIDS-compliant layout.

```bash
python skills/hbn-skill/scripts/reorganize_hbn.py \
  --input /path/to/hbn_raw \
  --output /path/to/hbn_bids
```

Features:
- Subject ID normalization to BIDS `sub-NDARXXXXXXXXX`
- Session detection from directory structure
- Modality routing: T1w, T2w, dMRI, rs-fMRI, task-fMRI, EEG
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Multimodal Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w, T2w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction | `smri_output/` |
| fMRI (rs-fMRI, task-fMRI) | `fmri-skill` | preprocessing, denoising, ROI time series, connectivity, task GLM | `fmri_output/` |
| dMRI | `dwi-skill` | eddy correction, tensor metrics, tractography, connectome | `dwi_output/` |
| EEG | `eeg-skill` | artifact removal, filtering, epoch extraction, spectral analysis | `eeg_output/` |

---

## Phenotype Extraction

### Script: `scripts/extract_hbn_phenotype.py`

```bash
python skills/hbn-skill/scripts/extract_hbn_phenotype.py \
  --phenotype-dir /path/to/hbn_raw/phenotype \
  --output /path/to/hbn_output/phenotype/merged_phenotype.csv \
  --imaging-ids /path/to/hbn_output/bids/participants.tsv
```

HBN phenotype domains include:
- Psychiatric assessments (CBCL, KSADS)
- Behavioral measures
- Cognitive assessments
- Lifestyle and environmental factors
- Genetics
- Actigraphy

---

## QC Integration

### Script: `scripts/hbn_qc_summary.py`

```bash
python skills/hbn-skill/scripts/hbn_qc_summary.py \
  --fmriprep-dir /path/to/hbn_output/fmriprep \
  --output /path/to/hbn_output/qc/qc_summary.csv \
  --exclude-output /path/to/hbn_output/qc/exclude_list.csv \
  --fd-threshold 0.3
```

---

## Recommended Output Layout
All assets should be organized under `./hbn_output/`:
- `hbn_output/raw/` (downloaded original files)
- `hbn_output/bids/` (staged BIDS data)
- `hbn_output/smri/` (links or copies from `smri_output/`)
- `hbn_output/fmri/` (links or copies from `fmri_output/`)
- `hbn_output/dwi/` (links or copies from `dwi_output/`)
- `hbn_output/eeg/` (links or copies from `eeg_output/`)
- `hbn_output/phenotype/` (merged phenotype tables)
- `hbn_output/qc/` (QC summaries and exclusion lists)
- `hbn_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local HBN data staging or organization.

- If the task starts from raw HBN data already present on disk and only asks for BIDS-style staging / organization:
  - skip the mandatory download stage
  - default to the narrow path `local raw HBN discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- HBN is a pediatric/adolescent cohort (ages 5-21); age-appropriate processing parameters may be needed.
- HBN includes EEG data in addition to standard neuroimaging modalities.
- HBN data is released in waves; not all subjects have all modalities.
- HBN subject IDs use NDAR format (e.g., `NDARAA075AMK`).
- `hbn-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end HBN workflow.
- User asks to download HBN data and then run multimodal processing.
- User needs BIDS staging for raw HBN NIfTI files.
- User asks to extract and merge HBN phenotype tables.
- User needs HBN-specific QC summaries and exclusion lists.

---

## Complementary / Related Skills
- `smri-skill`
- `fmri-skill`
- `dwi-skill`
- `eeg-skill`
- `bids-organizer`
- `fmriprep-tool`
- `qsiprep-tool`
- `freesurfer-tool`
- `mne-eeg-tool`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- HBN: https://fcon_1000.projects.nitrc.org/indi/cmi_healthy_brain_network/
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 10:49 HKT
Last Updated At: 2026-05-06 10:49 HKT
Author: chengwang96
