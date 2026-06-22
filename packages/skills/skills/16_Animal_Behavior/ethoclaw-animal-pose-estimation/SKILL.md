---
name: ethoclaw-animal-pose-estimation
description: Animal pose estimation using DeepLabCut SuperAnimal pre-trained models, supporting analysis of local videos and images.
homepage: https://github.com/DeepLabCut/DeepLabCut
metadata:
  {
    "openclaw":
      {
        "emoji": "🐭",
        "requires": { "python": ["deeplabcut"] },
        "install":
          [
            {
              "id": "pip",
              "kind": "pip",
              "package": "deeplabcut",
              "version": "--pre",
              "label": "Install DeepLabCut with model zoo support",
            },
          ],
      },
  }
---

# Animal Pose Estimation (DeepLabCut SuperAnimal)

Use DeepLabCut's SuperAnimal pre-trained models to perform animal pose estimation (keypoint detection) on local videos or images.

## Supported Models

- **superanimal_topviewmouse**: Top-view mouse model
- **superanimal_quadruped**: Quadruped animal model

## Supported Model Architectures

- **hrnet_w32**: HRNet w32 (recommended, higher accuracy)
- **resnet_50**: ResNet-50 (faster speed)

## Supported Detectors

- **fasterrcnn_resnet50_fpn_v2**: Faster R-CNN (recommended, higher accuracy)
- **fasterrcnn_mobilenet_v3_large_fpn**: MobileNet (faster speed)

## Quick Start

### Analyze a Single Video

```python
import deeplabcut
from pathlib import Path

# Video path
video_path = "/path/to/your/video.mp4"

# Optional: specify output directory, if not specified uses the same directory as the video
output_folder = "/path/to/output"  # Optional

# Run SuperAnimal analysis
deeplabcut.video_inference_superanimal(
    videos=[video_path],
    superanimal_name="superanimal_topviewmouse",
    model_name="hrnet_w32",
    detector_name="fasterrcnn_resnet50_fpn_v2",
    video_adapt=False,
    max_individuals=1,
    pseudo_threshold=0.1,
    bbox_threshold=0.9,
    dest_folder=output_folder  # If None, results are saved to the same directory as the video
)
```

### Analyze Multiple Images

```python
from deeplabcut.pose_estimation_pytorch.apis import superanimal_analyze_images
from pathlib import Path

# List of image paths
image_paths = [
    "/path/to/image1.jpg",
    "/path/to/image2.jpg",
]

# Optional: specify output directory
output_folder = "/path/to/output"  # Optional

# Run SuperAnimal image analysis
superanimal_analyze_images(
    images=image_paths,
    superanimal_name="superanimal_topviewmouse",
    model_name="hrnet_w32",
    detector_name="fasterrcnn_resnet50_fpn_v2",
    max_individuals=1,
    dest_folder=output_folder  # If None, results are saved to the same directory as the images
)
```

### Batch Analysis of Multiple Videos

```python
import deeplabcut
from pathlib import Path

# Multiple video paths
video_paths = [
    "/path/to/video1.mp4",
    "/path/to/video2.mp4",
    "/path/to/video3.avi",
]

# Specify output directory (all video results will be saved here)
output_folder = "/path/to/output"

# Batch analysis
deeplabcut.video_inference_superanimal(
    videos=video_paths,
    superanimal_name="superanimal_topviewmouse",
    model_name="hrnet_w32",
    detector_name="fasterrcnn_resnet50_fpn_v2",
    video_adapt=False,
    max_individuals=1,
    dest_folder=output_folder
)
```

## Parameter Description

### Video Analysis Parameters

| Parameter          | Type  | Default                      | Description                                                                                                                    |
| ------------------ | ----- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `videos`           | list  | Required                     | List of video file paths                                                                                                       |
| `superanimal_name` | str   | Required                     | SuperAnimal model name                                                                                                         |
| `model_name`       | str   | "hrnet_w32"                  | Pose estimation model name                                                                                                     |
| `detector_name`    | str   | "fasterrcnn_resnet50_fpn_v2" | Object detector name                                                                                                           |
| `video_adapt`      | bool  | False                        | Whether to enable video adaptation. **Disabled by default, only enable if specifically requested by the user**                 |
| `max_individuals`  | int   | 1                            | Maximum number of animals to detect. **Default is 1, only increase if specifically requested by the user**                     |
| `pseudo_threshold` | float | 0.1                          | Pseudo-label threshold                                                                                                         |
| `bbox_threshold`   | float | 0.9                          | Bounding box detection threshold                                                                                               |
| `detector_epochs`  | int   | 1                            | Number of detector training epochs                                                                                             |
| `pose_epochs`      | int   | 1                            | Number of pose estimation training epochs                                                                                      |
| `dest_folder`      | str   | None                         | Result output directory, if None saves to the same directory as the video                                                      |
| `scale_list`       | range | None                         | Multi-scale test list, e.g., `range(200, 600, 50)`. **Disabled by default, only enable if specifically requested by the user** |

### Image Analysis Parameters

| Parameter          | Type | Default                      | Description                                                                                                |
| ------------------ | ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `images`           | list | Required                     | List of image file paths                                                                                   |
| `superanimal_name` | str  | Required                     | SuperAnimal model name                                                                                     |
| `model_name`       | str  | "hrnet_w32"                  | Pose estimation model name                                                                                 |
| `detector_name`    | str  | "fasterrcnn_resnet50_fpn_v2" | Object detector name                                                                                       |
| `max_individuals`  | int  | 1                            | Maximum number of animals to detect. **Default is 1, only increase if specifically requested by the user** |
| `dest_folder`      | str  | None                         | Result output directory, if None saves to the same directory as the images                                 |

