---
name: seed-iv-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the SEED-IV (SJTU Emotion EEG Dataset - 4 emotions) dataset, including EEG validation, preprocessing, feature extraction, and emotion classification. Triggers include: 'SEED-IV', 'SEED4', 'emotion EEG', 'EEG emotion recognition', 'process SEED-IV', or any request to run the SEED-IV pipeline."
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
# SEED-IV Skill (Dataset-Orchestration Layer)

## Overview

`seed-iv-skill` is the NeuroClaw orchestration skill for the **SEED-IV (SJTU Emotion EEG Dataset - 4 emotions)** dataset, developed by the BCMI Lab at Shanghai Jiao Tong University.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for EEG validation, feature extraction, and classification.

**Core workflow (never bypassed):**
1. Identify input SEED-IV data and target analysis.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`seed_iv_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| EEG validation | Validate SEED-IV BIDS structure | `scripts/validate_seed_iv.py` | Validation report |
| EEG preprocessing | Filtering, artifact removal, epoching | `eeg-skill` | `eeg_output/` preprocessed EEG |
| Feature extraction | DE, PSD, connectivity features | `scripts/extract_seed_iv_features.py` | Feature matrices |
| Emotion classification | 4-class emotion recognition | `scripts/classify_seed_iv.py` | Classification results + accuracy |

---

## Dataset Characteristics

- **Cohort**: 15 healthy subjects
- **Sessions**: 3 sessions per subject (different days)
- **Emotions**: 4 classes — happy, sad, fear, neutral
- **Trials**: 24 trials per session (6 per emotion)
- **Stimuli**: Short film clips designed to elicit specific emotions
- **EEG System**: ESI NeuroScan System, 62 channels
- **Sampling rate**: 1000 Hz (downsampled to 200 Hz commonly)
- **Reference**: Linked mastoids (M1/M2)
- **Access**: BCMI Lab (bcmi.sjtu.edu.cn/~seed/)
- **Format**: MATLAB .mat files (community BIDS conversion available)

---

## Supported Modalities

| Modality | Description | Details |
|---|---|---|
| EEG | 62-channel EEG | ESI NeuroScan, 1000 Hz |
| Eye tracking | Eye movement data | Gaze position, blinks |
| Physiological | GSR (galvanic skin response) | Skin conductance |

---

## SEED-IV Emotion Labels

| Label | Emotion | Trials per Session |
|---|---|---|
| 0 | Neutral | 6 |
| 1 | Sad | 6 |
| 2 | Fear | 6 |
| 3 | Happy | 6 |

---

## BIDS Preparation

### Script: `scripts/validate_seed_iv.py`

Validates SEED-IV BIDS structure and generates a compliance report.

```bash
python skills/seed-iv-skill/scripts/validate_seed_iv.py \
  --input /path/to/SEED-IV/bids \
  --output /path/to/seed_iv_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Subject/session completeness check (15 subjects × 3 sessions)
- EEG file presence verification
- Event file validation (emotion labels)

---

## Core Workflow (Never Bypassed)

1. Identify user target: full SEED-IV pipeline, feature extraction only, or classification only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_seed_iv.py`.
5. Delegate to `eeg-skill` for EEG preprocessing (filtering, artifact removal).
6. Run `scripts/extract_seed_iv_features.py` for feature extraction (DE, PSD).
7. Run `scripts/classify_seed_iv.py` for emotion classification.
8. Save outputs into `seed_iv_output/`.

---

## Standard Output Layout

```
seed_iv_output/
├── bids/                   # BIDS-staged data (or validation report)
├── eeg/                    # Preprocessed EEG derivatives
├── features/               # Extracted features (DE, PSD, connectivity)
├── classification/         # Classification results and accuracies
├── qc/                     # QC summaries
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local SEED-IV data validation.

- If the task starts from SEED-IV data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local SEED-IV discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- SEED-IV is a relatively small dataset (15 subjects); cross-subject generalization is challenging.
- 62-channel EEG provides rich spatial information for source localization.
- Differential Entropy (DE) features are the most commonly used for SEED-IV classification.
- Session-level normalization is recommended to handle inter-session variability.
- `seed-iv-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end SEED-IV workflow.
- User asks to process SEED-IV EEG data.
- User needs BIDS validation for SEED-IV data.
- User asks for EEG-based emotion recognition analysis.
- User asks to extract DE or PSD features from SEED-IV.

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
- SEED-IV: https://bcmi.sjtu.edu.cn/~seed/
- BCMI Lab, Shanghai Jiao Tong University
- Zheng & Lu (2015): Investigating Critical Frequency Bands and Channels for EEG-based Emotion Recognition with Deep Neural Networks. IEEE Trans. Autonomous Mental Development.

Created At: 2026-05-06 14:21 HKT
Last Updated At: 2026-05-06 14:21 HKT
Author: chengwang96
