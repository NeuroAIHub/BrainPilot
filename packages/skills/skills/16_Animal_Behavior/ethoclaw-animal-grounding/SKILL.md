---
name: ethoclaw-animal-grounding
description: Animal center tracking using OpenCV for top-view videos, detecting black mouse body center position and exporting DeepLabCut-compatible results.
metadata:
  {
    "openclaw":
      {
        "emoji": "🎯",
        "requires": { "python": ["opencv-python", "numpy", "pandas"] },
        "install":
          [
            {
              "id": "pip",
              "kind": "pip",
              "package": "opencv-python",
              "label": "Install OpenCV for computer vision",
            },
            {
              "id": "pip",
              "kind": "pip",
              "package": "numpy",
              "label": "Install NumPy for numerical computing",
            },
            {
              "id": "pip",
              "kind": "pip",
              "package": "pandas",
              "label": "Install Pandas for data handling",
            },
            {
              "id": "pip",
              "kind": "pip",
              "package": "tables",
              "label": "Install PyTables for HDF5 support",
            },
          ],
      },
  }
---

# Animal Center Tracking (OpenCV-based)

Use OpenCV image processing techniques to track the body center position of a black mouse in top-view videos, and export results in DeepLabCut-compatible format.

## Supported Scenarios

- **Top-view mouse tracking**: Black mouse on light background
- **Single animal tracking**: One mouse per video
- **Real-time or recorded video**: Process video files frame by frame

## Adjustable Parameters

| Parameter         | Type | Default | Description                                        |
| ----------------- | ---- | ------- | -------------------------------------------------- |
| `threshold_value` | int  | 80      | Binary threshold for detecting black mouse (0-255) |
| `min_area`        | int  | 300     | Minimum contour area to filter noise (pixels)      |
| `blur_kernel`     | int  | 5       | Gaussian blur kernel size for noise reduction      |
| `morph_kernel`    | int  | 5       | Morphological operation kernel size                |

## Quick Start

### Track a Single Video

```python
import cv2
import numpy as np
import pandas as pd
import os

# Video path
video_path = "/path/to/your/video.mp4"

# Run tracking
track_mouse_center(video_path)
```

### Track with Custom Parameters

```python
# Adjust parameters for different lighting conditions
track_mouse_center(
    video_path,
    threshold_value=60,    # Lower threshold for darker mice
    min_area=500,          # Larger minimum area
    blur_kernel=7,         # Stronger noise reduction
    morph_kernel=7
)
```

## Parameter Description

### Tracking Parameters

| Parameter         | Type | Default  | Description                                              |
| ----------------- | ---- | -------- | -------------------------------------------------------- |
| `video_path`      | str  | Required | Path to input video file                                 |
| `threshold_value` | int  | 80       | Binary threshold (lower values detect darker objects)    |
| `min_area`        | int  | 300      | Minimum contour area in pixels to be considered as mouse |
| `blur_kernel`     | int  | 5        | Gaussian blur kernel size (must be odd number)           |
| `morph_kernel`    | int  | 5        | Morphological opening kernel size                        |

## Output Results

After analysis is complete, the following files will be generated in the same directory as the input video:

- **`video_name_tracking.h5`**: HDF5 file containing center coordinate data (DeepLabCut-compatible)
- **`video_name_tracking.csv`**: CSV file containing center coordinate data (easy to view)
- **`video_name_tracking.mp4`**: Visualization video with center point annotations

### Result Data Structure

CSV/H5 files contain the following columns:

- `scorer`: "EthoClaw"
- `bodyparts`: "center"
- `coords`: Coordinate type (x, y, likelihood)

Example data:

```
         EthoClaw
         center
         x       y       likelihood
0        320.0   240.0   1.0
1        322.0   238.0   1.0
2        NaN     NaN     0.0      # Detection failed
```

## Complete Example Script

### Complete Video Tracking Example

