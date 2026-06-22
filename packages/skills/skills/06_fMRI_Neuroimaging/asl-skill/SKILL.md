---
name: asl-skill
description: "Use this skill whenever the user wants to process Arterial Spin Labeling (ASL) perfusion MRI data including CBF (cerebral blood flow) quantification, ASL preprocessing (motion correction, partial volume correction, M0 normalization), or ASL-based brain perfusion analysis. Triggers include: 'ASL', 'ASL processing', 'CBF', 'cerebral blood flow', 'perfusion MRI', 'arterial spin labeling', 'pCASL', 'CASL', 'PASL', or any request involving ASL perfusion data."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: subagent
skill_type: modality
dependencies:
  - fsl-tool
  - nibabel-skill
  - claw-shell
complementary_skills:
  - smri-skill
  - fmri-skill
---
# ASL Skill (Modality Layer)

## Overview

`asl-skill` is the NeuroClaw **modality-layer** interface skill responsible for all Arterial Spin Labeling (ASL) perfusion MRI data processing tasks.

It strictly follows the NeuroClaw hierarchical design principles:
- This skill **only describes WHAT needs to be done** and **which tool skill to delegate to**.
- It contains **no implementation code or concrete commands**.
- All concrete execution is delegated to existing base/tool skills: `fsl-tool`, `nibabel-skill`, and `claw-shell`.
- Companion scripts in `scripts/` provide reference implementations for CBF quantification.

**Core workflow (never bypassed):**
1. Identify input ASL data and labeling strategy (pCASL, CASL, or PASL).
2. Ensure T1w structural data is available (via `smri-skill` if not yet processed).
3. Generate a **numbered execution plan** clearly stating WHAT needs to be done and which tool skill will handle each step.
4. Present the full plan, estimated runtime, resource requirements, and risks to the user and wait for explicit confirmation ("YES" / "execute" / "proceed").
5. On confirmation, delegate every step to the appropriate skill via `claw-shell`.
6. After execution, save all outputs in a clean directory structure (`asl_output/`).

**Research use only.**

---

## Quick Reference (Common ASL Tasks)

| Task | What needs to be done | Delegate to which tool skill | Expected output |
|---|---|---|---|
| ASL preprocessing | Motion correction, masking, registration to T1w | `fsl-tool` (ASL_PREPCORE) | Preprocessed ASL in T1w space |
| M0 normalization | Divide ASL difference image by M0 reference image to get perfusion signal | `fsl-tool` or `scripts/compute_cbf.py` | Normalized perfusion map |
| CBF quantification | Convert perfusion signal to absolute CBF (mL/100g/min) using Buxton model | `scripts/compute_cbf.py` | CBF map (NIfTI) + ROI summary (CSV) |
| Partial volume correction | Correct CBF for gray/white matter partial volume effects | `fsl-tool` + tissue segmentation | PVC-corrected CBF map |
| ASL-to-MNI normalization | Warp CBF map to MNI152 template for group analysis | `fsl-tool` (FNIRT) or `smri-skill` | CBF in MNI152 space |
| ROI-based CBF extraction | Extract mean CBF from atlas-defined ROIs | `fsl-tool` + atlas | Per-region CBF values (CSV) |
| Quality control | Check for outliers, low SNR, motion artifacts in ASL series | `scripts/compute_cbf.py` (--qc) | QC report |

---

## ASL Labeling Strategies

| Strategy | Description | Typical Parameters |
|---|---|---|
| **pCASL** (pseudo-Continuous ASL) | Most common; single PLD, good SNR | Label duration: 1.5–2.0 s, PLD: 1.5–2.0 s |
| **CASL** (Continuous ASL) | Longer labeling, higher SNR but more sensitive to transit effects | Label duration: 2–4 s, PLD: 1–2 s |
| **PASL** (Pulsed ASL) | Short labeling, lower SNR, no separate M0 needed (QUIPSS II) | Bolus thickness: 10–15 cm, TI1/TI2: 700/1800 ms |

---

## Core CBF Quantification Model

The Buxton single-compartment model for pCASL:

