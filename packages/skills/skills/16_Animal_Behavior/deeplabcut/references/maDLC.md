# Multi-Animal Pose Estimation (maDLC) Reference

## Table of Contents
1. [Overview](#overview)
2. [Creating a maDLC Project](#creating-a-madlc-project)
3. [Training maDLC](#training-madlc)
4. [Video Analysis for maDLC](#video-analysis-for-madlc)
5. [Tracking & Tracklets](#tracking-tracklets)

## Overview

Multi-animal DeepLabCut supports tracking multiple interacting animals simultaneously. It uses a two-step approach:
1. **Detection**: Find all animals in each frame (Faster R-CNN)
2. **Pose estimation**: Estimate keypoints for each detected animal

Then **tracking** links detections across frames to form persistent animal identities.

## Creating a maDLC Project

```python
import deeplabcut as dlc

config_path = dlc.create_new_project(
    "MultiMouseProject",
    "ExperimenterName",
    ["/path/to/video.mp4"],
    working_directory="/path/to/projects",
    multianimal=True,        # KEY: enables maDLC mode
)
```

In `config.yaml`, the `individuals` field lists the animals to track:

```yaml
individuals:
- mouse1
- mouse2
- mouse3
```

The skeleton defines connections both within and optionally between animals.

## Training maDLC

maDLC uses two networks: a detector and a pose model.

```python
# Create training dataset (trains both detector + pose model)
dlc.create_multianimaltraining_dataset(
    config_path,
    net_type="dlcrnet_ms5",      # good for multi-animal
    detector_type="fasterrcnn_resnet50_fpn_v2",
    num_shuffles=1,
)

# Train
dlc.train_network(
    config_path,
    maxiters=100000,
    saveiters=5000,
)
```

**Key differences from single-animal:**
- Labels include animal identity (which mouse is which)
- Detector network runs first to find all animals
- `numframes2pick` is per-animal; label ~20 frames per individual
- Labeling is more time-consuming; use the GUI's animal switching feature

## Video Analysis for maDLC

```python
# Analyze
dlc.analyze_videos(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
    auto_track=True,      # track animals across frames
    track_method="box",   # "box" (IoU) or "skeleton" (pose similarity)
)

# Create labeled video
dlc.create_labeled_video(
    config_path,
    ["/path/to/video.mp4"],
    filtered=True,
    videotype=".mp4",
)
```

## Tracking & Tracklets

After analysis, refine tracking:

```python
# Convert detections to tracklets
dlc.convert_detections2tracklets(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
    track_method="box",
)

# Manually refine tracklets in GUI
# dlc.refine_tracklets(config_path, ["/path/to/video.mp4"])

# Stitch corrected tracklets into final predictions
dlc.stitch_tracklets(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
)
```

## Common Issues

| Problem | Solution |
|---------|----------|
| Animals not detected | Lower detection threshold in `inference_cfg.yaml` |
| ID swaps | Use `track_method="skeleton"` for more robust tracking |
| Animals too similar | Add distinguishing features (ear tags, fur marks) or use re-identification |
| Detection too slow | Use `fasterrcnn_mobilenet_v3_large_fpn` as detector |
| Missing keypoints on occluded animals | Increase `numframes2pick`, add more labeled frames with occlusions |
