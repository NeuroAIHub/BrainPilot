# FreeSurfer & fMRIPrep Integration Reference

## Table of Contents
1. [Import from FreeSurfer](#import-from-freesurfer)
2. [FreeSurfer Utilities](#freesurfer-utilities)
3. [Import from fMRIPrep](#import-from-fmriprep)

## Import from FreeSurfer

### import_subj

Import a FreeSurfer-processed subject into the pycortex database.

```python
cortex.freesurfer.import_subj(freesurfer_subject, pycortex_subject=None, freesurfer_subject_dir=None, whitematter_surf='smoothwm')
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `freesurfer_subject` | str | required | FreeSurfer subject name |
| `pycortex_subject` | str | None | Pycortex subject name (defaults to freesurfer_subject) |
| `freesurfer_subject_dir` | str | None | FreeSurfer SUBJECTS_DIR (defaults to env var) |
| `whitematter_surf` | str | 'smoothwm' | White matter surface to import |

```python
# Basic import
cortex.freesurfer.import_subj("fsaverage")

# Import with different pycortex name
cortex.freesurfer.import_subj("sub-01", pycortex_subject="S1",
    freesurfer_subject_dir="/path/to/freesurfer/subjects")
```

### import_flat

Import flattened cortical surfaces from FreeSurfer.

```python
cortex.freesurfer.import_flat(freesurfer_subject, patch, hemis=['lh', 'rh'],
    pycortex_subject=None, flat_type='freesurfer',
    freesurfer_subject_dir=None)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `freesurfer_subject` | str | required | FreeSurfer subject name |
| `patch` | str | required | Patch name (e.g., "full" for full hemisphere) |
| `hemis` | list | ['lh','rh'] | Hemispheres to import |
| `flat_type` | str | 'freesurfer' | Flattening method used |

```python
cortex.freesurfer.import_flat("sub-01", "full", pycortex_subject="S1")
```

## FreeSurfer Utilities

### Surface Operations

```python
# Parse FreeSurfer surface file
pts, polys = cortex.freesurfer.parse_surf("/path/to/lh.pial")

# Write FreeSurfer surface
cortex.freesurfer.write_surf("output_surf", pts, polys)

# Get surface with type
pts, polys = cortex.freesurfer.get_surf("sub-01", "lh", "pial")

# Get curvature data
curv = cortex.freesurfer.get_curv("sub-01", "lh", type="wm")

# Parse curvature file
curv_data = cortex.freesurfer.parse_curv("/path/to/lh.curv")
```

### Surface-to-Surface Projection

```python
# Project data between subjects via FreeSurfer sphere
projected = cortex.freesurfer.mri_surf2surf(
    data, source_subj="sub-01", target_subj="fsaverage",
    hemi="lh")

# Get projection matrix (for repeated use)
matrix = cortex.freesurfer.get_mri_surf2surf_matrix(
    source_subj="sub-01", hemi="lh",
    surface_type="sphere.reg", target_subj="fsaverage")
projected = matrix.dot(data)
```

### FreeSurfer Processing

```python
# Run autorecon
cortex.freesurfer.autorecon("sub-01", type="all", parallel=True)

# Flatten cortical surface
cortex.freesurfer.flatten("sub-01", "lh", patch="full")

# Create fiducial (mid-cortical) surface
cortex.freesurfer.make_fiducial("sub-01")

# Get ROI labels
label_verts = cortex.freesurfer.get_label("S1", "V1", fs_subject="sub-01")
```

### File Path Helpers

```python
# Get FreeSurfer file paths
paths = cortex.freesurfer.get_paths("sub-01", "lh", type="surf")
# type options: "patch", "surf", "curv", "slim"
```

## Import from fMRIPrep

### import_subj

Import an fMRIPrep-processed subject into pycortex.

```python
cortex.fmriprep.import_subj(subject, source_dir, session=None,
    dataset=None, sname=None, old_fmriprep=False)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `subject` | str | required | BIDS subject ID (e.g., "01") |
| `source_dir` | str | required | Path to fMRIPrep output directory |
| `session` | str | None | BIDS session ID |
| `dataset` | str | None | BIDS dataset name |
| `sname` | str | None | Pycortex subject name (default: auto-generated) |
| `old_fmriprep` | bool | False | Use old fMRIPrep directory structure |

```python
# Import from fMRIPrep output
cortex.fmriprep.import_subj(
    subject="01",
    source_dir="/path/to/fmriprep/output",
    session="01",
    sname="S1"
)

# After import, subject is available in cortex.db
vol = cortex.Volume(data, "S1", "my_transform")
```

### Typical Workflow

```python
# 1. Run fMRIPrep on your BIDS dataset (outside pycortex)
# 2. Import the subject
cortex.fmriprep.import_subj("01", "/data/derivatives/fmriprep")

# 3. Create alignment transform
cortex.align.automatic("sub-01", "task_bold",
    reference="/data/derivatives/fmriprep/sub-01/func/sub-01_task-rest_bold.nii.gz")

# 4. Visualize
vol = cortex.Volume("beta_map.nii.gz", "sub-01", "task_bold")
cortex.quickshow(vol)
```
