---
name: ethoclaw-multiparameter-radar-generate
description: Generate GraphPad Prism-like multi-parameter radar charts from a folder of HDF5 .h5/.hdf5 files (KinematicParameter/ParameterName + ParameterData). Summarize frames per sample (mean/median/max), normalize (min-max or z-score), and plot per-sample radars and/or group-mean comparison radars (group inferred from filenames). Outputs publication-style PNG/PDF and CSV. Use when user asks for multi-parameter radar chart generation/radar chart comparison.
---

# H5 Multi-parameter Radar

One skill, focused on the two outputs you want:

- **per_sample**: single-sample radar for each sample (all parameters).
- **group_means** (recommended for group comparison): one polygon per group, using each group mean.
- **both**: generate both per_sample + group_means in one run.

(Still supports **all_samples** as a legacy overlay mode, if you ever need it.)

## Assumed HDF5 layout

Preferred:
- `/KinematicParameter/ParameterName`
- `/KinematicParameter/ParameterData` (frames × params)

## Grouping

Default group inference regex (1 capture group):
- `rec-\d+-([^-_]+)[-_]`

Override with `--group_regex` if your filenames differ.

## Run (Windows / Anaconda example)

### Generate both outputs (recommended)

```bat
D:\Anaconda3\python.exe plot_h5_radar.py --project_dir "C:\Users\ASUS\Desktop\2Dxy_test_project\random_project" --mode both --stat mean --normalize minmax --style nature
```

### Group means only (one polygon per group)

```bat
D:\Anaconda3\python.exe plot_h5_radar.py --project_dir "C:\Users\ASUS\Desktop\2Dxy_test_project\random_project" --mode group_means --stat mean --normalize minmax --style nature
```

### Per-sample only (one radar per sample)

```bat
D:\Anaconda3\python.exe plot_h5_radar.py --project_dir "C:\Users\ASUS\Desktop\2Dxy_test_project\random_project" --mode per_sample --stat mean --normalize minmax --style nature
```

### Legacy: all samples overlay

```bat
D:\Anaconda3\python.exe plot_h5_radar.py --project_dir "C:\Users\ASUS\Desktop\2Dxy_test_project\random_project" --mode all_samples --stat mean --normalize minmax --max_samples_combined 50 --style nature
```

## Key flags

- `--mode`: `both|per_sample|group_means|all_samples`
- `--stat`: `mean|median|max`
- `--normalize`: `none|minmax|zscore`
- `--n_params`: limit to N parameters for readability
- `--max_samples_combined`: limit sample count in all-samples combined overlay

## Outputs

Default output root (relative to `project_dir`):
- `results/h5_radar/<mode>/` (for `both`, it writes into `results/h5_radar/per_sample/` and `results/h5_radar/group_means/`)

Includes CSV matrices and PNG/PDF radars. If some files lack required datasets, see `skipped_files.txt`.
