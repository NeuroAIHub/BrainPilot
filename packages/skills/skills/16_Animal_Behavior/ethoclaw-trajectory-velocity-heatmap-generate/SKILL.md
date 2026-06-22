---
name: ethoclaw-trajectory_velocity_heatmap_generate
description: Generate spatial velocity heatmaps and trajectory heatmaps from 2D/3D animal behavior tracking data. Supports flexible data formats (.h5, .csv) with auto-detection of body parts and column naming patterns. Handles missing data, outliers, and various tracking configurations.
metadata: { "openclaw": { "emoji": "🐭", "requires": { "bins": ["python3"] } } }
---

# Trajectory Velocity Heatmap Generate

Analyze animal behavior tracking data to generate spatial heatmaps:

- **Velocity Heatmap**: Shows which spatial regions have the highest movement velocity (where the animal moves fastest)
- **Trajectory Heatmap**: Shows which spatial regions the animal spends the most time in (spatial density)

Designed to handle various data formats and tracking configurations.

## Supported Input Formats

### CSV Format (Flexible)

The tool auto-detects column naming patterns. Supported patterns include:

- Standard pattern: `{body_part}_x`, `{body_part}_y`, `{body_part}_confidence` (or `_likelihood`)
- Alternative patterns: `x_{body_part}`, `y_{body_part}`, `{body_part}_X`, `{body_part}_Y`
- Case insensitive matching

**Examples of valid CSV structures:**

```csv
# Pattern 1: Standard
nose_x,nose_y,nose_confidence,back_x,back_y,back_confidence
475.19,108.41,0.97,452.83,83.87,0.49

# Pattern 2: Alternative naming
x_nose,y_nose,likelihood_nose,x_tail,y_tail,likelihood_tail
475.19,108.41,0.97,440.93,60.84,0.01

# Pattern 3: 3D tracking (z coordinate ignored)
head_x,head_y,head_z,head_confidence
100.5,200.3,50.2,0.95
```

### HDF5 Format (Flexible)

Auto-detects common internal structures:

- `/2Dskeleton/BodyParts` + `/2Dskeleton/data2D` (reference format)
- `/body_parts` + `/coordinates` (alternative)
- `/keypoints` + `/data` (DeepLabCut-style)
- First dataset group with body part names and coordinate data

## Data Structure Flexibility

### Body Parts

- **Any number**: 1, 3, 5, or more body parts
- **Any names**: `nose`, `back`, `tail`, `head`, `center`, `body`, etc.
- **Auto-detection**: Tool scans and lists available body parts

### Data Quality Handling

- **Missing data**: NaN, empty values, or placeholders handled gracefully
- **Outliers**: Extreme values (tracking errors) automatically filtered
- **Low confidence**: Configurable threshold to exclude unreliable points
- **Tracking gaps**: Ignored in spatial heatmaps

## Usage

### Quick Start

```bash
# Analyze with auto-detection (interactive body part selection)
python3 {baseDir}/core_scripts/heatmap_velocity.py /path/to/data.csv
python3 {baseDir}/core_scripts/heatmap_trajectory.py /path/to/data.csv

# Specify body part directly
python3 {baseDir}/core_scripts/heatmap_velocity.py /path/to/data.csv --body-part nose
python3 {baseDir}/core_scripts/heatmap_trajectory.py /path/to/data.h5 --body-part center

# Analyze entire folder
python3 {baseDir}/core_scripts/heatmap_velocity.py /path/to/tracking_data/
python3 {baseDir}/core_scripts/heatmap_trajectory.py /path/to/tracking_data/
```

### Project Structure Support

**Standard Structure:**

```
Analysis_Project/
├── 0_videos/              # Video files
├── 1_2Dskeleton/          # Tracking data (.h5 or .csv)
└── 2_results/             # Generated results
    ├── heatmap_velocity/  # Velocity heatmaps
    └── heatmap_trajectory/# Trajectory heatmaps
```

**Simple Structure:**

```
data_folder/
├── mouse1.csv
├── mouse2.csv
└── results/               # Auto-created
    ├── heatmap_velocity/
    └── heatmap_trajectory/
```

### Group Detection

Groups are automatically detected from filenames for batch analysis:

- `control_mouse1.csv` → group: "control"
- `treatment_A_rat_01.h5` → group: "treatment_A"
- `experiment_2024_subject1.csv` → group: "experiment"

Pattern: First segment before underscore `_` or hyphen `-`

## Parameters

### Common Parameters

| Parameter                | Default   | Description                                                       |
| ------------------------ | --------- | ----------------------------------------------------------------- |
| `--body-part`            | `auto`    | Body part to analyze (auto-detects if not specified)              |
| `--list-parts`           | -         | List available body parts and exit                                |
| `--confidence-threshold` | `0.6`     | Minimum confidence (0.0-1.0). Points below threshold are excluded |
| `--output-dir`           | `auto`    | Output directory (auto-detected based on input structure)         |
| `--cmap`                 | `viridis` | Matplotlib colormap (blue-green-yellow)                           |
| `--bins`                 | `50`      | Number of bins for 2D histogram                                   |
| `--sigma`                | `2.0`     | Gaussian smoothing sigma (pixels)                                 |
| `--arena-size`           | `auto`    | Arena dimensions in pixels (format: `width,height`)               |
| `--outlier-threshold`    | `10`      | Outlier multiplier (IQR method). Set to 0 to disable              |

