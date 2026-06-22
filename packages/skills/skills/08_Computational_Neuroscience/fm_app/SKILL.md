---
name: fm_app
description: "Use this model doc whenever the user wants to run FM-APP for phenotype prediction using fMRI ROI features and optional sMRI features. This document provides model-level usage and delegates preprocessing to fmri-skill and smri-skill."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - smri-skill
  - run_models
---
# FM-APP Model Doc

## Overview
FM-APP is a multi-stage framework for phenotype prediction via fMRI to sMRI knowledge transfer.

- Paper: He Z, Li W, Liu Y, et al. FM-APP, IEEE TMI, 2024, 44(10): 4010-4022
- Official code: https://github.com/ZhibinHe/FM-APP
- Primary input: fMRI ROI connectivity features
- Additional input: sMRI ROI structural features (required in Stage 2)
- Primary output: multi-phenotype prediction and zero-shot phenotype reconstruction

In NeuroClaw, this is model-level guidance. Upstream preparation should be delegated to:
- `fmri-skill` for fMRI preprocessing and ROI extraction
- `smri-skill` for structural ROI feature extraction
- `hcpya-skill` if HCP Young Adult download/orchestration is needed

**Research use only.**

---

## Quick Start (From git clone)

### 1) Clone repository
```bash
git clone https://github.com/ZhibinHe/FM-APP.git
cd FM-APP
```

### 2) Create environment and install dependencies
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If using GPU, install CUDA-compatible PyTorch and graph-related packages first.

### 3) Prepare required data
Before training, ensure these are ready:
- fMRI ROI/connectivity features from `fmri-skill`
- sMRI ROI structural features from `smri-skill` (for Stage 2)
- phenotype CSV files and text feature tensors in `data/`

### 4) Run staged pipeline
```bash
# Stage 0: data preparation (example scripts)
python 00-create-folder_hcp_4fmri.py
python 01-fetch_data_hcp_4fmri.py
python 02-process_data_hcp_4fmri.py

# Stage 1: fMRI model training
python 101-main_stage1_fmri_HCP.py

# Stage 2: fMRI-T1w alignment
python 102-main_stage2_fmri_t1w_HCP.py

# Stage 3: decoder and zero-shot inference
python 103-main_stage3_t1w_HCP.py
```

---

## Pipeline Definition

| Stage | Script pattern | Purpose | Core output |
|---|---|---|---|
| Stage 0 | `00-*`, `01-*`, `02-*` | Data folder setup, ROI connectivity extraction, HDF5 packaging | `raw/*.h5`, processed inputs |
| Stage 1 | `101-main_stage1_fmri_HCP.py` | fMRI feature extraction and phenotype regression | `model/stage1_*.pth`, `model/stage1_dataset_*.pt` |
| Stage 2 | `102-main_stage2_fmri_t1w_HCP.py` | fMRI-T1w feature alignment (Sinkhorn-RPM) | `model/stage2_*.pth` |
| Stage 3 | `103-main_stage3_t1w_HCP.py` | masked decoder training and zero-shot phenotype inference | stage-3 checkpoints and inference outputs |

Run order must be: Stage 0 -> Stage 1 -> Stage 2 -> Stage 3.

---

## Stage Inputs and Outputs

### Stage 0 (Data Preparation)
Required inputs:
- subject lists and dataset files (HCP/HCPA)
- phenotype CSV files under `data/`
- pre-encoded text feature tensors (`*.pt`)

Main outputs:
- per-subject connectivity features (corr/pcorr)
- HDF5 packaged samples for model training

### Stage 1 (fMRI Training)
Required inputs:
- Stage 0 packaged features
- phenotype text features

Main outputs:
- best checkpoint: `model/stage1_fmri_best_*.pth`
- stage1 feature package: `model/stage1_dataset_*.pt`

### Stage 2 (fMRI-sMRI Alignment)
Required inputs:
- frozen Stage 1 model/features
- sMRI ROI features (e.g., 333x9 per subject)

Main outputs:
- best checkpoint: `model/stage2_fmri_to_t1w_best_*.pth`

### Stage 3 (Decoder and Zero-shot)
Required inputs:
- Stage 1 fused features and regression weights
- masks / phenotype supervision setup

Main outputs:
- decoder checkpoints
- reconstructed masked phenotype representations

---

## Typical Configuration Notes

- Atlas: Gordon333 (333 ROIs)
- Stage 1 typical settings: Adam, lr=0.0005, batch size=8, long-epoch training
- Stage 2 includes Sinkhorn matching; runtime is usually higher than Stage 1
- Stage 3 supports zero-shot phenotype inference using masked reconstruction

---

## Recommended Directory Layout

```text
FM-APP/
  data/
    HCP_train_phenotype.csv
    HCP_test_phenotype.csv
    HCP_all_phenotype.csv
    HCPA_train_phenotype.csv
    HCPA_test_phenotype.csv
    phenotype_text_feature_tr.pt
    phenotype_text_feature_te.pt
    HCPA_phenotype_text_feature_tr.pt
    HCPA_phenotype_text_feature_te.pt
  raw/
    *.h5
  model/
    stage1_*.pth
    stage2_*.pth
    stage1_dataset_*.pt
  net/
  imports/
  loss_function/
  util/
  requirements.txt
```

---

## NeuroClaw Delegation Rules

- fMRI preprocessing and ROI extraction: `fmri-skill`
- sMRI feature extraction: `smri-skill`
- HCP data orchestration: `hcpya-skill` (or `hcpa-skill` / `hcpd-skill` / `hcpep-skill` for other HCP variants)
- dependency management: `dependency-planner` + `conda-env-manager`
- command execution: `claw-shell`

No execution before explicit plan confirmation.

---

## Limitations and Notes

- CUDA-capable GPU is strongly recommended for training.
- Stage 2 depends on valid Stage 1 artifacts and sMRI features.
- Stage 3 depends on `stage1_dataset_*.pt` and proper masking setup.
- Keep train/val/test split strict to avoid leakage.
- Verify phenotype column counts and subject ID alignment before Stage 1.

---

## Reference

- He Z, Li W, Liu Y, et al. FM-APP: Foundation model for any phenotype prediction via fMRI to sMRI knowledge transfer. IEEE Transactions on Medical Imaging, 2024, 44(10): 4010-4022.
- Official repository: https://github.com/ZhibinHe/FM-APP
- NeuroSTORM HCP download scripts: https://github.com/CUHK-AIM-Group/NeuroSTORM/tree/main/scripts/dataset_download

Created At: 2026-03-28 20:03 HKT
Last Updated At: 2026-03-28 20:03 HKT
Author: chengwang96
