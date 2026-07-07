---
name: "netneurotools-guide"
description: "Domain-validated guidance for network neuroscience analysis using netneurotools: datasets, brain network metrics, connectivity consensus, modularity, spatial statistics, null models, and cortical surface visualization. Use this skill whenever the user works with brain connectivity matrices, connectomes, graph theory on brain networks, parcellated brain data (Schaefer, Cammoun, Desikan-Killiany), cortical surface templates (fsaverage, fsLR, CIVET, Conte69), network communication metrics, null model generation, spatial autocorrelation on brain maps, community detection in connectomes, or surface-based visualization with PyVista/PySurfer. Also trigger when the user mentions netneurotools, netneurolab, structure-function coupling, network neuroscience, brain graph analysis, or needs to fetch neuroimaging atlases and templates."
version: "1.0.0"
authors:
  - "Claude (AI-assisted)"
review_status: "ai-generated"
---

# NetNeuroTools Guide

## Purpose

This skill encodes the complete API and recommended workflows for **netneurotools**, a Python toolbox for network neuroscience developed by the Network Neuroscience Lab (netneurolab). It covers dataset fetching, brain connectivity metrics, network randomization and null models, community detection, spatial autocorrelation statistics, parcellation interface utilities, and cortical/subcortical surface visualization.

## When to Use This Skill

