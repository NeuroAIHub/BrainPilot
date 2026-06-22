# Video & Data Utilities Reference

## Table of Contents
1. [Video Preprocessing](#video-preprocessing)
2. [Post-Processing Predictions](#post-processing-predictions)
3. [Data Export & Conversion](#data-export-conversion)
4. [Skeleton Analysis](#skeleton-analysis)
5. [Outlier Detection](#outlier-detection)

## Video Preprocessing

```python
import deeplabcut as dlc

# Collect all videos in a directory
videos = dlc.collect_video_paths("/path/to/video_dir", videotype=[".mp4", ".avi"])

# Check video integrity
dlc.check_video_integrity(videos)

# Crop video
dlc.CropVideo("/path/to/video.mp4", start=100, end=5000, output_path="cropped.mp4")

# Downsample (reduce frame rate)
dlc.DownSampleVideo("/path/to/video.mp4", factor=2, output_path="downsampled.mp4")

# Shorten video
dlc.ShortenVideo("/path/to/video.mp4", start="00:00:05", stop="00:05:00", output_path="short.mp4")
```

## Post-Processing Predictions

```python
# Filter jittery predictions
dlc.filterpredictions(
    config_path,
    ["/path/to/video.mp4"],
    filtertype="arima",    # or "median"
    ARdegree=3,
    MAdegree=1,
    p_bound=0.5,           # min probability to keep
)

# Create video with all raw detections (before filtering)
dlc.create_video_with_all_detections(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
)
```

**Filter tips:**
- `arima`: Better for smooth tracking, uses temporal context
- `median`: Simple, fast, good for quick cleanup
- Low `p_bound` (0.1) keeps more predictions; high (0.9) is more conservative

## Data Export & Conversion

```python
# Convert H5 to CSV
dlc.analyze_videos_converth5_to_csv(
    "/path/to/output_folder",
    videotype=".mp4",
    scorer="YourName",
)

# Convert CSV to H5
dlc.convertcsv2h5("config.yaml", "user_specified")

# Convert single-animal project to maDLC format
dlc.convert2_maDLC(config_path, num_bodyparts=6)

# Export to NWB (supports NWB 2.0)
dlc.analyze_videos_converth5_to_nwb(
    "/path/to/output_folder",
    scorer="YourName",
    videotype=".mp4",
    individual_name="mouse1",
)
```

## Skeleton Analysis

Compute bone lengths and joint angles from predictions:

```python
dlc.analyzeskeleton(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
    save_as_csv=True,
    filtered=True,
)
```

## Outlier Detection

Find and relabel problematic frames:

```python
# Find outliers in raw predictions
dlc.find_outliers_in_raw_data(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
)

# Extract outlier frames for relabeling
dlc.extract_outlier_frames(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
    extractionalgorithm="jump",  # or "uncertain", "manual"
    p_bound=0.5,
)
```

**Extraction algorithms:**
- `"jump"`: Find frames where body parts jump more than expected
- `"uncertain"`: Find frames with low prediction confidence
- `"manual"`: Use outlier data from `find_outliers_in_raw_data`

## Merge Datasets

Combine training data from multiple projects:

```python
# Merge two labeled datasets
dlc.merge_datasets(
    config_path,
    [project_config1_path, project_config2_path],
)
```

## Trajectory Plotting

```python
dlc.plot_trajectories(
    config_path,
    ["/path/to/video.mp4"],
    videotype=".mp4",
    filtered=True,
    displayedbodyparts=["nose", "tailbase"],
    showfigure=True,
)
```
