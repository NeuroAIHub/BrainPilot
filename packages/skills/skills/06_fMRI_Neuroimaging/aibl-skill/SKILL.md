---
name: aibl-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the AIBL (Australian Imaging, Biomarkers and Lifestyle) dataset, including data access guidance, BIDS organization, and multimodal processing of sMRI and PET (PiB, FDG, tau). Triggers include: 'AIBL', 'AIBL data', 'process AIBL', 'AIBL PET', 'AIBL MRI', or any request to run the AIBL multimodal pipeline. This is the NeuroClaw dataset-orchestration layer for AIBL."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - pet-skill
---
# AIBL Skill (Dataset-Orchestration Layer)

## Overview
`aibl-skill` is the NeuroClaw orchestration skill for the **AIBL (Australian Imaging, Biomarkers and Lifestyle)** dataset.

It coordinates a fixed three-phase workflow:
1. Guide AIBL data access and download from the AIBL research portal.
2. Prepare and validate BIDS-style data organization for downstream processing.
3. Delegate modality pipelines to `smri-skill` for structural MRI and PET processing.

It also provides **phenotype extraction** and **QC integration** paths:
- Extract and merge AIBL phenotype tables (cognitive assessments, blood biomarkers, APOE genotype, lifestyle data).
- Generate per-subject QC summaries with exclusion lists.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to base/tool skills.

**Research use only.**

---

## Download Stage (Mandatory First Step)

### Source
AIBL data is distributed through the **AIBL research portal**:
- Website: https://aibl.csiro.au/
- Data access: requires registration and data use agreement
- Imaging data available via LONI Image Data Archive (IDA): https://ida.loni.usc.edu/

### Supported AIBL Data Packages
- **Imaging data**: T1w MRI, PET (PiB amyloid, FDG metabolism, tau)
- **Phenotype data**: cognitive assessments (CDR, MMSE, MoCA, ADAS-Cog), blood biomarkers (Aβ42, Aβ40, p-tau, NfL), APOE genotype, lifestyle and demographic data
- **Derived imaging data**: FreeSurfer outputs (if available)

### Delegation Rules for Download
- Environment/setup checks: `dependency-planner` + `conda-env-manager`
- LONI IDA download tool installation and execution: `claw-shell`
- Optional raw-data organization to BIDS-style staging: `bids-organizer`

### Download Inputs to Confirm in Plan
- LONI IDA credentials/authorized access
- Target data package (imaging only, phenotype only, or both)
- Subject list scope (full cohort or custom subset)
- AIBL phase (screening, baseline, 18-month, 36-month, 54-month, etc.)
- Destination directory with sufficient disk space

---

## Narrow Path: AIBL Raw Data -> BIDS Staging

Use this path when the task only asks to reorganize raw AIBL files into a BIDS-style dataset and does not require preprocessing, ROI extraction, phenotype merging, or downstream analysis.

### When this narrow path should dominate
- The task objective is limited to AIBL data staging, BIDS renaming, sidecar handling, and dataset-level metadata.
- Inputs are already local AIBL files or AIBL-style subject/date folders.
- The required deliverable is a direct staging script or command sequence, not a plan for preprocessing or downstream analysis.

### Narrow-path contract
- Do not widen the solution to preprocessing, ROI extraction, phenotype merging, or downstream analysis unless the task explicitly requires them.
- Treat this as a direct file-organization problem: scan AIBL subject/session layout, normalize subject labels, map modalities to BIDS names, copy or symlink files plus matching sidecars, and write dataset-level metadata plus staging logs.
- If the task is benchmark-style, prefer a single direct end-to-end staging script over a confirmation-first orchestration plan.

### Expected narrow-path behavior
1. Detect AIBL-style subject IDs (e.g., `002_S_0295`) and normalize to BIDS labels such as `sub-002S0295`.
2. Detect visit/timepoint information and normalize to session labels such as `ses-screening`, `ses-baseline`, `ses-18month`, etc.
3. Route modalities:
   - T1w/MPRAGE -> `anat/*_T1w`
   - PET PiB -> `pet/*_pet` (tracer: PiB)
   - PET FDG -> `pet/*_pet` (tracer: FDG)
   - PET tau -> `pet/*_pet` (tracer: tau)