Activate when the user:
- Works with brain connectivity matrices (structural or functional)
- Needs network communication metrics (shortest path, navigation, communicability, search information, diffusion efficiency)
- Wants to generate null/surrogate networks preserving degree, strength, or distance distributions
- Performs community detection or consensus clustering on brain networks
- Computes spatial autocorrelation (Moran's I, Geary's C, Lee's L) on parcellated brain data
- Fetches standard neuroimaging templates (fsaverage, fsLR, CIVET, Conte69) or atlases (Schaefer, Cammoun, Pauli)
- Needs to convert between vertex-level and parcel-level brain data
- Visualizes data on cortical surfaces using PyVista or PySurfer
- Mentions netneurotools, netneurolab, or any function from this toolbox
- Performs structure-function coupling, assortativity analysis, or dominance analysis
- Simulates atrophy spreading on brain networks (SIR model)

## Reference Files (Progressive Disclosure)

| Topic | File | When to Read |
|-------|------|--------------|
| Datasets | `references/datasets.md` | User fetches templates, atlases, or project datasets |
| Network Metrics | `references/metrics.md` | User computes communication, assortativity, spreading, or statistical network metrics |
| Networks | `references/networks.md` | User builds consensus connectivity, randomizes networks, or thresholds graphs |
| Statistics | `references/stats.md` | User runs permutation tests, correlations, residualization, or dominance analysis |
| Spatial & Modularity | `references/spatial-modularity.md` | User computes spatial autocorrelation or performs community detection |
| Interface & Plotting | `references/interface-plotting.md` | User converts parcels/vertices, handles CIFTI/GIFTI files, or plots on cortical surfaces |

## Installation

```bash
pip install netneurotools

# For PyVista surface plotting (recommended)
pip install netneurotools[pyvista]

# For PySurfer surface plotting (legacy)
pip install netneurotools[pysurfer]

# For numba acceleration
pip install netneurotools[numba]
```

**Core dependencies:** numpy>=1.16, scipy>=1.4.0, scikit-learn, matplotlib, nibabel>=3.0.0, nilearn, bctpy, tqdm, neuromaps

## Overview Pipeline

```
1. Fetch data       --> netneurotools.datasets (templates, atlases, connectomes)
2. Build networks   --> netneurotools.networks (consensus, thresholding)
3. Analyze metrics  --> netneurotools.metrics (communication, assortativity)
4. Null models      --> netneurotools.networks (randomization, surrogates)
5. Statistics       --> netneurotools.stats (permutation tests, dominance)
6. Spatial stats    --> netneurotools.spatial (Moran's I, Geary's C, Lee's L)
7. Modularity       --> netneurotools.modularity (consensus clustering)
8. Visualize        --> netneurotools.plotting (cortical surfaces, heatmaps)
```

## Quick Start

### Fetch Atlas and Template

```python
from netneurotools.datasets import fetch_schaefer2018, fetch_fsaverage_curated

# Fetch Schaefer 400-parcel atlas in fsaverage space
parc = fetch_schaefer2018('fsaverage')['400Parcels7Networks']
# parc is a SURFACE namedtuple with fields .L and .R

# Fetch curated fsaverage surfaces
surfaces = fetch_fsaverage_curated('fsaverage5')
# surfaces has keys: 'white', 'pial', 'inflated', 'sphere', 'medial', 'sulc', 'vaavg'
# Each value is a SURFACE namedtuple with fields .L and .R
```

### Consensus Functional Connectivity

```python
from netneurotools.networks import func_consensus
import numpy as np

# data: (N_nodes, T_timepoints, S_subjects) array
consensus = func_consensus(data, n_boot=1000, ci=95, seed=42)
```

### Community Detection

```python
from netneurotools.modularity import consensus_modularity
import numpy as np

# adjacency: (N, N) non-negative connectivity matrix
consensus, Q_all, zrand_all = consensus_modularity(
    adjacency, gamma=1.5, repeats=100, seed=1234
)
```

### Generate Distance-Preserving Surrogates

```python
from netneurotools.networks import match_length_degree_distribution

newB, newW, nr = match_length_degree_distribution(
    W, D, nbins=10, nswap=1000, seed=42
)
```

### Permutation Test for Correlation

```python
from netneurotools.stats import permtest_pearsonr, make_correlated_xy

x, y = make_correlated_xy(corr=0.3, size=100, seed=42)
r, p = permtest_pearsonr(x, y, n_perm=5000, seed=42)
```

### Spatial Autocorrelation

```python
from netneurotools.spatial import morans_i

I = morans_i(annotation_vector, spatial_weight_matrix)
```

### Plot on Cortical Surface (PyVista)

```python
from netneurotools.plotting import pv_plot_surface
import numpy as np

data_L = np.random.random((10242,))
data_R = np.random.random((10242,))
pl = pv_plot_surface(
    (data_L, data_R),
    template="fsaverage5",
    surf="inflated",
    cmap="viridis",
    lighting_style="plastic",
    jupyter_backend="static",
)
```

### Plot Parcellated Data (Shortcut)

```python
from netneurotools.plotting import pv_plot_parcellated_data
import numpy as np

data = np.random.rand(400)
pl = pv_plot_parcellated_data(data, 'schaefer400x7', template='fsaverage')
```

## Key Data Structures

| Structure | Description | Fields |
|-----------|-------------|--------|
| `SURFACE` | namedtuple for hemisphere file pairs | `.L`, `.R` (left/right hemisphere paths) |
| `sklearn.utils.Bunch` | Dict-like object returned by fetch functions | Varies per function |
| `FREESURFER_IGNORE` | Labels to ignore in FreeSurfer parcellations | `["unknown", "corpuscallosum", "Background+FreeSurfer_Defined_Medial_Wall"]` |
| `PARCIGNORE` | Labels to ignore in parcellation operations | `["unknown", "corpuscallosum", "Background+FreeSurfer_Defined_Medial_Wall", "???", "Unknown", "Medial_wall", "Medial wall", "medial_wall"]` |

## Core Modules Quick Reference

| Module | Key Functions | Purpose |
|--------|--------------|---------|
| `datasets` | `fetch_fsaverage`, `fetch_schaefer2018`, `fetch_cammoun2012`, `fetch_conte69`, `fetch_famous_gmat` | Fetch templates, atlases, connectomes |
| `metrics` | `distance_wei_floyd`, `navigation_wu`, `communicability_wei`, `search_information`, `mean_first_passage_time`, `assortativity_und`, `simulate_atrophy` | Network communication and properties |
| `networks` | `func_consensus`, `struct_consensus`, `match_length_degree_distribution`, `strength_preserving_rand_sa` | Build consensus, generate null models |
| `stats` | `permtest_pearsonr`, `efficient_pearsonr`, `residualize`, `get_dominance_stats` | Statistical testing and regression |
| `spatial` | `morans_i`, `gearys_c`, `lees_l`, `local_morans_i`, `local_gearys_c`, `local_lees_l` | Spatial autocorrelation |
| `modularity` | `consensus_modularity`, `find_consensus`, `zrand`, `get_modularity` | Community detection and evaluation |
| `interface` | `vertices_to_parcels`, `parcels_to_vertices`, `load_surf_parc_file`, `deconstruct_cifti` | Format conversion |
| `plotting` | `pv_plot_surface`, `pv_plot_parcellated_data`, `pv_plot_subcortex`, `plot_mod_heatmap` | Visualization |

## Common Pitfalls

1. **SURFACE fields are `.L` and `.R`**, not `.lh` and `.rh`. Use `surface.L` and `surface.R` to access hemisphere paths.

2. **Weight-to-distance conversion** must be done before calling `distance_wei_floyd` or `search_information`. Common transform: `D = -np.log(W / (np.max(W) + 1))`.

3. **Minimum permutation p-value** is `1 / (n_perm + 1)`. With `n_perm=1000`, the smallest p-value is ~0.001.

4. **`consensus_modularity` requires non-negative input.** Louvain cannot handle negative weights. Set negatives to zero: `A[A < 0] = 0`.

5. **`struct_consensus` hemiid encoding**: 0 = right hemisphere, 1 = left hemisphere.

6. **`pv_plot_surface` data format**: When `hemi='both'`, `vertex_data` can be a tuple `(left, right)` or a single concatenated array. Data length must match template vertex count.

7. **Data directory**: All fetch functions default to `~/nnt-data`. Override with `data_dir=` parameter or set `NNT_DATA` environment variable.

8. **`match_length_degree_distribution` recommended nswap**: Use `nswap = nnodes * 20` for adequate randomization.

9. **`strength_preserving_rand_sa` frac parameter** must be between 0 and 1. It controls temperature decrease per annealing stage.

10. **`parcels_to_vertices` and `vertices_to_parcels`** support `.annot`, `.gii`, and `.dlabel.nii` parcellation files. For `.dlabel.nii`, pass a single file path; for `.annot` or `.gii`, pass a tuple of `(left, right)` paths.

11. **Numba acceleration** is available for spatial stats, weighted correlation, and some metrics. Install numba for significant speedups on large datasets.

12. **Headless rendering** with PyVista: set `os.environ["VTK_DEFAULT_OPENGL_WINDOW"] = "vtkOSOpenGLRenderWindow"` before importing pyvista.
