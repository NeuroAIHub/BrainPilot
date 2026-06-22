---
name: fmri-skill
description: "Use this skill whenever the user wants to perform fMRI preprocessing, first-level analysis, ROI extraction, functional connectivity, effective connectivity, or atlas-based alignment to MNI152 space using either fMRIPrep, HCP-style pipelines, or CONN Toolbox. Triggers include: 'fmri', 'fMRI analysis', 'functional connectivity', 'effective connectivity', 'ROI extraction', 'seed-based correlation', 'PPI', 'DCM', 'atlas alignment', 'MNI152', 'HCP pipeline', 'CONN toolbox', or any request involving BOLD data."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: modality
dependencies:
  - fmriprep-tool
  - hcppipeline-tool
  - conn-tool
  - fsl-tool
  - bids-organizer
  - claw-shell
complementary_skills:
  - smri-skill
  - dwi-skill
---
# fMRI Skill (Modality Layer)

## Overview

`fmri-skill` is the NeuroClaw **modality-layer** interface skill responsible for all fMRI data processing and analysis tasks.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills: `fmriprep-tool`, `hcppipeline-tool`, `conn-tool`, `fsl-tool`, `bids-organizer`, and `claw-shell`.

**Core workflow (never bypassed):**
1. Identify input data (BIDS dataset or preprocessed BOLD files).
2. Generate a **numbered execution plan** that clearly states WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation (“YES” / “execute” / “proceed”).
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`fmri_output/`).

## Benchmark-Facing Default Mainline

For benchmark-style prompts, choose the narrowest task-faithful fMRI route first and do not widen into unrelated branches just because multiple downstream tools are available.

- If the prompt is task fMRI or mentions events, contrasts, design matrices, conditions, first-level, second-level, FEAT, cope, or z-stat maps:
  - Default to `BIDS -> fMRIPrep -> first-level GLM -> group-level GLM if requested`.
  - Keep the answer on the GLM/statistical path.
  - Do not introduce resting-state connectivity, CONN, PPI, DCM, or EEG branches unless the prompt explicitly asks for them.
- If the prompt is resting-state or asks for ROI time series / connectivity:
  - Default to `BIDS -> fMRIPrep -> XCP-D or ROI/connectivity extraction`.
  - Do not introduce task-GLM steps unless the prompt explicitly asks for task analysis.
  - If the prompt is an ADNI-like or other raw-data resting-state benchmark, keep the answer on the narrow mainline `raw data -> minimal BIDS organization -> fMRIPrep -> resting-state ROI/connectivity outputs`.
  - Do not expand the primary solution into EEG branches, CONN, effective connectivity, or broad multimodal orchestration unless the prompt explicitly asks for those branches.
- If required task-fMRI inputs such as `events.tsv`, contrasts, or condition timing are missing:
  - State `Missing required input` explicitly.
  - Do not silently switch the task into a resting-state pipeline.
- Do not delegate to unrelated modality skills such as EEG for fMRI-only tasks.
- In benchmark mode, do not make environment creation, broad project scaffolding, or long installation/setup sections the center of the answer when the task is asking for the executable imaging mainline.

When multiple fMRI routes are possible, prefer one explicit mainline plus a short note about blocked optional branches rather than a multi-branch menu inside the primary solution.

**Research use only.**

## Quick Reference (Common fMRI Tasks – Updated 2026-03-28)

