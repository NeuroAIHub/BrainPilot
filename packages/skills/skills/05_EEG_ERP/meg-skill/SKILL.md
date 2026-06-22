---
name: meg-skill
description: "Use this skill whenever the user wants to process MEG (magnetoencephalography) data including source localization, time-frequency analysis, connectivity analysis, sensor-level preprocessing, or MEG-specific feature extraction. Triggers include: 'MEG', 'MEG processing', 'MEG source localization', 'MEG connectivity', 'magnetoencephalography', 'beamformer', 'time-frequency', 'MEG preprocessing', or any request involving MEG data files (.fif, .con, .ds)."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: modality
dependencies:
  - claw-shell
complementary_skills:
  - eeg-skill
  - smri-skill
  - brain-visualization
---
# MEG Skill (Modality Layer)

## Overview

`meg-skill` is the NeuroClaw **modality-layer** interface skill responsible for all MEG (magnetoencephalography) data processing tasks.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to MNE-Python (via `claw-shell`) and companion scripts.
- Companion scripts in `scripts/` provide reference implementations for time-frequency analysis and source localization.

**Core workflow (never bypassed):**
1. Identify input MEG data format (.fif Elekta/Neuromag, .ds CTF, .con KIT/Yokogawa).
2. Ensure T1w structural MRI is available for source localization (via `smri-skill` if not yet processed).
3. Generate a **numbered execution plan** clearly stating WHAT needs to be done.
4. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
5. On confirmation, delegate every step via `claw-shell`.
6. After execution, save all outputs in a clean directory structure (`meg_output/`).

**Research use only.**

---

## Quick Reference (Common MEG Tasks)

| Task | What needs to be done | Implementation via | Expected output |
|---|---|---|---|
| Load & validation | Read raw MEG, check channel types, info metadata | MNE-Python (`mne.io`) | Raw object + validation report |
| Maxwell filtering | Signal-space separation (SSS) for Elekta systems | MNE-Python (`mne.preprocessing.maxwell_filter`) | Cleaned raw MEG |
| Filtering | Band-pass, notch (line noise removal at 50/60 Hz) | MNE-Python (`raw.filter`, `raw.notch_filter`) | Filtered raw data |
| Epoching | Segment continuous data around events | MNE-Python (`mne.Epochs`) | Epoched data |
| ICA artifact removal | Remove cardiac, ocular, environmental artifacts | MNE-Python (`mne.preprocessing.ICA`) | Cleaned epochs |
| Time-frequency analysis | Morlet wavelet multitaper, Hilbert transform | `scripts/time_frequency.py` | TFR maps (power, ITC) |
| Source localization | Forward/inverse modeling (MNE, dSPM, beamformer) | MNE-Python + FreeSurfer | Source estimates in brain space |
| Source-space connectivity | Coherence, PLV, dPLI between source parcels | MNE-Python (`mne_connectivity`) | Connectivity matrices |
| Sensor-level connectivity | Coherence, PLV between sensor pairs | MNE-Python | Sensor connectivity |
| Evoked responses | Average epochs, compute ERPs/ERFs | MNE-Python (`epochs.average`) | Evoked NIfTI/fif files |

---

## Supported MEG File Formats

| Format | System | Extension | Reader |
|---|---|---|---|
| Elekta/Neuromag | VectorView, TRIUX | `.fif` | `mne.io.read_raw_fif` |
| CTF | CTF MEG systems | `.ds` | `mne.io.read_raw_ctf` |
| KIT/Yokogawa | KIT, Ricoh | `.con`, `.mrk` | `mne.io.read_raw_kit` |
| BIDS MEG | Any (BIDS format) | `.meg.fif` | `mne.io.read_raw_fif` |

---

## Core Processing Pipeline

### Stage 1: Data Loading & Validation
- Load raw MEG data and validate channel types (magnetometers, gradiometers, EEG, EOG, ECG, STIM)
- Check sampling rate, duration, and channel count
- Report bad channels if annotated

### Stage 2: Preprocessing
- **Maxwell filtering** (SSS/tSSS): for Elekta systems, remove environmental noise
- **Band-pass filtering**: typically 1–100 Hz for sensor-level analysis
- **Notch filter**: remove power line noise (50 Hz or 60 Hz)
- **Downsampling**: optional, to reduce computation (e.g., 1000 Hz → 250 Hz)

