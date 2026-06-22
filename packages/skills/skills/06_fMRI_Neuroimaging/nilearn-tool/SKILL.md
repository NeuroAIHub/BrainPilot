---
name: nilearn-tool
description: "Use this skill whenever any NeuroClaw fMRI modality skill needs to execute concrete Nilearn operations: ROI/atlas time-series extraction, confounds handling (fMRIPrep), seed-based connectivity maps, ROI-to-ROI connectivity matrices, and optional GLM/decoding utilities. This is the dedicated base/tool skill that contains Nilearn usage patterns and lightweight wrappers. Never called directly by the user."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - claw-shell
---
# Nilearn Tool (Base/Tool Layer)

## Overview
`nilearn-tool` is the **NeuroClaw base/tool skill** that implements concrete **Nilearn** workflows for turning **preprocessed BOLD** into features (ROI time series, connectivity matrices, seed maps) and optional statistical modeling (GLM).

It is **never called directly by the user**. It is delegated to by `fmri-skill` (or other interface/modality skills) and executed via `claw-shell`.

**Research use only.**

## Agent Reference Rule

When the agent needs Nilearn-based implementation code, it should first consult the curated snippets in `skills/nilearn-tool/scripts/` instead of copying directly from long tutorial scripts with hard-coded paths.

Reference snippets available:
- `scripts/preprocess_bold_reference.py` -> dummy removal, smoothing, band-pass filtering, MNI resampling
- `scripts/connectome_reference.py` -> atlas ROI extraction and ROI-to-ROI connectivity export
- `scripts/zalff_summary_reference.py` -> MNI resampling, zALFF summary, atlas-level regional export
- `scripts/task_glm_reference.py` -> first-level task GLM with design matrix and contrast maps
- `scripts/second_level_glm_reference.py` -> group-level GLM from subject contrast maps
- `scripts/rest_ica_reference.py` -> resting-state CanICA component extraction
- `scripts/rest_dictlearning_reference.py` -> resting-state DictLearning component extraction
- `scripts/svm_classifier_reference.py` -> ROI/tabular disease classification with SVM
- `scripts/spacenet_classifier_reference.py` -> voxel-wise disease classification with SpaceNet
- `scripts/kmeans_parcellation_reference.py` -> mask-based K-means brain parcellation
- `scripts/hierarchical_parcellation_reference.py` -> mask-based hierarchical brain parcellation
- `scripts/denoise_timeseries_reference.py` -> confound regression and detrending with `clean_img`

---

## Scope (What this tool does / does not do)

### ✅ This tool does
- Load BOLD NIfTI and (optional) brain mask.
- Load fMRIPrep confounds TSV and apply common denoising regressors.
- Extract ROI time series from an atlas/parcellation.
- Compute ROI-to-ROI functional connectivity matrices.
- Compute seed-to-voxel connectivity maps.
- (Optional) Run first-/second-level GLM when events/maps are provided.

### ❌ This tool does NOT do
- Raw fMRI preprocessing (slice timing, motion correction, susceptibility distortion correction, eddy/topup, etc.).
  Those belong to `fmriprep-tool`, `hcppipeline-tool`, `fsl-tool`.

---

## Core Outputs (Typical)
- `roi_timeseries.csv` (T × R)
- `connectome.npy` / `connectome.csv` (R × R)
- `seed_zmap.nii.gz`
- (Optional) `first_level_zmap.nii.gz`, `second_level_zmap.nii.gz`
- Optional figures: connectome matrix PNG, connectome graph PNG, stat map PNG

---

## Minimal Nilearn Usage Patterns (Short Snippets)

### 1) fMRIPrep confounds (recommended)
```python
from nilearn.interfaces.fmriprep import load_confounds
confounds, sample_mask = load_confounds(confounds_tsv, strategy=["motion", "wm_csf"])
```

### 2) ROI time series (atlas/parcellation)
```python
from nilearn.maskers import NiftiLabelsMasker
masker = NiftiLabelsMasker(labels_img=atlas_img, t_r=tr, standardize=True, detrend=True)
roi_ts = masker.fit_transform(bold_img, confounds=confounds, sample_mask=sample_mask)  # (T, R)
```

