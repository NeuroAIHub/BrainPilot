# Standard Pipeline Reference

## Table of Contents
1. [Create a Project](#create-a-project)
2. [Extract & Label Frames](#extract-label-frames)
3. [Create Training Dataset](#create-training-dataset)
4. [Train & Evaluate](#train-evaluate)
5. [Analyze Videos](#analyze-videos)
6. [Export Results](#export-results)

## Create a Project

```python
import deeplabcut as dlc

config_path = dlc.create_new_project(
    "ProjectName",       # project name
    "ExperimenterName",  # your name
    ["/path/to/video.mp4"],      # video(s) to add
    working_directory="/path/to/projects",
    copy_videos=False,   # True = copy, False = symlink
    multianimal=False,   # True for maDLC
)
```

A `config.yaml` is created. Edit it to adjust bodyparts, skeleton, etc. Key fields:

| Field | Description |
|-------|-------------|
| `bodyparts` | List of body part names to track |
| `skeleton` | Pairs of bodyparts for skeleton lines in visualization |
| `numframes2pick` | How many frames to extract for labeling (~20 recommended) |
| `TrainingFraction` | Fraction of data used for training (e.g. `[0.95]`) |
| `iteration` | Training iteration identifier |

## Extract & Label Frames

```python
# Extract frames for manual labeling
dlc.extract_frames(
    config_path,
    mode="automatic",    # or "manual"
    algo="kmeans",       # clustering method: kmeans, uniform
    crop=True,           # crop around animal for better labeling
    userfeedback_percentage=20,
)

# User labels frames using the GUI
# dlc.label_frames(config_path)  # opens labeling GUI

# After labeling, check labels for completeness
dlc.check_labels(config_path, display_suggestions=True)
```

**Labeling tips:**
- Label ~20-50 frames for good initial results
- Use `kmeans` algorithm for diverse frame selection
- Set `crop=True` to zoom in on animals for precise labeling

## Create Training Dataset

```python
dlc.create_training_dataset(
    config_path,
    net_type="resnet_50",     # see net types below
    augmenter_type="imgaug",   # or "tensorpack", "default"
    num_shuffles=1,
)
```

Available architectures:

| `net_type` | Best for |
|-----------|----------|
| `resnet_50` | Default, good accuracy-speed balance |
| `resnet_101` | Higher accuracy, slower|
| `resnet_152` | Maximum accuracy |
| `mobilenet_v2_1.0` | Lightweight, faster inference |
| `efficientnet-b0` | Efficient, good for deployment |
| `dlcrnet_ms5` | Multi-scale, good for small body parts |

## Train & Evaluate

```python
# Train
dlc.train_network(
    config_path,
    maxiters=100000,     # more iters = more training
    saveiters=5000,      # checkpoint interval
    displayiters=500,    # console update interval
    max_snapshots_to_keep=5,
)

# Evaluate on test set
dlc.evaluate_network(
    config_path,
    Shuffles=[1],
    plotting=True,
    show_errors=True,
)

# Evaluate returns: train_error, test_error, p_cutoff
# p_cutoff: probability threshold for good predictions
```

**Key metrics:**
- RMSE < 5 pixels is usually "good enough"
- Use `p_cutoff` from evaluation to filter predictions later
- If accuracy is low: label more frames, use deeper network, increase `maxiters`

## Analyze Videos

```python
# Predict poses for all frames
dlc.analyze_videos(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
    save_as_csv=True,
    batchsize=8,
)

# Create labeled video with predictions overlaid
dlc.create_labeled_video(
    config_path,
    ["/path/to/video.mp4"],
    filtered=True,      # apply ARIMA filtering
    trailpoints=10,     # trail length for visualization
)

# Filter predictions (removes jitter)
dlc.filterpredictions(
    config_path,
    ["/path/to/video.mp4"],
    filtertype="arima",   # or "median"
    ARdegree=3,
    MAdegree=1,
)
```

## Export Results

H5 files are in the video directory. Export to CSV:

```python
# Export to CSV
dlc.analyze_videos_converth5_to_csv(
    "/path/to/videoDLC_resnet50_ProjectNameJul9",
    videotype=".mp4",
)

# Convert to NWB (Neurodata Without Borders)
dlc.analyze_videos_converth5_to_nwb(
    "/path/to/videoDLC_resnet50_ProjectNameJul9",
    scorer="YourName",
)

# Plot trajectories
dlc.plot_trajectories(
    config_path,
    ["/path/to/video.mp4"],
    filtered=True,
    showfigure=True,
)
```