| Task                              | What needs to be done                                      | Delegate to which tool skill                          | Expected output                          |
|-----------------------------------|------------------------------------------------------------|-------------------------------------------------------|------------------------------------------|
| BIDS organization                 | Convert raw DICOM/NIfTI into valid BIDS structure (dataset_description.json + proper naming) | `bids-organizer`                                      | BIDS-compliant dataset with metadata     |
| Standardized preprocessing (fMRIPrep) | Motion correction, slice timing, distortion correction, coregistration to T1w, FreeSurfer integration | `fmriprep-tool`                                       | Preprocessed BOLD in native/T1w space + anatomical derivatives |
| Post-processing denoising (XCP-D) | Spatial smoothing, band-pass filtering (0.01–0.08 Hz), nuisance regression (36P model), scrubbing (FD > 0.2mm) | `fmriprep-tool` (XCP-D integration)                  | Clean 4D BOLD + ROI timeseries (.tsv) + functional connectivity matrices |
| High-quality HCP-style preprocessing | Structural + functional (ICA-FIX) + diffusion + MSMAll surface alignment | `hcppipeline-tool`                                   | HCP-style preprocessed data              |
| Atlas alignment to T1w / MNI152   | Register functional/anatomical data to T1w native or MNI152 template | `fmriprep-tool` or `hcppipeline-tool`                | Data in T1w or MNI152 space              |
| ROI time-series extraction        | Extract mean/spatial ROI time-series from atlas-defined ROIs (e.g., Schaefer, Glasser, Gordon, Tian) | `fmriprep-tool` (XCP-D) or `nilearn-tool`           | ROI timeseries (TSV / CSV / .npy)        |
| Functional connectivity (clean)   | Compute Pearson correlation matrices from denoised ROI time-series (after XCP-D) | Post-XCP-D analysis or `conn-tool`                 | Whole-brain connectivity matrices, networks |
| Effective connectivity            | Psychophysiological Interaction (PPI/gPPI), Granger causality, Dynamic Causal Modeling (DCM) | `fsl-tool` or `conn-tool`                            | PPI maps, causality matrices, DCM parameters |
| First-level GLM (task-based)      | Task regressors + contrast estimation                      | `fsl-tool` (FEAT)                                     | Z-stat maps, cope files                  |
| Group-level analysis              | Second-level statistics across subjects                    | `fsl-tool` (randomise / FEAT)                         | Group statistical maps                   |
| Full ADNI-style rsfMRI pipeline   | BIDS → fMRIPrep → XCP-D → connectivity analysis (resting state optimized) | `bids-organizer` + `fmriprep-tool` + `fmriprep-tool` (XCP-D) | Clean BOLD + timeseries + connectivity matrices + QC |
| Advanced connectivity (CONN)      | ROI-to-ROI, seed-to-voxel, ICA networks, PPI/gPPI, DCM    | `conn-tool`                                           | Comprehensive connectivity results       |

## Installation (Handled by dependency-planner)

No manual installation required at this layer.  
When first used, `fmri-skill` automatically calls `dependency-planner` to ensure `fmriprep-tool`, `hcppipeline-tool`, `conn-tool`, `fsl-tool`, and `bids-organizer` are ready.

## Complete ADNI-Style rsfMRI Processing Workflow

### Recommended 3-Stage Processing Pipeline
For resting-state fMRI datasets (like ADNI), the most validated workflow combines **fMRIPrep** (preprocessing) + **XCP-D** (denoising/post-processing):

#### **Stage 1: BIDS Data Preparation** (via `bids-organizer`)
Input: Raw NIfTI files from DICOM conversion (e.g., `nifti/130_S_0969/T1/` and `nifti/130_S_0969/fMRI/`)

Tasks:
1. Create `dataset_description.json` at BIDS root:
   ```json
   {
     "Name": "ADNI rsfMRI T1 subset",
     "BIDSVersion": "1.8.0",
     "DatasetType": "raw"
   }
   ```
2. Create BIDS directory structure:
   ```
   bids/sub-130S0969/ses-M00/anat/
   bids/sub-130S0969/ses-M00/func/
   ```
3. Copy and rename files following BIDS convention:
   - T1w: `sub-130S0969_ses-M00_T1w.nii.gz` + `sub-130S0969_ses-M00_T1w.json`
   - fMRI (resting): `sub-130S0969_ses-M00_task-rest_bold.nii.gz` + `sub-130S0969_ses-M00_task-rest_bold.json`

Output: Valid BIDS-structured `bids/` directory

