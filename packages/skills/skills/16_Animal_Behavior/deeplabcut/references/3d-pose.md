# 3D Pose Estimation Reference

## Table of Contents
1. [Overview](#overview)
2. [Camera Setup & Calibration](#camera-setup-calibration)
3. [3D Triangulation](#3d-triangulation)
4. [Creating 3D Labeled Videos](#creating-3d-labeled-videos)

## Overview

DeepLabCut 3D reconstructs 3D poses from 2+ calibrated camera views. The workflow:

```
Multiple cameras → Calibrate → Analyze each view (2D) → Triangulate → 3D poses
```

## Camera Setup & Calibration

```python
import deeplabcut as dlc

# Create 3D project
config_path = dlc.create_new_project_3d(
    "3D_Project",
    "ExperimenterName",
    num_cameras=2,               # number of camera views
    working_directory="/path/to/projects",
)
```

Calibration requires a checkerboard visible in all cameras simultaneously:

```python
# Calibrate cameras
dlc.calibrate_cameras(
    config_path,
    cbrow=8,            # checkerboard rows (inner corners)
    cbcol=6,            # checkerboard cols (inner corners)
    calibrate=False,    # True to run calibration
    alpha=0,            # 0 = crop to valid region; 1 = keep all pixels
)

# Verify calibration quality
dlc.check_undistortion(
    config_path,
    cbrow=8,
    cbcol=6,
)
```

## 3D Triangulation

Each camera view is analyzed independently, then triangulated:

```python
# Step 1: Analyze each camera's video separately
for cam_config in camera_configs:
    dlc.analyze_videos(cam_config, [f"camera{i}_video.mp4"])
    dlc.filterpredictions(cam_config, [f"camera{i}_video.mp4"])

# Step 2: Triangulate 2D→3D
dlc.triangulate(
    config_path,
    video_path="/path/to/videos/",
    filterpredictions=True,
    videotype=".mp4",
)
```

## Creating 3D Labeled Videos

```python
dlc.create_labeled_video_3d(
    config_path,
    path="/path/to/videos/",
    start=0,            # start frame
    end=1000,           # end frame
    videotype=".mp4",
)
```

## Calibration Tips

- Use a printed checkerboard with known square size (in mm)
- Film the checkerboard moving through all areas where the animal moves
- Record at least 30-50 synchronized frames of the checkerboard from each camera
- `pick_corners`: if `True`, manually click corners on one frame; `False` for automatic detection
- Sync cameras with a flash/LED or use hardware triggers
- Higher resolution cameras give better 3D accuracy
