---
name: eeg-skill
description: "Use this skill whenever the user wants to load, preprocess, epoch, filter, or extract features from EEG data (resting-state, task-based, BCI, clinical, motor imagery, emotion, epilepsy, fatigue, etc.). Triggers include: 'eeg', 'EEG preprocessing', 'EEG feature extraction', 'band power', 'downsample to frequency bands', 'motor imagery BCI', 'emotion EEG', 'epilepsy detection', or any request involving .set/.edf/.bdf/.fif/.bids files."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: modality
dependencies:
  - mne-eeg-tool
  - claw-shell
---
# EEG Skill (Modality Layer)

## Overview

`eeg-skill` is the NeuroClaw **modality-layer** interface skill responsible for all EEG data processing tasks.  
It strictly follows the NeuroClaw hierarchical design principles:

- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no full implementation code**.
- All concrete execution (MNE-Python calls, torchaudio, scipy, file I/O, etc.) is delegated to the dedicated base/tool skill `mne-eeg-tool`.
- Waveform-to-spectrogram conversion uses `torchaudio.transforms.MelSpectrogram`.
- Frequency-band energy extraction uses continuous wavelet transform (`scipy.signal.cwt` with `morlet2` wavelet).

**Core workflow (never bypassed):**

1. Identify the user-provided EEG files (BIDS, .set, .edf, .bdf, .fif, etc.).
2. Generate a **numbered execution plan** that clearly states WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation (“YES” / “execute” / “proceed”).
4. On confirmation, delegate every step to `mne-eeg-tool` via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`eeg_output/`).

**Research use only** — outputs are for scientific analysis only.

## Quick Reference (Common EEG Tasks – Updated 2026-03-25)

| Task                                      | What needs to be done                                                      | Delegate to which tool skill                  | Expected output                          |
|-------------------------------------------|----------------------------------------------------------------------------|-----------------------------------------------|------------------------------------------|
| Load & basic validation                   | Read raw EEG + channel locations + events + validation                     | `claw-shell` (via `mne-eeg-tool`)             | Validation report + raw object           |
| Bad-channel detection & interpolation     | Auto-detect + interpolate noisy channels                                   | `claw-shell` (via `mne-eeg-tool`)             | Cleaned raw data                         |
| Downsampling + filtering                  | Resample, high-pass, notch, bandpass filtering                             | `claw-shell` (via `mne-eeg-tool`)             | Filtered .fif files                      |
| Artifact removal                          | ICA + AutoReject + EOG/ECG regression                                      | `claw-shell` (via `mne-eeg-tool`)             | Cleaned data                             |
| Continuous data cleaning                  | Resting-state pipeline (no events)                                         | `claw-shell` (via `mne-eeg-tool`)             | Cleaned continuous data                  |
| Re-referencing & epoching                 | Average reference (CAR) / REST + epoching + baseline correction            | `claw-shell` (via `mne-eeg-tool`)             | Epoched .fif files                       |
| Waveform to Mel-Spectrogram               | Convert raw waveform to Mel spectrogram using torchaudio                   | `claw-shell` (via `mne-eeg-tool`)             | Mel-spectrogram tensors (.pt)            |
| Frequency-band energy extraction          | Extract δ/θ/α/β/γ band energy using CWT with morlet2 wavelet               | `claw-shell` (via `mne-eeg-tool`)             | Per-band power matrices (CSV / .npy)     |
| Feature extraction (core)                 | Band power, CSP, Hjorth, sample entropy                                    | `claw-shell` (via `mne-eeg-tool`)             | Feature matrices (CSV / .npy / .npz)     |
| Advanced features                         | Functional connectivity, ERP peaks/latency/AUC, frontal alpha asymmetry, microstates | `claw-shell` (via `mne-eeg-tool`)             | Connectivity matrices, ERP CSV, asymmetry .npy, microstates .fif |
| Full end-to-end pipeline                  | Any combination of the above for BCI, emotion, epilepsy, fatigue, etc.     | `claw-shell` + `dependency-planner`           | Complete processed dataset + QC report   |

## Installation (Handled by dependency-planner)

No manual installation required.  
When first used, `eeg-skill` automatically calls `dependency-planner` to create the isolated `neuroclaw-eeg` conda environment containing MNE-Python, torchaudio, scipy, and all required packages.

## NeuroClaw recommended wrapper script

