import os
import numpy as np
from matplotlib import pyplot as plt
from matplotlib import gridspec as gridspec
from matplotlib.collections import LineCollection
from matplotlib.colors import to_rgba
from matplotlib.lines import Line2D


data_posttraining = {
    'methods': [
        'DPO',
        'DA-DPO',
        'VIGIL (Ours)',
    ],
    'colors': [
        "#D88F8A",
        "#8BCF8B",
        "#0F4D92"
    ],
    'steps': [0, 200, 400, 600, 800],
    'results': np.array([
        [22.0, 25.5, 28.2, 29.5, 30.2],
        [22.0, 33.5, 38.2, 39.8, 40.5],
        [22.0, 52.5, 56.8, 57.9, 58.5],
    ]),
}


def plot_curves(data_posttraining):
    methods = data_posttraining['methods']
    colors = data_posttraining['colors']

    fig = plt.figure(figsize=(9, 8))
    ax = fig.add_subplot(1, 1, 1)
    y_ticks = [0, 20, 40, 60]
    x = np.asarray(data_posttraining['steps'])
    results = data_posttraining['results'] # shape (n_methods, n_steps)
    x_pos = np.arange(len(x))
    ax.axhline(y=results[0][0], color='black', alpha=0.3, linewidth=4, linestyle='--')
    for m, (method, color) in enumerate(zip(methods, colors)):
        y = results[m]
        # Segments with alpha increasing left to right
        pts = np.column_stack([x_pos, y])
        segments = np.stack([pts[:-1], pts[1:]], axis=1)
        n_seg = len(segments)
        alphas = np.linspace(0.3, 0.9, n_seg)
        rgb = np.array(to_rgba(color))
        seg_colors = [(*rgb[:3], a) for a in alphas]
        lc = LineCollection(segments, colors=seg_colors, linewidths=3, capstyle='round')
        ax.add_collection(lc)
        ax.plot(x_pos, y, color=color, linewidth=0, marker='o', markersize=10, label='_nolegend_')

    # Legend with line + marker for each method
    handles = [ Line2D([0], [0], color='black', linestyle='--', linewidth=4, alpha=0.3, label='SFT only')]
    for method, color in zip(methods, colors):
        handles.append(Line2D([0], [0], color=color, linewidth=3, marker='o', markersize=10, label=method))
    ax.legend(handles=handles, fontsize=20, loc='lower right', ncols=2, frameon=False)

    ax.set_xlabel('Post-training steps', fontsize=28, fontfamily='helvetica', labelpad=12)
    ax.set_xticks(x_pos)
    ax.set_xticklabels([str(b) for b in x])
    ax.set_ylabel('Performance on highly\nvision-dependent tasks' + r'$\uparrow$', fontsize=28, fontfamily='helvetica', labelpad=12)
    ax.set_yticks(y_ticks)
    ax.set_yticklabels(y_ticks)
    ax.tick_params(labelsize=20, length=8, width=1.5)

    fig.tight_layout(pad=2)
    os.makedirs('./figures/', exist_ok=True)
    fig.savefig('./figures/comparison_posttraining.png', dpi=300)
    plt.close(fig)
    return


if __name__ == '__main__':
    plt.rcParams['font.family'] = 'helvetica'
    plt.rcParams['font.size'] = 24
    plt.rcParams['axes.spines.top'] = False
    plt.rcParams['axes.spines.right'] = False
    plt.rcParams['axes.linewidth'] = 3

    plot_curves(data_posttraining)
