---
name: "pycortex-guide"
description: "Domain-validated guidance for cortical surface visualization and brain surface rendering of fMRI data using pycortex: data types (Volume, Vertex, Dataset), 2D cortical flatmaps, 3D WebGL brain viewers, volume-to-surface mapping, FreeSurfer/fMRIPrep integration, ROI management, and surface analysis. Use this skill whenever the user mentions pycortex, `import cortex`, cortical surfaces, brain flatmaps, WebGL brain viewers, cortical surface mapping, or wants to visualize neuroimaging data on the cortex, even if they don't explicitly name pycortex."
version: "1.0.0"
authors:
  - "Claude (AI-assisted)"
review_status: "ai-generated"
---

# Pycortex Guide

## Purpose

Encodes domain knowledge for using pycortex — a Python library for visualizing fMRI and volumetric neuroimaging data on cortical surfaces. Covers data creation, 2D flatmap rendering, interactive 3D WebGL viewers, volume-to-surface mapping, subject database management, FreeSurfer/fMRIPrep integration, and surface geometry analysis.

## When to Use This Skill

Activate when the user:
- Wants to visualize fMRI data on cortical surfaces
- Mentions pycortex, `import cortex`, flatmaps, or cortical surface visualization
- Needs to create Volume, Vertex, or Dataset objects for brain data
- Wants to generate 2D flatmaps or 3D interactive brain viewers
- Needs to import FreeSurfer or fMRIPrep subjects into pycortex
- Works with volume-to-surface mapping or cortical ROIs
- Needs to align functional data to anatomical surfaces
- Wants to compute surface properties (curvature, thickness, geodesic distance)

## Reference Files

| Topic | File | When to Read |
|-------|------|--------------|
| Data types | `references/dataset-types.md` | User creates Volume, Vertex, RGB, 2D, or Dataset objects |
| Visualization | `references/visualization.md` | User wants flatmaps, WebGL viewers, exports, or screenshots |
| Database & subjects | `references/database-subjects.md` | User manages subjects, surfaces, transforms, or masks |
| Mapping & transforms | `references/mapping-transforms.md` | User maps volume↔surface, aligns data, or works with transforms |
| FreeSurfer & fMRIPrep | `references/freesurfer-fmriprep.md` | User imports subjects from FreeSurfer or fMRIPrep |
| Surface analysis | `references/surface-analysis.md` | User computes curvature, geodesic distance, ROIs, or distortion |
| MNI & utilities | `references/mni-utils.md` | User transforms to/from MNI space or uses volume utilities |

## Installation

```bash
pip install -U setuptools wheel numpy cython
pip install -U pycortex
# With headless rendering support:
pip install -U 'pycortex[headless]'
```

Requirements: Python 3.10+, Linux/macOS only. Key dependencies: numpy, scipy, matplotlib, nibabel, h5py, tornado, shapely, lxml.

## Overview Pipeline

```
1. Import subject (FreeSurfer/fMRIPrep)  →  stored in cortex.db
2. Create data objects (Volume/Vertex)    →  wrap arrays with metadata
3. Visualize (quickflat / webgl / export) →  2D flatmaps or 3D viewers
4. Analyze surfaces (curvature, ROIs)     →  surface geometry tools
```

## Quick Start

```python
import cortex

# Create a random volume for demo subject "S1" with transform "fullhead"
vol = cortex.Volume.random("S1", "fullhead")

# 2D flatmap
fig = cortex.quickshow(vol, with_curvature=True, with_rois=True)
fig.savefig("flatmap.png")

# Interactive 3D viewer
cortex.webshow(vol)

# Create volume from your own data (3D numpy array)
import numpy as np
data = np.random.randn(31, 100, 100)  # must match transform shape
vol = cortex.Volume(data, "S1", "fullhead", cmap="RdBu_r", vmin=-2, vmax=2)
cortex.quickshow(vol)

# Save/load datasets
ds = cortex.Dataset(my_map=vol)
ds.save("results.hdf")
ds_loaded = cortex.load("results.hdf")
```

## Key Data Types

| Class | Description | Key Args |
|-------|-------------|----------|
| `Volume` | Volumetric data (3D/4D) | `data, subject, xfmname, cmap, vmin, vmax` |
| `Vertex` | Surface vertex data (1D/2D) | `data, subject, cmap, vmin, vmax` |
| `VolumeRGB` | RGB per voxel | `red, green, blue, subject, xfmname, alpha` |
| `VertexRGB` | RGB per vertex | `red, green, blue, subject, alpha` |
| `Volume2D` | Two volumes, 2D colormap | `dim1, dim2, subject, xfmname, vmin, vmax, vmin2, vmax2` |
| `Vertex2D` | Two vertex maps, 2D colormap | `dim1, dim2, subject, vmin, vmax, vmin2, vmax2` |
| `Dataset` | Container for multiple views | `**named_dataviews` |

## Key Visualization Functions

| Function | Description |
|----------|-------------|
| `cortex.quickshow(data, ...)` | 2D flatmap → matplotlib Figure |
| `cortex.quickflat.make_png(fname, data, ...)` | Save flatmap as PNG |
| `cortex.quickflat.make_svg(fname, data, ...)` | Save flatmap as SVG |
| `cortex.quickflat.make_gif(fname, volumes, ...)` | Animated GIF from volumes |
| `cortex.webshow(data, ...)` | Interactive 3D WebGL viewer |
| `cortex.webgl.make_static(path, data, ...)` | Static HTML 3D viewer |
| `cortex.export.save_3d_views(vol, ...)` | Multi-angle PNG exports |
| `cortex.export.plot_panels(vol, panels, ...)` | Multi-panel figure |

## Common Pitfalls

1. Volume data shape must match the transform dimensions in the database. Use `cortex.db.get_xfm(subject, xfmname)` to check expected shape.
2. Subject and transform names must exist in `cortex.db` before creating Volume objects. Import from FreeSurfer first.
3. `cortex.quickshow` is an alias for `cortex.quickflat.make_figure` — they are the same function.
4. Vertex data length must match total vertex count (left + right hemisphere). Single-hemisphere data is auto-padded with zeros.
5. `vmin`/`vmax` default to 1st/99th percentile of data. Always set explicitly for consistent colorbars across subjects.
6. WebGL viewer (`webshow`) starts a Tornado server — it blocks in scripts. Use in IPython/Jupyter or set `autoclose=True`.
7. The pycortex filestore path is set in `cortex.options.config`. Check with `cortex.database.default_filestore`.
8. For headless rendering (no display), install with `pip install 'pycortex[headless]'` and use `cortex.export.save_3d_views(..., headless=True)`.
9. `cortex.db` is a singleton — all operations share the same database instance.
10. When saving datasets with `pack=True`, subject geometry and transforms are embedded in the HDF5 file for portability.
