---
name: adni-skill
description: "Use this skill whenever the user wants an end-to-end workflow for ADNI data (fMRI + T1), including BIDS preparation, fMRIPrep preprocessing, and DK68 ROI pipeline. This is the NeuroClaw dataset-orchestration layer for ADNI."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - bids-organizer
  - fmriprep-tool
  - claw-shell
---
# ADNI Skill (Dataset-Orchestration Layer)

## Overview
`adni-skill` is the NeuroClaw orchestration skill for ADNI subject-level fMRI + T1 workflows.

It supports two distinct usage modes:
1. A narrow ADNI raw NIfTI -> BIDS staging path.
2. A full downstream ADNI workflow path (BIDS + fMRIPrep + DK68 ROI extraction).

It coordinates a fixed two-stage pipeline:
1. Prepare ADNI data into BIDS and run fMRIPrep.
2. Run DK68 ROI extraction with QC.

It also provides an **optional VQA generation path** for VLM use cases:
- Reorganize ADNI data and convert DICOM to NIfTI.
- Generate task labels (task1-task5).
- Generate VQA pairs from task outputs.

This skill follows NeuroClaw hierarchy:
- Defines **WHAT to do**, not low-level implementation details.
- Does **not** execute direct shell commands itself.
- Delegates all execution via `claw-shell` to tool skills.

**Research use only.**

---

## Narrow Path: ADNI Raw NIfTI -> BIDS Staging

Use this path when the task only asks to reorganize raw ADNI NIfTI files into a BIDS-style dataset and does not require preprocessing, ROI extraction, VQA generation, EEG handling, or DICOM conversion.

### When this narrow path should dominate
- The task objective is limited to ADNI NIfTI staging, BIDS renaming, sidecar handling, and dataset-level metadata.
- Inputs are already local ADNI NIfTI files or ADNI-style subject/date folders.
- The required deliverable is a direct staging script or command sequence, not a plan for fMRIPrep or downstream analysis.

### Narrow-path contract
- Do not widen the solution to fMRIPrep, DK68, VQA, EEG, or generic multi-modality BIDS conversion unless the task explicitly requires them.
- Treat this as a direct file-organization problem: scan ADNI subject/session layout, normalize subject and visit labels, map modalities to BIDS names, copy or symlink NIfTI plus matching sidecars, and write dataset-level metadata plus staging logs.
- If the task is benchmark-style, prefer a single direct end-to-end staging script over a confirmation-first orchestration plan.

### Expected narrow-path behavior
1. Detect ADNI-style subject IDs such as `130_S_0969` and normalize them to deterministic BIDS labels such as `sub-130S0969`.
2. Detect visit/date information and normalize it to a deterministic session label such as `ses-M00` or `ses-YYYYMMDD` according to the task contract.
3. Route modalities narrowly:
  - T1/MPRAGE/SPGR -> `anat/*_T1w`
  - T2 -> `anat/*_T2w`
  - FLAIR -> `anat/*_FLAIR`
  - rs-fMRI/fMRI/BOLD -> `func/*_task-rest_bold`
  - DTI/DWI only if explicitly present in the raw ADNI NIfTI inputs
4. Preserve or rename matching JSON sidecars when available; if metadata is absent, create only the minimal dataset files required by the task and log the limitation.
5. Emit dataset-level outputs such as `dataset_description.json`, `participants.tsv`, `README`, and a manifest or skipped-file report when the task expects staging auditability.

### Important restriction for narrow staging tasks
For ADNI raw NIfTI -> BIDS staging tasks, do not let the broader full-workflow examples below pull the answer into fMRIPrep, DK68 ROI extraction, VQA generation, EEG tooling, or DICOM conversion. Those are separate paths, not the mainline.

---

## Core Workflow (Never Bypassed)
1. Confirm subject ID and modalities (T1 + fMRI).
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, prepare BIDS staging and run fMRIPrep.
5. After fMRIPrep success, run DK68 ROI pipeline with QC.
6. If VQA generation is requested, run the three VQA scripts and save outputs.
7. Save outputs into an ADNI-centered structure under `adni_output/`.

---

## Input Layout (Example)

Subject `130_S_0969` (fMRI + T1):