### 3) ROI-to-ROI connectivity
```python
from nilearn.connectome import ConnectivityMeasure
conn = ConnectivityMeasure(kind="correlation").fit_transform([roi_ts])[0]  # (R, R)
```

### 4) Seed-to-voxel connectivity (concept)
- Use `NiftiSpheresMasker` for seed TS, `NiftiMasker` for voxel TS, then correlate and Fisher-z.

## Curated Reference Snippets

These scripts are distilled from `rs-fMRI-Pipeline-Tutorial/` and should be the preferred starting point for new code in this skill:

### `scripts/preprocess_bold_reference.py`
- Covers the Nilearn-centric part of resting-state preprocessing shown in `multimodal_brain_connectivity_pipeline.py`
- Includes dummy-scan removal, spatial smoothing, temporal band-pass filtering, and MNI152 resampling

Example:
```bash
python skills/nilearn-tool/scripts/preprocess_bold_reference.py \
  --bold path/to/rest_bold.nii.gz \
  --output fmri_output/sub-001/nilearn/preprocessed_bold_mni.nii.gz
```

### `scripts/connectome_reference.py`
- Extracts atlas ROI time series with `NiftiLabelsMasker`
- Computes ROI-to-ROI connectivity with `ConnectivityMeasure`
- Exports `roi_timeseries.csv`, `connectome.npy`, and `connectome.csv`

Example:
```bash
python skills/nilearn-tool/scripts/connectome_reference.py \
  --bold path/to/preprocessed_bold_mni.nii.gz \
  --atlas path/to/AAL3v1.nii \
  --labels path/to/AAL3v1.nii.txt \
  --output-dir fmri_output/sub-001/nilearn/connectome
```

### `scripts/zalff_summary_reference.py`
- Adapts the regional zALFF summarization logic from `MNI152_zALFF_Brain_Region_Activation_Analysis.py`
- Uses Nilearn resampling, cleaning, and `NiftiLabelsMasker` for atlas-level reporting

Example:
```bash
python skills/nilearn-tool/scripts/zalff_summary_reference.py \
  --bold path/to/rest_bold.nii.gz \
  --atlas path/to/AAL3v1.nii \
  --labels path/to/AAL3v1.nii.txt \
  --mask path/to/mni_mask.nii.gz \
  --output-dir fmri_output/sub-001/nilearn/zalff
```

### Additional model-routing snippets
- `scripts/task_glm_reference.py` -> first-level task GLM
- `scripts/second_level_glm_reference.py` -> second-level / group GLM
- `scripts/rest_ica_reference.py` -> resting-state ICA decomposition
- `scripts/rest_dictlearning_reference.py` -> resting-state DictLearning decomposition
- `scripts/svm_classifier_reference.py` -> tabular / ROI SVM classifier
- `scripts/spacenet_classifier_reference.py` -> voxel-wise SpaceNet classifier
- `scripts/kmeans_parcellation_reference.py` -> K-means parcellation from masked image features
- `scripts/hierarchical_parcellation_reference.py` -> Hierarchical parcellation from masked image features
- `scripts/denoise_timeseries_reference.py` -> confound-aware detrending and time-series cleaning

---

## Wrapper Entry (Recommended)
This tool should expose a **small CLI wrapper** (implementation kept in a separate file, not embedded here):
- File: `skills/nilearn-tool/nilearn_pipeline.py`
- Subcommands (recommended):
  - `roi-ts` → extract ROI time series
  - `connectome` → compute connectivity matrix from ROI TS
  - `seed-corr` → seed connectivity z-map
  - `first-glm` / `second-glm` (optional)

**All execution must be routed through `claw-shell`.**

