---
name: neurostorm
description: "Use this skill whenever the user wants to preprocess fMRI data, pretrain or fine-tune NeuroSTORM, run inference, or benchmark on fMRI tasks (age/gender prediction, phenotype prediction, disease diagnosis, fMRI retrieval, task fMRI state classification). Triggers include: 'fMRI', 'NeuroSTORM', 'fMRI preprocessing', 'fMRI foundation model', 'brain imaging', 'HCP', 'ABCD', 'UKB', 'ADHD200', 'COBRE', 'UCLA', 'NSD', 'BOLD5000', 'disease diagnosis from fMRI', 'pretrain fMRI model', 'fine-tune fMRI', or any request involving .nii/.nii.gz fMRI volume files."
license: MIT
layer: base
skill_type: model
dependencies:
  - fmri-skill
  - smri-skill
  - run_models
---
# NeuroSTORM Skill
## Overview
`neurostorm-skill` covers all workflows for the **NeuroSTORM fMRI foundation model**: data downloading, preprocessing, pre-training, fine-tuning, and inference.
**Supported tasks:**
| ID | Task |
|----|------|
| 1 | Age & Gender Prediction |
| 2 | Phenotype Prediction |
| 3 | Disease Diagnosis |
| 4 | fMRI Retrieval |
| 5 | Task fMRI State Classification |
**Supported datasets:** HCP1200, ABCD, UKB, Cobre, ADHD200, HCPA, HCPD, UCLA, HCPEP, HCPTASK, GOD, NSD, BOLD5000
---

## Installation
```bash
# 1. Create conda environment
conda create -n neurostorm python=3.11
conda activate neurostorm
# 2. Install PyTorch (CUDA 12.8 example)
pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 \
    --index-url https://download.pytorch.org/whl/cu128
# 3. Install remaining dependencies
pip install tensorboard tensorboardX tqdm ipdb nvitop monai \
    pytorch-lightning==1.9.4 neptune nibabel nilearn numpy
# 4. (Optional) Install Mamba SSM for NeuroSTORM backbone
git clone https://github.com/Dao-AILab/causal-conv1d.git && cd causal-conv1d
TORCH_CUDA_ARCH_LIST="12.0" pip install --no-build-isolation -e .
git clone https://github.com/state-spaces/mamba.git && cd mamba
TORCH_CUDA_ARCH_LIST="12.0" pip install --no-build-isolation -e .
```
Alternatively, use the provided Docker image:
```bash
docker build -t neurostorm:latest .
docker run --gpus all -it --rm \
    -v $(pwd):/workspace \
    -v /path/to/data:/workspace/data \
    --shm-size=8g neurostorm:latest
```
---
## Workflows

### 1. Data Preprocessing
**Input:** Raw fMRI volumes in MNI152 space (`.nii` / `.nii.gz`)  
**Output:** Per-frame `.pt` tensor files ready for model input
```bash
# Brain extraction (requires FSL)
bash datasets/brain_extraction.sh /path/to/raw /path/to/extracted
# Convert to 4D volume tensors (background removal, resampling, Z-normalization)
python datasets/preprocessing_volume.py \
    --dataset_name hcp \
    --load_root ./data/hcp \
    --save_root ./processed_data/hcp \
    --num_processes 8
# (Optional) Convert to 2D ROI time series or functional correlation matrix
python datasets/generate_roi_data_from_nii.py \
    --atlas_names aal3 cc200 \
    --dataset_names hcp \
    --output_dir ./processed_data \
    --num_processes 8
```
---

### 2. Pre-training
**Input:** Preprocessed `.pt` volume files  
**Output:** Pre-trained model checkpoint (`.ckpt`)
```bash
# MAE-based pre-training on HCP-YA
python main.py \
    --pretraining \
    --use_mae \
    --model neurostorm \
    --dataset_name HCP1200 \
    --image_path ./processed_data/hcp \
    --mask_ratio 0.5 \
    --batch_size 8 \
    --learning_rate 1e-4 \
    --max_epochs 100 \
    --loggername tensorboard \
    --project_name pt_neurostorm_mae
```
See `scripts/hcp_pretrain/` for ready-made pre-training scripts.
---

### 3. Fine-tuning
**Input:** Preprocessed `.pt` files + pre-trained checkpoint  
**Output:** Fine-tuned checkpoint (`.ckpt`) + TensorBoard logs
```bash
# Example: gender classification on HCP-YA
python main.py \
    --model neurostorm \
    --dataset_name HCP1200 \
    --image_path ./processed_data/hcp \
    --load_model_path ./pretrained_models/neurostorm_mae.ckpt \
    --downstream_task_id 1 \
    --downstream_task_type classification \
    --task_name sex \
    --batch_size 12 \
    --learning_rate 5e-5 \
    --max_epochs 30 \
    --loggername tensorboard \
    --project_name ft_neurostorm_gender
```
See `scripts/hcp_downstream/` and other `*_downstream/` folders for task-specific scripts.
---

### 4. Inference / Demo
**Input:** HCP-YA dataset + fine-tuned checkpoint  
**Output:** Prediction results printed to stdout
```bash
# Quick demo (age, gender, phenotype)
sh scripts/run_demo.sh
# Or directly:
python demo.py \
    --ckpt_path /path/to/gender.ckpt \
    --task gender \
    --image_path /path/to/HCP1200 \
    --devices 1 \
    --precision 32
```
---

## Input / Output Summary
| Stage | Input | Output |
|-------|-------|--------|
| Preprocessing | `.nii` / `.nii.gz` volumes in MNI152 space | Per-frame `.pt` tensors |
| Pre-training | Preprocessed `.pt` files | Model checkpoint `.ckpt` |
| Fine-tuning | `.pt` files + pre-trained `.ckpt` | Fine-tuned `.ckpt` + logs |
| Inference | `.pt` files + fine-tuned `.ckpt` | Predictions (stdout / CSV) |
---

## Reference
- Paper: *Towards a General-Purpose Foundation Model for fMRI Analysis* (Nature Biomedical Engineering, 2026)
- Project: https://cuhk-aim-group.github.io/NeuroSTORM/
- GitHub: https://github.com/CUHK-AIM-Group/NeuroSTORM
---

Created At: 2026-04-02 00:23 HKT
Last Updated At: 2026-04-02 00:23 HKT
Author: chengwang96
