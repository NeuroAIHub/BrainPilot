import os
import numpy as np
from matplotlib import pyplot as plt


data_comparison = {
    'methods': [
        r'DPO',
        r'DA-DPO',
        r'VIGIL (Ours)',
    ],
    'colors': [
        "#D88F8A",
        "#8BCF8B",
        "#0F4D92"
    ],
    'results': {
        'Qwen2.5-VL-7B\nPOPE$_{Adv}$': np.array([82.8, 84.2, 86.9]),
        'LLaVA-OneVision-7B\nPOPE$_{Adv}$': np.array([82.8, 84.2, 86.9]),
        'InternVL2.5-26B\nPOPE$_{Adv}$': np.array([85.5, 86.8, 89.4]),
        'Qwen2.5-VL-72B\nPOPE$_{Adv}$': np.array([84.5, 87.4, 89.8]),
        'Qwen2.5-VL-7B\nMathVista': np.array([48.0, 48.8, 49.5]),
        'LLaVA-OneVision-7B\nMathVista': np.array([50.8, 51.5, 52.8]),
        'InternVL2.5-26B\nMathVista': np.array([57.9, 58.8, 60.1]),
        'Qwen2.5-VL-72B\nMathVista': np.array([54.1, 55.4, 56.6]),
        'Qwen2.5-VL-7B\nMMBench': np.array([71.2, 72.0, 72.5]),
        'LLaVA-OneVision-7B\nMMBench': np.array([72.5, 73.0, 73.8]),
        'InternVL2.5-26B\nMMBench': np.array([79.5, 80.1, 81.3]),
        'Qwen2.5-VL-72B\nMMBench': np.array([77.2, 77.8, 78.5]),
    },
}


def _task_suffix(subtask_name):
    """Benchmark = part after the first newline (e.g. 'Qwen2.5-VL-7B\\nMathVista' -> 'MathVista')."""
    return subtask_name.split('\n', 1)[-1] if '\n' in subtask_name else subtask_name


