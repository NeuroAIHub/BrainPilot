# Database & Subjects Reference

## Table of Contents
1. [Database Singleton (cortex.db)](#database-singleton)
2. [Subject Management](#subject-management)
3. [Surfaces](#surfaces)
4. [Transforms](#transforms)
5. [Masks](#masks)
6. [ROI Storage](#roi-storage)
7. [Configuration](#configuration)

## Database Singleton

`cortex.db` is the singleton `Database` object providing access to all stored subjects, surfaces, transforms, and masks.

```python
import cortex

# Check filestore location
print(cortex.database.default_filestore)

# List subjects
print(dir(cortex.db))
```

### Database File Structure

```
filestore/
└── {subject}/
    ├── surfaces/
    │   ├── {name}_{hemisphere}.npz    # Surface geometry files
    │   └── ...
    ├── transforms/
    │   └── {xfmname}/
    │       ├── matrices.xfm           # Affine transform
    │       └── reference.nii.gz       # Reference volume
    ├── rois.svg                       # ROI definitions
    ├── overlays.svg                   # Overlay definitions
    └── warning.txt                    # Optional subject notes
```

## Subject Management

```python
# Access subject database
subj_db = cortex.db.get_paths("S1")
# Returns dict with keys: 'surfs', 'xfms', 'anatomicals', etc.

# SubjectDB provides attribute access
subj = cortex.database.SubjectDB("S1")
subj.transforms   # XfmDB object
subj.surfaces     # SurfaceDB object
```

## Surfaces

### get_surf

```python
cortex.db.get_surf(subject, type, hemisphere="both", merge=False, nudge=False)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `subject` | str | required | Subject name |
| `type` | str | required | Surface type |
| `hemisphere` | str | "both" | "left", "right", or "both" |
| `merge` | bool | False | Merge hemispheres into single array |
| `nudge` | bool | False | Nudge hemispheres apart for display |

Surface types: `"fiducial"`, `"inflated"`, `"flat"`, `"pial"`, `"wm"`, `"pia"`

Returns: `(pts, polys)` — vertices array `(N, 3)` and faces array `(F, 3)`.
If `hemisphere="both"` and `merge=False`, returns `((left_pts, left_polys), (right_pts, right_polys))`.

```python
# Get both hemispheres merged
pts, polys = cortex.db.get_surf("S1", "fiducial", merge=True)

# Get left hemisphere only
left_pts, left_polys = cortex.db.get_surf("S1", "fiducial", "left")

# Get inflated surface
pts, polys = cortex.db.get_surf("S1", "inflated", merge=True, nudge=True)
```

## Transforms

### get_xfm

```python
cortex.db.get_xfm(subject, xfmname, xfmtype="coord")
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `xfmtype` | str | "coord" | Transform type: "coord", "magnet", "raw" |

Returns a `Transform` object.

```python
xfm = cortex.db.get_xfm("S1", "fullhead")
print(xfm.shape)  # Expected volume shape

# Save a new transform
xfm.save("S1", "my_new_xfm")
```

### save_xfm

```python
cortex.db.save_xfm(subject, name, xfm, xfmtype="coord", reference=None)
```

## Masks

Masks define which voxels are included in analyses. Stored per subject/transform.

### get_mask

```python
cortex.db.get_mask(subject, xfmname, type="thick")
```

| Type | Description |
|------|-------------|
| `"thick"` | Thick cortical ribbon mask (default) |
| `"thin"` | Thin cortical ribbon mask |
| `"nearest"` | Nearest-neighbor mask |

Returns: 3D boolean array matching transform shape.

```python
mask = cortex.db.get_mask("S1", "fullhead", "thick")
n_voxels = mask.sum()
# Use mask with Volume
masked_data = np.random.randn(n_voxels)
vol = cortex.Volume(masked_data, "S1", "fullhead", mask=mask)
```

## ROI Storage

ROIs are stored as SVG files in the subject directory.

```python
# Get ROI vertices
roi_verts = cortex.db.get_overlay("S1")
# Returns SVGOverlay object

# Get specific ROI vertex indices
from cortex.utils import get_roi_verts
roi_dict = get_roi_verts("S1", roi="V1")  # dict: {"V1": array_of_vertex_indices}

# Get all ROIs
all_rois = get_roi_verts("S1")  # dict of all ROI names → vertex arrays

# Get ROI masks for volume data
from cortex.utils import get_roi_mask
roi_masks = get_roi_mask("S1", "fullhead", roi="V1")
```

## Configuration

```python
import cortex

# View current config
print(cortex.options.config.get("basic", "filestore"))

# Config file location
print(cortex.options.usercfg)

# Key config sections:
# [basic] filestore = path to subject database
# [webgl] colormaps = path to colormap files
```

Default config is at `cortex/defaults.cfg`. User overrides in `~/.config/pycortex/options.cfg`.
