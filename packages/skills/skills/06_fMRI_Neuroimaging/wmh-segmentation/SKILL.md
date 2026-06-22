---
name: wmh-segmentation
description: "Use this skill whenever the user wants to perform automated white matter hyperintensity (WMH) segmentation on structural MRI data using the MARS-WMH nnU-Net model. Requires one FLAIR and one T1w NIfTI image (no contrast). Triggers include: 'wmh', 'white matter hyperintensities', 'WMH segmentation', 'MARS-WMH', 'wmh-nnunet', 'segment FLAIR T1', 'white matter lesions', 'vascular WMH', 'mars wmh', or any request to run nnU-Net WMH segmentation on FLAIR+T1w pair."
license: MIT License (NeuroClaw custom skill – freely modifiable within the project)
layer: base
skill_type: tool
dependencies:
  - claw-shell
---
# WMH Segmentation (MARS-WMH nnU-Net)

## Overview
MARS-WMH is the state-of-the-art, clinically-validated deep-learning tool (nnU-Net architecture) for segmenting brain white matter hyperintensities of presumed vascular origin. It takes a FLAIR image (recommended 1 mm isotropic) and a co-registered or registrable T1w image (1 mm isotropic, no contrast) and outputs a precise WMH segmentation mask in NIfTI format (returned in the original input resolution).

This skill serves as the **NeuroClaw interface-layer wrapper** for the official MARS-WMH Docker container (`ghcr.io/miac-research/wmh-nnunet:latest`) and strictly follows the hierarchical design:

1. Check whether Docker (with NVIDIA Container Toolkit) is installed (`docker --version` + `nvidia-smi` via `claw-shell`).
2. If `nvidia-smi` fails → immediately print the exact NVIDIA Container Toolkit installation commands and instruct the user to run them manually before retry.
3. If paths not provided → interactively ask the user for FLAIR and T1w full paths and confirm they exist on disk.
4. If paths provided → verify file existence and readability.
5. Prepare clean working directory, copy inputs, generate exact Docker pull/tag + run commands.
6. Generate a numbered execution plan.
7. Present the plan, estimated runtime (~5–15 min on GPU), requirements and risks → wait for explicit user confirmation (“YES” / “execute” / “proceed”).
8. On confirmation → delegate **all** shell execution to `claw-shell`.
9. Report completion, exact output mask location, and next steps.

**Key design principle (2026 update)**: All Docker execution is routed through `claw-shell`.

## Quick Reference (Common Use Cases)

| Task                              | Recommended approach                                      |
|-----------------------------------|-----------------------------------------------------------|
| Standard WMH segmentation         | Default Docker run (nnU-Net, GPU)                         |
| Already co-registered images      | Add `--skipRegistration` flag                             |
| CPU-only fallback                 | Remove `--gpus all` (slow)                                |

## Installation Check & Setup
Installation of Docker is delegated to `dependency-planner`.

GPU check performed before every run:

- If `nvidia-smi` fails, prompt user to run:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

**Prerequisites**:
- `dependency-planner`
- `claw-shell`
- NVIDIA GPU + drivers
- ≥8 GB VRAM

## NeuroClaw recommended wrapper script
```bash
# WMH Segmentation Shell Commands (execute via claw-shell)

# 0. GPU check
nvidia-smi >/dev/null 2>&1 || {
  echo "GPU not detected. Run the following commands to install NVIDIA Container Toolkit:"
  cat << 'EOF'
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
EOF
  exit 1
}

# 1. Pull & tag
docker pull ghcr.io/miac-research/wmh-nnunet:latest
docker tag ghcr.io/miac-research/wmh-nnunet:latest mars-wmh-nnunet:latest

# 2. Prepare workspace (replace paths with user-provided FLAIR/T1w)
FLAIR="/path/to/FLAIR.nii.gz"
T1="/path/to/T1w.nii.gz"
OUTPUT_DIR="wmh_output"
mkdir -p "$OUTPUT_DIR"
cp "$FLAIR" "$OUTPUT_DIR/FLAIR.nii.gz"
cp "$T1" "$OUTPUT_DIR/T1w.nii.gz"

# 3. Fix Docker data directory permission issues (common on Ubuntu)
chmod -R 777 "$OUTPUT_DIR"

# 4. Run inference
docker run --rm --gpus all \
  -v "$(pwd)/$OUTPUT_DIR:/data" \
  mars-wmh-nnunet:latest \
  --flair /data/FLAIR.nii.gz \
  --t1 /data/T1w.nii.gz

# 5. Show output mask
ls -lh "$OUTPUT_DIR"/*.nii*
echo "WMH segmentation mask saved in $OUTPUT_DIR"
```

## Important Notes & Limitations
- Docker data directory permission issues are automatically fixed with `chmod -R 777` on the output directory.
- If `docker run` fails with permission denied → run `newgrp docker` first, then retry.
- First run pulls image (~several GB); subsequent runs are fast.
- Input must be NIfTI; use `dcm2nii` if starting from DICOM.
- Output mask appears in `$OUTPUT_DIR` (exact filename shown by final `ls`).

## When to Call This Skill
- User provides FLAIR + T1w and wants WMH segmentation.
- Any mention of MARS-WMH, nnU-Net WMH, white matter lesions segmentation.

## Complementary / Related Skills
- `dcm2nii`              → convert DICOM to NIfTI input
- `dependency-planner`   → install Docker and NVIDIA Container Toolkit
- `claw-shell`           → safe Docker execution

## Reference
Official repo: https://github.com/miac-research/MARS-WMH  
Docker image: `ghcr.io/miac-research/wmh-nnunet:latest`  
Custom NeuroClaw skill.

Created At: 2026-03-23  
Last Updated At: 2026-03-26 00:29 HKT  
Author: chengwang96