4. Preserve or rename matching JSON sidecars when available; if metadata is absent, create only the minimal dataset files required by the task and log the limitation.
5. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`, `README`, and a manifest or skipped-file report.

---

## Core Workflow (Never Bypassed)
1. Identify user target: full AIBL processing, imaging subset, phenotype extraction, or BIDS staging only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run download stage first (if needed).
5. After download success, run BIDS preparation using `scripts/reorganize_aibl.py`.
6. Delegate to `smri-skill` for structural MRI processing (brain extraction, tissue segmentation, cortical reconstruction).
7. If PET processing is requested, handle PET-specific preprocessing (spatial normalization, SUVR computation).
8. If phenotype extraction is requested, run `scripts/extract_aibl_phenotype.py`.
9. If QC summary is requested, run `scripts/aibl_qc_summary.py`.
10. Save outputs into an AIBL-centered structure under `aibl_output/`.

---

## Input Layout (Example)

Subject `002_S_0295` (T1w + PET):

```
aibl_raw/
  002_S_0295/
    screening/
      T1/
        002_S_0295_T1.nii.gz
        002_S_0295_T1.json
      PET_PiB/
        002_S_0295_PET_PiB.nii.gz
        002_S_0295_PET_PiB.json
      PET_FDG/
        002_S_0295_PET_FDG.nii.gz
        002_S_0295_PET_FDG.json
  phenotype/
    cognitive_assessments.csv
    blood_biomarkers.csv
    apoe_genotype.csv
    demographics.csv
```

---

## BIDS Preparation

### Script: `scripts/reorganize_aibl.py`

Converts AIBL raw directory structure to BIDS-compliant layout.

```bash
python skills/aibl-skill/scripts/reorganize_aibl.py \
  --input /path/to/aibl_raw \
  --output /path/to/aibl_bids \
  --participants-file /path/to/aibl_raw/phenotype/demographics.csv
```

Features:
- Subject ID normalization: AIBL format to BIDS `sub-002S0295`
- Session mapping: AIBL visit names to BIDS `ses-` labels
- Modality routing: T1w, PET (PiB, FDG, tau)
- Sidecar JSON preservation and validation
- `dataset_description.json` and `participants.tsv` generation
- Dry-run mode: `--dry-run` to preview without copying

---

## Modality Processing Delegation

After BIDS staging completes, `aibl-skill` delegates by modality:

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction, ROI morphometry | `smri_output/` derivatives and stats |
| PET (PiB/FDG/tau) | `pet-skill` | spatial normalization to template, SUVR computation, reference region quantification | `pet_output/` SUVR maps and ROI values |

### Delegation Strategy
- If user asks for full multimodal AIBL analysis: run sMRI -> PET in ordered phases.
- If user asks for one modality only: call only the corresponding modality skill.
- PET processing typically requires co-registration to T1w first, then normalization to standard space.

---

## Phenotype Extraction

### Script: `scripts/extract_aibl_phenotype.py`

Extracts and merges AIBL phenotype tables for downstream analysis.

```bash
python skills/aibl-skill/scripts/extract_aibl_phenotype.py \
  --phenotype-dir /path/to/aibl_raw/phenotype \
  --output /path/to/aibl_output/phenotype/merged_phenotype.csv \
  --columns subject_id,visit,diagnosis,age,sex,mmse,cdr,apoe \
  --imaging-ids /path/to/aibl_output/bids/participants.tsv
