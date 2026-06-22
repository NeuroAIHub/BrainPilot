---
name: deeplabcut
description: "Toolbox for markerless animal pose estimation with DeepLabCut. Covers single/multi-animal tracking, SuperAnimal pretrained models, 2D/3D pose estimation, keypoint labeling GUI, model training/evaluation, video analysis, and behavioral quantification. Use when the user needs animal pose estimation, behavior tracking, keypoint detection in videos, or mentions DeepLabCut/DLC/SuperAnimal."
version: "1.0.0"
authors:
  - "Claude (AI-assisted)"
review_status: "ai-generated"
source: "https://github.com/DeepLabCut/DeepLabCut"
---

# DeepLabCut — Markerless Animal Pose Estimation

## Purpose

DeepLabCut is a Python toolbox for state-of-the-art markerless pose estimation of animals. It uses deep learning to track body parts from videos without physical markers. The library is animal-agnostic, supports both single and multi-animal scenarios, and includes the SuperAnimal family of pretrained models for out-of-the-box inference.

## When to Use This Skill

Activate when the user:
- Wants to track animal body parts from video
- Asks about pose estimation, keypoint detection, or behavioral tracking
- Mentions DeepLabCut, DLC, SuperAnimal, or markerless tracking
- Needs to analyze animal movement/kinematics
- Asks about multi-animal tracking or 3D pose reconstruction
- Wants to use pretrained animal pose models

## Quick Decision Tree

```
What does the user need?
├── No labeled data, just want to track animals → SuperAnimal (video_inference_superanimal)
├── Single animal, have labeled data → Standard single-animal pipeline
├── Multiple animals interacting → maDLC (multi-animal pipeline)
├── 3D pose reconstruction → 3D pipeline (calibrate_cameras + triangulate)
└── Just post-process results → filterpredictions, analyzeskeleton
```

## Reference Files (Progressive Disclosure)

| Topic | File | When to Read |
|-------|------|--------------|
| Standard Pipeline | `references/standard-pipeline.md` | Full workflow: create project → train → analyze |
| SuperAnimal & ModelZoo | `references/modelzoo.md` | Pretrained models, zero-shot inference |
| Multi-Animal (maDLC) | `references/maDLC.md` | Tracking multiple interacting animals |
| 3D Pose Estimation | `references/3d-pose.md` | Triangulation from multiple camera views |
| Video & Data Utilities | `references/utilities.md` | Video cropping, format conversion, data export |

## Installation

```bash
# Minimal (headless, no GUI):
pip install deeplabcut

# With GUI (label_frames, refine_labels, SkeletonBuilder):
pip install "deeplabcut[gui]"

# PyTorch must be installed separately:
pip install torch torchvision
# Or for GPU (check pytorch.org for your CUDA version):
conda install pytorch cudatoolkit=11.3 -c pytorch
```

Verify: `python -c "import deeplabcut; print(deeplabcut.__version__)"`

## Standard Pipeline Overview

```python
import deeplabcut as dlc

# 1. Create project
config_path = dlc.create_new_project(
    "ProjectName", "ExperimenterName", ["/path/to/video.mp4"],
    working_directory="/path/to/projects"
)

# 2. Extract frames for labeling
dlc.extract_frames(config_path, mode="automatic", algo="kmeans", crop=True)

# 3. USER labels frames manually in GUI
# dlc.label_frames(config_path)  # launches the labeling GUI

# 4. Create training dataset from labeled frames
dlc.create_training_dataset(config_path, net_type="resnet_50")

# 5. Train the network
dlc.train_network(config_path, maxiters=100000, saveiters=5000)

# 6. Evaluate
dlc.evaluate_network(config_path, plotting=True)

# 7. Analyze videos (predict poses)
dlc.analyze_videos(config_path, ["/path/to/video.mp4"], videotype=".mp4")

# 8. Create labeled videos (overlay predictions)
dlc.create_labeled_video(config_path, ["/path/to/video.mp4"])

# 9. Export results to CSV
dlc.analyze_videos_converth5_to_csv("/path/to/videoDLC_resnet50_ProjectNameJul9")
```

## Key API Reference

### Project Management

| Function | Description |
|----------|-------------|
| `create_new_project(project, experimenter, videos, working_directory)` | Start a new single-animal project |
| `create_new_project_3d(project, experimenter, num_cameras, working_directory)` | Start a new 3D project |
| `create_pretrained_project(path, task, videos, SUPERANIMAL_NAME, model_name, detector_name)` | Create project from SuperAnimal pretrained model |
| `add_new_videos(config_path, videos)` | Add videos to existing project |

### Training & Evaluation

| Function | Description |
|----------|-------------|
| `create_training_dataset(config_path, net_type, augmenter_type)` | Prepare training data; `net_type`: `resnet_50`, `resnet_101`, `mobilenet_v2_1.0`, `efficientnet-b0` |
| `train_network(config_path, maxiters, saveiters)` | Train; key params: `maxiters=100000`, `saveiters=5000` |
| `evaluate_network(config_path, plotting=True)` | Evaluate on test set, produce metrics |

### Video Analysis

| Function | Description |
|----------|-------------|
| `analyze_videos(config_path, videos, videotype, save_as_csv)` | Predict poses for all frames in videos |
| `create_labeled_video(config_path, videos, videotype, filtered)` | Overlay predicted keypoints on video |
| `video_inference_superanimal(videos, superanimal_name, ...)` | Zero-shot inference with pretrained SuperAnimal models |

### Post-Processing

| Function | Description |
|----------|-------------|
| `filterpredictions(config_path, video, ...)` | Smooth predictions (ARIMA, median filtering) |
| `analyzeskeleton(config_path, video, ...)` | Compute bone lengths, joint angles from predictions |
| `plot_trajectories(config_path, video, ...)` | Plot body part trajectories over time |

### SuperAnimal Pretrained Models

Available models for zero-shot inference:

| Model | Species | Body Parts |
|-------|---------|------------|
| `superanimal_topviewmouse` | Top-view mouse (various strains) | 21 keypoints |
| `superanimal_quadruped` | Quadrupeds (dog, horse, sheep, etc.) | 39 keypoints |
| `superanimal_face` | Primate/human faces | 54 keypoints |
| `superanimal_full` | Full body animals (topview mouse + quadruped) | Combined |

## Common Pitfalls

1. **Wrong PyTorch version**: Always install PyTorch BEFORE deeplabcut. Check [pytorch.org](https://pytorch.org) for the correct CUDA version.
2. **GPU out of memory**: Reduce batch size (default 8 → 4 or 2) in `pose_cfg.yaml`.
3. **Missing GUI dependencies**: `label_frames` requires `pip install "deeplabcut[gui]"`. On headless servers, use X11 forwarding or label locally.
4. **Video codec issues**: If `create_labeled_video` fails, try converting to `.mp4` (H.264) or `.avi` first.
5. **maDLC detector**: Multi-animal mode requires a detection model (`fasterrcnn_resnet50_fpn_v2` is the default). Single-animal can work with heatmap regression alone.
6. **SuperAnimal scale**: Adjust `scale_list` parameter for SuperAnimal — try `[200, 300, 400]` first; smaller animals may need higher values.