```python
# Example snippets (for reference in mne-eeg-tool implementation)

# 1. Waveform to Mel-Spectrogram
import torch
import torchaudio.transforms as T

mel_spec = T.MelSpectrogram(
    sample_rate=256,      # Adjust according to your EEG sampling rate
    n_fft=1024,
    hop_length=256,
    n_mels=128,
    f_min=0.5,
    f_max=60.0            # Common EEG frequency range
)
spectrogram = mel_spec(waveform)   # waveform shape: (channels, time)

# 2. Frequency-band energy extraction using CWT + morlet2
import numpy as np
from scipy.signal import cwt, morlet2

def extract_band_power(signal, fs=256):
    widths = np.arange(1, 128)  # Adjust according to frequency range
    cwt_matrix = cwt(signal, morlet2, widths)
    
    # Example: extract delta (0.5-4 Hz), theta (4-8 Hz), alpha (8-13 Hz), beta (13-30 Hz), gamma (30-60 Hz)
    delta_power = np.mean(np.abs(cwt_matrix[low_idx:high_idx])**2, axis=0)
    # ... similar processing for other bands
    return band_powers
```

## Important Notes & Limitations

- This SKILL.md contains **only high-level task descriptions and delegation instructions**.
- Waveform-to-spectrogram conversion is handled by `torchaudio.transforms.MelSpectrogram`.
- Frequency-band energy extraction is performed via continuous wavelet transform (`scipy.signal.cwt` + `morlet2` wavelet).
- Long-running operations (ICA on long recordings, CWT on high-density data, connectivity matrices, microstate analysis) are automatically routed to background mode in the `claw` tmux session.
- Execution begins **only after explicit user confirmation** of the full numbered plan.
- All outputs are saved in `./eeg_output/` with clear subfolders (raw/, filtered/, epoched/, features/, spectrograms/, etc.).

## When to Call This Skill

- The user provides raw or partially processed EEG data and requests preprocessing, Mel-spectrogram conversion, frequency-band energy extraction, feature engineering, or a full pipeline.
- After `research-idea` or `method-design` when the experiment involves EEG data.

## Post-Execution Verification (Harness Integration)

After EEG processing completes, this skill **automatically invokes harness-core's VerificationRunner** to validate preprocessed data quality:

**Integrated verification checks**:

```python
from skills.harness_core import VerificationRunner, AuditLogger
import numpy as np
import mne

verifier = VerificationRunner(task_type="eeg_preprocessing")

# 1. EEG data file exists and is readable
verifier.add_check("eeg_file_integrity",
    checker=lambda: verify_eeg_file_readable(output_dir),
    severity="error"
)

# 2. Channel count matches expected
verifier.add_check("channel_count",
    checker=lambda: verify_expected_channels(output_dir, expected_count=64),
    severity="warning"
)

# 3. No excessive bad segments (after artifact removal)
verifier.add_check("artifact_removal_success",
    checker=lambda: verify_bad_segments_removed(output_dir, max_pct=5),
    severity="warning"
)

# 4. Data range plausible (not clipped or saturated)
verifier.add_check("data_range_plausible",
    checker=lambda: verify_data_range(output_dir, min_range=-500, max_range=500),
    severity="error"
)

# 5. No NaN/Inf values in preprocessed data
verifier.add_check("no_nan_inf",
    checker=lambda: verify_no_nan_inf(output_dir),
    severity="error"
)

# 6. Frequency spectrum reasonable (no DC offset, reasonable content)
verifier.add_check("frequency_spectrum",
    checker=lambda: verify_frequency_spectrum(output_dir),
    severity="warning"
)

# 7. Epoching statistics (if applicable)
verifier.add_check("epoch_statistics",
    checker=lambda: verify_epoch_count_and_length(output_dir),
    severity="warning"
)

# 8. Feature extraction output dimensions
verifier.add_check("feature_matrix_shape",
    checker=lambda: verify_feature_matrix_shape(output_dir),
    severity="warning"
)

report = verifier.run(output_dir)

# Log verification results
logger = AuditLogger(log_file=f"{output_dir}/eeg_verification.jsonl")
logger.log_validation(
    task_name="eeg_preprocessing",
    checks_passed=len([r for r in report.results if r.passed]),
    checks_failed=len([r for r in report.results if not r.passed]),
    warnings=len([r for r in report.results if r.severity == "warning" and not r.passed]),
    report_summary=report.to_dict()
)

if report.failed:
    raise ValueError(f"EEG preprocessing verification failed: {report.summary}")
```

**Output files generated**:
- `{output_dir}/eeg_verification.jsonl` — structured audit log
- `{output_dir}/.eeg_verification_timestamp` — completion marker

## Complementary / Related Skills

- `dependency-planner` + `conda-env-manager` → environment and package installation (MNE-Python + torchaudio + scipy)
- `mne-eeg-tool` → base/tool layer that contains all specific implementation code
- `harness-core` → automated verification and audit logging

## Reference

Aligned with NeuroClaw modality-skill pattern (see `freesurfer-tool`, `wmh-segmentation`, etc.).  
Core libraries: MNE-Python (main), `torchaudio.transforms.MelSpectrogram` (waveform to spectrogram), `scipy.signal.cwt` + `morlet2` (frequency band energy extraction).

---
Created At: 2026-03-25 16:00 HKT  
Last Updated At: 2026-04-05 02:01 HKT
Author: chengwang96