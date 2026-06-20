# figures4papers Demo Index

Use this file when a user asks for a `figures4papers` look, cites the older
`scientific-figure-making` skill, or needs a concrete Python/matplotlib example
instead of only abstract style rules.

The bundled examples live under `../assets/figures4papers/`. They are reference
materials for the Python track only. Keep the normal `nature-figure` contract first:
define the scientific claim, pick Python or R, and only then adapt a demo pattern.

## How to use the demos

1. Select the closest chart family from the table below.
2. Read the listed `plot_*.py` files for layout, palette, axis, legend, and export
   patterns.
3. Reuse the pattern, not the demo data or manuscript-specific labels.
4. Preserve editable SVG/PDF/TIFF export rules from `api.md`.
5. Do not reveal local repository paths or internal asset filenames in user-facing
   prose unless the user asks for an audit trail.

## Bundled project map

| Project | Open when | Local examples |
|---------|-----------|----------------|
| `figure_ImmunoStruct` | Method comparison bars, ablation bars, large readable annotations | `../assets/figures4papers/figure_ImmunoStruct/plot_bars.py`, `raw_data.py`, `figures/*.png` |
| `figure_CellSpliceNet` | Compact comparison and ablation bars | `../assets/figures4papers/figure_CellSpliceNet/plot_comparison.py`, `plot_ablation.py` |
| `figure_brainteaser` | Composition breakdown bars, category/subcategory comparisons, rewriting/self-correction panels | `../assets/figures4papers/figure_brainteaser/plot_*.py` |
| `figure_VIGIL` | Radar/polar comparison and post-training trend lines | `../assets/figures4papers/figure_VIGIL/plot_comparison_radar.py`, `plot_posttraining.py` |
| `figure_ophthal_review` | Time trends and composition heatmaps for review/survey style figures | `../assets/figures4papers/figure_ophthal_review/plot_trend.py`, `plot_composition.py` |
| `figure_RNAGenScape` | Heatmaps, optimization/speed comparisons, manifold illustrations, sweep plots | `../assets/figures4papers/figure_RNAGenScape/plot_*.py` |
| `figure_Dispersion` | Conceptual 3D-style sphere diagrams and observation/idea panels | `../assets/figures4papers/figure_Dispersion/plot_illustration.py`, `plot_idea.py` |
| `figure_Cflows` | Diffusion/trajectory illustrations, gene-regulatory comparisons, ablation comparisons | `../assets/figures4papers/figure_Cflows/*.py` |
| `figure_FPGM` | Frequency-prior or distribution-style method motivation figure | `../assets/figures4papers/figure_FPGM/plot_freq_prior.py` |
| `assets` | Partially manual schematic/result panels for visual inspiration only | `../assets/figures4papers/assets/*.png` |

## Pattern routing

- Grouped bars: start with `figure_ImmunoStruct`, `figure_CellSpliceNet`, or
  `figure_brainteaser`; then apply the tighter Nature export and font rules in
  `api.md`.
- Radar/polar: start with `figure_VIGIL`; cross-check `chart-types.md` before
  implementing normalization, radial labels, and legend placement.
- Trend/line: start with `figure_VIGIL` or `figure_ophthal_review`; use shared
  legends and direct event labels where they reduce eye travel.
- Heatmap/matrix: start with `figure_RNAGenScape` or `figure_ophthal_review`; keep
  colorbars and labels readable at final journal dimensions.
- Conceptual 3D/spheres: start with `figure_Dispersion` or `figure_Cflows`; use this
  only when it supports the manuscript claim, not as decorative filler.

## Relationship to the older skill

The original `scientific-figure-making` skill focused on publication-ready
matplotlib figures and the figures4papers house style. In this repository, that
guidance is folded into `nature-figure`:

- `api.md` contains the palette, helper signatures, and export conventions.
- `common-patterns.md` expands the reusable layout patterns.
- `design-theory.md` captures the typography, color, and composition rationale.
- `tutorials.md` gives end-to-end scaffold examples.
- This file preserves the real demo script map and bundled example assets.

## External source

Original upstream repository:
<https://github.com/ChenLiu-1996/figures4papers>
