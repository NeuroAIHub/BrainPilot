"""
Reusable Nature-journal figure templates.

Each function creates a complete figure from data and saves it.
Derived from nature-skills/nature-figure (MIT License, Copyright 2026 Yuan Yizhe).
Source: https://github.com/Yuan1z0825/nature-skills
"""

import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib as mpl
from matplotlib import gridspec

from nature_figure_style import (
    apply_publication_style, DEFAULT_COLORS, DEFAULT_COLORS_NMI_PASTEL,
    add_panel_label, is_dark, finalize_figure,
)


def make_grouped_bar(ax, categories, series, labels,
                     ylabel='Value', colors=None,
                     annotate=False, bar_width=0.8,
                     error_kw=None):
    """
    Grouped bar chart.

    Parameters
    ----------
    ax         : matplotlib Axes
    categories : list[str]  — x-axis category names (length K)
    series     : list[array] — one array per group (each length K)
    labels     : list[str]  — legend label per group
    colors     : list[str] | None
    annotate   : bool  — print value above each bar
    bar_width  : float — total width for all bars in one category
    error_kw   : dict  — passed to ax.bar

    Returns
    -------
    list[BarContainer]
    """
    if colors is None:
        colors = DEFAULT_COLORS
    if error_kw is None:
        error_kw = {'elinewidth': 2, 'capthick': 2, 'capsize': 10}
    n_groups = len(series)
    n_cats = len(categories)
    w = bar_width / n_groups
    x = np.arange(n_cats)
    containers = []
    for i, (vals, label, color) in enumerate(zip(series, labels, colors)):
        offset = (i - (n_groups - 1) / 2) * w
        bars = ax.bar(x + offset, vals, width=w, label=label,
                      color=color, edgecolor='black', linewidth=1.5,
                      error_kw=error_kw)
        containers.append(bars)
        if annotate:
            for bar, val in zip(bars, vals):
                ax.text(bar.get_x() + bar.get_width() / 2,
                        bar.get_height() + 0.01,
                        f'{val:.2f}', ha='center', va='bottom', fontsize=10)
    ax.set_xticks(x)
    ax.set_xticklabels(categories)
    ax.set_ylabel(ylabel)
    ax.legend()
    return containers


def make_trend(ax, x, y_series, labels,
               colors=None, ylabel=None, xlabel=None,
               show_shadow=False, shadow_alpha=0.15,
               lw=2.5, marker='o', markersize=8):
    """
    Multi-line trend plot.

    Parameters
    ----------
    x        : array-like   — shared x values
    y_series : list[array]  — one 1D array per line (or 2D for mean±std)
    labels   : list[str]
    show_shadow : bool  — fill_between ± std if y_series contains 2D arrays
    """
    if colors is None:
        colors = DEFAULT_COLORS
    for y, label, color in zip(y_series, labels, colors):
        y = np.asarray(y)
        if y.ndim == 2:
            mean, std = y.mean(0), y.std(0)
        else:
            mean, std = y, None
        ax.plot(x, mean, color=color, lw=lw, marker=marker,
                markersize=markersize, label=label)
        if show_shadow and std is not None:
            ax.fill_between(x, mean - std, mean + std,
                            color=color, alpha=shadow_alpha)
    if ylabel:
        ax.set_ylabel(ylabel)
    if xlabel:
        ax.set_xlabel(xlabel)
    ax.legend()


def make_forest_plot(ax, labels, estimates, ci_low, ci_high,
                     colors=None, ref=0.0, xlabel=None, xlim=None,
                     marker='o', markersize=5, lw=1.5):
    """Minimal forest plot for Nature-style clinical/statistical panels."""
    y = np.arange(len(labels))[::-1]
    if colors is None:
        colors = ['#B64342'] * len(labels)
    for yi, est, lo, hi, color in zip(y, estimates, ci_low, ci_high, colors):
        ax.plot([lo, hi], [yi, yi], color=color, lw=lw)
        ax.plot(est, yi, marker=marker, ms=markersize, color=color)
    ax.axvline(ref, color='#767676', linestyle='--', linewidth=1.2, alpha=0.8)
    ax.set_yticks(y)
    ax.set_yticklabels(labels)
    if xlabel:
        ax.set_xlabel(xlabel)
    if xlim is not None:
        ax.set_xlim(xlim)
    ax.spines['right'].set_visible(False)
    ax.spines['top'].set_visible(False)