```
nifti/130_S_0969/T1/I10308298_..._3.nii.gz
nifti/130_S_0969/T1/I10308298_..._3.json
nifti/130_S_0969/fMRI/I10308297_..._8.nii.gz
nifti/130_S_0969/fMRI/I10308297_..._8.json
```

---

## BIDS Preparation (Stage A-C)

### Stage A: Prepare BIDS root metadata
Create `dataset_description.json` under the BIDS root:

```json
{
  "Name": "ADNI rsfMRI T1 subset",
  "BIDSVersion": "1.8.0",
  "DatasetType": "raw"
}
```

### Stage B: Create BIDS directories

```bash
mkdir -p bids/sub-130S0969/ses-M00/anat
mkdir -p bids/sub-130S0969/ses-M00/func
```

### Stage C: Copy and rename NIfTI + JSON

T1w:

```bash
cp "nifti/130_S_0969/T1/"*.nii.gz \
  "bids/sub-130S0969/ses-M00/anat/sub-130S0969_ses-M00_T1w.nii.gz"

cp "nifti/130_S_0969/T1/"*.json \
  "bids/sub-130S0969/ses-M00/anat/sub-130S0969_ses-M00_T1w.json"
```

fMRI:

```bash
cp "nifti/130_S_0969/fMRI/"*.nii.gz \
  "bids/sub-130S0969/ses-M00/func/sub-130S0969_ses-M00_task-rest_bold.nii.gz"

cp "nifti/130_S_0969/fMRI/"*.json \
  "bids/sub-130S0969/ses-M00/func/sub-130S0969_ses-M00_task-rest_bold.json"
```

---

## fMRIPrep Stage (Stage D)

### Typical Docker run

```bash
docker run --rm -it \
  -v /path/to/ADNI_Datasets/bids:/data:ro \
  -v /path/to/ADNI_Datasets/fmriprep_out:/out \
  -v /path/to/ADNI_Datasets/fmriprep_work:/work \
  -v /path/to/freesurfer:/fs \
  nipreps/fmriprep:23.2.1 \
  /data /out participant \
  --participant-label 130S0969 \
  --fs-license-file /fs/license.txt \
  --output-spaces T1w \
  --work-dir /work \
  --clean-workdir
```

fMRIPrep handles:
- BIDS ingestion and validation
- T1/fMRI pairing checks
- FreeSurfer surface reconstruction
- fMRI preprocessing (slice timing, motion correction)
- BOLD-to-T1 registration
- T1w-space outputs

---

## DK68 Pipeline Stage

Pipeline behavior:
1. TR auto-read from `desc-preproc_bold.json` and used for band-pass timing
2. Drop initial TRs (default `drop-first-trs = 4`, configurable)
3. Confounds auto-select: `trans_*`, `rot_*`, `white_matter`, `csf`, `framewise_displacement`
   - Fallback: motion-only columns if missing
4. DK68 ROI order fixed: left hemisphere then right hemisphere
5. Resample DK labels to BOLD space with nearest-neighbor
6. ROI-level regression of confounds (motion/WM/CSF)
7. ROI-level band-pass filtering: 0.01 - 0.08 Hz
8. ROI-level z-score normalization over time
   - $z(t) = (x(t) - mu) / sigma$
9. QC output: mean FD / max FD (after TR drop), optional DVARS

Run command:

```bash
python run_dk68_pipeline_qc.py \
  --base /path/to/ADNI_Datasets \
  --sub 130S0969 \
  --ses M00 \
  --drop-first-trs 4
```

---

## Optional: VQA Generation (for VLM)

This path uses the reference scripts under `skills/adni-skill/scripts/`:
- `reorganize_adni.py`
- `generate_adni_task_files.py`
- `generate_vqa_from_tasks.py`

If your ADNI data follows the **direct ADNI download layout**, these scripts can be used directly. Otherwise, adjust paths and assumptions in the scripts to match your local layout.

### VQA Task Chain
**(1) Anatomical & Imaging Assessment -> (2) Lesion Identification & Localization -> (3) Diagnostic Synthesis -> (4) Prognostic Judgment & Risk Forecasting -> (5) Therapeutic Cycle Management**

### Quick Usage (Three Scripts)
Run the following commands under the ADNI root (example: `data/omnibrainbench_extend`):

1) Reorganize ADNI and convert DICOM to NIfTI

```bash
python reorganize_adni.py --cmd dcm2niix
```

Optional cleanup after conversion:

