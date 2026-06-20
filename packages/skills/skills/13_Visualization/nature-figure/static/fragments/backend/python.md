# Backend: Python (matplotlib / seaborn)

**Python-only execution rule.** When the user has selected Python, do all figure drawing, previewing, exporting, and visual QA in Python. Do not call R/ggplot2, ComplexHeatmap, patchwork, or any R graphics device to create a temporary preview, fallback export, or layout approximation. If Python or required Python plotting packages are missing, stop before rendering and report the missing dependency. You may still write the Python script, provide `pip`/environment install commands, or ask permission to install dependencies, but do not cross-render the figure in R.

## Python quick-start

```python
import matplotlib as mpl
import matplotlib.pyplot as plt

mpl.rcParams.update({
    "font.family": "sans-serif",
    "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
    "svg.fonttype": "none",     # editable text in SVG
    "pdf.fonttype": 42,         # editable TrueType text in PDF
    "font.size": 7,             # use 15-24 only for large slide-sized panels
    "axes.spines.right": False,
    "axes.spines.top": False,
    "axes.linewidth": 0.8,
    "legend.frameon": False,
})

def save_pub_py(fig, filename, dpi=600):
    fig.savefig(f"{filename}.svg", bbox_inches="tight")
    fig.savefig(f"{filename}.pdf", bbox_inches="tight")
    fig.savefig(f"{filename}.tiff", dpi=dpi, bbox_inches="tight")
```

Use `text.usetex = True` only when LaTeX is installed and math-rich labels are required.

## Going deeper

- `references/api.md` — Python PALETTE, helper function signatures, validation rules.
- `references/common-patterns.md` — hero panels, legend-only axes, dark image plates, asymmetric layouts.
- `references/chart-types.md` — radar, 3D sphere, fill_between, scatter patterns.
- `references/tutorials.md` — end-to-end walkthroughs for bars, trends, heatmaps.
- `references/demos.md` — bundled figures4papers Python scripts and output previews.