#### **Stage 2: Preprocessing with fMRIPrep** (via `fmriprep-tool`)
Input: BIDS directory from Stage 1

Key Operations:
- Run FreeSurfer on T1w (structural preprocessing)
- Slice timing correction on BOLD
- Motion correction (frame-to-frame realignment)
- BOLD → T1w registration
- (Optional) T1w → MNI152 registration

Command structure (Docker):
```bash
docker run --rm -it \
  -v <BIDS_PATH>:/data:ro \
  -v <OUTPUT_PATH>:/out \
  -v <WORK_PATH>:/work \
  -v <FREESURFER_LICENSE_PATH>:/fs \
  nipreps/fmriprep:23.2.1 \
  /data /out participant \
  --participant-label <SUBID> \
  --fs-license-file /fs/license.txt \
  --output-spaces T1w \
  --work-dir /work \
  --clean-workdir
```

Output:
- Preprocessed BOLD in T1w space: `derivatives/fmriprep/sub-*/func/*_space-T1w_desc-preproc_bold.nii.gz`
- Confound regressors: `derivatives/fmriprep/sub-*/func/*_desc-confounds_timeseries.tsv` (includes motion, signal, etc.)
- Anatomical derivatives: `derivatives/fmriprep/sub-*/anat/` (T1w in MNI, brain masks, tissue probability maps)

#### **Stage 3: Post-Processing with XCP-D** (Spatial Smoothing, Band-Pass Filtering, Nuisance Regression, Scrubbing)
Input: fMRIPrep derivatives (`derivatives/fmriprep/`)

Key Denoising Operations:
1. **Spike detection & removal** (despike): Suppress extreme outliers before regression
2. **Nuisance regression (36P model)**:
   - 6 motion parameters (roll, pitch, yaw, x, y, z)
   - Global mean signal (GMS)
   - White matter (WM) signal
   - Cerebrospinal fluid (CSF) signal
   - + temporal derivatives of all 9 parameters (18 total)
   - + squared terms (18 total)
   - = **36 parameters** total (one of the most effective motion artifact suppression models)
   - **Alternative**: 27P (no global signal regression if GSR is not acceptable in your study)
3. **Band-pass filtering**: 0.01–0.08 Hz (retains resting-state low-frequency fluctuations; removes cardiac/respiratory noise & scanner drift)
4. **Spatial smoothing**: 6 mm FWHM Gaussian kernel (improves signal-to-noise for group-level analysis)
5. **Scrubbing (artifact handling)**: Mark frames with Framewise Displacement (FD) > 0.2 mm; remove and interpolate

Command structure (Docker):
```bash
docker run -ti --rm \
  -v <FMRIPREP_DERIVATIVES>:/fmriprep:ro \
  -v <XCPD_OUTPUT>:/out \
  -v <FREESURFER_LICENSE>:/opt/freesurfer/license.txt:ro \
  pennlinc/xcp_d:latest \
  /fmriprep /out participant \
  --participant-label <SUBID> \
  --nuisance-regressors 36P \
  --despike \
  --lower-bpf 0.01 --upper-bpf 0.08 \
  --smoothing 6 \
  --fd-thresh 0.2 \
  --nthreads 8 \
  --mem_gb 32
```

**Core Parameter Guide**:
| Parameter | Value | Explanation |
|---|---|---|
| `--nuisance-regressors` | `36P` | 36-parameter motion + signal regression model (most effective for motion artifact suppression) |
| `--despike` | (flag) | Suppress time-series spikes before filtering/regression |
| `--lower-bpf` / `--upper-bpf` | `0.01` / `0.08` | Resting-state frequency band (classic choice) |
| `--smoothing` | `6` | 6 mm FWHM Gaussian smoothing (standard for group analysis) |
| `--fd-thresh` | `0.2` | Framewise displacement threshold (0.2 mm = moderate scrubbing) |
| `--nthreads` | `8` | Number of CPU threads |
| `--mem_gb` | `32` | Memory allocation (adjust to your system) |