```bash
python reorganize_adni.py --cmd dcm2niix --cleanup
```

2) Generate task label files (task1-task5)

```bash
python generate_adni_task_files.py --root . --outdir task_outputs
```

By default this does not execute task1 (FreeSurfer) or task4 (WMH) segmentation; it only checks eligibility and writes CSV/shell commands.

Run task1 now:

```bash
python generate_adni_task_files.py --root . --outdir task_outputs --run-task1
```

Run task4 now:

```bash
python generate_adni_task_files.py --root . --outdir task_outputs --run-task4
```

Run task1 and task4 together:

```bash
python generate_adni_task_files.py --root . --outdir task_outputs --run-task1 --run-task4
```

3) Generate VQA pairs from task outputs

```bash
python generate_vqa_from_tasks.py --task-dir task_outputs --outdir vqa_outputs
```

### Data Preparation Notes
Expected per-subject layout for the VQA scripts:

```
ADNI_ROOT/
  sub-0001/
    T1.nii
    FLAIR.nii
  sub-0002/
    T1.nii
    FLAIR.nii
```

Convert DICOM to NIfTI with `dcm2niix`, then rename outputs to `T1.nii` and `FLAIR.nii`:

```bash
dcm2niix -z y -o /path/to/output_nifti /path/to/input_dicom_folder
```

---

### Label Sources Used by VQA

1) Anatomical structure identification (FreeSurfer)
- Dataset: UCSF - Cross-Sectional FreeSurfer (7.x) [ADNI1, GO, 2, 3, 4]
- CSV: `UCSFFSX7_03Mar2026.csv`
- QC filter: keep `OVERALLQC = 1`

2) Imaging modality identification
- `T1.nii` -> T1W
- `FLAIR.nii` -> FLAIR
- `PD.nii` -> PD

3) Disease/abnormality diagnosis (cognitive status)
- Table: Diagnostic Summary [ADNI1, GO, 2, 3, 4]
- CSV: `DXSUM_03Mar2026.csv`
- Label mapping: `1 = CN`, `2 = MCI`, `3 = Dementia`

4) Lesion localization (WMH segmentation)
Use MARS-WMH nnU-Net (Docker):

```bash
docker pull ghcr.io/miac-research/wmh-nnunet:latest
docker tag ghcr.io/miac-research/wmh-nnunet:latest mars-wmh-nnunet:latest
docker run --rm --gpus all -v $(pwd):/data mars-wmh-nnunet:latest --flair /data/FLAIR.nii --t1 /data/T1w.nii
```

5) Risk forecasting and treatment-related labels (longitudinal)
- Group records by subject ID across multiple visits
- Track diagnosis changes (e.g., CN -> MCI, MCI -> Dementia) for progression risk labels

---

## Recommended Output Layout
All assets should be organized under `./adni_output/`:
- `adni_output/bids/` (staged BIDS data)
- `adni_output/fmriprep/` (fMRIPrep derivatives)
- `adni_output/dk68/` (ROI CSVs)
- `adni_output/qc/` (QC metrics)
- `adni_output/vqa/` (VQA task outputs)
- `adni_output/logs/`

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- ADNI subject naming must be normalized (e.g., `130_S_0969` -> `130S0969`).
- fMRIPrep requires FreeSurfer license and sufficient disk space.
- DK68 pipeline assumes `aparc+aseg.mgz` is available in fMRIPrep outputs.
- VQA scripts assume a subject-per-folder layout; adapt scripts if your ADNI organization differs.

---

## When to Call This Skill
- User asks for ADNI end-to-end processing (fMRI + T1).
- User needs BIDS staging + fMRIPrep + DK68 ROI outputs.
- User requests VQA generation for VLM from ADNI.

---

## Complementary / Related Skills
- `bids-organizer`
- `fmriprep-tool`
- `freesurfer-tool`
- `fmri-skill`
- `smri-skill`
- `dependency-planner`
- `conda-env-manager`
- `claw-shell`

---

## Reference
- fMRIPrep: https://fmriprep.org/
- BIDS spec: https://bids.neuroimaging.io/
- OmniBrainBench: https://github.com/CUHK-AIM-Group/OmniBrainBench

Created At: 2026-03-28 20:38 HKT
Last Updated At: 2026-03-28 20:38 HKT
Author: chengwang96