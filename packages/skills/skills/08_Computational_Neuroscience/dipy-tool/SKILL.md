---
name: dipy-tool
description: "Use this skill whenever any NeuroClaw diffusion MRI / DWI modality skill needs to execute concrete DIPY operations: load DWI (NIfTI+bvals+bvecs), optional masking, DTI fitting, compute FA/MD/AD/RD, and extract ROI statistics. This is the dedicated base/tool skill that contains all specific DIPY code and usage patterns. Never called directly by the user."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - claw-shell
---
# DIPY Tool (Base/Tool Layer)

## Overview
`dipy-tool` is the **NeuroClaw base/tool skill** that provides the concrete **DIPY** implementation for diffusion MRI (DWI/DTI) processing and feature extraction.

It is **never called directly by the user**. It is delegated to by a diffusion modality-layer skill (e.g., future `dwi-skill` / `dmri-skill`) and executed via `claw-shell` for safety, logging, and long-running stability.

This skill provides:
- Robust loading of **DWI NIfTI + bvals + bvecs** with sanity checks.
- Brain mask generation (`median_otsu`) or use of a provided mask.
- **DTI fitting** (optionally selecting a b-value range) and metric export:
  - **FA / MD / AD / RD** as NIfTI maps
- **ROI / atlas statistics** extraction (CSV summaries).

**Research use only** — not for clinical diagnosis.

## Agent Reference Rule

When the agent needs DIPY-based implementation code, it should first consult the curated snippets in `skills/dipy-tool/scripts/` instead of copying the large embedded wrapper or unrelated tutorial files with hard-coded paths.

Reference snippets available:
- `scripts/load_and_mask_reference.py` -> DWI + gradients loading, b0 discovery, `median_otsu` brain masking
- `scripts/dti_metrics_reference.py` -> tensor fitting and FA/MD/AD/RD export
- `scripts/roi_stats_reference.py` -> atlas-based summary statistics on tensor metrics

---

## Quick Reference (Core Tasks)

| Task | What it does | Output |
|---|---|---|
| Load DWI + gradients | Validates shapes, loads NIfTI+bvals+bvecs | in-memory arrays |
| Brain mask | Auto mask (median_otsu) or use external | `brain_mask.nii.gz` |
| DTI fit | TensorModel fit on selected volumes | tensor fit object |
| Export tensor metrics | Compute & save FA/MD/AD/RD | `FA.nii.gz`, `MD.nii.gz`, `AD.nii.gz`, `RD.nii.gz` |
| ROI stats | Per-label summary (mean/median/std/p05/p95) | `roi_stats_FA.csv`, etc. |

---

## Curated Reference Scripts

These scripts are aligned with NeuroClaw's DWI handling pattern and with the modality / dependency expectations documented in `rs-fMRI-Pipeline-Tutorial/`:
- the tutorial explicitly includes DTI/DWI as a supported modality
- the tutorial installs `dipy` as a core dependency
- the tutorial's multimodal structure motivates deterministic outputs and atlas-based summaries

### `scripts/load_and_mask_reference.py`
- Loads DWI NIfTI + bvals + bvecs with shape checks
- Finds b0 volumes and builds a brain mask with `median_otsu`
- Exports `brain_mask.nii.gz`, `mean_b0.nii.gz`, and `dwi_summary.txt`

Example:
```bash
python skills/dipy-tool/scripts/load_and_mask_reference.py \
    --dwi path/to/sub-001_dwi.nii.gz \
    --bval path/to/sub-001_dwi.bval \
    --bvec path/to/sub-001_dwi.bvec \
    --output-dir dwi_output/sub-001/dipy/load_mask
```

### `scripts/dti_metrics_reference.py`
- Filters gradients for tensor fitting
- Fits a tensor model with DIPY
- Exports `FA.nii.gz`, `MD.nii.gz`, `AD.nii.gz`, and `RD.nii.gz`

Example:
```bash
python skills/dipy-tool/scripts/dti_metrics_reference.py \
    --dwi path/to/sub-001_dwi.nii.gz \
    --bval path/to/sub-001_dwi.bval \
    --bvec path/to/sub-001_dwi.bvec \
    --mask dwi_output/sub-001/dipy/load_mask/brain_mask.nii.gz \
    --output-dir dwi_output/sub-001/dipy/metrics
```

### `scripts/roi_stats_reference.py`
- Computes atlas-level statistics from tensor metrics
- Supports optional label names for structured CSV outputs
- Intended for FA/MD/AD/RD summaries after tensor fitting

Example:
```bash
python skills/dipy-tool/scripts/roi_stats_reference.py \
    --metric dwi_output/sub-001/dipy/metrics/FA.nii.gz \
    --roi path/to/JHU_labels_in_dwi_space.nii.gz \
    --output dwi_output/sub-001/dipy/roi_stats_FA.csv
```

---

## Installation (Handled by `dependency-planner`)
This tool is installed automatically when required.

Recommended isolated environment:
```bash
conda create -n neuroclaw-dipy python=3.11 -y
conda activate neuroclaw-dipy
conda install -c conda-forge dipy nibabel numpy scipy scikit-image pandas -y
# Optional:
conda install -c conda-forge matplotlib -y
```

