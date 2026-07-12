# Confounds Reference

fMRIPrep does not smooth or denoise BOLD data. Instead it emits a **rich table
of nuisance regressors** per run — your downstream tool (Nilearn, FitLins, FSL
FEAT, SPM) is responsible for including them in a design matrix or regressing
them out.

File: `sub-<label>_[specifiers]_desc-confounds_timeseries.tsv` (+ `.json`).

Row = one BOLD timepoint (kept for every volume in the raw series; leading
non-steady-state rows typically have `n/a` in framewise-derivative columns).

⚠️ **Never dump every column into a design matrix**. Pick a strategy and
include only its subset. See [strategy recipes](#recommended-denoising-strategies) at the bottom.

## Table of Contents
1. [Column reference](#column-reference)
2. [aCompCor and tCompCor](#acompcor-and-tcompcor)
3. [DCT cosine regressors](#dct-cosine-regressors)
4. [Spike/outlier regressors](#spikeoutlier-regressors)
5. [Crown / brain-edge PCA](#crown--brain-edge-pca)
6. [JSON metadata schema](#json-metadata-schema)
7. [Recommended denoising strategies](#recommended-denoising-strategies)
8. [Programmatic loading](#programmatic-loading)
9. [Interpreting the report's carpetplot](#interpreting-the-reports-carpetplot)

---

## Column reference

### Motion parameters (6 base + expansions → up to 24)

| Column | Meaning |
|--------|---------|
| `trans_x`, `trans_y`, `trans_z` | Rigid-body translations (mm) w.r.t. reference volume |
| `rot_x`, `rot_y`, `rot_z` | Rigid-body rotations (radians) |
| `trans_{x,y,z}_derivative1` | 1st temporal derivative of each translation |
| `rot_{x,y,z}_derivative1` | 1st temporal derivative of each rotation |
| `trans_{x,y,z}_power2` | Quadratic term of each translation |
| `rot_{x,y,z}_power2` | Quadratic term of each rotation |
| `trans_{x,y,z}_derivative1_power2` | Squared derivative |
| `rot_{x,y,z}_derivative1_power2` | Squared derivative |

Choose 6 = base, 12 = base + derivatives (Friston), 24 = base + derivatives +
squares (Satterthwaite).

### Global signals

| Column | Meaning |
|--------|---------|
| `csf` | Mean signal in eroded CSF mask (anatomical) |
| `white_matter` | Mean signal in eroded WM mask (anatomical) |
| `global_signal` | Mean signal in brain mask |
| `csf_derivative1`, `csf_power2`, `csf_derivative1_power2` | expansions |
| `white_matter_derivative1`, `white_matter_power2`, `white_matter_derivative1_power2` | expansions |
| `global_signal_derivative1`, `global_signal_power2`, `global_signal_derivative1_power2` | expansions |

Combined with the 24 motion params → **36-parameter Satterthwaite** strategy.

### Motion metrics

| Column | Meaning | Notes |
|--------|---------|-------|
| `framewise_displacement` | FD (mm) per Power 2012 | `n/a` for first volume |
| `rmsd` | Relative frame-to-frame head motion (Jenkinson 2002) | |
| `dvars` | Derivative of RMS voxel variance (Power 2012) | `n/a` for first volume |
| `std_dvars` | Standardized DVARS | For thresholding |

### Non-steady-state outliers

`non_steady_state_outlier00`, `non_steady_state_outlier01`, ... — one column
per detected dummy volume, with `1` at that timepoint and `0` elsewhere.
Detected automatically or set by `--dummy-scans N`.

### Motion spike regressors

`motion_outlier00`, `motion_outlier01`, ... — one column per timepoint flagged
by (FD > `--fd-spike-threshold`) OR (std_dvars > `--dvars-spike-threshold`).
Defaults: FD > 0.5 mm, std_dvars > 1.5.

These are **one-hot** regressors — including them censors those volumes when
regressed. Alternatively use them to build a scrub mask and drop volumes.

---

## aCompCor and tCompCor

**aCompCor** (anatomical, Behzadi 2007 / Muschelli 2014): PCA of BOLD signals
inside three noise ROIs derived from tissue segmentation. Each ROI's
components are written to a **distinct column prefix** — no need to consult
the JSON `Mask` field to disambiguate:

| ROI | Column prefix | JSON `Mask` |
|-----|---------------|-------------|
| Combined WM ∪ CSF (Behzadi original) | `a_comp_cor_00`, `a_comp_cor_01`, ... | `combined` |
| CSF alone (Muschelli) | `c_comp_cor_00`, `c_comp_cor_01`, ... | `CSF` |
| WM alone (Muschelli) | `w_comp_cor_00`, `w_comp_cor_01`, ... | `WM` |

All three sets carry `Method: aCompCor` in the JSON. Retained-vs-dropped
status, singular value, and cumulative variance explained are in the JSON
sidecar per component.

**tCompCor** (temporal, Behzadi 2007): PCA on top-variance voxels
(temporally). Columns: `t_comp_cor_00`, `t_comp_cor_01`, ...
JSON `Method: tCompCor`.

**Retention policy**: by default fMRIPrep keeps components that cumulatively
explain the top 50% variance of each ROI's decomposition. Dropped components
are kept in the JSON with the `dropped_XX` prefix. Use `--return-all-components`
to include every component in the TSV.

**Selection tips**:
- The three anatomical CompCor variants are now distinguishable by column
  prefix (`a_`, `c_`, `w_`) — no need to filter the JSON `Mask` field to
  separate combined / CSF-only / WM-only families.
- Common choices: first 5–6 components; first N to explain 50% / 70% / 90%
  cumulative variance; number chosen by elbow / broken stick.
- Behzadi original: use `a_comp_cor_*` (combined-mask components).
- Muschelli refinement: use `w_comp_cor_*` and `c_comp_cor_*` separately.
- Do **not** combine WM/CSF CompCor with the plain `white_matter` / `csf`
  global signal (redundant / collinear).
- Combining `global_signal` **with** CompCor is beneficial (Parkes 2018).

### High-pass filtering caveat

fMRIPrep applies a temporal high-pass filter *before* CompCor decomposition.
When you use CompCor regressors, you MUST include the corresponding
`cosine_XX` regressors in the same design matrix — otherwise you'll re-alias
low-frequency drift back into your model.

---

## DCT cosine regressors

`cosine_00`, `cosine_01`, ..., `cosine_NN` — DCT basis functions modeling
low-frequency drift.

- Number of regressors depends on effective series length (excluding detected
  non-steady-state volumes) and TR.
- Cutoff is set internally to match the CompCor high-pass.
- Two datasets with the same TR and effective length produce identical cosine
  regressors.
- **Do not combine with your own high-pass filter.**

---

## Spike/outlier regressors

Categories (each is a set of one-hot columns):

| Prefix | Trigger | Threshold flag |
|--------|---------|----------------|
| `non_steady_state_outlier` | Detected T1-saturation / dummy scans | `--dummy-scans` |
| `motion_outlier` | Frame with FD > threshold OR std_dvars > threshold | `--fd-spike-threshold`, `--dvars-spike-threshold` |

Common practice:
- **Regress-out**: include as regressors → those timepoints are effectively censored.
- **Scrub**: use as a mask to drop volumes prior to GLM (rebuilds series length).
- **Report**: track the fraction of flagged volumes per subject — a common
  quality-control exclusion criterion (e.g. exclude subject if >20%).

---

## Crown / brain-edge PCA

24 PCA components extracted from voxels on the outer brain edge ("crown"):
signal here is dominated by motion / physiological artifacts, not neural
activity. Introduced in Patriat 2017 and formalized for fMRIPrep in
Provins 2022.

Columns: `edge_comp_00`, `edge_comp_01`, ..., `edge_comp_23` (24 components).
JSON `Method: EdgeRegressor` (not `aCompCor` or `tCompCor`, though the
implementation reuses aCompCor plumbing on the "crown" mask). Useful as an
aggressive nuisance model when a lot of motion is expected.

---

## JSON metadata schema

Each TSV has a paired JSON. Example entry for one component:

```json
{
  "a_comp_cor_00": {
    "CumulativeVarianceExplained": 0.1082,
    "Mask": "combined",
    "Method": "aCompCor",
    "Retained": true,
    "SingularValue": 25.827,
    "VarianceExplained": 0.1082
  },
  "dropped_0": {
    "CumulativeVarianceExplained": 0.5966,
    "Mask": "combined",
    "Method": "aCompCor",
    "Retained": false,
    "SingularValue": 20.796,
    "VarianceExplained": 0.0701
  }
}
```

Fields:
- `Method` — `aCompCor` or `tCompCor`.
- `Mask` — for aCompCor: `CSF`, `WM`, `combined`.
- `SingularValue` — component's singular value.
- `VarianceExplained` — this component's share of ROI variance.
- `CumulativeVarianceExplained` — running total up through this component.
- `Retained` — whether saved in the TSV (`true`) or listed only in JSON (`false`, i.e. `dropped_XX`).

---

## Recommended denoising strategies

Pick ONE (or a small orthogonal set) — don't mix redundant families.

### Minimal (6-parameter)

```
trans_x, trans_y, trans_z, rot_x, rot_y, rot_z
+ framewise_displacement (optional group-level covariate)
```

Simplest; only motion. Poor for high-motion cohorts.

### 24-parameter Friston-24 (aka Volterra)

```
Base 6 + 6 derivatives + 6 squares + 6 squared derivatives
```

Column pattern: `(trans|rot)_[xyz](_derivative1)?(_power2)?`

### 36-parameter Satterthwaite (aka aCompCor+GSR expansion)

24-parameter motion + 12 tissue signals (csf, white_matter, global_signal,
each with derivative + squares).

### aCompCor (Behzadi original)

```
6 motion + first N aCompCor components with Mask=="combined" + cosine_XX
```

### aCompCor (Muschelli refinement)

```
6 motion + first N w_comp_cor_* (WM mask) + first N c_comp_cor_* (CSF mask) + cosine_XX
```

(No need to filter by JSON `Mask` — the column prefixes already partition
combined/WM/CSF.)

### Scrubbing / censoring

Use `motion_outlier_XX` as a design regressor OR drop those volumes entirely
(rebuild series). Common threshold: FD>0.5 mm (default) or stricter (0.2 mm)
for resting-state connectivity.

### AROMA (via post-processor)

fMRIPrep 21+ dropped built-in AROMA. Use the community-maintained
`fmripost-aroma` BIDS-App downstream — it consumes fMRIPrep outputs.

---

## Programmatic loading

Python (Nilearn / pandas):

```python
from pathlib import Path
import pandas as pd
import json

conf = Path("derivatives/sub-01/func/"
            "sub-01_task-rest_desc-confounds_timeseries.tsv")

df = pd.read_csv(conf, sep="\t")

# Metadata (used to pick components by variance / retention if desired)
with open(conf.with_suffix(".json")) as f:
    meta = json.load(f)

# Extract aCompCor combined-mask, top 6 — columns are prefixed a_/c_/w_ to
# denote combined/CSF/WM masks respectively, so filtering by prefix suffices.
combined_cols = [c for c in df.columns if c.startswith("a_comp_cor_")][:6]

# Motion basic 6
motion6 = ["trans_x", "trans_y", "trans_z", "rot_x", "rot_y", "rot_z"]

# High-pass cosines
cosines = [c for c in df.columns if c.startswith("cosine")]

# Motion outliers
outliers = [c for c in df.columns if c.startswith("motion_outlier")]

design = df[motion6 + combined_cols + cosines + outliers].fillna(0.0)
```

Nilearn convenience:

```python
from nilearn.interfaces.fmriprep import load_confounds

confounds, sample_mask = load_confounds(
    "sub-01_task-rest_space-MNI152NLin2009cAsym_desc-preproc_bold.nii.gz",
    strategy=["motion", "high_pass", "wm_csf", "scrub"],
    motion="basic",
    wm_csf="basic",
    scrub=5,
    fd_threshold=0.5,
    std_dvars_threshold=1.5,
)
```

`load_confounds` supports `strategy=[...]` values: `motion`, `high_pass`,
`wm_csf`, `global_signal`, `compcor`, `ica_aroma`, `scrub`, `non_steady_state`.

---

## Interpreting the report's carpetplot

The visual report's per-run carpetplot (Power 2016; Provins 2022 extension)
plots BOLD time × voxels as a heatmap, with above-the-carpet:
- `GS`, `CSF`, `WM` — global / tissue signals
- `FD` — framewise displacement
- `DVARS` — derivative of variance

Rows are grouped: cortical GM, deep GM, WM, CSF, cerebellum, edge/crown.

Diagnostic patterns:
- **Vertical bright/dark stripes** — motion or physiological events;
  correlates with FD/DVARS spikes.
- **Slow drift** — scanner drift; ensure cosine regressors or high-pass.
- **Correlated stripes across all rows** — global signal contamination;
  consider including `global_signal` regressor.
- **Row-specific bright bands** — issue localized to that tissue class (e.g.,
  vascular near-edge).

The report also shows:
- **CompCor cumulative-variance curves** — helps choose N components.
- **Confound correlation heatmap** — spot collinearity in your chosen model.
- **Confound-vs-global-signal bar plot** — flag partial-volume effects.
