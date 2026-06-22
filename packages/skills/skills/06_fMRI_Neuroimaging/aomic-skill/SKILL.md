---
name: aomic-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the AOMIC (Amsterdam Open MRI Collection) dataset, including data access, BIDS organization, and multimodal processing of sMRI, rs-fMRI, and task-fMRI. Triggers include: 'AOMIC', 'AOMIC data', 'process AOMIC', 'AOMIC fMRI', 'AOMIC resting state', or any request to run the AOMIC multimodal pipeline. This is the NeuroClaw dataset-orchestration layer for AOMIC."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - bids-organizer
  - claw-shell
---
# AOMIC Skill (Dataset-Orchestration Layer)

## Overview
`aomic-skill` is the NeuroClaw orchestration skill for the **AOMIC (Amsterdam Open MRI Collection)** dataset.

It coordinates a fixed three-phase workflow:
1. Guide AOMIC data access and download from OpenNeuro / the AOMIC repository.
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill` and `fmri-skill`.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract and merge AOMIC phenotype tables (Big Five personality traits, fluid intelligence, demographics).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
AOMIC data is publicly available:
- Website: https://nilab-uva.github.io/AOMIC.github.io/
- OpenNeuro derivatives: https://openneuro.org/
- Data access: direct download, no authentication required for most components

### Supported AOMIC Sub-datasets
- **AOMIC-ID1000**: ~1,000 participants with T1w, rs-fMRI, task-fMRI (emotion, gambling, motor, language tasks), Big Five personality, Raven's progressive matrices
- **AOMIC-PIOP1**: T1w, rs-fMRI, task-fMRI (emotion, working memory), personality and cognitive data
- **AOMIC-PIOP2**: T1w, rs-fMRI, task-fMRI (emotion, working memory), personality and cognitive data

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- Download tool installation and execution: `claw-shell`
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- Target sub-dataset (ID1000, PIOP1, PIOP2, or all)
- Subject list scope (full cohort or custom subset)
- Destination directory with sufficient disk space

---

## Narrow Path: AOMIC Raw Data -> BIDS Staging

Use this path when the task only asks to reorganize raw AOMIC files into a BIDS-style dataset and does not require preprocessing, ROI extraction, phenotype merging, or downstream analysis.

### When this narrow path should dominate
- The task objective is limited to AOMIC data staging, BIDS renaming, sidecar handling, and dataset-level metadata.
- Inputs are already local AOMIC files or AOMIC-style subject folders.
- The required deliverable is a direct staging script or command sequence, not a plan for preprocessing or downstream analysis.

### Narrow-path contract
- Do not widen the solution to preprocessing, ROI extraction, phenotype merging, or downstream analysis unless the task explicitly requires them.
- Treat this as a direct file-organization problem: scan AOMIC subject layout, normalize subject labels, map modalities to BIDS names, copy or symlink files plus matching sidecars, and write dataset-level metadata plus staging logs.
- If the task is benchmark-style, prefer a single direct end-to-end staging script over a confirmation-first orchestration plan.

### Expected narrow-path behavior
1. Detect AOMIC subject IDs (e.g., `sub-0001`) and validate BIDS compliance.
2. Detect session/task information from directory structure and filenames.
3. Route modalities:
   - T1w -> `anat/*_T1w`
   - rs-fMRI -> `func/*_task-rest_bold`
   - task-fMRI -> `func/*_task-<taskname>_bold` (emotion, gambling, motor, language, workingmemory)
4. Preserve or rename matching JSON sidecars and physiological recordings when available.
5. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`, `README`, and a manifest or skipped-file report.

---

## Core Workflow (Never Bypassed)
1. Identify user target: full AOMIC processing, specific sub-dataset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_aomic.py`.
6. Delegate sequentially or in parallel to:
   - `smri-skill` for structural MRI (T1w)
   - `fmri-skill` for functional MRI (rs-fMRI, task-fMRI)
7. If phenotype extraction is requested, run `scripts/extract_aomic_phenotype.py`.
8. If QC summary is requested, run `scripts/aomic_qc_summary.py`.
9. Save outputs into an AOMIC-centered structure under `aomic_output/`.

---

## Input Layout (Example)

Subject `sub-0001` (T1w + rs-fMRI + task-fMRI):

```
aomic_raw/
  sub-0001/
    anat/
      sub-0001_T1w.nii.gz
      sub-0001_T1w.json
    func/
      sub-0001_task-rest_bold.nii.gz
      sub-0001_task-rest_bold.json
      sub-0001_task-emotion_bold.nii.gz
      sub-0001_task-emotion_bold.json
      sub-0001_task-gambling_bold.nii.gz
      sub-0001_task-gambling_bold.json
      sub-0001_task-motor_bold.nii.gz
      sub-0001_task-motor_bold.json
      sub-0001_task-language_bold.nii.gz
      sub-0001_task-language_bold.json
  phenotype/
    big_five.csv
    ravens.csv
    demographics.csv
```

---

## BIDS Preparation

### Script: `scripts/reorganize_aomic.py`

Validates and reorganizes AOMIC data into BIDS-compliant layout.

```bash
python skills/aomic-skill/scripts/reorganize_aomic.py \
  --input /path/to/aomic_raw \
  --output /path/to/aomic_bids \
  --participants-file /path/to/aomic_raw/phenotype/demographics.csv
```

Features:
- Subject ID validation (BIDS-compliant `sub-XXXX` format)
- Session/task detection from directory structure and filenames
- Modality routing: T1w, rs-fMRI, task-fMRI (emotion, gambling, motor, language, workingmemory)
- Sidecar JSON preservation and validation
- Physiological recording file handling
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Modality Processing Delegation

After BIDS staging completes, `aomic-skill` delegates by modality:

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction, ROI morphometry | `smri_output/` derivatives and stats |
| fMRI (rs-fMRI/task-fMRI) | `fmri-skill` | preprocessing, denoising, ROI time series, connectivity, task GLM | `fmri_output/` derivatives, timeseries, connectivity |

### Delegation Strategy
- If user asks for full multimodal AOMIC analysis: run sMRI -> fMRI in ordered phases.
- If user asks for one modality only: call only the corresponding modality skill.
- Task-fMRI analysis should use task-specific event files (emotion, gambling, motor, language, workingmemory).

---

## Phenotype Extraction

### Script: `scripts/extract_aomic_phenotype.py`

Extracts and merges AOMIC phenotype tables for downstream analysis.

```bash
python skills/aomic-skill/scripts/extract_aomic_phenotype.py \
  --phenotype-dir /path/to/aomic_raw/phenotype \
  --output /path/to/aomic_output/phenotype/merged_phenotype.csv \
  --columns subject_id,age,sex,openness,conscientiousness,extraversion,agreeableness,neuroticism,ravens_score \
  --imaging-ids /path/to/aomic_output/bids/participants.tsv
```

Features:
- Reads AOMIC phenotype CSV/TSV files (Big Five, Raven's, demographics)
- Column selection and renaming
- Missing value handling (filter or impute)
- Cross-reference with imaging subject list to keep only subjects with both imaging and phenotype data
- Outputs merged CSV ready for statistical analysis or model training

---

## QC Integration

### Script: `scripts/aomic_qc_summary.py`

Generates per-subject QC summaries and exclusion lists.

```bash
python skills/aomic-skill/scripts/aomic_qc_summary.py \
  --fmriprep-dir /path/to/aomic_output/fmriprep \
  --freesurfer-dir /path/to/aomic_output/smri/freesurfer \
  --output /path/to/aomic_output/qc/qc_summary.csv \
  --exclude-output /path/to/aomic_output/qc/exclude_list.csv \
  --fd-threshold 0.3
```

Features:
- Reads fMRIPrep confounds (framewise displacement, DVARS)
- Reads FreeSurfer recon-all QC metrics
- Structural quality assessment
- Applies exclusion criteria: motion threshold (FD), structural quality
- Outputs per-subject QC summary CSV and exclusion list CSV

---

## Recommended Output Layout
All assets should be organized under `./aomic_output/`:
- `aomic_output/raw/` (downloaded original AOMIC files)
- `aomic_output/bids/` (staged BIDS data)
- `aomic_output/smri/` (links or copies from `smri_output/`)
- `aomic_output/fmri/` (links or copies from `fmri_output/`)
- `aomic_output/phenotype/` (merged phenotype tables)
- `aomic_output/qc/` (QC summaries and exclusion lists)
- `aomic_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local AOMIC data staging or organization.

- If the task starts from raw AOMIC data already present on disk and only asks for BIDS-style staging / organization:
  - skip the mandatory download stage
  - do not automatically delegate to `smri-skill` or `fmri-skill`
  - default to the narrow path `local raw AOMIC discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.
- Preserve the AOMIC-centered output contract under `aomic_output/bids/` when the task is specifically a staging benchmark.
- Only use the full multimodal orchestration and confirmation-heavy workflow when the prompt explicitly asks for download, end-to-end multimodal AOMIC processing, or post-staging structural / functional analysis.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.
- If download fails for partial subjects, continue batch with clear failure report and retry list.

---

## Important Notes and Limitations
- AOMIC data is already in BIDS format for many components; the reorganize script primarily validates and handles edge cases.
- AOMIC has multiple sub-datasets (ID1000, PIOP1, PIOP2) with slightly different task paradigms and phenotype measures.
- Task-fMRI event files (.tsv) must be preserved alongside BOLD data for proper task analysis.
- Some AOMIC components include physiological recordings (cardiac, respiration) that can be used for advanced denoising.
- `aomic-skill` is orchestration-only; detailed preprocessing logic remains in `smri-skill` and `fmri-skill`.

---

## When to Call This Skill
- User asks for end-to-end AOMIC workflow.
- User asks to process AOMIC MRI data (sMRI, rs-fMRI, task-fMRI).
- User needs BIDS staging for raw AOMIC files.
- User asks to extract and merge AOMIC phenotype tables (personality, cognition, demographics).
- User asks for AOMIC-specific QC summaries and exclusion lists.
- User needs a single entry point for AOMIC multimodal orchestration.

---

## Complementary / Related Skills
- `smri-skill`
- `fmri-skill`
- `bids-organizer`
- `fmriprep-tool`
- `freesurfer-tool`
- `nilearn-tool`
- `brain-visualization`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- AOMIC: https://nilab-uva.github.io/AOMIC.github.io/
- OpenNeuro: https://openneuro.org/
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 11:24 HKT
Last Updated At: 2026-05-06 11:24 HKT
Author: chengwang96
