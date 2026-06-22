---
name: seed-vig-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the SEED-VIG (SJTU Emotion EEG Dataset - Vigilance) dataset, including EEG validation, preprocessing, feature extraction, and vigilance/fatigue detection. Triggers include: 'SEED-VIG', 'SEEDVIG', 'vigilance EEG', 'fatigue detection', 'drowsiness EEG', 'process SEED-VIG', or any request to run the SEED-VIG pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - eeg-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - brain-visualization
---
# SEED-VIG Skill (Dataset-Orchestration Layer)

## Overview

`seed-vig-skill` is the NeuroClaw orchestration skill for the **SEED-VIG (SJTU Emotion EEG Dataset - Vigilance)** dataset, developed by the BCMI Lab at Shanghai Jiao Tong University for vigilance/fatigue detection research.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for EEG validation, feature extraction, and vigilance classification.

**Core workflow (never bypassed):**
1. Identify input SEED-VIG data and target analysis.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`seed_vig_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| EEG validation | Validate SEED-VIG BIDS structure | `scripts/validate_seed_vig.py` | Validation report |
| EEG preprocessing | Filtering, artifact removal | `eeg-skill` | `eeg_output/` preprocessed EEG |
| Feature extraction | Band power, DE, connectivity | `scripts/extract_seed_vig_features.py` | Feature matrices |
| Vigilance classification | Binary/multi-class vigilance detection | `scripts/classify_seed_vig.py` | Classification results |

---

## Dataset Characteristics

- **Cohort**: 23 healthy subjects
- **Task**: Simulated driving task (vigilance decrement paradigm)
- **EEG System**: 17-channel EEG (ESI NeuroScan or dry electrodes)
- **Sampling rate**: 200 Hz
- **Reference**: Linked mastoids (M1/M2)
- **Labels**: Vigilance levels (KSS scale or EEG-derived)
- **Duration**: ~2 hours per subject
- **Access**: BCMI Lab (bcmi.sjtu.edu.cn/~seed/)
- **Format**: MATLAB .mat files (community BIDS conversion available)

---

## Supported Modalities

| Modality | Description | Details |
|---|---|---|
| EEG | 17-channel EEG | ESI NeuroScan, 200 Hz |
| Eye tracking | Eye movement data | Blinks, gaze position |
| Peripheral | EOG, EMG | Eye/muscle artifacts |

---

## SEED-VIG Vigilance Labels

| Label | Description | Method |
|---|---|---|
| KSS | Karolinska Sleepiness Scale | Self-report (1-9) |
| EEG-based | Theta/alpha/beta power ratios | Spectral analysis |
| Binary | Alert vs. Drowsy | Threshold-based |

---

## BIDS Preparation

### Script: `scripts/validate_seed_vig.py`

Validates SEED-VIG BIDS structure and generates a compliance report.

```bash
python skills/seed-vig-skill/scripts/validate_seed_vig.py \
  --input /path/to/SEED-VIG/bids \
  --output /path/to/seed_vig_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Subject completeness check (23 subjects)
- EEG file presence verification
- Vigilance label availability check

---

## Core Workflow (Never Bypassed)

1. Identify user target: full SEED-VIG pipeline, feature extraction only, or classification only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_seed_vig.py`.
5. Delegate to `eeg-skill` for EEG preprocessing.
6. Run `scripts/extract_seed_vig_features.py` for feature extraction.
7. Run `scripts/classify_seed_vig.py` for vigilance classification.
8. Save outputs into `seed_vig_output/`.

---

## Standard Output Layout

```
seed_vig_output/
├── bids/                   # BIDS-staged data (or validation report)
├── eeg/                    # Preprocessed EEG derivatives
├── features/               # Extracted features (band power, DE)
├── classification/         # Vigilance classification results
├── qc/                     # QC summaries
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local SEED-VIG data validation.

- If the task starts from SEED-VIG data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local SEED-VIG discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- 17-channel EEG provides limited spatial resolution compared to high-density systems.
- Simulated driving may not fully replicate real-world drowsiness.
- Theta/alpha/beta power ratios are commonly used spectral features for vigilance detection.
- Cross-subject calibration is often needed due to individual differences in EEG patterns.
- `seed-vig-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end SEED-VIG workflow.
- User asks to process SEED-VIG EEG data.
- User needs BIDS validation for SEED-VIG data.
- User asks for EEG-based vigilance/fatigue detection analysis.
- User asks for drowsiness detection or alertness monitoring.

---

## Complementary / Related Skills
- `eeg-skill` → EEG preprocessing and feature extraction
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- SEED-VIG: https://bcmi.sjtu.edu.cn/~seed/
- BCMI Lab, Shanghai Jiao Tong University
- Wei et al. (2017): EEG-based vigilance estimation using extreme learning machines. Neurocomputing.

Created At: 2026-05-06 14:21 HKT
Last Updated At: 2026-05-06 14:21 HKT
Author: chengwang96