Output:
- Clean 4D BOLD: `derivatives/xcpd/sub-*/func/*_desc-denoised_bold.nii.gz`
- ROI timeseries (built-in atlases):
  - Schaefer 100/200/400/1000 (cortical parcellations)
  - Glasser 360 (multimodal parcellation)
  - Gordon 333 (cortical + subcortical)
  - Tian 96 or similar (subcortical)
  - Files: `*_desc-schaefer*, *_desc-glasser*, *_desc-gordon*, *_desc-tian*_timeseries.tsv`
- Functional connectivity matrices: `*_timeseries.tsv` (Pearson correlations pre-computed)
- Quality control metrics and edge case reports

#### **Stage 4: Downstream Analysis** (ROI extraction, connectivity analysis)
- Extract specific ROI timeseries from XCP-D outputs (.tsv files)
- Compute network-level statistics, graph theory measures, or seed-based maps
- Perform group-level statistical analysis (via FSL, SPM, or custom pipelines)

---

## NeuroClaw recommended wrapper script

No wrapper script is needed at the modality layer.  
All execution is routed through `bids-organizer`, `fmriprep-tool`, `hcppipeline-tool`, `conn-tool`, `fsl-tool`, and `claw-shell`.

## Important Notes & Limitations

### Processing Architecture & Runtimes
- **BIDS Preparation** (~5-10 min per subject): File organization, metadata verification
- **fMRIPrep** (~1.5-2 hours per subject with FreeSurfer): Full structural + functional preprocessing, parallelizable
- **XCP-D** (~20-30 min per subject): Post-processing denoising, ROI extraction, connectivity computation
- **Total pipeline**: 2-2.5 hours per subject (sequential), much faster with parallelization across subjects

### Data Requirements & Outputs
- **Input**: Raw DICOM/NIfTI (T1w + resting-state BOLD or task BOLD)
- **Intermediate**: fMRIPrep derivatives with confound matrices (TSV files)
- **Final outputs** (after XCP-D):
  - Clean 4D BOLD images (`.nii.gz`)
  - ROI timeseries in multiple standard atlases (`.tsv`)
  - Pre-computed functional connectivity matrices (Pearson correlations)
  - Quality control metrics (FD ranges, valid frame counts, etc.)

### Resting-State Network Considerations
- **36P nuisance regression** is proven most effective for motion artifact suppression (Head Motion Index ~85% reduction)
- **Band-pass filtering (0.01–0.08 Hz)** is standard for resting-state; preserve low-frequency oscillations while removing physiological noise
- **Scrubbing threshold (FD > 0.2 mm)** removes high-motion frames; conservative threshold (~5–15% of frames typically removed in ADNI)
- **Smoothing (6 mm FWHM)**: Improves SNR for group-level analysis; trade-off with spatial specificity

### Key Differences from Task-Based fMRI
- **Resting-state (ADNI model)**:
  - Focuses on intrinsic connectivity networks
  - Heavy denoising emphasis (36P + scrubbing + despike)
  - Lower frequency band (0.01–0.08 Hz)
  - No task regressors; uses confound regression instead
  
- **Task-based fMRI**:
  - Emphasizes task activations
  - Less aggressive denoising (to preserve task signal)
  - Often no band-pass filtering (preserves full range including task-related frequencies)
  - Explicit task design matrix (regressors for task timing)

### Input Data Requirements
- **T1w MRI**: 1 per subject (used by FreeSurfer for anatomical reference)
- **BOLD**: 1 or more functional scans per subject
  - Resting-state: typically 5–15 min (300–900 volumes at 2–3 sec TR)
  - ADNI standard: ~6 min at TR=3s = 120 volumes
- **Metadata (JSON)**: Must include `RepetitionTime`, `FlipAngle`, `EchoTime` (for proper preprocessing)

