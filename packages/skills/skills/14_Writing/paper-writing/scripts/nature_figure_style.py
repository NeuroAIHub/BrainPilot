"""
Nature-journal publication style constants and helper functions.

Derived from nature-skills/nature-figure (MIT License, Copyright 2026 Yuan Yizhe).
Source: https://github.com/Yuan1z0825/nature-skills
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import os
from pathlib import Path


# ─────────────────────────────────────────────────────────────────────────────
# Color Palettes
# ─────────────────────────────────────────────────────────────────────────────

PALETTE = {
    "blue_main":      "#0F4D92",
    "blue_secondary": "#3775BA",
    "green_1": "#DDF3DE",
    "green_2": "#AADCA9",
    "green_3": "#8BCF8B",
    "red_1":   "#F6CFCB",
    "red_2":   "#E9A6A1",
    "red_strong": "#B64342",
    "neutral_light": "#CFCECE",
    "neutral_mid":   "#767676",
    "neutral_dark":  "#4D4D4D",
    "neutral_black": "#272727",
    "gold":   "#FFD700",
    "teal":   "#42949E",
    "violet": "#9A4D8E",
    "magenta":"#EA84DD",
}

DEFAULT_COLORS = [
    PALETTE["blue_main"],
    PALETTE["green_3"],
    PALETTE["red_strong"],
    PALETTE["teal"],
    PALETTE["violet"],
    PALETTE["neutral_light"],
]

PALETTE_NMI_PASTEL = {
    "baseline_dark": "#484878",
    "baseline_mid":  "#7884B4",
    "baseline_soft": "#B4C0E4",
    "ours_tiny":  "#E4E4F0",
    "ours_base":  "#E4CCD8",
    "ours_large": "#F0C0CC",
    "bg_lilac": "#E0E0F0",
    "bg_aqua":  "#E0F0F0",
    "bg_peach": "#F0E0D0",
    "neutral_light": "#D8D8D8",
    "neutral_mid":   "#A8A8A8",
    "neutral_dark":  "#606060",
    "delta_up":   "#2E9E44",
    "delta_down": "#E53935",
}

DEFAULT_COLORS_NMI_PASTEL = [
    PALETTE_NMI_PASTEL["baseline_dark"],
    PALETTE_NMI_PASTEL["baseline_mid"],
    PALETTE_NMI_PASTEL["baseline_soft"],
    PALETTE_NMI_PASTEL["ours_tiny"],
    PALETTE_NMI_PASTEL["ours_base"],
    PALETTE_NMI_PASTEL["ours_large"],
]

PALETTE_NATURE_IMAGING = {
    "bg": "#000000",
    "context": "#B8B8B8",
    "cyan": "#22D7E6",
    "magenta": "#FF2AD4",
    "white": "#FFFFFF",
}

PALETTE_NATURE_MATERIAL = {
    "aqua": "#77D7D1",
    "teal": "#33B5A5",
    "lilac": "#B9A7E8",
    "violet": "#7C6CCF",
    "callout_red": "#E53935",
    "neutral": "#D9D9D9",
}

PALETTE_NATURE_CLINICAL = {
    "baseline": "#272727",
    "week6": "#E28E2C",
    "week13": "#D24B40",
    "week26": "#5B8FD6",
    "year1": "#7BAA5B",
    "year2": "#C45AD6",
    "group_band": "#F2E6D9",
}

PALETTE_NATURE_GENOMICS = {
    "neutral_light": "#D8D8D8",
    "neutral_mid": "#8F8F8F",
    "wave1": "#D9544D",
    "wave2": "#5B7FCA",
    "wave3": "#B89BD9",
    "outline": "#4D4D4D",
}


# ─────────────────────────────────────────────────────────────────────────────
# Style Setup
# ─────────────────────────────────────────────────────────────────────────────

def apply_publication_style(font_size=16, axes_linewidth=2.5, use_tex=False):
    """Apply Nature-style rcParams. Call once before creating any figures."""
    plt.rcParams['font.family'] = 'sans-serif'
    plt.rcParams['font.sans-serif'] = ['Arial', 'DejaVu Sans', 'Liberation Sans']
    plt.rcParams['svg.fonttype'] = 'none'
    plt.rcParams['font.size'] = font_size
    plt.rcParams['axes.spines.right'] = False
    plt.rcParams['axes.spines.top'] = False
    plt.rcParams['axes.linewidth'] = axes_linewidth
    plt.rcParams['legend.frameon'] = False
    if use_tex:
        plt.rcParams['text.usetex'] = True


# Presets:
#   Large bar panels:      apply_publication_style(font_size=24, axes_linewidth=3)
#   Compact figures:       apply_publication_style(font_size=15, axes_linewidth=2)
#   Dense multi-panels:    apply_publication_style(font_size=8, axes_linewidth=1)
#   LaTeX labels:          apply_publication_style(use_tex=True)


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions
# ─────────────────────────────────────────────────────────────────────────────

def is_dark(hex_color, threshold=128):
    """Return True if hex color is dark (use white text on it)."""
    c = hex_color.lstrip('#')
    r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    return (0.299 * r + 0.587 * g + 0.114 * b) < threshold


def add_panel_label(ax, label, x=-0.06, y=1.02, fontsize=14,
                    color='black', fontweight='bold'):
    """Place a Nature-style panel label near the top-left edge."""
    ax.text(
        x, y, label,
        transform=ax.transAxes,
        fontsize=fontsize,
        fontweight=fontweight,
        color=color,
        ha='left',
        va='bottom',
    )


def style_dark_image_ax(ax, facecolor='black'):
    """Prepare an axes for microscopy / rendering plates."""
    ax.set_facecolor(facecolor)
    ax.set_xticks([])
    ax.set_yticks([])
    for spine in ax.spines.values():
        spine.set_visible(False)
    return ax


def annotate_bars(ax, bars, colors, fmt='{:.2f}', fontsize=32, offset=-0.10):
    """Add luminance-aware text labels on bars."""
    for bar, color in zip(bars, colors):
        c = color.lstrip('#')
        r, g, b = int(c[0:2], 16) / 255, int(c[2:4], 16) / 255, int(c[4:6], 16) / 255
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        textcolor = 'white' if lum < 0.5 else 'black'
        value = bar.get_height()
        ax.text(bar.get_x() + bar.get_width() / 2,
                value + offset,
                fmt.format(value),
                ha='center', va='bottom',
                fontsize=fontsize, color=textcolor)


def finalize_figure(fig, out_path, formats=None, dpi=300,
                    pad=2, bbox_inches=None, close=True):
    """
    Apply tight_layout and save figure.

    Parameters
    ----------
    out_path : str   — path without extension, or with extension
    formats  : list  — e.g. ['png', 'pdf']. If None, uses extension of out_path.
    dpi      : int   — 300 standard, 600 for dense bar panels
    pad      : float — tight_layout pad (2 default, 1 for compact multi-panel)
    """
    fig.tight_layout(pad=pad)
    base = Path(out_path)
    os.makedirs(base.parent, exist_ok=True)
    if formats is None:
        formats = [base.suffix.lstrip('.') or 'png']
        base = base.with_suffix('')
    saved = []
    for fmt in formats:
        p = str(base) + f'.{fmt}'
        kw = {}
        if bbox_inches is not None:
            kw['bbox_inches'] = bbox_inches
        fig.savefig(p, dpi=dpi, **kw)
        saved.append(p)
    if close:
        plt.close(fig)
    return saved
