---
name: ethoclaw-multiparameter-violin-stats-generate
description: "Read HDF5 (.h5/.hdf5) data, compare groups with appropriate statistical tests (2 groups: t-test/Mann–Whitney; 3+ groups: ANOVA/Kruskal–Wallis + post-hoc pairwise), and generate violin plots + summary table/JSON. Use when the user asks for multi-parameter violin plot generation/group difference testing/batch parameter statistical plotting."
---

# H5 Multi-parameter Violin + Stats

Generate violin plots and run group-difference tests directly from `.h5/.hdf5` files.

## Workflow

### 1) Inspect the H5 structure (find dataset paths)
If you don’t know the internal paths, run:

```bash
python scripts/h5_inspect.py your_data.h5
```

Identify:
- a **numeric** 1D dataset path for values, e.g. `/metrics/score`
- a **label** 1D dataset path for group labels, e.g. `/meta/group`

### 2) Run stats + generate violin plot

```bash
python scripts/h5_violin_stats.py \
  --h5 your_data.h5 \
  --dataset /metrics/score \
  --group /meta/group \
  --method auto \
  --config skills/ethoclaw-multiparameter-violin-stats-generate/config.toml \
  --out outputs/violin.png \
  --out-json outputs/result.json
```

- `--method auto`: follows `config.toml` defaults
  - 2 groups → `stats.default_2_groups`
  - 3+ groups → `stats.default_3plus_groups`
- Choose nonparametric methods explicitly when needed:
  - 2 groups: `--method mannwhitney`
  - >=3 groups: `--method kruskal`

### 3) Interpreting results
- For **2 groups**: the “overall” test is the direct group comparison.
- For **>=3 groups**: script runs overall ANOVA/Kruskal first; if `p <= alpha` (default 0.05), it runs **pairwise** comparisons and reports Holm-adjusted p-values (`p_holm`).

Stat rules reference: `references/stats-rule.md`.

## Notes / Assumptions
- Current scripts assume `values` is a **1D numeric array** and `group` is a **1D label array** of the same length.
- If your H5 stores multiple metrics or nested structures, extend the loader in `scripts/h5_violin_stats.py::_read_h5_1d`.
- If dependencies are missing, install Python `pip` + packages (system-dependent). In WSL/Ubuntu, you typically need `python3-venv` and `python3-pip`.
