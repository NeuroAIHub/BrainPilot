# Surface Analysis Reference

## Table of Contents
1. [Surface Properties (surfinfo)](#surface-properties)
2. [Geodesic Distance](#geodesic-distance)
3. [Surface Geometry (polyutils)](#surface-geometry)
4. [ROI Operations](#roi-operations)
5. [SVG Overlays](#svg-overlays)

## Surface Properties

### curvature

```python
cortex.surfinfo.curvature(outfile, subject, smooth=20)
```

Computes mean curvature of the cortical surface. Result is cached.

### thickness

```python
cortex.surfinfo.thickness(outfile, subject)
```

Computes cortical thickness (distance between white matter and pial surfaces).

### distortion

```python
cortex.surfinfo.distortion(outfile, subject, dist_type='areal', smooth=20)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `dist_type` | str | 'areal' | Distortion type: 'areal' or 'metric' |
| `smooth` | int | 20 | Smoothing iterations |

Computes flatmap distortion (how much the flattening stretches/compresses the surface).

### tissots_indicatrix

```python
cortex.surfinfo.tissots_indicatrix(outfile, subject, radius=10, spacing=50)
```

Computes Tissot's indicatrix for visualizing flatmap distortion patterns.

### flat_border

```python
cortex.surfinfo.flat_border(outfile, subject)
```

Computes flatmap border information.

```python
# Example: visualize curvature
curv = cortex.Vertex(cortex.db.get_surfinfo("S1", "curvature"), "S1")
cortex.quickshow(curv)

# Blend data with curvature
vx = cortex.Vertex(my_data, "S1")
blended = vx.blend_curvature(alpha=0.5, brightness=0.5, contrast=0.25, smooth=20)
cortex.quickshow(blended)
```

## Geodesic Distance

### Exact Geodesic

```python
from cortex.polyutils import exact_geodesic
distances = exact_geodesic.geodesic_distance(surface, vertex_indices)
```

### Via Surface Class

```python
from cortex.polyutils import Surface

pts, polys = cortex.db.get_surf("S1", "fiducial", "left")
surf = Surface(pts, polys)

# Geodesic distance from a seed vertex
distances = surf.geodesic_distance(vertex_index)

# Geodesic path between two vertices
path = surf.geodesic_path(start_vertex, end_vertex)
```

```python
# Example: compute and visualize geodesic distance
pts, polys = cortex.db.get_surf("S1", "fiducial", merge=True)
from cortex.polyutils import Surface
surf = Surface(pts, polys)

seed = 10000  # vertex index
dists = surf.geodesic_distance([seed])

vx = cortex.Vertex(dists, "S1", cmap="hot", vmin=0, vmax=100)
cortex.quickshow(vx)
```

## Surface Geometry

### Surface Class

```python
from cortex.polyutils import Surface

pts, polys = cortex.db.get_surf("S1", "fiducial", "left")
surf = Surface(pts, polys)
```

Key properties:
- `surf.adj` — sparse adjacency matrix
- `surf.face_normals` — normal vector per face
- `surf.vertex_normals` — normal vector per vertex
- `surf.face_areas` — area of each face
- `surf.cotangent_weights` — cotangent Laplacian weights
- `surf.laplace_operator` — Laplace-Beltrami operator (sparse matrix)
- `surf.connected` — connected components

Key methods:
- `surf.geodesic_distance(verts)` — exact geodesic distance from vertices
- `surf.smooth(data, iterations)` — smooth data on surface
- `surf.subsurface(vertex_mask)` — extract subsurface

### Distortion Analysis

```python
from cortex.polyutils import Distortion

# Compare fiducial to flat surface
fid_pts, polys = cortex.db.get_surf("S1", "fiducial", "left")
flat_pts, _ = cortex.db.get_surf("S1", "flat", "left")

dist = Distortion(fid_pts, flat_pts, polys)
areal = dist.areal      # areal distortion per face
metric = dist.metric     # metric distortion per face
```

### Utility Functions

```python
from cortex.polyutils.misc import (
    voxelize,        # Surface → 3D voxel mask
    marching_cubes,  # 3D volume → surface mesh
    decimate,        # Reduce polygon count
    boundary_edges,  # Find boundary edges of mesh
    face_area,       # Compute face areas
    face_volume,     # Volume between two surfaces
    measure_volume,  # Total enclosed volume
)

# Voxelize a surface
mask_3d = voxelize(pts, polys, shape=(256, 256, 256), center=(128, 128, 128))

# Extract surface from volume
new_pts, new_polys = marching_cubes(volume_data, smooth=True, decimate=True)
```

## ROI Operations

### Get ROI Vertices

```python
from cortex.utils import get_roi_verts

# Single ROI
v1_verts = get_roi_verts("S1", roi="V1")  # {"V1": array([...])}

# All ROIs
all_rois = get_roi_verts("S1")  # {"V1": array, "V2": array, ...}
```

### Get ROI Volume Mask

```python
from cortex.utils import get_roi_mask

# Get binary mask in volume space
v1_mask = get_roi_mask("S1", "fullhead", roi="V1")
# Returns dict: {"V1": 3D_boolean_array}
```

### Visualize ROI

```python
# Highlight ROI vertices
roi_verts = get_roi_verts("S1", roi="V1")["V1"]
data = np.zeros(cortex.db.get_surf("S1", "fiducial", merge=True)[0].shape[0])
data[roi_verts] = 1.0
vx = cortex.Vertex(data, "S1", cmap="hot", vmin=0, vmax=1)
cortex.quickshow(vx, with_rois=True)
```

## SVG Overlays

ROIs and overlays are stored as SVG files. The `svgoverlay` module manages them.

```python
# Get overlay object
overlay = cortex.db.get_overlay("S1")

# Access ROI definitions
# ROIs are stored in {filestore}/{subject}/rois.svg

# Custom overlay file
fig = cortex.quickshow(vol, overlay_file="/path/to/custom_overlay.svg")
```

ROIs can be edited interactively using Inkscape:
```python
from cortex.rois import ROIpack
rois = ROIpack("S1", "rois.svg")
rois.to_svg(open_inkscape=True)  # Opens Inkscape for editing
```
