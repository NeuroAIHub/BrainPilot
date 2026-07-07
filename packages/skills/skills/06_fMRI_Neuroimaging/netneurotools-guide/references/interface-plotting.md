# Interface & Plotting API Reference

## Table of Contents
- [Interface](#interface): [Constants](#constants) | [CIFTI](#cifti) | [FreeSurfer](#freesurfer) | [GIFTI](#gifti) | [Surface Parcellation](#surface-parcellation)
- [Plotting](#plotting): [PyVista](#pyvista-plotters) | [PySurfer](#pysurfer-plotters) | [Matplotlib](#matplotlib-plotters) | [Colors](#color-utilities)

---
## Interface

`netneurotools.interface`

### Constants

**PARCIGNORE** -- Labels ignored in parcellation extraction: `["unknown", "corpuscallosum", "Background+FreeSurfer_Defined_Medial_Wall", "???", "Unknown", "Medial_wall", "Medial wall", "medial_wall"]`

**SURFACE namedtuple** -- Returned by dataset fetch functions. Fields: `L` (left hemisphere), `R` (right hemisphere). Access: `surface.L`, `surface.R`.

### CIFTI

`netneurotools.interface.cifti`

**`describe_cifti(filename)`** -- Prints CIFTI file info. `filename`: str or Path. Returns None.

**`extract_cifti_volume(data, axis)`** -- Extracts volume data. `data`: np.ndarray. `axis`: nibabel.cifti2.BrainModelAxis. Returns `(vol_data: np.ndarray, affine: np.ndarray)`.

**`extract_cifti_surface(data, axis, surf_name)`** -- Extracts surface data for a named structure. `data`: np.ndarray. `axis`: nibabel.cifti2.BrainModelAxis. `surf_name`: str (e.g., `"CIFTI_STRUCTURE_CORTEX_LEFT"`, `"CIFTI_STRUCTURE_CORTEX_RIGHT"`). Returns np.ndarray.

**`extract_cifti_labels(axis, parc_ignore=PARCIGNORE)`** -- Extracts labels from LabelAxis. `axis`: nibabel.cifti2.LabelAxis. `parc_ignore`: list, optional. Returns `(keys: tuple, labels: tuple)`.

**`extract_cifti_surface_labels(data, label_axis, brainmodel_axis, surf_name, parc_ignore=PARCIGNORE)`** -- Extracts surface data and labels. `data`: np.ndarray. `label_axis`: nibabel.cifti2.LabelAxis. `brainmodel_axis`: nibabel.cifti2.BrainModelAxis. `surf_name`: str. `parc_ignore`: list, optional. Returns `(surf_data: np.ndarray, keys: tuple of int, labels: tuple)`.

**`deconstruct_cifti(filename, brain_model_axis_index=1)`** -- Extracts volume + both hemispheres. `filename`: str or Path. `brain_model_axis_index`: int, optional (default `1`). Returns `((vol_data, affine), surf_left, surf_right)`.

### FreeSurfer

`netneurotools.interface.freesurfer`

**`extract_annot_labels(annot_file, parc_ignore=PARCIGNORE)`** -- Extracts vertices/labels from `.annot` file. `annot_file`: str or Path. `parc_ignore`: list, optional. Returns `(surf_data: np.ndarray, keys: tuple of int, labels: tuple)`.

### GIFTI

`netneurotools.interface.gifti`

**`extract_gifti_labels(gifti_file, parc_ignore=PARCIGNORE)`** -- Extracts vertices/labels from GIFTI label file. `gifti_file`: str or os.PathLike or nib.GiftiImage. `parc_ignore`: list, optional. Returns `(surf_data: np.ndarray, keys: tuple of int, labels: tuple)`.

### Surface Parcellation

`netneurotools.interface.surf_parc`

**`load_surf_parc_file(parc_file, cifti_structure=None, parc_ignore=PARCIGNORE)`** -- Loads parcellation (`.gii`, `.dlabel.nii`, `.annot`). `parc_file`: str or os.PathLike or nib.GiftiImage or nib.Cifti2Image. `cifti_structure`: str, optional (required for `.dlabel.nii`). `parc_ignore`: list, optional. Returns `(surf_data: np.ndarray, keys: tuple, labels: tuple)`.

**`vertices_to_parcels(vert_data, parc_file, hemi="both", background=None, parc_ignore=PARCIGNORE)`** -- Converts vertex-level to parcel-level (mean). `vert_data`: np.ndarray or tuple/list. `parc_file`: str or Path or tuple/list. `hemi`: `"both"`, `"L"`, or `"R"`. `background`: int, optional. `parc_ignore`: list, optional. Returns `(reduced, keys, labels)` -- tuples of tuples when `hemi="both"`.

**`parcels_to_vertices(parc_data, parc_file, hemi="both", fill=np.nan, parc_ignore=PARCIGNORE)`** -- Converts parcel-level to vertex-level. `parc_data`: np.ndarray or tuple/list. `parc_file`: str or Path or tuple/list. `hemi`: `"both"`, `"L"`, or `"R"`. `fill`: int or float, optional (default `np.nan`). `parc_ignore`: list, optional. Returns `(projected, keys, labels)` -- tuples of tuples when `hemi="both"`.

---
## Plotting

`netneurotools.plotting`

### PyVista Plotters

`netneurotools.plotting.pyvista_plotters`

```python
pv_plot_surface(
    vertex_data, template, surf="inflated", hemi="both", layout="default",
    mask_medial=True, cmap="viridis", clim=None, panel_size=(700, 500),
    zoom_ratio=1.25, show_colorbar=True, show_silhouette=False,
    cbar_title=None, show_plot=True, jupyter_backend="static",
    lighting_style="default", save_fig=None, plotter_kws=None,
    mesh_kws=None, cbar_kws=None, silhouette_kws=None,
    data_dir=None, verbose=0
)
```
Plots vertex-level data on cortical surface. Returns pyvista.Plotter.
- `vertex_data`: array-like or tuple -- `(left, right)` or concatenated when `hemi="both"`.
- `template`: `"fsaverage"`, `"fsaverage6"`, `"fsaverage5"`, `"fsaverage4"`, `"fslr4k"`, `"fslr8k"`, `"fslr32k"`, `"fslr164k"`, `"civet41k"`, `"civet164k"`.
- `surf`: fsaverage: `"midthickness"`, `"pial"`, `"white"`, `"inflated"`, `"sphere"`. fslr: adds `"veryinflated"`. civet: `"midthickness"`, `"white"`, `"inflated"`. Default: `"inflated"`.
- `hemi`: `"L"`, `"R"`, `"both"`. Default: `"both"`.
- `layout`: `"default"` (2x2/1x2), `"single"`, `"row"`, `"column"`. Default: `"default"`.
- `mask_medial`: bool. Default: `True`.
- `cmap`: str. Default: `"viridis"`.
- `clim`: (vmin, vmax) or None (auto 2.5/97.5 percentile). Default: `None`.
- `panel_size`: (width, height) pixels. Default: `(700, 500)`.
- `zoom_ratio`: float. Default: `1.25`.
- `show_colorbar`: bool. Default: `True`.
- `show_silhouette`: bool. Default: `False`.
- `cbar_title`: str or None. Default: `None`.
- `show_plot`: bool. Default: `True`.
- `jupyter_backend`: `"static"`, `"html"`, `"trame"`, or `None`. Default: `"static"`.
- `lighting_style`: `"default"`, `"lightkit"`, `"threelights"`, `"metallic"`, `"plastic"`, `"shiny"`, `"glossy"`, `"ambient"`, `"plain"`, `"none"`. Default: `"default"`.
- `save_fig`: str/Path or None. Raster: `.png`, `.jpeg`, `.jpg`, `.bmp`, `.tif`, `.tiff`. Vector: `.svg`, `.eps`, `.ps`, `.pdf`, `.tex`. Default: `None`.
- `plotter_kws`, `mesh_kws`, `cbar_kws`, `silhouette_kws`: dict or None. Default: `None`.
- `data_dir`: str/Path or None. `verbose`: int (default `0`).

```python
pv_plot_parcellated_data(data, parcellation, template='fsaverage', hemi="both", **kwargs)
```
Converts parcel data to vertices via `parcels_to_vertices`, then calls `pv_plot_surface`. Returns pyvista.Plotter.
- `data`: array-like or tuple -- parcellated data.
- `parcellation`: str/Path/tuple/list -- file path(s), or built-in: `"schaefer{n}x{k}"` (e.g., `"schaefer400x7"`), `"cammoun{scale}"` (e.g., `"cammoun033"`), `"mmpall"`.
- `template`: str. Default: `"fsaverage"`. Must match parcellation.
- `hemi`: `"L"`, `"R"`, `"both"`. Default: `"both"`.
- `**kwargs`: forwarded to `pv_plot_surface`.

```python
pv_plot_subcortex(
    parcel_data, template, include_keys=None, custom_surfaces=None,
    hemi="both", layout="default", cmap="viridis", clim=None,
    panel_size=(500, 400), zoom_ratio=1.4, show_colorbar=True,
    show_silhouette=False, parallel_projection=True, cbar_title=None,
    show_plot=True, jupyter_backend="static", lighting_style="default",
    save_fig=None, plotter_kws=None, mesh_kws=None, cbar_kws=None,
    silhouette_kws=None, force_fetch=False, data_dir=None, verbose=0
)
```
Plots subcortical data. Returns pyvista.Plotter.
- `parcel_data`: dict mapping region ID strings to scalar values.
- `template`: `"aseg"`, `"tianS1"`, `"tianS2"`, `"tianS3"`, `"tianS4"`, `"custom"`.
- `include_keys`: list or tuple of lists (left, right). Default: `None` (all keys from parcel_data).
- `custom_surfaces`: dict (region ID -> PyVista mesh). Required when `template="custom"`. Default: `None`.
- `hemi`: `"L"`, `"R"`, `"both"`. Default: `"both"`.
- `layout`: `"default"`, `"single"`, `"row"`, `"column"`. Default: `"default"`.
- `cmap`: str. Default: `"viridis"`.
- `clim`: (vmin, vmax) or None. Default: `None`.
- `panel_size`: Default: `(500, 400)`.
- `zoom_ratio`: Default: `1.4`.
- `show_colorbar`: Default: `True`. `show_silhouette`: Default: `False`.
- `parallel_projection`: bool. Default: `True`.
- `cbar_title`: str or None. Default: `None`.
- `show_plot`: Default: `True`. `jupyter_backend`: Default: `"static"`.
- `lighting_style`: `"default"`, `"lightkit"`, `"threelights"`, `"metallic"`, `"plastic"`, `"shiny"`, `"glossy"`, `"ambient"`, `"plain"`, `"none"`. Default: `"default"`.
- `save_fig`: str/Path or None. Default: `None`.
- `plotter_kws`, `mesh_kws`, `cbar_kws`, `silhouette_kws`: dict or None. Default: `None`.
- `force_fetch`: bool. Default: `False`. `data_dir`: str/Path or None. `verbose`: int (default `0`).

### PySurfer Plotters

`netneurotools.plotting.pysurfer_plotters` (requires mayavi/pysurfer)

```python
plot_conte69(data, lhlabel, rhlabel, surf='midthickness', vmin=None, vmax=None,
             colormap='viridis', colorbar=True, num_labels=4,
             orientation='horizontal', colorbartitle=None,
             backgroundcolor=(1, 1, 1), foregroundcolor=(0, 0, 0), **kwargs)
```
Plots on Conte69 atlas. Wrapper for `plot_fslr` with `surf_atlas='conte69'`. Returns tuple (lhplot, rhplot) of mayavi.Scene.
- `data`: (N,) array_like. `lhlabel`/`rhlabel`: str (`.gii` paths).
- `surf`: `"midthickness"`, `"inflated"`, `"vinflated"`. Default: `"midthickness"`.
- `vmin`, `vmax`: float or None. `colormap`: str (default `"viridis"`). `colorbar`: bool (default `True`).
- `num_labels`: int (default `4`). `orientation`: `"horizontal"` or `"vertical"`.
- `colorbartitle`: str or None. `backgroundcolor`/`foregroundcolor`: RGB tuple in [0,1].
- `**kwargs`: passed to `mayavi.mlab.triangular_mesh()`.

```python
plot_fslr(data, lhlabel, rhlabel, surf_atlas='conte69', surf_type='midthickness',
          vmin=None, vmax=None, colormap='viridis', colorbar=True, num_labels=4,
          orientation='horizontal', colorbartitle=None,
          backgroundcolor=(1, 1, 1), foregroundcolor=(0, 0, 0), **kwargs)
```
Plots on fsLR32k atlas. Returns tuple (lhplot, rhplot) of mayavi.Scene.
- `data`: (N,) array_like. `lhlabel`/`rhlabel`: str (`.gii` paths).
- `surf_atlas`: `"conte69"` or `"yerkes19"`. Default: `"conte69"`.
- `surf_type`: `"midthickness"`, `"inflated"`, `"vinflated"`. Default: `"midthickness"`.
- `vmin`, `vmax`: float or None. `colormap`: str (default `"viridis"`). `colorbar`: bool (default `True`).
- `num_labels`: int (default `4`). `orientation`: `"horizontal"` or `"vertical"`.
- `colorbartitle`: str or None. `backgroundcolor`/`foregroundcolor`: RGB tuple in [0,1].
- `**kwargs`: passed to `mayavi.mlab.triangular_mesh()`.

```python
plot_fsaverage(data, *, lhannot, rhannot, order='lr', mask=None, noplot=None,
               subject_id='fsaverage', subjects_dir=None, vmin=None, vmax=None, **kwargs)
```
Plots parcellated data on fsaverage. Calls `plot_fsvertex` internally. Returns surfer.Brain.
- `data`: (N,) array_like. `lhannot`/`rhannot`: path-like (`.annot` files).
- `order`: `"lr"` or `"rl"`. Default: `"lr"`.
- `mask`: (N,) array_like or None. `noplot`: list or None.
- `subject_id`: str (default `"fsaverage"`). `subjects_dir`: str or None.
- `vmin`, `vmax`: float or None.
- `**kwargs`: passed to `plot_fsvertex`.

```python
plot_fsvertex(data, *, order='lr', surf='pial', views='lat', vmin=None, vmax=None,
              center=None, mask=None, colormap='viridis', colorbar=True, alpha=0.8,
              label_fmt='%.2f', num_labels=3, size_per_view=500,
              subject_id='fsaverage', subjects_dir=None, data_kws=None, **kwargs)
```
Plots vertex-wise data on fsaverage. Returns surfer.Brain.
- `data`: (N,) array_like. `order`: `"lr"` or `"rl"`. Default: `"lr"`.
- `surf`: str (default `"pial"`). `views`: str or list (default `"lat"`).
- `vmin`, `vmax`: float or None. `center`: float or None.
- `mask`: (N,) array_like or None. `colormap`: str (default `"viridis"`). `colorbar`: bool (default `True`).
- `alpha`: float [0,1] (default `0.8`). `label_fmt`: str (default `"%.2f"`).
- `num_labels`: int (default `3`). `size_per_view`: int (default `500`).
- `subject_id`: str (default `"fsaverage"`). `subjects_dir`: str or None.
- `data_kws`: dict or None (kwargs for `Brain.add_data()`).
- `**kwargs`: passed to `surfer.Brain()`.

### Matplotlib Plotters

`netneurotools.plotting.mpl_plotters`

```python
plot_mod_heatmap(data, communities, *, inds=None, edgecolor='black', ax=None,
                 figsize=(6.4, 4.8), xlabels=None, ylabels=None, xlabelrotation=90,
                 ylabelrotation=0, cbar=True, square=True, xticklabels=None,
                 yticklabels=None, mask_diagonal=True, **kwargs)
```
Plots heatmap with community boundaries. Returns matplotlib.axes.Axes.
- `data`: (N, N) array_like. `communities`: (N,) array_like.
- `inds`: (N,) array_like or None (auto-generated). `edgecolor`: str (default `"black"`).
- `ax`: Axes or None. `figsize`: tuple (default `(6.4, 4.8)`).
- `xlabels`/`ylabels`: list or None (community labels). `xlabelrotation`: float (default `90`). `ylabelrotation`: float (default `0`).
- `cbar`: bool (default `True`). `square`: bool (default `True`).
- `xticklabels`/`yticklabels`: list or None (per-entry labels, incompatible with xlabels/ylabels).
- `mask_diagonal`: bool (default `True`).
- `**kwargs`: passed to `plt.pcolormesh()`.

```python
plot_point_brain(data, coords, views=None, views_orientation='vertical',
                 views_size=(4, 2.4), cbar=False, robust=True, size=50, **kwargs)
```
Plots 3D point cloud brain. Returns `(fig: matplotlib.figure.Figure, axes: matplotlib.axes.Axes)`.
- `data`: (N,) array_like. `coords`: (N, 3) array_like.
- `views`: list or None -- from `"sagittal"`, `"sag"`, `"coronal"`, `"cor"`, `"axial"`, `"ax"`. Default: `None` (sagittal + axial).
- `views_orientation`: `"vertical"` or `"horizontal"`. Default: `"vertical"`.
- `views_size`: tuple (default `(4, 2.4)`). `cbar`: bool (default `False`).
- `robust`: bool (default `True`). `size`: int (default `50`).
- `**kwargs`: passed to `matplotlib.axes.Axis.scatter`.

### Color Utilities

`netneurotools.plotting.color_utils`

Three custom colormaps registered with matplotlib on import: `parula` (LinearSegmentedColormap), `justine` (ListedColormap), `dinosaur` (LinearSegmentedColormap). Use by name: `cmap="parula"`.

**`available_cmaps()`** -- Returns `["parula", "justine", "dinosaur"]`.
