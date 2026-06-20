# MNI & Utilities Reference

## Table of Contents
1. [MNI Space Transforms](#mni-space-transforms)
2. [Volume Utilities](#volume-utilities)
3. [Anatomical Processing](#anatomical-processing)
4. [General Utilities](#general-utilities)

## MNI Space Transforms

### compute_mni_transform

```python
cortex.mni.compute_mni_transform(subject, xfm, template=None)
```

Computes the combined transform from functional space to MNI standard space using FSL's FLIRT and FNIRT.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subject` | str | Subject name |
| `xfm` | str | Transform name (functional → anatomical) |
| `template` | str | MNI template path (default: FSL's MNI152 1mm) |

Returns: `func_to_mni` warp field.

### transform_to_mni

```python
cortex.mni.transform_to_mni(volumedata, func_to_mni, template=None)
```

Transform volumetric data from functional space to MNI space.

```python
# Full workflow: subject space → MNI
func_to_mni = cortex.mni.compute_mni_transform("S1", "fullhead")
mni_data = cortex.mni.transform_to_mni(vol.volume, func_to_mni)
```

### transform_mni_to_subject

```python
cortex.mni.transform_mni_to_subject(subject, xfm, volarray, func_to_mni, template=None)
```

Transform data from MNI space back to subject's functional space.

```python
# MNI → subject space
subject_data = cortex.mni.transform_mni_to_subject(
    "S1", "fullhead", mni_volume, func_to_mni)
vol = cortex.Volume(subject_data, "S1", "fullhead")
```

### transform_surface_to_mni

```python
cortex.mni.transform_surface_to_mni(subject, surfname)
```

Transform surface vertices to MNI coordinates.

```python
mni_pts = cortex.mni.transform_surface_to_mni("S1", "fiducial")
```

### Example: MNI Atlas on Subject Surface

```python
import cortex
import numpy as np
import nibabel as nib

# Load MNI atlas
atlas = nib.load("MNI_atlas.nii.gz").get_fdata()

# Compute warp
func_to_mni = cortex.mni.compute_mni_transform("S1", "fullhead")

# Transform atlas to subject space
subj_atlas = cortex.mni.transform_mni_to_subject(
    "S1", "fullhead", atlas, func_to_mni)

# Visualize
vol = cortex.Volume(subj_atlas, "S1", "fullhead", cmap="tab20")
cortex.quickshow(vol)
```

## Volume Utilities

### mosaic

```python
cortex.mosaic(data, dim=0, show=True, **kwargs)
```

Creates a 2D mosaic view of 3D volumetric data (radiological convention).

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `data` | ndarray | required | 3D volume |
| `dim` | int | 0 | Dimension to slice across |
| `show` | bool | True | Display with matplotlib |

```python
import cortex
import numpy as np

data = np.random.randn(64, 64, 32)
cortex.mosaic(data, dim=2)  # Axial slices
```

### unmask

```python
cortex.unmask(mask, data)
```

Reconstruct full volume from masked (1D) data.

```python
mask = cortex.db.get_mask("S1", "fullhead", "thick")
masked_data = np.random.randn(mask.sum())
full_volume = cortex.unmask(mask, masked_data)
# full_volume.shape == mask.shape (MaskedArray)
```

### Detrending Functions

```python
from cortex.volume import detrend_median, detrend_gradient, detrend_poly

# Median filter detrending
detrended = detrend_median(data, kernel=15)

# Gradient-based detrending
grad = detrend_gradient(data, diff=3)

# Polynomial detrending
detrended = detrend_poly(data, polyorder=10, mask=None)
```

## Anatomical Processing

### brainmask

```python
cortex.anat.brainmask(outfile, subject)
```

Creates a brain mask using FSL BET. Requires FSL installation.

### whitematter

```python
cortex.anat.whitematter(outfile, subject, do_voxelize=False)
```

Creates white matter segmentation mask using FreeSurfer labels or FSL FAST.

### voxelize

```python
cortex.anat.voxelize(outfile, subject, surf='wm', mp=True)
```

Voxelizes a surface to create a binary 3D mask.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `surf` | str | 'wm' | Surface to voxelize: 'wm' or 'pia' |
| `mp` | bool | True | Use multiprocessing |

## General Utilities

### cortex.utils (imported to top-level)

```python
# Get ROI vertices (most commonly used utility)
from cortex.utils import get_roi_verts, get_roi_mask

# Get ROI vertex indices
rois = get_roi_verts("S1")           # all ROIs
v1 = get_roi_verts("S1", roi="V1")   # specific ROI

# Get ROI mask in volume space
masks = get_roi_mask("S1", "fullhead")
v1_mask = get_roi_mask("S1", "fullhead", roi="V1")
```

### Vertex distance from surface

```python
# Compute voxel distance from cortical surface
# (useful for defining cortical ribbon masks)
from cortex.utils import get_vox_dist
dist, argdist = get_vox_dist(subject, xfmname)
```

### Multiprocessing helper

```python
from cortex.mp import map as mp_map
# Parallel map function used internally by pycortex
results = mp_map(func, iterable)
```
