# Visualization Reference

## Table of Contents
1. [Quickflat (2D Flatmaps)](#quickflat-2d-flatmaps)
2. [WebGL (3D Interactive Viewer)](#webgl-3d-interactive-viewer)
3. [Export (Multi-View Rendering)](#export-multi-view-rendering)

## Quickflat (2D Flatmaps)

### make_figure / quickshow

```python
cortex.quickshow(braindata, recache=False, pixelwise=True, thick=32,
    sampler='nearest', height=1024, dpi=100, depth=0.5,
    with_rois=True, with_sulci=False, with_labels=True,
    with_colorbar=True, with_borders=False, with_dropout=False,
    with_curvature=False, with_connected_vertices=False,
    overlay_file=None, linewidth=None, linecolor=None,
    roifill=None, shadow=None, labelsize=None, labelcolor=None,
    cutout=None, curvature_brightness=None, curvature_contrast=None,
    fig=None, colorbar_ticks=None, colorbar_location='center',
    roi_list=None, sulci_list=None, nanmean=False)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `braindata` | Volume/Vertex | required | Data to display |
| `pixelwise` | bool | True | Pixel-accurate mapping (vs interpolated) |
| `thick` | int | 32 | Number of cortical layers to sample |
| `sampler` | str | 'nearest' | Sampling method: 'nearest', 'trilinear', 'lanczos' |
| `height` | int | 1024 | Image height in pixels |
| `depth` | float | 0.5 | Cortical depth (0=white matter, 1=pial) |
| `with_rois` | bool | True | Show ROI boundaries |
| `with_sulci` | bool | False | Show sulcal boundaries |
| `with_curvature` | bool | False | Show curvature underlay |
| `with_colorbar` | bool | True | Show colorbar |
| `with_dropout` | bool | False | Show dropout regions |
| `cutout` | str | None | ROI name to cut out and zoom |
| `roi_list` | list | None | Specific ROIs to display |
| `nanmean` | bool | False | Use nanmean for layer averaging |
| `fig` | Figure | None | Existing matplotlib figure |
| `extra_disp` | tuple | None | Extra display layer (name, colormap) |
| `extra_hatch` | tuple | None | Hatch overlay (Dataview, color_tuple) |
| `curvature_threshold` | bool | None | Threshold curvature display |

```python
import cortex
vol = cortex.Volume.random("S1", "fullhead")

# Basic flatmap
fig = cortex.quickshow(vol)

# With curvature and sulci
fig = cortex.quickshow(vol, with_curvature=True, with_sulci=True,
                       curvature_brightness=0.5, curvature_contrast=0.25)

# Zoom to ROI
fig = cortex.quickshow(vol, cutout="V1")

# Custom ROI display
fig = cortex.quickshow(vol, roi_list=["V1", "V2", "V3"],
                       linewidth=2, linecolor=(1, 1, 1, 1))
```

### make_png

```python
cortex.quickflat.make_png(fname, braindata, recache=False, pixelwise=True,
    sampler='nearest', height=1024, bgcolor=None, dpi=100, **kwargs)
```

```python
cortex.quickflat.make_png("output.png", vol, bgcolor=(0,0,0,0))  # transparent
cortex.quickflat.make_png("output.png", vol, height=2048, dpi=300)  # high-res
```

### make_svg

```python
cortex.quickflat.make_svg(fname, braindata, with_labels=False,
    with_curvature=True, layers=['rois'], height=1024, overlay_file=None)
```

### make_gif

```python
cortex.quickflat.make_gif(output_path, volumes, frame_duration=1, **figure_kwargs)
```

```python
vols = [cortex.Volume(data[t], "S1", "fullhead") for t in range(10)]
cortex.quickflat.make_gif("animation.gif", vols, frame_duration=0.5,
                          with_curvature=True)
```

### Compositing Functions

For fine-grained control over flatmap layers:

```python
from cortex.quickflat import composite
fig, ax = plt.subplots()
composite.add_curvature(fig, braindata, ...)
composite.add_data(fig, braindata, ...)
composite.add_rois(fig, braindata, ...)
composite.add_sulci(fig, braindata, ...)
composite.add_colorbar(fig, braindata, ...)
composite.add_cutout(fig, braindata, name="V1", ...)
```

---

## WebGL (3D Interactive Viewer)

### show / webshow

```python
cortex.webshow(data, autoclose=None, open_browser=None, port=None,
    pickerfun=None, recache=False, template='mixer.html',
    overlays_visible=('rois', 'sulci'), labels_visible=('rois',),
    types=('inflated',), overlay_file=None,
    curvature_brightness=None, curvature_contrast=None,
    surface_specularity=None, title='Brain', layout=None)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `data` | Dataset/Volume/Vertex | required | Data to display |
| `autoclose` | bool | True | Close server when browser disconnects |
| `open_browser` | bool | True | Auto-open browser |
| `port` | int | random | Server port |
| `pickerfun` | callable | None | Click callback: `fn(voxel, vertex, hemi)` |
| `types` | tuple | ('inflated',) | Surface types to include |
| `overlays_visible` | tuple | ('rois','sulci') | Default visible overlays |
| `surface_specularity` | float | None | Surface shininess |

```python
# Basic viewer
handle = cortex.webshow(vol)

# Multi-dataset viewer with picker
def on_click(voxel, vertex, hemi):
    print(f"Clicked vertex {vertex} in {hemi}")

ds = cortex.Dataset(map1=vol1, map2=vol2)
handle = cortex.webshow(ds, pickerfun=on_click)

# Programmatic control via handle
handle._set_view(**{"camera.azimuth": 45, "camera.altitude": 30})
handle.getImage("screenshot.png", size=(1920, 1080))
```

### make_static

```python
cortex.webgl.make_static(outpath, data, recache=False,
    template='static.html', anonymize=False,
    overlays_visible=('rois', 'sulci'), labels_visible=('rois',),
    types=('inflated',), html_embed=True, title='Brain')
```

```python
# Self-contained HTML file
cortex.webgl.make_static("viewer.html", vol, html_embed=True)

# Anonymized for sharing
cortex.webgl.make_static("public_viewer.html", vol, anonymize=True)
```

### View Control (JSMixer handle)

```python
handle = cortex.webshow(vol)

# Camera
handle._set_view(**{"camera.azimuth": 90, "camera.altitude": 0})

# Surface unfolding (0=folded, 1=flat)
handle._set_view(**{"surface.S1.unfold": 0.5})

# Save/load views
handle.save_view("S1", "my_view")
handle.get_view("S1", "my_view")

# Screenshots and movies
handle.getImage("shot.png", size=(1920, 1080))
handle.makeMovie(animation_dict, "movie.mp4", fps=30)
```

---

## Export (Multi-View Rendering)

### save_3d_views

```python
cortex.export.save_3d_views(volume, base_name='fig',
    list_angles=['lateral_pivot'], list_surfaces=['inflated'],
    viewer_params=dict(labels_visible=[], overlays_visible=['rois']),
    size=(4096, 3072), trim=True, sleep=10, headless=False)
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `list_angles` | list | ['lateral_pivot'] | View angles |
| `list_surfaces` | list | ['inflated'] | Surface types |
| `size` | tuple | (4096,3072) | Image size |
| `trim` | bool | True | Auto-trim borders |
| `headless` | bool | False | Use Playwright (no display) |

Available angles: `'left'`, `'right'`, `'front'`, `'back'`, `'top'`, `'bottom'`, `'flatmap'`, `'medial_pivot'`, `'lateral_pivot'`, `'bottom_pivot'`, `'top_pivot'`

Available surfaces: `'inflated'`, `'flatmap'`, `'fiducial'`, `'inflated_cut'`

```python
# Multiple views, headless
paths = cortex.export.save_3d_views(
    vol, base_name="results/brain",
    list_angles=["lateral_pivot", "medial_pivot", "flatmap"],
    list_surfaces=["inflated"],
    headless=True, size=(4096, 3072))
```

### plot_panels

```python
cortex.export.plot_panels(volume, panels, figsize=(16, 9),
    windowsize=(6400, 3600), save_name=None, sleep=10, headless=False)
```

```python
panels = [
    {"extent": [0, 0.5, 0.5, 0.5],
     "view": {"hemisphere": "left", "angle": "lateral_pivot", "surface": "inflated"}},
    {"extent": [0.5, 0.5, 0.5, 0.5],
     "view": {"hemisphere": "right", "angle": "lateral_pivot", "surface": "inflated"}},
    {"extent": [0, 0, 1, 0.5],
     "view": {"angle": "flatmap", "surface": "flatmap"}}
]
fig = cortex.export.plot_panels(vol, panels, save_name="panels.png", headless=True)
```

### headless_viewer (context manager)

```python
with cortex.export.headless_viewer(vol) as handle:
    handle._set_view(**{"camera.azimuth": 45})
    handle.getImage("view.png")
```

Requires: `pip install 'pycortex[headless]' && playwright install chromium`
