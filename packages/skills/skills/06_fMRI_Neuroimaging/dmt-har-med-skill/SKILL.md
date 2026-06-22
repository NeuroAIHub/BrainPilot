---
name: dmt-har-med-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the DMT-HAR-MED dataset (ds006644), including download, BIDS organization, and processing of rs-fMRI data from a psychedelic intervention study. Triggers include: 'DMT-HAR-MED', 'DMT HAR MED', 'ds006644', 'process DMT data', 'psychedelic fMRI', or any request to run the DMT-HAR-MED pipeline. This is the NeuroClaw dataset-orchestration layer for DMT-HAR-MED."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - fmri-skill
  - bids-organizer
  - claw-shell
---
# DMT-HAR-MED Skill (Dataset-Orchestration Layer)

## Overview
`dmt-har-med-skill` is the NeuroClaw orchestration skill for the **DMT-HAR-MED** dataset (OpenNeuro ds006644).

DMT-HAR-MED contains rs-fMRI data from 40 participants in a psychedelic intervention study investigating the effects of N,N-Dimethyltryptamine (DMT) on brain function. The dataset includes multiple experimental conditions (DMT, placebo) and behavioral/physiological measurements.

It coordinates a fixed three-phase workflow:
1. Download DMT-HAR-MED data from OpenNeuro.
2. Prepare and validate BIDS-style data organization.
3. Delegate fMRI processing to `fmri-skill`.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract DMT-HAR-MED phenotype data (intervention conditions, behavioral measures).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
DMT-HAR-MED data is available on OpenNeuro:
- Website: https://openneuro.org/datasets/ds006644/versions/1.0.1

### Supported DMT-HAR-MED Data Packages
- **Imaging data**: rs-fMRI (NIfTI format)
- **Phenotype data**: intervention conditions, behavioral and physiological measurements
- **Participants**: 40 participants with psychedelic intervention

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- OpenNeuro dataset download: `claw-shell` (via `openneuro` CLI or `datalad`)
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- Subject list scope (full or custom subset)
- Destination directory with sufficient disk space

---

## Core Workflow (Never Bypassed)
1. Identify user target: download, BIDS staging, or full preprocessing.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, verify/prepare BIDS staging using `scripts/reorganize_dmt_har_med.py`.
6. Delegate to `fmri-skill` for rs-fMRI processing.
7. If phenotype extraction is requested, run `scripts/extract_dmt_har_med_phenotype.py`.
8. If QC summary is requested, run `scripts/dmt_har_med_qc_summary.py`.
9. Save outputs into a DMT-HAR-MED-centered structure under `dmt_har_med_output/`.

---

## BIDS Preparation

### Script: `scripts/reorganize_dmt_har_med.py`

Verifies and optionally reorganizes DMT-HAR-MED data to BIDS-compliant layout.

```bash
python skills/dmt-har-med-skill/scripts/reorganize_dmt_har_med.py \
  --input /path/to/dmt_har_med_raw \
  --output /path/to/dmt_har_med_bids
```

Features:
- BIDS validation and verification
- Subject ID normalization
- Modality routing: rs-fMRI
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview

---

## Phenotype Extraction

### Script: `scripts/extract_dmt_har_med_phenotype.py`

```bash
python skills/dmt-har-med-skill/scripts/extract_dmt_har_med_phenotype.py \
  --phenotype-dir /path/to/dmt_har_med_raw/phenotype \
  --output /path/to/dmt_har_med_output/phenotype/merged_phenotype.csv \
  --imaging-ids /path/to/dmt_har_med_output/bids/participants.tsv
```

---

## QC Integration

### Script: `scripts/dmt_har_med_qc_summary.py`

```bash
python skills/dmt-har-med-skill/scripts/dmt_har_med_qc_summary.py \
  --fmriprep-dir /path/to/dmt_har_med_output/fmriprep \
  --output /path/to/dmt_har_med_output/qc/qc_summary.csv \
  --exclude-output /path/to/dmt_har_med_output/qc/exclude_list.csv \
  --fd-threshold 0.3
```

---

## Recommended Output Layout
All assets should be organized under `./dmt_har_med_output/`:
- `dmt_har_med_output/raw/` (downloaded original files)
- `dmt_har_med_output/bids/` (BIDS data)
- `dmt_har_med_output/fmri/` (links or copies from `fmri_output/`)
- `dmt_har_med_output/phenotype/` (merged phenotype tables)
- `dmt_har_med_output/qc/` (QC summaries and exclusion lists)
- `dmt_har_med_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local DMT-HAR-MED data staging or organization.

- If the task starts from raw DMT-HAR-MED data already present on disk and only asks for BIDS-style staging / validation:
  - skip the mandatory download stage
  - default to the narrow path `local raw DMT-HAR-MED discovery -> BIDS validation -> minimal metadata -> report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- DMT-HAR-MED is a specialized psychedelic intervention dataset; analysis requires domain expertise.
- DMT-HAR-MED data from OpenNeuro is already in BIDS format; re-staging may not be needed.
- The dataset includes multiple experimental conditions; event files define condition timing.
- DMT-HAR-MED includes only rs-fMRI; no structural (T1w) or diffusion data is available.
- `dmt-har-med-skill` is orchestration-only; detailed preprocessing logic remains in `fmri-skill`.

---

## When to Call This Skill
- User asks for end-to-end DMT-HAR-MED workflow.
- User asks to download DMT-HAR-MED data and then run rs-fMRI processing.
- User needs BIDS validation for DMT-HAR-MED data.
- User asks to extract DMT-HAR-MED phenotype data.
- User needs DMT-HAR-MED-specific QC summaries.

---

## Complementary / Related Skills
- `fmri-skill`
- `bids-organizer`
- `fmriprep-tool`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- DMT-HAR-MED: https://openneuro.org/datasets/ds006644/versions/1.0.1
- BIDS spec: https://bids.neuroimaging.io/

Created At: 2026-05-06 01:56 HKT
Last Updated At: 2026-05-06 01:56 HKT
Author: chengwang96