### Velocity-Specific Parameters

| Parameter        | Default | Description                                                       |
| ---------------- | ------- | ----------------------------------------------------------------- |
| `--fps`          | `30`    | Video frame rate for velocity calculation                         |
| `--velocity-max` | `auto`  | Maximum velocity for color scale (auto-detected if not specified) |

### Trajectory-Specific Parameters

| Parameter | Default | Description                                        |
| --------- | ------- | -------------------------------------------------- |
| _(none)_  | -       | Trajectory heatmap uses the same common parameters |

## Handling Different Data Scenarios

### Scenario 1: Unknown Column Names

```bash
# Tool will auto-detect and list available body parts
python3 {baseDir}/core_scripts/heatmap_velocity.py data.csv
# Output: "Available body parts: head, body, tail. Using: body"
```

### Scenario 2: 3D Tracking Data (x, y, z)

```bash
# Only x and y are used, z is ignored
python3 {baseDir}/core_scripts/heatmap_trajectory.py 3d_tracking.csv --body-part head
```

### Scenario 3: Missing Confidence Column

```bash
# All points assumed valid (confidence = 1.0)
python3 {baseDir}/core_scripts/heatmap_velocity.py simple_xy.csv
```

### Scenario 4: Many Body Parts

```bash
# List available parts and select one
python3 {baseDir}/core_scripts/heatmap_velocity.py multi_part_data.csv
# Output: "Found 8 body parts: nose, head_center, neck, back, ..."
```

### Scenario 5: Poor Tracking Quality

```bash
# Lower confidence threshold, increase outlier filtering
python3 {baseDir}/core_scripts/heatmap_velocity.py noisy_data.csv \
    --confidence-threshold 0.3 --outlier-threshold 5
```

## Troubleshooting

### "No valid body parts found"

- Check that CSV has proper headers
- For HDF5, verify the file structure
- Use `--list-parts` to see detected columns

### "Insufficient valid data"

- Lower `--confidence-threshold` (e.g., 0.3)
- Check if tracking data is mostly empty
- Verify `--body-part` matches your data

### Extreme velocity values / Overexposed heatmap

- Check for tracking jumps in raw data
- Manually set `--velocity-max` to control color scale (e.g., `--velocity-max 100`)

### Empty trajectory heatmap

- Verify coordinate ranges are reasonable
- Check `--arena-size` if manually specified
- Ensure sufficient valid data points

## Examples

```bash
# Basic analysis with defaults
python3 {baseDir}/core_scripts/heatmap_velocity.py ./tracking_data/

# Custom body part and confidence
python3 {baseDir}/core_scripts/heatmap_velocity.py data.csv \
    --body-part head_center --confidence-threshold 0.8

# High-resolution trajectory analysis
python3 {baseDir}/core_scripts/heatmap_trajectory.py data.csv \
    --bins 100 --sigma 3 --cmap plasma

# Handle noisy data
python3 {baseDir}/core_scripts/heatmap_velocity.py noisy_data.csv \
    --confidence-threshold 0.4 --outlier-threshold 3

# Fixed arena size
python3 {baseDir}/core_scripts/heatmap_trajectory.py data.csv \
    --arena-size 640,480 --bins 50

# Batch processing with custom output
python3 {baseDir}/core_scripts/heatmap_velocity.py ./experiment_data/ \
    --output-dir ./results/day1/ --body-part center
```

## Output Files

Each input file generates:

- `{filename}_velocity.png` - **Spatial Velocity Heatmap** showing which regions have the highest movement velocity (2D spatial heatmap with velocity overlay)
- `{filename}_trajectory.png` - **Spatial Trajectory Heatmap** showing which regions the animal spends the most time in (2D spatial density heatmap with trajectory overlay)

### Velocity Heatmap Output

The velocity heatmap shows:

- **Left panel**: Pure spatial velocity heatmap (average velocity per spatial bin)
- **Right panel**: Velocity heatmap with trajectory overlay (trajectory colored by instantaneous velocity)
- Color intensity represents average velocity in that spatial region

### Trajectory Heatmap Output

The trajectory heatmap shows:

- **Left panel**: Pure spatial density heatmap (time spent per spatial bin)
- **Right panel**: Density heatmap with trajectory overlay (trajectory shown in cyan)
- Color intensity represents time spent in that spatial region

### Unified Colorbar for Batch Processing

When processing a folder with multiple files, both heatmap scripts automatically calculate a unified colorbar range:

1. **Pass 1**: Calculate heatmaps for all files and find the global maximum (99th percentile)
2. **Pass 2**: Generate all visualizations using the same colorbar range

This ensures that heatmaps from different samples are directly comparable.

- **Trajectory heatmaps** use a unified density scale across all samples
- **Velocity heatmaps** use a unified velocity scale across all samples

Console output includes:

- Detected body parts
- Valid data percentage
- Velocity statistics (mean, median, max)
- Velocity hotspot location (region with highest average velocity)
- Unified colorbar range (for batch processing)
