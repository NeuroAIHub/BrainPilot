---
name: ethoclaw-multiparameter-clustermap-generate
description: "Generate journal-style hierarchical clustering clustermaps (heatmap+dendrogram) from a folder of .h5/.hdf5 files (KinematicParameter/ParameterName + ParameterData). Summarize frames per sample (mean/median/max), optionally normalize (column z-score), cluster samples/parameters, and export PNG/PDF + CSV + linkage arrays. Use when user asks for multi-parameter clustering heatmap/clustering tree/full parameter full sample clustering figure generation."
---

# H5 Multi-parameter Clustermap

Create a Prism-like clustermap (heatmap + dendrogram) for **all parameters × all samples** from `.h5` files.

## Assumptions about H5 structure
Each `.h5` must contain:
- `KinematicParameter/ParameterName` (parameter name list)
- `KinematicParameter/ParameterData` (2D array: frames/timepoints × parameters)

## How it works
- For each sample (one `.h5`): summarize every parameter’s time-series into a single value (`mean`/`median`/`max`).
- Stack into a feature matrix: **rows = samples**, **cols = parameters**.
- Optional normalization: parameter-wise z-score across samples (column z-score).
- Hierarchical cluster rows and columns and draw clustermap.

## Quick start (no config editing)

### Option 1: Run in the project folder (recommended)

```bash
cd /d C:\\path\\to\\your_project
python <skill>/scripts/cluster_all_params.py
```

It will:
- auto-read all `*.h5` under the current folder
- write outputs to `results/cluster_all_kinematic_params/`

### Option 2: Pass project path explicitly

```bash
python scripts/cluster_all_params.py --root "C:\\path\\to\\your_project"
```

### Option 3: Use TOML config (only if you want a saved preset)

```bash
python scripts/cluster_all_params_from_config.py --config references/config.example.toml
```

## Outputs
In your configured output folder:
- `clustermap_all_params.png`
- `clustermap_all_params.pdf`
- `feature_matrix.csv`
- `row_linkage.npy`, `col_linkage.npy`
- `clustering_meta.json`

## Config knobs you’ll likely change

CLI flags (no file edits):
- `--summary mean|median|max`
- `--style nature|cell|minimal`
- `--cmap RdBu_r|coolwarm|vlag|icefire|...` (used when `style` doesn’t override)
- `--linewidths` / `--linecolor` (grid lines)
- `--metric euclidean|correlation`

TOML (optional saved preset):
- `features.summary = mean|median|max`
- `plot.style = nature|cell|minimal`
- `plot.cmap = RdBu_r|coolwarm|vlag|icefire|...`
- `plot.linewidths` / `plot.linecolor`
- `clustering.metric = euclidean|correlation`

## Notes
- If `ParameterName` ordering differs between files, the script will stop (to avoid mixing mismatched features).
- If you have many parameters, set smaller `plot.xtick_fontsize` and rotate ticks.
