---
name: camcan-skill
description: "Use this skill whenever the user wants an end-to-end workflow for the Cam-CAN (Cambridge Centre for Ageing and Neuroscience) dataset, including BIDS validation, multimodal processing of sMRI, rs-fMRI, task-fMRI, and MEG, phenotype extraction, and QC integration. Triggers include: 'Cam-CAN', 'CamCAN', 'process Cam-CAN data', 'Cam-CAN MEG', 'Cam-CAN fMRI', or any request to run the Cam-CAN multimodal pipeline."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: subagent
skill_type: dataset
dependencies:
  - smri-skill
  - fmri-skill
  - meg-skill
  - bids-organizer
  - claw-shell
complementary_skills:
  - mne-eeg-tool
---
# Cam-CAN Skill (Dataset-Orchestration Layer)

## Overview

`camcan-skill` is the NeuroClaw orchestration skill for the **Cam-CAN (Cambridge Centre for Ageing and Neuroscience)** dataset.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills via `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for BIDS validation, phenotype extraction, and QC.

**Core workflow (never bypassed):**
1. Identify input Cam-CAN data and target modalities.
2. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
3. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
4. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
5. After execution, save all outputs in a clean directory structure (`camcan_output/`).

**Research use only.**

---

## Quick Reference

| Task | What needs to be done | Delegate to | Expected output |
|---|---|---|---|
| BIDS validation | Validate Cam-CAN BIDS structure | `scripts/validate_camcan.py` | Validation report |
| sMRI processing | Brain extraction, tissue segmentation, cortical reconstruction | `smri-skill` | `smri_output/` derivatives |
| rs-fMRI processing | Preprocessing, denoising, connectivity | `fmri-skill` | `fmri_output/` derivatives |
| task-fMRI processing | Movie-watching task GLM, activation analysis | `fmri-skill` | `fmri_output/` task results |
| MEG processing | Source localization, time-frequency analysis | `meg-skill` | `meg_output/` TFR and source |
| Phenotype extraction | Cognitive, sensory, health measures | `scripts/extract_camcan_phenotype.py` | Merged phenotype CSV |
| QC summary | Per-subject quality control | `scripts/camcan_qc_summary.py` | QC summary + exclusion list |

---

## Dataset Characteristics

- **Cohort**: ~700 participants spanning the adult lifespan (18-88 years)
- **Design**: Cross-sectional population-based sample
- **Site**: MRC Cognition and Brain Sciences Unit, Cambridge, UK
- **Scanner**: Siemens 3T TIM TRIO
- **MEG system**: CTF 275-channel system
- **Access**: OpenNeuro ds003097 (CC0 license)

---

## Supported Modalities

| Modality | Description | Tasks/Conditions |
|---|---|---|
| T1w | High-resolution structural MRI | Single acquisition |
| T2*w | Functional MRI (multi-echo EPI) | Resting-state (eyes open), Movie-watching |
| MEG | Magnetoencephalography | Resting-state (eyes open), Auditory (passive listening), Visual (passive viewing) |
| dMRI | Diffusion-weighted imaging | DTI tractography |

---

## Cam-CAN Task Paradigms

### fMRI Tasks
| Task | Description | Duration |
|---|---|---|
| REST | Resting-state (eyes open) | ~8 min |
| MOVIE | Movie-watching (feature film excerpts) | ~15 min |

### MEG Tasks
| Task | Description | Duration |
|---|---|---|
| REST | Resting-state (eyes open, eyes closed) | ~8 min |
| AUDITORY | Passive listening to tones and speech | ~5 min |
| VISUAL | Passive viewing of visual stimuli | ~5 min |

---

## BIDS Preparation

### Script: `scripts/validate_camcan.py`

Validates Cam-CAN BIDS structure and generates a compliance report.

```bash
python skills/camcan-skill/scripts/validate_camcan.py \
  --input /path/to/CamCAN/bids \
  --output /path/to/camcan_output/qc/bids_validation.csv
