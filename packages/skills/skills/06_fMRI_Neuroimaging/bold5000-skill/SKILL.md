---
name: bold5000-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the BOLD5000 dataset, including download, BIDS organization, and processing of task-fMRI data with visual image stimuli. Triggers include: 'BOLD5000', 'BOLD 5000', 'process BOLD5000', 'visual fMRI', or any request to run the BOLD5000 pipeline. This is the NeuroClaw dataset-orchestration layer for BOLD5000."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - bids-organizer
  - claw-shell
---
# BOLD5000 Skill (Dataset-Orchestration Layer)

## Overview
`bold5000-skill` is the NeuroClaw orchestration skill for the **BOLD5000** dataset.

BOLD5000 is a high-density repeated visual fMRI dataset with 8 participants performing 5,000-image visual recognition tasks. It is designed for studying visual object recognition and scene understanding.

It coordinates a fixed three-phase workflow:
1. Download BOLD5000 data from the OpenNeuro repository.
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill` and `fmri-skill`.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
BOLD5000 data is available on OpenNeuro:
- Website: https://bold5000-dataset.github.io/
- OpenNeuro: https://openneuro.org/datasets/ds002785

### Supported BOLD5000 Data Packages
- **Imaging data**: T1w structural, task-fMRI (NIfTI format)
- **Stimulus data**: 5,000 natural images with category labels and image metadata
- **Behavioral data**: Recognition memory judgments, response times
- **Participants**: 4 participants x ~1250 images each (high-density repeated measures)

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- OpenNeuro dataset download: `claw-shell` (via `openneuro` CLI or `datalad`)
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- Target subset (all subjects, specific subjects)
- Whether to include stimulus images
- Destination directory with sufficient disk space

---

## Narrow Path: BOLD5000 Raw NIfTI -> BIDS Staging

Use this path when the task only asks to reorganize raw BOLD5000 NIfTI files into a BIDS-style dataset and does not require preprocessing or downstream analysis.

### Expected narrow-path behavior
1. BOLD5000 data from OpenNeuro is already in BIDS format; verify and validate structure.
2. Route modalities:
   - T1w -> `anat/*_T1w`
   - task-fMRI -> `func/*_task-*_bold`
3. Preserve stimulus metadata and event files.
4. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`.

---

## Core Workflow (Never Bypassed)
1. Identify user target: download, BIDS staging, or full preprocessing.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, verify/prepare BIDS staging using `scripts/reorganize_bold5000.py`.
6. Delegate to modality skills:
   - `smri-skill` for structural MRI (T1w)
   - `fmri-skill` for task-fMRI
7. If stimulus analysis is requested, use `scripts/extract_bold5000_stimulus.py` to generate stimulus metadata.
8. Save outputs into a BOLD5000-centered structure under `bold5000_output/`.

---

## Stimulus Metadata Extraction

### Script: `scripts/extract_bold5000_stimulus.py`

Extracts and organizes BOLD5000 stimulus metadata for downstream analysis.

```bash
python skills/bold5000-skill/scripts/extract_bold5000_stimulus.py \
  --stimulus-dir /path/to/bold5000_raw/stimuli \
  --output /path/to/bold5000_output/stimulus/stimulus_metadata.csv
```

Features:
- Reads stimulus image file names and paths
- Extracts category labels (object, scene, etc.)
- Generates per-image metadata CSV for modeling
- Links stimulus presentation events to fMRI volumes

---

## QC Integration

### Script: `scripts/bold5000_qc_summary.py`

```bash
python skills/bold5000-skill/scripts/bold5000_qc_summary.py \
  --fmriprep-dir /path/to/bold5000_output/fmriprep \
  --output /path/to/bold5000_output/qc/qc_summary.csv \
  --fd-threshold 0.3
```

---

## Recommended Output Layout
All assets should be organized under `./bold5000_output/`:
- `bold5000_output/raw/` (downloaded original BOLD5000 files)
- `bold5000_output/bids/` (BIDS data)
- `bold5000_output/smri/` (links or copies from `smri_output/`)
- `bold5000_output/fmri/` (links or copies from `fmri_output/`)
- `bold5000_output/stimulus/` (stimulus metadata and event files)
- `bold5000_output/qc/` (QC summaries)
- `bold5000_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local BOLD5000 data staging or organization.

- If the task starts from raw BOLD5000 data already present on disk and only asks for BIDS-style staging / validation:
  - skip the mandatory download stage
  - default to the narrow path `local raw BOLD5000 discovery -> BIDS validation -> minimal metadata -> report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- BOLD5000 is a small dataset (4 participants); statistical power is limited for group-level analyses.
- BOLD5000 uses high-density repeated image presentations; analysis requires handling of repeated measures.
- BOLD5000 data from OpenNeuro is already in BIDS format; re-staging may not be needed.
- Stimulus images are included in the dataset; event files reference image file names.
- `bold5000-skill` is orchestration-only; detailed preprocessing logic remains in `smri-skill` and `fmri-skill`.

---

## When to Call This Skill
- User asks for end-to-end BOLD5000 workflow.
- User asks to download BOLD5000 data and then run task-fMRI processing.
- User needs BIDS validation for BOLD5000 data.
- User asks to extract BOLD5000 stimulus metadata.
- User needs BOLD5000-specific QC summaries.

---

## Complementary / Related Skills
- `smri-skill`
- `fmri-skill`
- `bids-organizer`
- `fmriprep-tool`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- BOLD5000: https://bold5000-dataset.github.io/
- Chang et al., 2019, *BOLD5000: A public fMRI dataset of 5,000 images*
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 01:52 HKT
Last Updated At: 2026-05-06 01:52 HKT
Author: chengwang96