def plot_radar(data_comparison):
    """
    Single radar chart. Each axis = one subtask; one curve per method.
    Each benchmark (task suffix after \\n) has its own radii list: values are normalized
    to display range 45-90 using that benchmark's min/max from its radii list, and
    radius labels on each spoke show that benchmark's tick values.
    """
    methods = data_comparison['methods']
    colors = data_comparison['colors']
    n_methods = len(methods)
    benchmark_radii = {
        'POPE$_{Adv}$': [75, 80, 85, 91],
        'MathVista': [30, 40, 50, 61],
        'MMBench': [40, 55, 70, 85],
    }

    # results is directly subtask_name -> value array
    task_dict = data_comparison['results']
    subtask_names = list(task_dict.keys())
    value_arrays = list(task_dict.values())

    fig = plt.figure(figsize=(12, 10))
    ax = fig.add_subplot(111, projection='polar')
    n_subtasks = len(subtask_names)
    subtask_benchmarks = [_task_suffix(st) for st in subtask_names]

    # Per-benchmark (r_min, r_max) from that benchmark's radii list
    def limits_for_benchmark(bench):
        radii = benchmark_radii.get(bench, [0, 100])
        return (min(radii), max(radii))

    # One polygon per method: normalize each spoke by its benchmark's radii range, then map to 45-90
    angles = np.linspace(2 * np.pi, 0, n_subtasks, endpoint=False)
    angles_closed = np.append(angles, angles[0])

    for m in range(n_methods):
        vals = np.array([v[m] for v in value_arrays], dtype=float)
        mask = np.isnan(vals)
        if np.any(mask):
            vals = vals.copy()
            fill = 0.0 if np.all(mask) else np.nanmean(vals)
            vals[mask] = fill
        # Normalize per spoke: benchmark's (r_min, r_max) -> display 45-90. One vertex per subtask (no interpolation).
        normalized = np.zeros_like(vals)
        for i, (v, bench) in enumerate(zip(vals, subtask_benchmarks)):
            r_lo, r_hi = limits_for_benchmark(bench)
            span = r_hi - r_lo
            if span <= 0:
                normalized[i] = 45 + 45 * 0.5
            else:
                n = np.clip((v - r_lo) / span, 0.0, 1.0)
                normalized[i] = 45 + 45 * n
        # Closed polygon: exact data at each angle, then back to first (no extra interpolation)
        vals_closed = np.append(normalized, normalized[0])
        ax.plot(angles_closed, vals_closed, color=colors[m], linewidth=2, label=methods[m])
        ax.fill(angles_closed, vals_closed, color=colors[m], alpha=0.05)
        # Mark actual vertices so it's clear each point is a real data value
        ax.scatter(angles, normalized, color=colors[m], s=18, zorder=5, edgecolors='none')

    ax.set_ylim(45, 90)
    ax.set_theta_zero_location('N')
    for spine in ax.spines.values():
        spine.set_visible(False)
    r_min_disp, r_max_disp = ax.get_ylim()
    ax.grid(False)
    # Outer boundary
    ax.plot(angles_closed, np.full_like(angles_closed, r_max_disp), color='k', linewidth=0.8, zorder=4)
    # Radial spokes: one per angle
    for a in angles:
        ax.plot([a, a], [r_min_disp, r_max_disp], color='gray', linewidth=0.5, zorder=4)
    # Benchmark-specific contour polygons: one polygon per level index k (innermost=0, ...).
    max_levels = max(len(benchmark_radii.get(b, [])) for b in subtask_benchmarks)
    for k in range(max_levels):
        display_radii = np.zeros(n_subtasks)
        for i, bench in enumerate(subtask_benchmarks):
            radii_list = benchmark_radii.get(bench, [])
            if not radii_list:
                display_radii[i] = 45 + 22.5
                continue
            contour_val = radii_list[k] if k < len(radii_list) else radii_list[-1]
            r_lo, r_hi = limits_for_benchmark(bench)
            span = r_hi - r_lo
            if span <= 0:
                display_radii[i] = 45 + 22.5
            else:
                frac = (contour_val - r_lo) / span
                display_radii[i] = 45 + 45 * np.clip(frac, 0.0, 1.0)
        contour_closed = np.append(display_radii, display_radii[0])
        ax.plot(angles_closed, contour_closed, color='k', linewidth=0.6, zorder=4, label='_nolegend_')
    ax.set_yticks([r_max_disp])
    ax.set_yticklabels([])
    ax.set_rlabel_position(0)
    ax.set_xticks(angles)
    ax.set_xticklabels([])
    # Per-spoke radius labels: skip innermost tick to avoid clutter
    for angle, bench in zip(angles, subtask_benchmarks):
        radii_list = benchmark_radii.get(bench, [])
        if len(radii_list) <= 1:
            continue
        r_lo, r_hi = limits_for_benchmark(bench)
        span = r_hi - r_lo
        for tick_val in radii_list[1:]:  # skip innermost (smallest) number
            if span <= 0:
                display_r = 45 + 22.5
            else:
                frac = (tick_val - r_lo) / span
                display_r = 45 + 45 * np.clip(frac, 0.0, 1.0)
            lbl = f'{tick_val:.0f}' if tick_val == int(tick_val) else f'{tick_val:.1f}'
            rot = np.degrees(angle)
            ax.text(angle, display_r + 1, lbl, fontsize=12, ha='center', va='center',
                    rotation=rot, rotation_mode='anchor',
                    transform=ax.transData, clip_on=False)
    # One label per subtask (angle)
    for angle, label in zip(angles, subtask_names):
        offset = 8 + 10 * np.abs(np.sin(angle))
        label_r = r_max_disp + offset
        ax.text(angle, label_r, label, fontsize=14, ha='center', va='center',
                transform=ax.transData, clip_on=False, fontfamily='monospace')
    ax.legend(loc='upper right', bbox_to_anchor=(1.40, 0.05), fontsize=15, frameon=False)

    fig.tight_layout(pad=2)
    os.makedirs('./figures/', exist_ok=True)
    fig.savefig('./figures/comparison_radar.png', dpi=300, bbox_inches='tight')
    plt.close(fig)
    return


if __name__ == '__main__':
    plt.rcParams['font.family'] = 'helvetica'
    plt.rcParams['font.size'] = 24
    plt.rcParams['axes.spines.right'] = False
    plt.rcParams['axes.spines.top'] = False
    plt.rcParams['axes.linewidth'] = 3

    plot_radar(data_comparison)
