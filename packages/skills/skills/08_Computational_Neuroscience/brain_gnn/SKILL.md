---
name: braingnn
description: "Use this model doc whenever the user wants to run BrainGNN for fMRI phenotype prediction, including graph construction, training, and evaluation. This document focuses on model-level usage and delegates upstream preprocessing to fmri-skill (and optionally hcpya-skill for HCP data)."
license: MIT License (NeuroClaw custom skill - freely modifiable within the project)
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - run_models
---
# BrainGNN Model Doc

## Overview
BrainGNN is an interpretable graph neural network for fMRI analysis and phenotype prediction.

- Paper: Li et al., 2020, BrainGNN
- Official code: https://github.com/xxlya/BrainGNN_Pytorch/tree/main
- Primary input: ROI-level fMRI data (timeseries/connectivity)
- Primary output: phenotype prediction (classification/regression, task-dependent)

In NeuroClaw, this document is model-level guidance. Upstream data preparation should be delegated to:
- `fmri-skill` for fMRI preprocessing and ROI extraction
- `hcpya-skill` when HCP Young Adult dataset download/orchestration is needed

**Research use only.**

---

## Quick Start (From git clone)

### 1) Clone repository
```bash
git clone https://github.com/xxlya/BrainGNN_Pytorch.git
cd BrainGNN_Pytorch
```

### 2) Create environment and install dependencies
```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

If using GPU, install version-matched PyTorch/PyG builds first, then install remaining requirements.

### 3) Prepare data (ROI first)
Use `fmri-skill` to prepare ROI timeseries and metadata, then arrange files under:
- `data/{dataset_name}-rest.csv`
- `data/{dataset_name}_roi/`

### 4) Run 3-phase pipeline
```bash
# Phase 1: build connectivity matrices
python 01-fetch_data.py --atlas aal3 --dataset_name adhd200 --dataset_dir data

# Phase 2: convert to graph samples
python 02-process_data.py --atlas aal3 --dataset_name adhd200 --dataset_dir data --nclass 2 --score DX

# Phase 3: train/evaluate BrainGNN
CUDA_VISIBLE_DEVICES=0 python 03-main.py \
  --atlas aal3 --dataset_name adhd200 --dataset_dir data \
  --indim 166 --nroi 166 --nclass 2 --fold 0
```

---

## Pipeline Definition

### Phase 1: Connectivity Generation (`01-fetch_data.py`)
Purpose: convert ROI timeseries to connectivity features.

Outputs:
- `data/{dataset_name}_roi/braingnn_{atlas}/*.mat`
- `data/{dataset_name}_roi/braingnn_{atlas}/valid_subject_list.pkl`

Key args:
- `--atlas`: `aal3`, `dk`, `cc200`, `ho`
- `--dataset_name`: `adhd200`, `cobre`, `UCLA`, `hcp-d`, `hcp-ep`, `ABCD`
- `--dataset_dir`: root data dir, default `data`

### Phase 2: Graph Construction (`02-process_data.py`)
Purpose: convert connectivity matrices into per-subject graph files.

Outputs:
- `data/{dataset_name}_roi/braingnn_{atlas}/raw/{subject_id}.h5`

Common args:
- `--nclass`: class count
- `--score`: label key (`DX`, `Gender`, `Age`)
- `--seed`: random seed

### Phase 3: Training and Evaluation (`03-main.py`)
Purpose: train BrainGNN with fold-wise evaluation and checkpointing.

Outputs:
- `model/{fold}.pth`
- `model/log/{fold}/` (TensorBoard)

Core model options:
- `--indim`, `--nroi`: must match atlas ROI count
- `--nclass`: output classes
- `--fold`: CV fold index
- `--n_epochs`, `--batchSize`, `--lr`, `--weightdecay`

---

## Input / Output Contract

### Required inputs
- ROI timeseries per subject
- Subject metadata CSV with labels
- Dataset name and atlas selection

### Produced outputs
- Connectivity matrices and graph files
- Trained checkpoint(s)
- Evaluation logs and metrics

---

## Atlas and Dimension Mapping

| Atlas | Typical ROI count | Required flags |
|---|---:|---|
| `aal3` | 166 | `--indim 166 --nroi 166` |
| `cc200` | 200 | `--indim 200 --nroi 200` |
| `dk` | atlas-dependent | set both flags to actual ROI count |
| `ho` | atlas-dependent | set both flags to actual ROI count |

If `--indim` or `--nroi` does not match the real ROI count, training will fail.

---

## Recommended Directory Layout

```text
BrainGNN_Pytorch/
  data/
    {dataset_name}-rest.csv
    {dataset_name}_roi/
      braingnn_{atlas}/
        *.mat
        valid_subject_list.pkl
        raw/*.h5
  model/
    {fold}.pth
    log/{fold}/
```

---

## NeuroClaw Delegation Rules

- ROI generation and preprocessing: delegate to `fmri-skill`
- HCP download/orchestration (if needed): delegate to `hcpya-skill` (or `hcpa-skill` / `hcpd-skill` / `hcpep-skill` for other HCP variants)
- Dependency checks: `dependency-planner` + `conda-env-manager`
- Execution routing: `claw-shell`

No execution before explicit plan confirmation.

---

## Limitations and Notes

- This workflow assumes ROI data already exists before Phase 1.
- GPU is strongly recommended for training speed.
- Cross-validation is controlled by running Phase 3 repeatedly with different `--fold` values.
- TensorBoard command:
```bash
tensorboard --logdir ./model/log/
```

---

## Reference

- Li X, Zhou Y, Dvornek N, Zhang M, Gao S, Zhuang J, Scheinost D, Staib L, Ventola P, Duncan J. 2020. BrainGNN.
- Official repository: https://github.com/xxlya/BrainGNN_Pytorch/tree/main
- PyG installation notes: https://pytorch-geometric.readthedocs.io/en/latest/notes/installation.html

Created At: 2026-03-28 19:53 HKT
Last Updated At: 2026-03-28 19:53 HKT
Author: chengwang96