### Stage 3: Artifact Removal (ICA)
- Run ICA (FastICA, Infomax, or Picard)
- Auto-detect and remove cardiac (ECG), ocular (EOG), and muscle artifacts
- Correlate ICA components with ECG/EOG channels

### Stage 4: Epoching & Averaging
- Segment around events of interest
- Baseline correction
- Reject bad epochs (amplitude threshold, autoreject)
- Compute evoked responses (ERFs)

### Stage 5: Time-Frequency Analysis (via `scripts/time_frequency.py`)
- Morlet wavelet or multitaper spectral analysis
- Compute power spectral density per frequency band (δ/θ/α/β/γ)
- Inter-trial coherence (ITC)

### Stage 6 (Optional): Source Localization
- Requires T1w MRI from `smri-skill` and FreeSurfer cortical reconstruction
- Compute forward model (BEM or sphere)
- Apply inverse solution (MNE, dSPM, sLORETA, or LCMV beamformer)
- Output source estimates on cortical surface

---

## Scripts

### `scripts/time_frequency.py`
Computes time-frequency representations from MEG epochs.

```bash
python skills/meg-skill/scripts/time_frequency.py \
  --epochs /path/to/epochs.fif \
  --output /path/to/meg_output/tfr/ \
  --freq-min 1 --freq-max 100 --freq-steps 40 \
  --method morlet \
  --baseline -0.2 0.0
```

---

## Standard Output Layout

```
meg_output/
├── preprocessed/          # Filtered, cleaned raw MEG
├── epochs/                # Epoched data (.fif)
├── evoked/                # Averaged evoked responses (.fif, .nii.gz)
├── tfr/                   # Time-frequency results
│   ├── power_*.nii.gz
│   └── itc_*.nii.gz
├── source/                # Source estimates (if source localization run)
│   ├── stc_*.lh.stc
│   └── stc_*.rh.stc
├── connectivity/          # Connectivity matrices (if requested)
├── qc/                    # Quality control reports
└── logs/
```

---

## Installation (Handled by dependency-planner)

No manual installation required at this layer.
When first used, `meg-skill` automatically calls `dependency-planner` to install MNE-Python and dependencies via conda.

---

## Important Notes & Limitations

- MEG data is large (hundreds of MB to GB per recording); ensure sufficient disk space.
- Maxwell filtering (SSS) is specific to Elekta/Neuromag systems; CTF and KIT systems use different approaches.
- Source localization requires co-registered T1w MRI and MEG sensor positions (head position indicator coils or digitized head shape).
- MNE-Python is the primary backend; all MEG processing is built on MNE.
- MEG has millisecond temporal resolution but lower spatial resolution than fMRI.
- BIDS-MEG format follows the BIDS extension for MEG: https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/02-magnetoencephalography.html
- This skill is for research workflows; not for clinical decision-making.

---

## When to Call This Skill

- When the user provides MEG data (.fif, .ds, .con) and requests preprocessing, artifact removal, or analysis.
- When time-frequency analysis or source localization is needed for MEG data.
- When MEG connectivity analysis (sensor-level or source-level) is requested.
- When `eeg-skill` handles EEG but the data also includes MEG channels.
- When dataset skills (e.g., `Cam-CAN`) delegate MEG processing.

---

## Complementary / Related Skills

- `eeg-skill` → EEG processing (MEG and EEG share many MNE-Python tools)
- `smri-skill` → T1w structural preprocessing (required for source localization)
- `freesurfer-tool` → cortical reconstruction for source-space analysis
- `nibabel-skill` → NIfTI I/O for surface/volume data
- `brain-visualization` → MEG source overlay visualization
- `nilearn-tool` → post-hoc statistical analysis on source estimates

---

## Reference
- MNE-Python: https://mne.tools/
- Gramfort et al. (2013): MEG and EEG data analysis with MNE-Python
- Taulu & Simola (2006): Spatiotemporal signal space separation (SSS)
- BIDS MEG: https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/02-magnetoencephalography.html
- Cam-CAN dataset: https://www.cam-can.org/

Created At: 2026-05-06 12:19 HKT
Last Updated At: 2026-05-06 12:19 HKT
Author: chengwang96