def make_heatmap(ax, matrix, x_labels=None, y_labels=None,
                 cmap='magma', cbar_label=None, annotate=False,
                 fmt='{:.2f}', fontsize=12):
    """2D heatmap with optional colorbar and cell annotations."""
    im = ax.imshow(matrix, cmap=cmap, aspect='auto')
    if cbar_label:
        cbar = ax.figure.colorbar(im, ax=ax)
        cbar.set_label(cbar_label)
    if x_labels:
        ax.set_xticks(range(len(x_labels)))
        ax.set_xticklabels(x_labels, rotation=30, ha='right')
    if y_labels:
        ax.set_yticks(range(len(y_labels)))
        ax.set_yticklabels(y_labels)
    if annotate:
        norm = mpl.colors.Normalize(vmin=matrix.min(), vmax=matrix.max())
        cm_obj = plt.get_cmap(cmap)
        for (i, j), val in np.ndenumerate(matrix):
            r, g, b, _ = cm_obj(norm(val))
            lum = 0.299 * r + 0.587 * g + 0.114 * b
            color = 'white' if lum < 0.5 else 'black'
            ax.text(j, i, fmt.format(val), ha='center', va='center',
                    fontsize=fontsize, color=color)
    ax.set_frame_on(False)


# ─────────────────────────────────────────────────────────────────────────────
# Complete Figure Templates
# ─────────────────────────────────────────────────────────────────────────────

def template_grouped_bar_with_legend_panel(methods, metrics, mean_dict, std_dict,
                                           colors=None, out_path='./figures/comparison'):
    """
    Multi-metric grouped bar chart with a dedicated legend panel.

    Parameters
    ----------
    methods   : list[str]       — method names
    metrics   : list[str]       — metric names
    mean_dict : dict[str,array] — metric -> array of means per method
    std_dict  : dict[str,array] — metric -> array of stds per method
    colors    : list[str]       — one color per method
    out_path  : str             — save path (no extension)
    """
    apply_publication_style(font_size=24, axes_linewidth=3)
    if colors is None:
        colors = DEFAULT_COLORS[:len(methods)]

    fig = plt.figure(figsize=(28, 6))
    gs = gridspec.GridSpec(1, len(metrics) + 1)

    handles, labels = None, None
    for col, metric in enumerate(metrics):
        ax = fig.add_subplot(gs[col])
        bars = ax.bar(
            range(len(methods)), mean_dict[metric],
            yerr=std_dict[metric], capsize=5,
            color=colors, label=methods,
            error_kw={'elinewidth': 2, 'capthick': 2},
        )
        if col == 0:
            handles, labels = ax.get_legend_handles_labels()
        ax.set_xticks([])
        y_vals = mean_dict[metric]
        margin = (y_vals.max() - y_vals.min()) * 0.15
        ax.set_ylim([y_vals.min() - margin, y_vals.max() + margin])
        ax.set_ylabel(metric, fontsize=32)

    ax_leg = fig.add_subplot(gs[-1])
    ax_leg.legend(handles, labels, fontsize=28, loc='center', frameon=False)
    ax_leg.set_axis_off()

    return finalize_figure(fig, out_path, formats=['png', 'pdf'])


def template_ablation_bar(configs, values, stds=None,
                          out_path='./figures/ablation'):
    """
    Horizontal ablation bar chart with alpha-graduated colors.

    Parameters
    ----------
    configs : list[str] — ablation configuration names
    values  : array      — performance values
    stds    : array|None  — standard deviations
    """
    apply_publication_style(font_size=24, axes_linewidth=3)

    n = len(configs)
    blue_rgb = (0.215686, 0.458824, 0.729412)
    alphas = np.linspace(0.2, 1.0, n)
    colors = [(blue_rgb[0], blue_rgb[1], blue_rgb[2], a) for a in alphas]

    fig, ax = plt.subplots(figsize=(12, 6))
    ax.barh(range(n), values, xerr=stds, color=colors, ecolor='k', capsize=5)
    ax.set_yticks(range(n))
    ax.set_yticklabels(configs)
    ax.set_xlim([values.min() - 0.05, values.max() + 0.03])
    ax.set_xlabel('Score', fontsize=32)

    return finalize_figure(fig, out_path, formats=['png'])


