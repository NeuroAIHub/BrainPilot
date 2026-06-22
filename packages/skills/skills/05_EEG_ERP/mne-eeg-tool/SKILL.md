---
name: mne-eeg-tool
description: "Use this skill whenever any NeuroClaw modality skill (especially eeg-skill) needs to execute concrete MNE-Python operations for EEG loading, preprocessing, filtering, artifact removal, epoching, frequency-band analysis, or feature extraction. This is the dedicated base/tool skill that contains all specific MNE-Python code and usage patterns."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - claw-shell
---
# MNE-EEG Tool (Base/Tool Layer)

## Overview
`mne-eeg-tool` is the **NeuroClaw base/tool skill** that provides all concrete MNE-Python implementation for EEG processing.

It is **never called directly by the user**. It is exclusively delegated to by the modality-layer skill `eeg-skill` (and any future EEG-related modality skills).

This skill:
- Contains the complete, ready-to-run MNE-Python code (covers all standard preprocessing and feature extraction tasks).
- Handles environment setup verification.
- Provides a single, well-documented wrapper script (`eeg_pipeline.py`) that implements **all** common EEG tasks, including the newly added continuous-data branch, functional connectivity, ERP features, frontal alpha asymmetry, and microstate analysis.
- Routes every execution through `claw-shell` for safety and logging.

**Research use only** — outputs are for scientific analysis.

## Agent Reference Rule

When the agent needs MNE-EEG implementation code, it should first consult the curated snippet in `skills/mne-eeg-tool/scripts/` instead of copying from the embedded wrapper below.

Reference snippet available:
- `scripts/eeg_pipeline_reference.py` -> full EEG pipeline: load, bad-channel detection, filtering, ICA, epoching, frequency bands, connectivity, ERP features, alpha asymmetry, microstates

Example:
```bash
python skills/mne-eeg-tool/scripts/eeg_pipeline_reference.py \
    --input path/to/data.set \
    --resting \
    --output-dir eeg_output/
```

## Quick Reference (Core Functions)

| Function                              | Purpose                                                                 | New in this update? |
|---------------------------------------|-------------------------------------------------------------------------|---------------------|
| `load_eeg()`                          | Load .set / .edf / .bdf / .fif / BIDS + validation                     | —                   |
| `detect_and_interpolate_bad_channels()` | Auto-detect + interpolate noisy channels                             | **Yes**             |
| `preprocess_filtering()`              | Resample + high-pass + notch + bandpass                                 | —                   |
| `remove_artifacts()`                  | ICA + AutoReject + EOG/ECG regression                                   | **Yes**             |
| `continuous_data_cleaning()`          | Resting-state pipeline (no events)                                      | **Yes**             |
| `rereference_and_epoch()`             | Average reference + epoching + baseline correction                      | —                   |
| `extract_frequency_bands()`           | Split into δ/θ/α/β/γ bands + power matrices                             | —                   |
| `extract_features()`                  | Band power, CSP, Hjorth, sample entropy, etc.                           | —                   |
| `compute_connectivity()`              | PLV, coherence, wPLI, imaginary coherence                               | **Yes**             |
| `extract_erp_features()`              | Peak amplitude, latency, area under curve                               | **Yes**             |
| `compute_alpha_asymmetry()`           | Frontal alpha asymmetry (emotion studies)                               | **Yes**             |
| `run_microstate_analysis()`           | EEG microstates (resting-state)                                         | **Yes**             |
| `full_eeg_pipeline()`                 | One-click end-to-end pipeline (any combination)                         | —                   |

## Installation (Handled by dependency-planner)
This skill is automatically installed when `eeg-skill` is used:

```bash
# Executed via dependency-planner + conda-env-manager
conda create -n neuroclaw-eeg python=3.11 -y
conda activate neuroclaw-eeg
conda install -c conda-forge mne pyentrp scikit-learn pandas numpy matplotlib -y
pip install mne[full]  # optional: full extras
```

## NeuroClaw recommended wrapper script

The full EEG pipeline implementation is in `scripts/eeg_pipeline_reference.py` (see Agent Reference Rule above).

Example:
```bash
python skills/mne-eeg-tool/scripts/eeg_pipeline_reference.py \
    --input path/to/data.set \
    --resting \
    --output-dir eeg_output/
```

Functions: `load_eeg`, `detect_and_interpolate_bad_channels`, `preprocess_filtering`, `remove_artifacts`, `continuous_data_cleaning`, `rereference_and_epoch`, `extract_frequency_bands`, `extract_features`, `compute_connectivity`, `extract_erp_features`, `compute_alpha_asymmetry`, `run_microstate_analysis`, `full_eeg_pipeline`.

## Important Notes & Limitations
- Requires the `neuroclaw-eeg` conda environment (auto-created by `dependency-planner`).
- Long-running steps (ICA, connectivity, microstates) run safely in `claw` tmux session.
- Outputs are always written to `./eeg_output/` with clear subfolders.
- Fully extensible: new functions can be added to `eeg_pipeline.py` without touching `eeg-skill`.

## Complementary / Related Skills
- `claw-shell` → executes this skill’s wrapper
- `dependency-planner` + `conda-env-manager` → creates `neuroclaw-eeg` environment

## Reference
Official MNE-Python documentation (https://mne.tools) + MNE-Connectivity + mne-microstates.
Aligned with NeuroClaw base/tool skill pattern (freesurfer-tool, dcm2nii, etc.).

Curated reference snippet in this skill:
- `skills/mne-eeg-tool/scripts/eeg_pipeline_reference.py`

## Post-Execution Verification (Harness Integration)

After MNE-EEG processing completes, this skill **automatically invokes harness-core's VerificationRunner** to validate output integrity:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger

verifier = VerificationRunner(task_type="eeg_processing")

# 1. EEG file loading success
verifier.add_check("eeg_loading",
    checker=lambda: verify_eeg_loaded(output_dir),
    severity="error"
)

# 2. Channel count and data shape
verifier.add_check("channel_integrity",
    checker=lambda: verify_channel_count(output_dir),
    severity="error"
)

# 3. Artifact removal success (ICA, AutoReject)
verifier.add_check("artifact_removal",
    checker=lambda: verify_artifact_removal_rate(output_dir, min_rate=0.85),
    severity="warning"
)

# 4. Frequency spectrum sanity (not all zeros, reasonable power)
verifier.add_check("frequency_spectrum",
    checker=lambda: verify_frequency_spectrum(output_dir),
    severity="warning"
)

# 5. Data range and NaN/Inf checks
verifier.add_check("data_integrity",
    checker=lambda: verify_no_nan_inf(output_dir),
    severity="error"
)

# 6. Connectivity/Features output shape
verifier.add_check("feature_extraction",
    checker=lambda: verify_feature_dimensions(output_dir),
    severity="warning"
)

report = verifier.run(output_dir)

# Log verification results
logger = AuditLogger(log_file=f"{output_dir}/eeg_verification.jsonl")
logger.log_validation(
    task_name="eeg_processing",
    checks_passed=len([r for r in report.results if r.passed]),
    total_checks=len(report.results),
    output_path=output_dir
)
```

**Output**: `eeg_output/eeg_verification.jsonl` (structured audit log with JSONL format)

---

Created At: 2026-03-25 14:00 HKT  
Last Updated At: 2026-04-05 02:03 HKT  
Author: chengwang96