```

Features:
- BIDS directory structure validation
- Modality completeness check (T1w, T2*w, MEG, dMRI)
- Sidecar JSON presence and content validation
- Participant ID consistency across modalities
- Missing data identification and reporting

---

## Core Workflow (Never Bypassed)

1. Identify user target: full Cam-CAN processing, imaging subset, phenotype extraction, or BIDS validation only.
2. Generate a numbered plan with tools, outputs, runtime, storage, and risks.
3. Wait for explicit confirmation (`YES` / `execute` / `proceed`).
4. On confirmation, run BIDS validation using `scripts/validate_camcan.py`.
5. Delegate to `smri-skill` for structural MRI processing.
6. Delegate to `fmri-skill` for functional MRI processing (resting-state and movie-watching).
7. Delegate to `meg-skill` for MEG processing (source localization, time-frequency analysis).
8. If phenotype extraction is requested, run `scripts/extract_camcan_phenotype.py`.
9. If QC summary is requested, run `scripts/camcan_qc_summary.py`.
10. Save outputs into `camcan_output/`.

---

## Modality Processing Delegation

| Modality | Delegated skill | Typical tasks | Main outputs |
|---|---|---|---|
| sMRI (T1w) | `smri-skill` | brain extraction, tissue segmentation, cortical reconstruction | `smri_output/` derivatives |
| fMRI (T2*w) | `fmri-skill` | preprocessing, denoising, connectivity, task GLM | `fmri_output/` derivatives |
| MEG | `meg-skill` | source localization, time-frequency, connectivity | `meg_output/` TFR and source |
| dMRI | `dwi-skill` | diffusion preprocessing, tensor metrics | `dwi_output/` metrics |

---

## Standard Output Layout

```
camcan_output/
├── bids/                   # BIDS-staged data (or validation report)
├── smri/                   # Structural MRI derivatives
├── fmri/                   # Functional MRI derivatives (rest + movie)
├── meg/                    # MEG derivatives (TFR, source, connectivity)
├── dwi/                    # Diffusion MRI derivatives
├── phenotype/              # Merged phenotype tables
├── qc/                     # QC summaries and exclusion lists
└── logs/                   # Processing logs
```

---

## Benchmark Adapter Guidance

For benchmark-style prompts, do not force the full orchestration when the task only asks for local Cam-CAN data validation or staging.

- If the task starts from Cam-CAN data already present on disk and only asks for BIDS validation:
  - Skip the download stage
  - Default to the narrow path `local Cam-CAN discovery -> BIDS validation -> report`
- In benchmark mode, do not require explicit confirmation before presenting the validation solution.

---

## Safety and Execution Policy
- No execution before explicit plan confirmation.
- All execution must be routed via `claw-shell`.
- Missing dependencies must be resolved by `dependency-planner` before running.

---

## Important Notes and Limitations
- Cam-CAN is a population-based sample spanning the full adult lifespan (18-88 years).
- MEG data uses CTF 275-channel system; MEG processing requires system-specific handling.
- Movie-watching fMRI is a unique task paradigm; standard GLM may not apply.
- Age range is a key variable; consider age-stratified analyses.
- Data is available on OpenNeuro ds003097 in BIDS format.
- `camcan-skill` is orchestration-only; detailed preprocessing logic remains in modality skills.

---

## When to Call This Skill
- User asks for end-to-end Cam-CAN workflow.
- User asks to process Cam-CAN MRI and/or MEG data.
- User needs BIDS validation for Cam-CAN data.
- User asks to extract Cam-CAN phenotype data (cognitive, sensory, health).
- User asks for age-related brain imaging analysis using Cam-CAN.

---

## Complementary / Related Skills
- `smri-skill` → structural MRI preprocessing
- `fmri-skill` → functional MRI preprocessing and analysis
- `meg-skill` → MEG processing (source localization, time-frequency)
- `mne-eeg-tool` → MNE-Python EEG/MEG processing
- `bids-organizer` → BIDS validation and organization
- `brain-visualization` → visualization of derivatives
- `dependency-planner` → dependency resolution
- `conda-env-manager` → environment management
- `claw-shell` → command execution

---

## Reference
- Cam-CAN: https://camcan.mrc-cbu.cam.ac.uk/
- OpenNeuro ds003097: https://openneuro.org/datasets/ds003097
- Shafto et al. (2014): The Cam-CAN study protocol. BMC Neurology.
- Taylor et al. (2017): The Cam-CAN data repository. NeuroImage.

Created At: 2026-05-06 13:31 HKT
Last Updated At: 2026-05-06 13:31 HKT
Author: chengwang96