### System & License Requirements
- **Docker**: Required for fMRIPrep and XCP-D (recommended approach)
- **FreeSurfer**: Requires valid license file (free registration at https://surfer.nmr.mgh.harvard.edu/fswiki/License)
- **CPU**: 8+ threads recommended (typically 4–8 threads per pipeline = up to 16 for parallel subjects)
- **Memory**: 32 GB RAM minimum (16–32 GB per subject in parallel)
- **Disk**: 50–100 GB per subject (raw BOLD ~1 GB, derivatives ~5–10 GB)

### Quality Control Flags
- **FD metric**: Assess head motion frame-by-frame
- **BOLD signal dropout**: Check for signal losses (common in orbitofrontal areas)
- **Registration quality**: Verify BOLD-to-T1w alignment (visual inspection of overlays)
- **Confound correlations**: Verify nuisance regressors are uncorrelated with residual BOLD
- **Timeseries variance**: Post-XCP-D timeseries should show natural fluctuations (1-3% variation)

### This skill is for research workflows; not for clinical decision-making.

---

## Standard Output Layout (fMRI Derivatives)

After completing the full pipeline (BIDS → fMRIPrep → XCP-D), outputs are organized as:

```
fmri_output/
├── bids/                          # Original BIDS dataset
│   ├── dataset_description.json
│   └── sub-*/ses-*/func/          # Raw BOLD + JSON metadata
├── fmriprep/                      # fMRIPrep derivatives
│   ├── dataset_description.json
│   └── sub-*/
│       ├── anat/
│       │   ├── *_T1w.nii.gz               # T1w in native space
│       │   ├── *_T1w_brain_mask.nii.gz    # Brain mask
│       │   ├── *_space-MNI_T1w.nii.gz     # T1w in MNI152 (if --output-spaces MNI152NLin2009cAsym)
│       │   └── *_label-*.nii.gz           # Tissue probability maps (GM/WM/CSF)
│       ├── func/
│       │   ├── *_space-T1w_desc-preproc_bold.nii.gz  # Preprocessed BOLD (in native T1w space)
│       │   ├── *_desc-confounds_timeseries.tsv       # Motion + signal confounds
│       │   └── *_desc-confounds_regressors.json      # Confound descriptions
│       └── freesurfer/            # FreeSurfer outputs (symlink or copy)
├── xcpd/                          # XCP-D post-processing derivatives
│   ├── dataset_description.json
│   └── sub-*/
│       ├── anat/
│       │   └── *_space-T1w_desc-brain_mask.nii.gz
│       └── func/
│           ├── *_desc-denoised_bold.nii.gz           # Clean 4D BOLD (denoised, smoothed, filtered)
│           ├── *_desc-schaefer100_timeseries.tsv     # Schaefer 100-region timeseries
│           ├── *_desc-schaefer200_timeseries.tsv     # Schaefer 200-region timeseries
│           ├── *_desc-schaefer400_timeseries.tsv     # Schaefer 400-region timeseries
│           ├── *_desc-glasser360_timeseries.tsv      # Glasser 360 multimodal parcellation
│           ├── *_desc-gordon333_timeseries.tsv       # Gordon 333 network atlas
│           ├── *_desc-tian96_timeseries.tsv          # Tian 96 subcortical atlas
│           ├── *_desc-schaefer100_correlations.tsv   # Pre-computed Pearson correlations (Schaefer 100)
│           ├── *_desc-glasser360_correlations.tsv    # Pre-computed Pearson correlations (Glasser 360)
│           └── *_desc-qc_metrics.json                # Quality control: FD ranges, valid frames, etc.
├── roi/                           # ROI time-series extractions (optional, for custom analysis)
│   └── *.csv                      # Custom ROI CSV tables (if further analysis required)
├── connectivity/                  # Connectivity analysis (if post-hoc analysis was run)
│   ├── *_connectivity_matrix.npy  # Numpy arrays of connectivity matrices
│   └── *.tsv                      # Pairwise connectivity stats
├── stats/                         # Group-level statistics (if group analysis was run)
│   └── *.nii.gz                   # Group-level Z-stat maps, T-stat maps
└── logs/                          # Processing logs
    ├── fmriprep_*.log
    ├── xcpd_*.log
    └── qc_report_*.html           # QC reports from fMRIPrep / XCP-D
```

**Key files for downstream analysis**:
1. **Clean BOLD**: `xcpd/sub-*/func/*_desc-denoised_bold.nii.gz`
2. **ROI timeseries** (ready for connectivity analysis): `xcpd/sub-*/func/*_timeseries.tsv` (pick your atlas)
3. **Confound matrix** (for reference): `fmriprep/sub-*/func/*_confounds_timeseries.tsv`
4. **Anatomical reference**: `fmriprep/sub-*/anat/*_T1w.nii.gz`

## When to Call This Skill

- After `bids-organizer` when raw resting-state or task-based fMRI data needs preprocessing.
- When the user wants standardized preprocessing via **fMRIPrep** (with optional XCP-D post-processing for resting-state studies).
- When the user needs high-quality, publication-grade **HCP-style preprocessing** (surface-based, ICA-FIX).
- When the research requires **resting-state functional connectivity** analysis with validated denoising (ADNI model: fMRIPrep + XCP-D).
- When the research involves **ROI timeseries extraction** from multiple standard atlases (Schaefer, Glasser, Gordon, Tian).
- When the user wants **effective connectivity** analysis (PPI/gPPI/DCM) via `conn-tool` or `fsl-tool`.
- After `research-idea` or `method-design` when the experiment involves fMRI data (resting-state networks, task activation, or dual-regression).

## Complementary / Related Skills

- `bids-organizer` → organize raw DICOM/NIfTI data into BIDS structure
- `dcm2nii` → convert raw DICOM to NIfTI (if not already done)
- `smri-skill` → prepare T1w structural images (FreeSurfer preprocessing)
- `fmriprep-tool` → standardized preprocessing (motion correction, distortion correction, FreeSurfer integration, coregistration to T1w)
- `fmriprep-tool` (XCP-D integration) → post-processing denoising, scrubbing, connectivity extraction (recommended for resting-state)
- `hcppipeline-tool` → high-quality HCP-style preprocessing (ICA-FIX, MSMAll, advanced diffusion pipeline)
- `conn-tool` → advanced functional & effective connectivity analysis (ROI-to-ROI, seed-to-voxel, network ICA, PPI/gPPI, DCM)
- `fsl-tool` → ROI extraction, basic connectivity, PPI design, FEAT GLM (task-based analysis)
- `nilearn-tool` → custom ROI extraction and post-hoc connectivity analysis from NIfTI files
- `dependency-planner` → environment & dependency management

## Reference

Aligned with NeuroClaw modality-skill pattern (see `smri-skill`, `eeg-skill`, `dwi-skill`).  
**Validated pipeline**: ADNI resting-state fMRI processing workflow (fMRIPrep 23.x + XCP-D).  
Core tools used:
- `fmriprep-tool` (v23.2.1+): Motion correction, coregistration, FreeSurfer wrapper
- `xcp-d` (integrated or separate): Spatial smoothing, band-pass filtering (0.01–0.08 Hz), nuisance regression (36P), scrubbing
- `hcppipeline-tool`: HCP-grade structural + functional processing (alternative)
- `conn-tool`: Advanced connectivity & effective connectivity (complementary)
- `fsl-tool`: ROI extraction, GLM, basic connectivity (complementary)
- `nilearn`: Custom ROI extraction and downstream analysis (complementary)

**Key references**:
- Poldrack et al. (2017): fMRIPrep validation
- Ciric et al. (2019): XCP-D: Motion artifact suppression via nuisance regression
- Fair et al. (2021): Correction and interpretation of fMRI-based resting-state connectivity

---
Created At: 2026-03-25 16:02 HKT  
Last Updated At: 2026-03-28 17:53 HKT  
Author: chengwang96