```

Features:
- Reads AIBL phenotype CSV/TSV files (cognitive, biomarker, genetic, demographic)
- Column selection and renaming
- Visit alignment (screening, baseline, 18-month, 36-month, 54-month)
- Missing value handling (filter or impute)
- Cross-reference with imaging subject list to keep only subjects with both imaging and phenotype data
- Diagnostic group classification: healthy controls (HC), mild cognitive impairment (MCI), Alzheimer's disease (AD)
- Outputs merged CSV ready for statistical analysis or model training

---

## QC Integration

### Script: `scripts/aibl_qc_summary.py`

Generates per-subject QC summaries and exclusion lists.

```bash
python skills/aibl-skill/scripts/aibl_qc_summary.py \
  --fmriprep-dir /path/to/aibl_output/fmriprep \
  --freesurfer-dir /path/to/aibl_output/smri/freesurfer \
  --output /path/to/aibl_output/qc/qc_summary.csv \
  --exclude-output /path/to/aibl_output/qc/exclude_list.csv \
  --fd-threshold 0.3
```

Features:
- Reads fMRIPrep confounds (if fMRI data available)
- Reads FreeSurfer recon-all QC metrics
- Structural quality assessment (motion artifacts, coverage)
- Applies exclusion criteria: motion threshold (FD), structural quality
- Outputs per-subject QC summary CSV and exclusion list CSV

---

## Recommended Output Layout
All assets should be organized under `./aibl_output/`:
- `aibl_output/raw/` (downloaded original AIBL files)
- `aibl_output/bids/` (staged BIDS data)
- `aibl_output/smri/` (links or copies from `smri_output/`)
- `aibl_output/pet/` (PET processing outputs)
- `aibl_output/phenotype/` (merged phenotype tables)
- `aibl_output/qc/` (QC summaries and exclusion lists)
- `aibl_output/logs/` (download + orchestration logs)

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full `download -> staging -> multimodal processing` orchestration when the task is only asking for local AIBL data staging or organization.

- If the task starts from raw AIBL data already present on disk and only asks for BIDS-style staging / organization:
  - skip the mandatory download stage
  - do not automatically delegate to `smri-skill`
  - default to the narrow path `local raw AIBL discovery -> BIDS-style staging -> minimal metadata -> validation/report`
- In benchmark mode, do not require explicit confirmation before presenting the direct staging solution.
- Preserve the AIBL-centered output contract under `aibl_output/bids/` when the task is specifically a staging benchmark.
- Only use the full multimodal orchestration and confirmation-heavy workflow when the prompt explicitly asks for download, end-to-end multimodal AIBL processing, or post-staging structural / PET analysis.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.
- If download fails for partial subjects, continue batch with clear failure report and retry list.

---

## Important Notes and Limitations
- AIBL imaging data includes both structural MRI and multiple PET tracers (PiB, FDG, tau). PET processing requires tracer-specific workflows.
- LONI IDA download requires authenticated access and compliance with the AIBL Data Use Agreement.
- AIBL subject IDs follow the format `XXX_S_XXXX`; normalization to BIDS labels must be consistent across all stages.
- AIBL has multiple follow-up timepoints (screening through 54-month); session handling must account for longitudinal structure.
- AIBL phenotype tables may use different delimiter formats across releases; auto-detection is recommended.
- PET SUVR computation requires reference region definition (e.g., cerebellar cortex for PiB, pons for FDG).
- `aibl-skill` is orchestration-only; detailed preprocessing logic remains in `smri-skill` and PET processing tools.

---

## When to Call This Skill
- User asks for end-to-end AIBL workflow.
- User asks to process AIBL MRI and/or PET data.
- User needs BIDS staging for raw AIBL files.
- User asks to extract and merge AIBL phenotype tables (cognitive, biomarker, genetic).
- User asks for AIBL-specific QC summaries and exclusion lists.
- User needs a single entry point for AIBL multimodal orchestration.

---

## Complementary / Related Skills
- `smri-skill`
- `pet-skill` → PET processing (SUVR computation, tracer-specific reference regions, partial volume correction)
- `bids-organizer`
- `freesurfer-tool`
- `nibabel-skill`
- `brain-visualization`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- AIBL Study: https://aibl.csiro.au/
- LONI IDA: https://ida.loni.usc.edu/
- BIDS spec: https://bids.neuroimaging.io/
- BIDS PET extension: https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/09-positron-emission-tomography.html

Created At: 2026-05-06 11:24 HKT
Last Updated At: 2026-05-06 12:19 HKT
Author: chengwang96