**Recommended execution pattern (avoids shell activation pitfalls):**
- Use `conda run -n neuroclaw-dipy ...` routed through `claw-shell`.

---

## NeuroClaw recommended wrapper

If a single entry point is still needed later, it should be assembled from the curated snippets in `skills/dipy-tool/scripts/` rather than keeping a long monolithic example embedded in this document.

Recommended composition:
- `load_and_mask_reference.py` for DWI sanity checks and mask creation
- `dti_metrics_reference.py` for tensor fitting and FA/MD/AD/RD export
- `roi_stats_reference.py` for atlas-based feature summarization

All real runs must still be delegated to `claw-shell`.

---

## Example execution (must be routed via `claw-shell`)
```bash
conda run -n neuroclaw-dipy python skills/dipy-tool/dipy_pipeline.py \
  --dwi /data/sub-001_dwi.nii.gz \
  --bval /data/sub-001_dwi.bval \
  --bvec /data/sub-001_dwi.bvec \
  --outdir dwi_output/sub-001 \
  --dti-bmax 1200 \
  --roi /data/JHU_labels_in_dwi_space.nii.gz
```

---

## Important Notes & Limitations
- **Preprocessing matters**: FA/MD are highly sensitive to motion/eddy/susceptibility distortions. Best practice is to run **topup/eddy** first (e.g., via `fsl-tool` or HCP diffusion pipeline) and use the **rotated bvecs** output by eddy.
- **DTI vs multi-shell**: DTI fitting is most stable on low b-values (commonly b≤1000–1200). Higher-order models (DKI/NODDI) require separate implementations (extend this tool if needed).
- **ROI alignment**: ROI/atlas labels must be in the *same voxel space* as the DWI-derived metrics. Registration/warping is handled by other tools (e.g., FSL/ANTs/HCP pipelines).
- **Numerical stability**: small negative eigenvalues can occur; this pipeline clips them to zero before FA computation.

## Benchmark Adapter Guidance

For benchmark-style ROI-statistics tasks, treat this tool as a library of narrow downstream building blocks rather than a mandatory full DWI pipeline.

- If the prompt already provides metric maps plus an ROI/atlas image, start directly from `scripts/roi_stats_reference.py` or an equivalent narrow ROI-statistics implementation.
- Do not automatically prepend DWI loading, masking, or tensor fitting when the required metric maps already exist.
- Preserve the benchmark output contract: when the task expects separate ROI summary files per metric, write one CSV per selected metric rather than a single combined table unless the prompt explicitly asks for a merged export.

---

## Complementary / Related Skills
- `dependency-planner` + `conda-env-manager` → install/manage `neuroclaw-dipy`

---

## Reference
- DIPY documentation: https://dipy.org/documentation/latest/
- DIPY DTI reconstruction examples (tensor fitting + FA/MD/AD/RD)
- rs-fMRI-Pipeline-Tutorial: https://github.com/Karcen/rs-fMRI-Pipeline-Tutorial
- Curated code snippets in this skill:
    - `skills/dipy-tool/scripts/load_and_mask_reference.py`
    - `skills/dipy-tool/scripts/dti_metrics_reference.py`
    - `skills/dipy-tool/scripts/roi_stats_reference.py`
- Aligned with NeuroClaw base/tool skill pattern (`mne-eeg-tool`, etc.)

## Post-Execution Verification (Harness Integration)

After DIPY processing completes, this skill **automatically invokes harness-core's VerificationRunner** to validate output integrity:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger

verifier = VerificationRunner(task_type="dipy_dti_processing")

# 1. DWI file loading and shape validation
verifier.add_check("dwi_loading",
    checker=lambda: verify_dwi_loaded(output_dir),
    severity="error"
)

# 2. Brain mask existence and coverage
verifier.add_check("brain_mask",
    checker=lambda: verify_brain_mask(output_dir),
    severity="error"
)

# 3. Gradient table validity (bvals/bvecs)
verifier.add_check("gradient_table",
    checker=lambda: verify_gradient_table(output_dir),
    severity="error"
)

# 4. Tensor metrics bounds (FA: 0–1, MD/AD/RD: reasonable μm²/ms)
verifier.add_check("tensor_bounds",
    checker=lambda: verify_tensor_metrics_bounds(output_dir),
    severity="warning"
)

# 5. Data integrity (NaN/Inf checks)
verifier.add_check("data_integrity",
    checker=lambda: verify_no_nan_inf(output_dir),
    severity="error"
)

# 6. ROI statistics shape (if extracted)
verifier.add_check("roi_statistics",
    checker=lambda: verify_roi_stats_shape(output_dir),
    severity="warning"
)

report = verifier.run(output_dir)

# Log verification results
logger = AuditLogger(log_file=f"{output_dir}/dipy_verification.jsonl")
logger.log_validation(
    task_name="dipy_dti_processing",
    checks_passed=len([r for r in report.results if r.passed]),
    total_checks=len(report.results),
    output_path=output_dir
)
```

**Output**: `{output_dir}/dipy_verification.jsonl` (structured audit log with JSONL format)

---

Created At: 2026-03-26 00:40 HKT
Last Updated At: 2026-04-14 00:28 HKT
Author: chengwang96