```
CBF = (6000 * ΔM * λ) / (2 * α * M0 * T1b * (exp(-w/T1b) - exp(-(τ+w)/T1b)))   [mL/100g/min]
```

Where:
- ΔM = ASL difference image (control - label)
- M0 = equilibrium magnetization of arterial blood
- λ = blood-tissue water partition coefficient (0.9 mL/g)
- α = labeling efficiency (0.85 for pCASL, 0.95 for CASL, 0.98 for PASL)
- T1b = T1 of arterial blood at 3T (~1.65 s) or 1.5T (~1.35 s)
- w = post-labeling delay (PLD)
- τ = label duration

---

## Scripts

### `scripts/compute_cbf.py`
Computes CBF maps from ASL difference images and M0 reference.

```bash
python skills/asl-skill/scripts/compute_cbf.py \
  --diff /path/to/asl_diff.nii.gz \
  --m0 /path/to/m0_reference.nii.gz \
  --output /path/to/asl_output/cbf_map.nii.gz \
  --roi-summary /path/to/asl_output/cbf_roi.csv \
  --roi-atlas /path/to/atlas_in_asl_space.nii.gz \
  --label-strategy pcasl \
  --pld 1.8 \
  --label-duration 1.8 \
  --field-strength 3.0
```

---

## Standard Output Layout

```
asl_output/
├── preprocessed/          # Motion-corrected, registered ASL
├── cbf/                   # CBF maps
│   ├── cbf_map.nii.gz
│   ├── cbf_roi.csv
│   └── cbf_mni.nii.gz    # (if normalization requested)
├── pvc/                   # Partial volume corrected CBF (if requested)
├── qc/                    # Quality control reports
│   └── asl_qc_report.csv
└── logs/
```

---

## Installation (Handled by dependency-planner)

No manual installation required at this layer.
When first used, `asl-skill` automatically calls `dependency-planner` to ensure `fsl-tool`, `nibabel-skill`, and `claw-shell` are ready.

---

## Important Notes & Limitations

- ASL has inherently low SNR compared to BOLD fMRI; averaging multiple control-label pairs is recommended.
- M0 image is required for absolute CBF quantification; if absent, only relative CBF can be computed.
- PLD and labeling duration must be known from the acquisition protocol; incorrect values invalidate CBF.
- At 3T, T1b ≈ 1.65 s; at 1.5T, T1b ≈ 1.35 s.
- Partial volume correction is important for ASL due to its low resolution (~3–4 mm).
- ASLPrep (https://aslprep.readthedocs.io/) is the recommended automated pipeline for large cohorts.
- This skill is for research workflows; not for clinical decision-making.

---

## When to Call This Skill

- After `smri-skill` when T1w structural preprocessing is complete and ASL data needs processing.
- When the user needs CBF quantification from pCASL, CASL, or PASL data.
- When ASL-to-T1w coregistration or normalization to MNI space is required.
- When partial volume correction is requested for ASL perfusion analysis.
- When dataset skills (e.g., PNC) delegate ASL processing.

---

## Complementary / Related Skills

- `smri-skill` → T1w structural preprocessing (brain extraction, tissue segmentation for PVC)
- `fmri-skill` → if ASL is used alongside BOLD for multimodal analysis
- `fsl-tool` → ASL_PREPCORE (preprocessing), FLIRT/FNIRT (registration/normalization), BASIL (CBF quantification)
- `nibabel-skill` → NIfTI I/O for mask manipulation
- `nilearn-tool` → ROI-based CBF extraction
- `brain-visualization` → CBF map visualization

---

## Reference
- Alsop et al. (2015): Recommended implementation of ASL (Magnetic Resonance in Medicine)
- Buxton et al. (1998): General kinetic model for ASL (Journal of Cerebral Blood Flow & Metabolism)
- ASLPrep: https://aslprep.readthedocs.io/
- FSL BASIL: https://fsl.fmrib.ox.ac.uk/fsl/fslwiki/BASIL
- BIDS ASL extension: https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/11-arterial-spin-labeling.html

Created At: 2026-05-06 12:19 HKT
Last Updated At: 2026-05-06 12:19 HKT
Author: chengwang96