Example calls:
```bash
conda run -n neuroclaw-nilearn python skills/nilearn-tool/nilearn_pipeline.py roi-ts \
  --bold <preproc_bold.nii.gz> --confounds <confounds.tsv> --tr 2.0 --atlas schaefer_2018_200_7 \
  --outdir fmri_output/sub-001/nilearn/roi_ts

conda run -n neuroclaw-nilearn python skills/nilearn-tool/nilearn_pipeline.py connectome \
  --roi-timeseries fmri_output/sub-001/nilearn/roi_ts/roi_timeseries.csv --kind correlation \
  --outdir fmri_output/sub-001/nilearn/connectome
```

---

## Installation (Handled by `dependency-planner`)
Recommended isolated environment:
```bash
conda create -n neuroclaw-nilearn python=3.11 -y
conda install -n neuroclaw-nilearn -c conda-forge nilearn nibabel numpy scipy pandas scikit-learn matplotlib -y
```

---

## Safety / Execution Rules (NeuroClaw)
- No direct `subprocess.run()` for long operations in this skill.
- All shell commands go through `claw-shell`.
- Always produce outputs under `fmri_output/.../nilearn/...` with deterministic filenames.

---

## Complementary / Related Skills
- `dependency-planner` + `conda-env-manager` → install/manage `neuroclaw-nilearn`
- `claw-shell` → mandatory execution layer

---

## Reference
- Nilearn documentation: https://nilearn.github.io/
- fMRIPrep confounds interface: Nilearn `nilearn.interfaces.fmriprep`
- Curated code snippets in this skill:
  - `skills/nilearn-tool/scripts/preprocess_bold_reference.py`
  - `skills/nilearn-tool/scripts/connectome_reference.py`
  - `skills/nilearn-tool/scripts/zalff_summary_reference.py`
  - `skills/nilearn-tool/scripts/task_glm_reference.py`
  - `skills/nilearn-tool/scripts/second_level_glm_reference.py`
  - `skills/nilearn-tool/scripts/rest_ica_reference.py`
  - `skills/nilearn-tool/scripts/rest_dictlearning_reference.py`
  - `skills/nilearn-tool/scripts/svm_classifier_reference.py`
  - `skills/nilearn-tool/scripts/spacenet_classifier_reference.py`
  - `skills/nilearn-tool/scripts/kmeans_parcellation_reference.py`
  - `skills/nilearn-tool/scripts/hierarchical_parcellation_reference.py`
  - `skills/nilearn-tool/scripts/denoise_timeseries_reference.py`

## Post-Execution Verification (Harness Integration)

After Nilearn processing completes, this skill **automatically invokes harness-core's VerificationRunner** to validate output integrity:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger

verifier = VerificationRunner(task_type="nilearn_processing")

# 1. ROI time series shape and completeness
verifier.add_check("roi_timeseries",
    checker=lambda: verify_roi_timeseries(output_dir),
    severity="error"
)

# 2. Confounds loading and application
verifier.add_check("confounds_handling",
    checker=lambda: verify_confounds_applied(output_dir),
    severity="warning"
)

# 3. Connectivity matrix dimensionality (N_ROI × N_ROI)
verifier.add_check("connectivity_shape",
    checker=lambda: verify_connectome_shape(output_dir),
    severity="error"
)

# 4. Correlation bounds (-1 to +1)
verifier.add_check("correlation_bounds",
    checker=lambda: verify_correlation_bounds(output_dir),
    severity="warning"
)

# 5. Data integrity (NaN/Inf checks)
verifier.add_check("data_integrity",
    checker=lambda: verify_no_nan_inf(output_dir),
    severity="error"
)

report = verifier.run(output_dir)

# Log verification results
logger = AuditLogger(log_file=f"{output_dir}/nilearn_verification.jsonl")
logger.log_validation(
    task_name="nilearn_processing",
    checks_passed=len([r for r in report.results if r.passed]),
    total_checks=len(report.results),
    output_path=output_dir
)
```

**Output**: `fmri_output/nilearn_verification.jsonl` (structured audit log with JSONL format)

---

Created At: 2026-03-26 00:54 HKT
Last Updated At: 2026-04-14 00:26 HKT
Author: chengwang96