def template_multi_panel_trend(methods, x, y_dict, panel_names,
                               colors=None, out_path='./figures/trends'):
    """
    Multi-panel trend plot with shared legend panel.

    Parameters
    ----------
    methods     : list[str]
    x           : array — shared x values
    y_dict      : dict[str, list[array]] — panel_name -> list of y arrays per method
    panel_names : list[str]
    colors      : list[str]
    """
    apply_publication_style(font_size=15, axes_linewidth=2)
    if colors is None:
        colors = DEFAULT_COLORS[:len(methods)]

    fig, axes = plt.subplots(1, len(panel_names) + 1, figsize=(18, 5))
    handles, labels = None, None

    for idx, (ax, name) in enumerate(zip(axes[:len(panel_names)], panel_names)):
        for method, color in zip(methods, colors):
            y = y_dict[name][method]
            ax.plot(x, y, color=color, lw=2.5, marker='o', markersize=6, label=method)
        ax.set_title(name, fontsize=18)
        ax.set_xlabel('Epoch', fontsize=16)
        ax.set_ylabel('Loss', fontsize=16)
        if idx == 0:
            handles, labels = ax.get_legend_handles_labels()

    axes[-1].legend(handles, labels, fontsize=14, loc='center', frameon=False)
    axes[-1].set_axis_off()

    return finalize_figure(fig, out_path, formats=['png', 'pdf'])


def template_dual_colormap_heatmap(matrix, methods, metrics,
                                    out_path='./figures/heatmap'):
    """
    Heatmap with dual colormaps (positive=Reds, negative=Blues_r).

    Parameters
    ----------
    matrix   : 2D array — rows=methods, cols=metrics
    methods  : list[str]
    metrics  : list[str] — even indices positive, odd indices negative
    """
    apply_publication_style(font_size=16, axes_linewidth=2)

    fig, ax = plt.subplots(figsize=(10, 6))
    n_rows, n_cols = matrix.shape
    vmax = matrix.max(0)

    for j in range(n_cols):
        is_positive = (j % 2 == 0)
        cmap = plt.cm.Reds if is_positive else plt.cm.Blues_r
        cmap = cmap.copy()
        norm = mpl.colors.Normalize(
            vmin=0 if is_positive else vmax[j],
            vmax=vmax[j] if is_positive else 0,
        )
        ax.imshow(matrix[:, j:j + 1], cmap=cmap, norm=norm,
                  aspect='auto', extent=[j - 0.5, j + 0.5, 0, n_rows], origin='lower')

    for (i, j), val in np.ndenumerate(matrix):
        is_positive = (j % 2 == 0)
        cmap = plt.cm.Reds if is_positive else plt.cm.Blues_r
        norm = mpl.colors.Normalize(
            vmin=0 if is_positive else vmax[j],
            vmax=vmax[j] if is_positive else 0,
        )
        r, g, b, _ = cmap(norm(val))
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        color = 'white' if lum < 0.5 else 'black'
        ax.text(j, i + 0.5, f'{val:.2f}', ha='center', va='center',
                fontsize=13, color=color)

    ax.set_xlim(-0.5, n_cols - 0.5)
    ax.set_xticks(np.arange(n_cols))
    ax.set_xticklabels(metrics, rotation=30, ha='right', fontsize=14)
    ax.tick_params(axis='x', bottom=False, top=False, length=0)
    ax.set_yticks(np.arange(n_rows) + 0.5)
    ax.set_yticklabels(methods, fontsize=14)
    ax.set_frame_on(False)
    ax.invert_yaxis()

    return finalize_figure(fig, out_path, formats=['png'])