```python
import cv2
import numpy as np
import pandas as pd
import os
from pathlib import Path


def track_mouse_center(video_path,
                       threshold_value=80,
                       min_area=300,
                       blur_kernel=5,
                       morph_kernel=5):
    """
    Track black mouse center position in top-view video using OpenCV

    Parameters:
    -----------
    video_path : str
        Path to input video file
    threshold_value : int
        Binary threshold for detecting black mouse (default 80)
    min_area : int
        Minimum contour area to filter noise (default 300)
    blur_kernel : int
        Gaussian blur kernel size (default 5)
    morph_kernel : int
        Morphological operation kernel size (default 5)

    Returns:
    --------
    dict : Paths to output files
    """

    # Check input file
    if not os.path.exists(video_path):
        raise FileNotFoundError(f"Video file does not exist: {video_path}")

    # Generate output paths (same directory as input video)
    video_dir = os.path.dirname(video_path)
    video_name = os.path.splitext(os.path.basename(video_path))[0]

    output_h5 = os.path.join(video_dir, f"{video_name}_tracking.h5")
    output_csv = os.path.join(video_dir, f"{video_name}_tracking.csv")
    output_video = os.path.join(video_dir, f"{video_name}_tracking.mp4")

    # Open input video
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video file: {video_path}")

    # Get video properties
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    # Setup output video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_video, fourcc, fps, (frame_width, frame_height))

    # Store tracking results
    tracking_data = {
        'frame': [],
        'center_x': [],
        'center_y': [],
        'likelihood': []
    }

    frame_count = 0

    print(f"Starting video processing: {video_path}")
    print(f"Total frames: {total_frames}, Resolution: {frame_width}x{frame_height}, FPS: {fps}")

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        frame_count += 1

        # Image preprocessing
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blurred = cv2.GaussianBlur(gray, (blur_kernel, blur_kernel), 0)

        # Binarization (extract black regions)
        _, thresh = cv2.threshold(blurred, threshold_value, 255, cv2.THRESH_BINARY_INV)

        # Morphological operation (opening to remove noise)
        kernel = np.ones((morph_kernel, morph_kernel), np.uint8)
        mask = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)

        # Find contours
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        center_x, center_y, likelihood = np.nan, np.nan, 0.0

        if contours:
            # Find largest contour
            largest_contour = max(contours, key=cv2.contourArea)

            # Filter small noise
            if cv2.contourArea(largest_contour) > min_area:
                # Calculate contour center (image moments)
                M = cv2.moments(largest_contour)
                if M["m00"] != 0:
                    center_x = int(M["m10"] / M["m00"])
                    center_y = int(M["m01"] / M["m00"])
                    likelihood = 1.0  # Successfully detected

                    # Draw results on frame
                    cv2.drawContours(frame, [largest_contour], -1, (0, 255, 0), 2)
                    cv2.circle(frame, (center_x, center_y), 5, (0, 0, 255), -1)
                    text = f"Center: ({center_x}, {center_y})"
                    cv2.putText(frame, text, (center_x - 50, center_y - 20),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

        # Record tracking data
        tracking_data['frame'].append(frame_count)
        tracking_data['center_x'].append(center_x)
        tracking_data['center_y'].append(center_y)
        tracking_data['likelihood'].append(likelihood)

        # Write to output video
        out.write(frame)

        # Progress display
        if frame_count % 100 == 0:
            print(f"Progress: {frame_count}/{total_frames} ({frame_count/total_frames*100:.1f}%)")

    # Release resources
    cap.release()
    out.release()

    # Create DeepLabCut-compatible DataFrame
    scorer = 'EthoClaw'
    bodypart = 'center'

    # Build multi-index columns
    columns = pd.MultiIndex.from_tuples([
        (scorer, bodypart, 'x'),
        (scorer, bodypart, 'y'),
        (scorer, bodypart, 'likelihood')
    ], names=['scorer', 'bodyparts', 'coords'])

    # Create DataFrame
    df_data = np.column_stack([
        tracking_data['center_x'],
        tracking_data['center_y'],
        tracking_data['likelihood']
    ])

    df = pd.DataFrame(df_data, columns=columns)

    # Save as HDF5 format (DeepLabCut-compatible)
    df.to_hdf(output_h5, key='df_with_missing', mode='w')

    # Save as CSV format
    df.to_csv(output_csv)

    print(f"\nProcessing complete!")
    print(f"Results saved:")
    print(f"  - HDF5: {output_h5}")
    print(f"  - CSV: {output_csv}")
    print(f"  - Video: {output_video}")

    return {
        'h5_path': output_h5,
        'csv_path': output_csv,
        'video_path': output_video,
        'total_frames': frame_count
    }


# ==================== User Configuration Area ====================

# Video path (Required)
video_path = "/path/to/your/video.mp4"

# Tracking parameters (Optional)
threshold_value = 80    # Binary threshold (0-255), lower for darker mice
min_area = 300          # Minimum contour area in pixels
blur_kernel = 5         # Gaussian blur kernel size
morph_kernel = 5        # Morphological kernel size

# ==================== Run Tracking ====================

# Verify video exists
if not os.path.exists(video_path):
    raise FileNotFoundError(f"Video file does not exist: {video_path}")

print(f"Starting mouse center tracking: {video_path}")

# Run tracking
result = track_mouse_center(
    video_path,
    threshold_value=threshold_value,
    min_area=min_area,
    blur_kernel=blur_kernel,
    morph_kernel=morph_kernel
)

print("Tracking complete!")
print(f"Total frames processed: {result['total_frames']}")
print(f"Results saved to: {os.path.dirname(video_path)}")
```

## Tracking Method

The tracking algorithm follows these steps:

1. **Image Preprocessing**
   - Convert to grayscale
   - Apply Gaussian blur to reduce noise

2. **Binarization**
   - Use threshold to extract black mouse regions (THRESH_BINARY_INV)
   - Pixels darker than `threshold_value` become white (255)

3. **Morphological Operations**
   - Apply opening operation to remove small noise

4. **Contour Detection**
   - Find all contours in the binary mask
   - Select the largest contour (assumed to be the mouse)

5. **Center Calculation**
   - Use image moments to calculate the centroid of the contour
   - Formula: `cx = M10/M00`, `cy = M01/M00`

6. **Result Export**
   - Save coordinates in DeepLabCut-compatible format
   - Generate visualization video with annotations

## Notes

1. **Video Requirements**:
   - Top-view perspective
   - Black mouse on light background
   - Even lighting conditions
   - Minimal shadows

2. **Parameter Tuning**:
   - If mouse is not detected: decrease `threshold_value`
   - If too much noise is detected: increase `min_area` or `blur_kernel`
   - For very small mice: decrease `min_area`

3. **Detection Failure**:
   - When mouse is occluded or leaves the frame, `likelihood` will be 0
   - Coordinates will be NaN for failed detections

4. **Single Animal Only**:
   - This method tracks only the largest black object
   - For multiple animals, consider using DeepLabCut SuperAnimal models

5. **Output Compatibility**:
   - HDF5 format is compatible with DeepLabCut analysis tools
   - CSV format can be opened in Excel or Python pandas
