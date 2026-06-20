# Dataset Types Reference

## Table of Contents
1. [Volume](#volume)
2. [Vertex](#vertex)
3. [VolumeRGB / VertexRGB](#volumergb--vertexrgb)
4. [Volume2D / Vertex2D](#volume2d--vertex2d)
5. [Dataset](#dataset)
6. [Colors Utility](#colors-utility)

## Volume

Wraps 3D/4D volumetric data with subject, transform, and colormap metadata.

```python
cortex.Volume(data, subject, xfmname, mask=None, cmap=None, vmin=None, vmax=None, description="", **kwargs)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | ndarray or str | 3D `(z,y,x)`, 4D `(t,z,y,x)`, 1D masked `(v,)`, 2D masked `(t,v)`, or NIfTI path |
| `subject` | str | Subject name in `cortex.db` |
| `xfmname` | str | Transform name in database |
| `mask` | ndarray, optional | Binary 3D mask; auto-detected if data is 1D/2D |
| `cmap` | str | Matplotlib colormap name |
| `vmin/vmax` | float | Color scale bounds (default: 1st/99th percentile) |

Key properties and methods:
- `vol.volume` — returns unmasked 3D/4D array
- `vol.linear` — True if data is masked (1D/2D)
- `vol.movie` — True if data has time dimension
- `vol.shape` — 3D volume shape
- `vol.map(projection="nearest")` — convert to Vertex via surface mapping
- `vol.save(filename)` — save to HDF5
- `vol.save_nii(filename)` — save as NIfTI
- `Volume.random(subject, xfmname)` — class method for random test data
- `Volume.empty(subject, xfmname, value=0)` — class method for constant volume

```python
# From numpy array
vol = cortex.Volume(np.random.randn(31, 100, 100), "S1", "fullhead",
                    cmap="hot", vmin=0, vmax=3)

# From NIfTI file
vol = cortex.Volume("func.nii.gz", "S1", "fullhead")

# Masked data (1D)
mask = cortex.db.get_mask("S1", "fullhead", "thick")
masked_data = np.random.randn(mask.sum())
vol = cortex.Volume(masked_data, "S1", "fullhead", mask=mask)

# 4D movie data
movie_vol = cortex.Volume(np.random.randn(100, 31, 100, 100), "S1", "fullhead")
```

## Vertex

Wraps surface vertex data (one value per vertex).

```python
cortex.Vertex(data, subject, cmap=None, vmin=None, vmax=None, description="", **kwargs)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `data` | ndarray | 1D `(v,)` or 2D `(t,v)` for movie |
| `subject` | str | Subject name in `cortex.db` |

Key properties and methods:
- `vx.vertices` — data with time dim added if needed
- `vx.left` / `vx.right` — hemisphere-specific data
- `vx.llen` / `vx.rlen` — vertex counts per hemisphere
- `vx.hem` — "left", "right", or "both"
- `vx.volume(xfmname, projection="nearest")` — map back to volume (approximate)
- `vx.map(target_subj, surface_type="fiducial")` — project to another subject
- `vx.blend_curvature(alpha)` — blend with curvature, returns VertexRGB
- `Vertex.random(subject)` — random test data
- `Vertex.empty(subject, value=0)` — constant vertex data

```python
# Full brain (both hemispheres)
n_verts = cortex.db.get_surf("S1", "fiducial", "both", merge=True, nudge=False)[0].shape[0]
vx = cortex.Vertex(np.random.randn(n_verts), "S1", cmap="RdBu_r", vmin=-3, vmax=3)

# Single hemisphere (auto-padded)
left_pts, _ = cortex.db.get_surf("S1", "fiducial", "left")
vx_left = cortex.Vertex(np.random.randn(left_pts.shape[0]), "S1")
```

## VolumeRGB / VertexRGB

Direct RGB(A) color specification per voxel or vertex.

```python
cortex.VolumeRGB(red, green, blue, subject=None, xfmname=None, alpha=None,
                 description="", channel1color=(255,0,0), channel2color=(0,255,0),
                 channel3color=(0,0,255), vmin=None, vmax=None, autorange="individual")

cortex.VertexRGB(red, green, blue, subject=None, alpha=None, ...)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `red/green/blue` | ndarray or Volume/Vertex | Data channels |
| `alpha` | ndarray or Volume/Vertex, optional | Transparency channel |
| `channel1/2/3color` | tuple(int,int,int) | RGB color for each channel |
| `vmin/vmax` | float or tuple(3) | Per-channel or shared bounds |
| `autorange` | str | "individual" or "shared" percentile ranging |

```python
# Three-channel RGB volume
r = cortex.Volume(data_r, "S1", "fullhead")
g = cortex.Volume(data_g, "S1", "fullhead")
b = cortex.Volume(data_b, "S1", "fullhead")
rgb = cortex.VolumeRGB(r, g, b)

# With alpha transparency
alpha = cortex.Volume(significance_map, "S1", "fullhead")
rgb = cortex.VolumeRGB(r, g, b, alpha=alpha)

# Custom channel colors
rgb = cortex.VolumeRGB(ch1, ch2, ch3, subject="S1", xfmname="fullhead",
                       channel1color=(255, 100, 0),
                       channel2color=(0, 200, 100),
                       channel3color=(100, 0, 255))
```

## Volume2D / Vertex2D

Two data dimensions visualized with a 2D colormap.

```python
cortex.Volume2D(dim1, dim2, subject=None, xfmname=None, cmap=None,
                vmin=None, vmax=None, vmin2=None, vmax2=None)

cortex.Vertex2D(dim1, dim2, subject=None, cmap=None,
                vmin=None, vmax=None, vmin2=None, vmax2=None)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `dim1/dim2` | ndarray or Volume/Vertex | Two data dimensions |
| `vmin/vmax` | float | Bounds for dim1 |
| `vmin2/vmax2` | float | Bounds for dim2 |
| `cmap` | str | 2D colormap name |

```python
# Activation + significance
activation = cortex.Volume(beta_map, "S1", "fullhead")
significance = cortex.Volume(-np.log10(pval_map), "S1", "fullhead")
vol2d = cortex.Volume2D(activation, significance,
                        vmin=-5, vmax=5, vmin2=0, vmax2=5)
cortex.quickshow(vol2d)
```

## Dataset

Container for multiple named Dataview objects. Used for multi-map viewers.

```python
cortex.Dataset(**named_dataviews)
```

```python
ds = cortex.Dataset(
    activation=cortex.Volume(act_data, "S1", "fullhead", cmap="hot"),
    contrast=cortex.Volume(con_data, "S1", "fullhead", cmap="RdBu_r"),
    surface=cortex.Vertex(surf_data, "S1", cmap="viridis")
)

# Save and load
ds.save("experiment.hdf")
ds = cortex.load("experiment.hdf")  # alias for Dataset.from_file

# Save portable (includes subject geometry)
ds.save("portable.hdf", pack=True)

# Access views
ds["activation"]  # or ds.activation
for name, view in ds:
    print(name)

# Append more views
ds.append(new_map=cortex.Volume(...))
```

## Colors Utility

Predefined colors for RGB visualizations:

```python
from cortex.dataset import Colors
Colors.RoseRed     # (237, 35, 96)
Colors.LimeGreen   # (141, 198, 63)
Colors.SkyBlue     # (0, 176, 218)
Colors.DodgerBlue  # (30, 144, 255)
Colors.Red         # (255, 0, 0)
Colors.Green       # (0, 255, 0)
Colors.Blue        # (0, 0, 255)
```

Numpy-style arithmetic works on all data types:
```python
vol_sum = vol1 + vol2
vol_diff = vol1 - vol2
vol_scaled = vol1 * 2.0
vol_abs = abs(vol1)
```
