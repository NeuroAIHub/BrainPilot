# 📖 Reference Data Guide: Animal Behavior Trajectory Data (.h5 & .csv)

This document explains how to process 2D animal behavior trajectory tracking data using Python. The data is available in both original HDF5 (`.h5`) format and converted standard table (`.csv`) format.

---

## 1. Data Structure and Physical Meaning

Whether from the original `.h5` file or the converted `.csv` file, the core data representation is the same. This is a typical combination of **Time-series** and **Spatial coordinates** data.

### 1.1 What does each "Row" represent?

- **Physical Meaning**: **1 Row = 1 Frame**.
- **Explanation**: Each row of data represents one frame in the video. If your video recording frame rate is 30 fps (30 frames per second), then 30 consecutive rows of data represent 1 second of animal behavior trajectory in the real world. The increasing row number represents the passage of time.

### 1.2 What does each "Column" represent?

Column data is organized by "Body Part", with each part occupying **3 columns**.
Taking `nose` as an example:

1.  `nose_x`: The **X-axis pixel coordinate** of the nose in the current frame of the video (typically with the top-left corner of the frame as the origin 0,0, and rightward as the positive X direction).
2.  `nose_y`: The **Y-axis pixel coordinate** of the nose in the current frame of the video (downward as the positive Y direction).
3.  `nose_confidence` (or likelihood): The **confidence/probability value** of the algorithm model's detection of the nose position in the current frame. The value range is `0.0 ~ 1.0`.
    - `1.0` means the model is 100% confident that the nose is at this (X, Y) coordinate.
    - If the value is very low (e.g., `< 0.6`), it usually means the nose is occluded in this frame, or the image is blurry causing inaccurate model recognition. In this case, the (X, Y) coordinate is **unreliable**.

---

## 2. Reading and Using CSV Files (⭐ Recommended: Simplest and Most Efficient)

The converted `.csv` file already contains intuitive headers, making it most convenient to process using the `pandas` library.

### 2.1 Basic Reading Code

```python
import pandas as pd

# 1. Read CSV file
csv_path = "control 506.csv"
df = pd.DataFrame()
try:
    df = pd.read_csv(csv_path)
    print("✅ CSV data loaded successfully!")
except FileNotFoundError:
    print("❌ File not found, please check the path.")

# 2. View data overview
print(f"Data contains {df.shape[0]} frames and {df.shape[1]} columns of information.")
print("\nFirst 5 rows preview:")
print(df.head())
```

### 2.2 Data Analysis Tips: How to Clean and Extract Data?

In actual analysis, we cannot directly trust all coordinates. We must use the `confidence` column to filter out "dirty data" with inaccurate recognition.

```python
# Assume we want to study the movement trajectory of the mouse nose

# 1. Extract complete nose data
nose_data = df[['nose_x', 'nose_y', 'nose_confidence']]

# 2. [Core Technique] Filter low confidence data
# Set a threshold, e.g., 0.8. Treat coordinates with confidence < 0.8 as invalid (NaN)
threshold = 0.8
valid_nose_data = df.copy() # Copy data to avoid modifying original table

# Replace x and y coordinates that don't meet the condition with missing value NaN (Not a Number)
valid_nose_data.loc[valid_nose_data['nose_confidence'] < threshold, ['nose_x', 'nose_y']] = None

# 3. Extract filtered clean coordinates for plotting or calculating velocity
clean_x = valid_nose_data['nose_x']
clean_y = valid_nose_data['nose_y']

print(f"After filtering, {clean_x.isna().sum()} frames of nose data were excluded due to low confidence.")
```

---

## 3. Reading Original HDF5 (.h5) Files

If you don't want to generate intermediate CSV files and prefer to read directly from the source using code, you can use `h5py`.

### 3.1 HDF5 Internal Structure

According to our data's HDFView structure, you need to focus on two internal paths:

- `/2Dskeleton/BodyParts`: A one-dimensional byte array storing body part names (e.g., `[b'nose', b'back', b'tail']`).
- `/2Dskeleton/data2D`: A two-dimensional pure numeric matrix storing coordinates and confidence values.

### 3.2 Basic Reading Code

```python
import h5py
import numpy as np
import pandas as pd

h5_path = "control 506.h5"

with h5py.File(h5_path, 'r') as f:
    # 1. Parse body part names (and decode utf-8)
    raw_body_parts = f['/2Dskeleton/BodyParts'][:]
    body_parts = [part.decode('utf-8') if isinstance(part, bytes) else str(part) for part in raw_body_parts]

    # 2. Read pure numeric matrix
    data2d = f['/2Dskeleton/data2D'][:]

    # 3. Dynamically reconstruct into DataFrame in memory for easy subsequent processing
    column_names = []
    for part in body_parts:
        column_names.extend([f"{part}_x", f"{part}_y", f"{part}_confidence"])

    df_from_h5 = pd.DataFrame(data2d, columns=column_names)

print("\n✅ Data parsed directly from HDF5:")
print(df_from_h5.head())
```

## 4. Advanced Application Scenarios

Once you successfully extract clean `X` and `Y` coordinates, you can use them for the following animal behavior analyses:

1.  **Plot Trajectory Heatmap**: Use `matplotlib` or `seaborn` to plot `(back_x, back_y)` as a 2D histogram to observe which area the mouse prefers to stay in.
2.  **Calculate Total Movement Distance**: Calculate the **Euclidean distance** between coordinate points in each frame and the previous frame ($d = \sqrt{(x_2 - x_1)^2 + (y_2 - y_1)^2}$), then sum the distances of all frames.
3.  **Calculate Instantaneous Velocity**: Use the distance between adjacent frames divided by the time difference between adjacent frames ($t = 1 / frame rate$).
4.  **Identify Body Posture**: By calculating the distance between `nose` and `tail` points, you can determine whether the mouse is in a stretched or curled state.
