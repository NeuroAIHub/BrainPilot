---
name: ethoclaw-paper-figure-layout
description: "Auto-layout folders of result images into a paper-like PDF (LaTeX) with captions derived from filenames and optional heatmap+colorbar grouping. Use when the user says: use images in this folder to help with layout/generate paper figures/arrange figures into PDF by folder grouping; or when there are many PNG/JPG figures that need consistent captions and pagination."
---

# Paper Figure Layout

Auto-generate a Nature-Communications-ish **compact multi-panel figure PDF** from a directory of images.

## What it does

### Default (recommended): compact multi-panel

- **Compact, figure-like layout** (not one-page-per-image)
- **Subpanel letters** `a, b, c…` aligned in reading order
- **Figure title above panels** (`Fig. X | Title`)
- **Per-panel descriptions below** ("a …; b …; c …")
- **Sensible defaults**: if the user doesn’t specify, pick **1 representative image per type**
  - "type" = (nested) subfolder under the input root, e.g. `heatmap_velocity/`, `radar/group_means/`

### Legacy: foldered dump

- **Groups by subfolder**: each subfolder becomes a section.
- **Captions from filenames**: underscores/dashes become spaces.
- **Stable pagination**: uses one-column LaTeX blocks (no fragile two-column floats).

## Quick start

### Compact multi-panel (default)

```bash
python3 scripts/layout_results_foldered.py \
  --input "/path/to/2_results" \
  --output "/path/to/out.pdf" \
  --title "Results"
```

Defaults (can override):
- `--mode compact`
- `--max-per-type 1`
- `--cols 2`
- `--panels-per-figure 6`

Default representative logic:
- `--max-per-type 1` means: keep **1 representative per inferred subtype**, not just 1 file for the whole folder.
- Example: if a folder contains `x-Axis`, `y-Axis`, `z-Axis`, the default compact layout should keep all 3 because they are three subtypes of the same figure family.

Useful override:
- `--max-per-type 0` → include **all images** from each type/folder instead of representative selection.

Special handling:
- If a folder contains `colorBar` / `color_bar` plus heatmaps, the layout bundles them into one panel:
  - up to 3 heatmaps + 1 shared colorbar side-by-side
  - the colorbar is rendered narrow instead of occupying a full panel by itself

### Legacy foldered

```bash
python3 scripts/layout_results_foldered.py \
  --input "/path/to/2_results" \
  --output "/path/to/out.pdf" \
  --title "Results" \
  --mode foldered
```

## Outputs

- A single PDF at `--output`.

## Notes

- The TypeTex LaTeX compiler environment often defaults to `xelatex` via latexmk, but `xelatex` may be missing.
  The script supplies a `.latexmkrc` that forces `pdflatex`.

## Resources

- `scripts/layout_results_foldered.py` — the generator.
- `assets/naturecomm_figures.tex` — the Nature-Communications-ish preamble used by the generator.
