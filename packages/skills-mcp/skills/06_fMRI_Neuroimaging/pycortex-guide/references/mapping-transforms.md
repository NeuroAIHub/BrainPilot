# Mapping & Transforms Reference

## Table of Contents
1. [Volume-to-Surface Mapping](#volume-to-surface-mapping)
2. [Mapper Types](#mapper-types)
3. [Transform Class](#transform-class)
4. [Alignment](#alignment)

## Volume-to-Surface Mapping

### get_mapper

```python
cortex.mapper.get_mapper(subject, xfmname, type='nearest', recache=False, **kwargs)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `subject` | str | required | Subject name |
| `xfmname` | str | required | Transform name |
| `type` | str | 'nearest' | Mapper type (see table below) |
| `recache` | bool | False | Force recomputation |

Returns a Mapper object that can project data between volume and surface space.

```python
mapper = cortex.mapper.get_mapper("S1", "fullhead", type="trilinear")

# Volume → Surface
vertex_data = mapper(volume_data)

# Surface → Volume (inverse)
volume_data = mapper.backwards(vertex_data)

# Access mask
mask = mapper.mask
left_mask, right_mask = mapper.hemimasks
```

### High-Level Convenience

```python
# Volume.map() method
vol = cortex.Volume(data, "S1", "fullhead")
vx = vol.map("nearest")  # returns Vertex

# Direct function
from cortex.mapper import vol2surf
vertex_data = vol2surf(data, "S1", "fullhead", target_surface="native")
```

### nanproject

```python
from cortex.mapper import nanproject
vertex_data = nanproject(volume_data_with_nans, mapper, reweigh=True)
```

Handles NaN values during projection by reweighting non-NaN contributions.

## Mapper Types

| Type | Class | Description |
|------|-------|-------------|
| `'nearest'` | PointNN | Nearest-neighbor point sampling |
| `'trilinear'` | PointTrilin | Trilinear interpolation at surface points |
| `'gaussian'` | PointGauss | Gaussian kernel sampling |
| `'lanczos'` | PointLanczos | Lanczos interpolation |
| `'const_nearest'` | ConstPatchNN | Constant-depth patch, nearest neighbor |
| `'const_trilinear'` | ConstPatchTrilin | Constant-depth patch, trilinear |
| `'const_lanczos'` | ConstPatchLanczos | Constant-depth patch, Lanczos |
| `'line_nearest'` | LineNN | Line sampling (WM→pial), nearest |
| `'line_trilinear'` | LineTrilin | Line sampling (WM→pial), trilinear |
| `'line_lanczos'` | LineLanczos | Line sampling (WM→pial), Lanczos |

Point mappers sample at a single cortical depth. Line mappers average across the cortical ribbon (white matter to pial surface). Patch mappers sample a local neighborhood.

Recommended defaults:
- Quick visualization: `'nearest'`
- Publication quality: `'line_nearest'` or `'trilinear'`
- Smoothest results: `'lanczos'`

## Transform Class

```python
from cortex.xfm import Transform
```

### Creating Transforms

```python
# From 4x4 matrix + reference NIfTI
xfm = Transform(np.eye(4), "reference.nii.gz")

# From FSL FLIRT output
xfm = Transform.from_fsl("flirt_matrix.mat", "func.nii.gz", "anat.nii.gz")

# From FreeSurfer bbregister
xfm = Transform.from_freesurfer("register.dat", "func.nii.gz", "S1")
```

### Using Transforms

```python
# Apply to points
transformed_pts = xfm(pts)  # pts shape (N, 3)

# Inverse
inv_xfm = xfm.inv

# Compose transforms
combined = xfm1 * xfm2

# Save to database
xfm.save("S1", "my_transform", xfmtype="magnet")

# Convert to FSL format
xfm.to_fsl("anat.nii.gz", direction='func>anat')

# Convert to FreeSurfer format
xfm.to_freesurfer("register.dat", "S1")
```

### Transform Types

| Type | Description |
|------|-------------|
| `"magnet"` | Scanner magnet coordinates → anatomical |
| `"coord"` | Coordinate transform (default) |
| `"raw"` | Raw affine matrix |

## Alignment

Functions for aligning functional volumes to cortical surfaces.

### Manual Alignment (FreeSurfer FreeView)

```python
cortex.align.manual(subject, xfmname, output_name="register.lta",
    wm_color="yellow", pial_color="blue", wm_surface='white',
    noclean=False, reference=None, inspect_only=False)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `subject` | str | required | Subject name |
| `xfmname` | str | required | Transform name to save |
| `output_name` | str | "register.lta" | Output registration filename |
| `wm_color` | str | "yellow" | White matter surface color in FreeView |
| `pial_color` | str | "blue" | Pial surface color in FreeView |
| `wm_surface` | str | "white" | White matter surface type |
| `reference` | str | None | Path to functional volume |
| `inspect_only` | bool | False | View alignment without editing |

Opens FreeView GUI for interactive alignment. Saves result to database.

### Automatic Alignment

```python
# Using FreeSurfer bbregister
cortex.align.automatic(subject, xfmname, reference, init="coreg",
    epi_mask=False, intermediate=None, reference_contrast="t2", noclean=False)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `subject` | str | required | Subject name |
| `xfmname` | str | required | Name to save transform as |
| `reference` | str | required | Path to functional volume |
| `init` | str | "coreg" | Initialization: "coreg", "fsl", "header", "spm" |
| `epi_mask` | bool | False | Use EPI mask during registration |
| `reference_contrast` | str | "t2" | Reference image contrast type: "t1" or "t2" |
| `noclean` | bool | False | Keep temporary files after alignment |

```python
# Using FSL FLIRT BBR
cortex.align.automatic_fsl(subject, xfmname, reference="func.nii.gz")

# Fine-tune existing alignment
cortex.align.autotweak(subject, xfmname)
```