## Output Results

### Video Analysis Output

After analysis is complete, the following files will be generated in the specified directory (or the same directory as the video):

- **`video_nameDLC_snapshot-....h5`**: HDF5 file containing keypoint coordinate data
- **`video_nameDLC_snapshot-....csv`**: CSV file containing keypoint coordinate data (easy to view)
- **`video_nameDLC_snapshot-....pickle`**: Pickle file containing complete analysis results
- **`video_name_labeled.mp4`** (optional): Visualization video with keypoint annotations

### Image Analysis Output

- **`image_nameDLC_snapshot-....h5`**: Keypoint coordinate data
- **`image_nameDLC_snapshot-....csv`**: Keypoint coordinate CSV
- **`image_name_labeled.png`** (optional): Visualization image with keypoint annotations

### Result Data Structure

CSV/H5 files contain the following columns:

- `scorer`: Model name
- `individuals`: Animal individual ID (e.g., individual1, individual2...)
- `bodyparts`: Body part names (e.g., nose, tailbase, leftear, etc.)
- `coords`: Coordinate type (x, y, likelihood)

## Complete Example Scripts

### Complete Video Analysis Example

```python
import os
from pathlib import Path
import deeplabcut

# ==================== User Configuration Area ====================

# Video path (Required)
video_path = "/path/to/your/video.mp4"

# Output directory (Optional, set to None to use the same directory as the video)
output_folder = None  # Example: "/path/to/output"

# SuperAnimal model selection
superanimal_name = "superanimal_topviewmouse"  # or "superanimal_quadruped"

# Model architecture selection
model_name = "hrnet_w32"  # or "resnet_50"

# Detector selection
detector_name = "fasterrcnn_resnet50_fpn_v2"  # or "fasterrcnn_mobilenet_v3_large_fpn"

# Number of animals (default is 1, only increase if specifically requested by the user)
max_individuals = 1

# Whether to use multi-scale testing (disabled by default, only enable if specifically requested by the user)
use_multiscale = False
scale_list = range(200, 600, 50) if use_multiscale else None

# ==================== Run Analysis ====================

# Verify video exists
if not os.path.exists(video_path):
    raise FileNotFoundError(f"Video file does not exist: {video_path}")

# Determine output directory
if output_folder is None:
    output_folder = str(Path(video_path).parent)

# Ensure output directory exists
os.makedirs(output_folder, exist_ok=True)

print(f"Starting video analysis: {video_path}")
print(f"Output directory: {output_folder}")
print(f"Using model: {superanimal_name}")

# Run analysis
kwargs = {
    "videos": [video_path],
    "superanimal_name": superanimal_name,
    "model_name": model_name,
    "detector_name": detector_name,
    "video_adapt": False,
    "max_individuals": max_individuals,
    "pseudo_threshold": 0.1,
    "bbox_threshold": 0.9,
    "detector_epochs": 1,
    "pose_epochs": 1,
    "dest_folder": output_folder,
}

if scale_list is not None:
    kwargs["scale_list"] = scale_list

deeplabcut.video_inference_superanimal(**kwargs)

print("Analysis complete!")
print(f"Results saved to: {output_folder}")
```

### Complete Image Analysis Example

```python
import os
from pathlib import Path
from deeplabcut.pose_estimation_pytorch.apis import superanimal_analyze_images

# ==================== User Configuration Area ====================

# Image paths (Required) - can be single or multiple
image_paths = [
    "/path/to/image1.jpg",
    "/path/to/image2.png",
]

# Output directory (Optional, set to None to use the directory of the images)
output_folder = None  # Example: "/path/to/output"

# SuperAnimal model selection
superanimal_name = "superanimal_topviewmouse"

# Model architecture selection
model_name = "hrnet_w32"

# Detector selection
detector_name = "fasterrcnn_resnet50_fpn_v2"

# Number of animals (default is 1, only increase if specifically requested by the user)
max_individuals = 1

# ==================== Run Analysis ====================

# Verify all images exist
for img_path in image_paths:
    if not os.path.exists(img_path):
        raise FileNotFoundError(f"Image file does not exist: {img_path}")

# Determine output directory
if output_folder is None:
    # Use the directory of the first image
    output_folder = str(Path(image_paths[0]).parent)

# Ensure output directory exists
os.makedirs(output_folder, exist_ok=True)

print(f"Starting analysis of {len(image_paths)} images")
print(f"Output directory: {output_folder}")

# Run analysis
superanimal_analyze_images(
    images=image_paths,
    superanimal_name=superanimal_name,
    model_name=model_name,
    detector_name=detector_name,
    max_individuals=max_individuals,
    dest_folder=output_folder,
)

print("Analysis complete!")
print(f"Results saved to: {output_folder}")
```

## Notes

1. **First Run**: When using a SuperAnimal model for the first time, pre-trained weights will be automatically downloaded, requiring an internet connection.

2. **GPU Acceleration**: If you have a CUDA-enabled GPU, DeepLabCut will automatically use GPU acceleration for analysis.

3. **Memory Usage**: Analyzing long videos or high-resolution images may require significant memory; it is recommended to process in batches.

4. **Result Interpretation**:
   - The `likelihood` value indicates detection confidence (0-1), closer to 1 is more reliable
   - It is recommended to filter out keypoints with likelihood < 0.5

5. **Multi-Animal Scenarios**: If there are multiple animals in the video, please adjust the `max_individuals` parameter.

6. **Model Selection Recommendations**:
   - Top-view mouse experiments → `superanimal_topviewmouse`
   - Other quadruped animals → `superanimal_quadruped`
   - Prioritize accuracy → `hrnet_w32`
   - Prioritize speed → `resnet_50`
