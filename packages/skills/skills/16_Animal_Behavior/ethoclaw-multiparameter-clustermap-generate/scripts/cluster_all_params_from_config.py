# -*- coding: utf-8 -*-
"""Cluster all kinematic parameters across all samples from a folder of .h5 files.

Reads config from TOML.

Each sample is summarized into one feature vector (one value per parameter)
from KinematicParameter/ParameterData (T x P).

Outputs:
- clustermap_all_params.png/.pdf
- feature_matrix.csv
- row_linkage.npy / col_linkage.npy
- clustering_meta.json

Usage:
  python scripts/cluster_all_params_from_config.py --config references/config.example.toml

You can copy config.example.toml and edit it.
"""

import argparse, os, re, glob, json
import numpy as np

import h5py
import pandas as pd
import seaborn as sns
import matplotlib
matplotlib.use('Agg')

from scipy.cluster.hierarchy import linkage

try:
    import tomllib  # py3.11+
except Exception:  # pragma: no cover
    import tomli as tomllib  # type: ignore


def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]


def _decode(x):
    if isinstance(x, bytes):
        return x.decode('utf-8', errors='ignore')
    return str(x)


def summarize_ts(x: np.ndarray, method: str) -> float:
    x = np.asarray(x, dtype=float)
    x[~np.isfinite(x)] = np.nan
    if method == 'median':
        return float(np.nanmedian(x))
    if method == 'max':
        return float(np.nanmax(x))
    return float(np.nanmean(x))


def col_zscore(M: np.ndarray) -> np.ndarray:
    mu = np.nanmean(M, axis=0, keepdims=True)
    sd = np.nanstd(M, axis=0, keepdims=True)
    sd[sd == 0] = 1.0
    return (M - mu) / sd


def read_toml(path: str) -> dict:
    with open(path, 'rb') as f:
        return tomllib.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True, help='Path to TOML config')
    args = ap.parse_args()

    cfg = read_toml(args.config)

    root = cfg['io']['root']
    outdir = cfg['io']['outdir']
    if not os.path.isabs(outdir):
        outdir = os.path.join(root, outdir)
    os.makedirs(outdir, exist_ok=True)

    param_name_ds = cfg['h5'].get('param_name_dataset', 'KinematicParameter/ParameterName')
    param_data_ds = cfg['h5'].get('param_data_dataset', 'KinematicParameter/ParameterData')

    summary = cfg['features'].get('summary', 'mean')
    normalize = cfg['features'].get('normalize', 'col_zscore')

    linkage_method = cfg['clustering'].get('linkage', 'average')
    metric = cfg['clustering'].get('metric', 'euclidean')

    style = cfg['plot'].get('style', 'nature')
    cmap = cfg['plot'].get('cmap', 'RdBu_r')
    linewidths = float(cfg['plot'].get('linewidths', 0.4))
    linecolor = cfg['plot'].get('linecolor', 'white')
    figwidth = float(cfg['plot'].get('figwidth', 18))
    figheight = float(cfg['plot'].get('figheight', 10))
    xtick_rotation = float(cfg['plot'].get('xtick_rotation', 90))
    xtick_fontsize = float(cfg['plot'].get('xtick_fontsize', 7))
    ytick_fontsize = float(cfg['plot'].get('ytick_fontsize', 8))
    save_png = bool(cfg['plot'].get('save_png', True))
    save_pdf = bool(cfg['plot'].get('save_pdf', True))
    png_dpi = int(cfg['plot'].get('png_dpi', 300))

    h5_files = sorted(glob.glob(os.path.join(root, '*.h5')), key=natural_key)
    if not h5_files:
        raise SystemExit(f'No .h5 files found under {root}')

    sample_names = []
    feats_list = []
    per_sample = {}
    param_names_ref = None

    for hp in h5_files:
        sample = os.path.splitext(os.path.basename(hp))[0]
        with h5py.File(hp, 'r') as h5:
            if param_name_ds not in h5 or param_data_ds not in h5:
                continue
            names_raw = h5[param_name_ds][()]
            param_names = [_decode(n).strip() for n in names_raw]
            data = np.asarray(h5[param_data_ds][()])
            if data.ndim != 2:
                continue

            if param_names_ref is None:
                param_names_ref = param_names
            else:
                if len(param_names) != len(param_names_ref) or any(a != b for a, b in zip(param_names, param_names_ref)):
                    raise SystemExit(f"ParameterName mismatch in {os.path.basename(hp)}; cannot combine reliably.")

            feats = [summarize_ts(data[:, j], summary) for j in range(data.shape[1])]

            sample_names.append(sample)
            feats_list.append(np.array(feats, dtype=float))
            per_sample[sample] = {
                'h5': os.path.basename(hp),
                'n_frames': int(data.shape[0]),
                'n_params': int(data.shape[1]),
            }

    if not feats_list:
        raise SystemExit('No valid kinematic parameter data found in any .h5')

    M = np.vstack(feats_list)
    if normalize == 'col_zscore':
        M = col_zscore(M)

    df = pd.DataFrame(M, index=sample_names, columns=param_names_ref)

    df.to_csv(os.path.join(outdir, 'feature_matrix.csv'))

    row_link = linkage(df.values, method=linkage_method, metric=metric)
    col_link = linkage(df.values.T, method=linkage_method, metric=metric)

    np.save(os.path.join(outdir, 'row_linkage.npy'), row_link)
    np.save(os.path.join(outdir, 'col_linkage.npy'), col_link)

    # --- plotting style presets (lightweight, journal-ish defaults) ---
    style_l = str(style).lower()
    if style_l == 'cell':
        sns.set_theme(style='white', context='paper', font_scale=0.9)
        # diverging, publication-friendly
        cmap_use = 'RdBu_r'
        linewidths = linewidths if linewidths is not None else 0.4
    elif style_l == 'nature':
        sns.set_theme(style='white', context='paper', font_scale=0.95)
        cmap_use = 'vlag'  # clean diverging
    elif style_l == 'minimal':
        sns.set_theme(style='white', context='paper', font_scale=0.9)
        cmap_use = cmap
        linewidths = 0.0
    else:
        sns.set_theme(style='white', context='paper', font_scale=0.9)
        cmap_use = cmap

    g = sns.clustermap(
        df,
        row_linkage=row_link,
        col_linkage=col_link,
        cmap=cmap_use,
        center=0.0 if normalize == 'col_zscore' else None,
        linewidths=linewidths,
        linecolor=linecolor,
        xticklabels=True,
        yticklabels=True,
        figsize=(figwidth, figheight),
    )

    # tick label polish
    try:
        g.ax_heatmap.set_xticklabels(g.ax_heatmap.get_xticklabels(), rotation=xtick_rotation, ha='right', fontsize=xtick_fontsize)
        g.ax_heatmap.set_yticklabels(g.ax_heatmap.get_yticklabels(), fontsize=ytick_fontsize)
    except Exception:
        pass

    g.fig.suptitle(
        f"All kinematic params ({summary}) | norm={normalize} | linkage={linkage_method}, metric={metric}",
        y=1.02,
    )

    if save_png:
        g.savefig(os.path.join(outdir, 'clustermap_all_params.png'), dpi=png_dpi, bbox_inches='tight')
    if save_pdf:
        g.savefig(os.path.join(outdir, 'clustermap_all_params.pdf'), bbox_inches='tight')

    meta = {
        'root': root,
        'outdir': outdir,
        'source': {'param_name_dataset': param_name_ds, 'param_data_dataset': param_data_ds},
        'summary': summary,
        'normalize': normalize,
        'linkage_method': linkage_method,
        'distance_metric': metric,
        'plot': {
            'style': style,
            'cmap': cmap_use,
            'linewidths': linewidths,
            'linecolor': linecolor,
            'xtick_rotation': xtick_rotation,
            'xtick_fontsize': xtick_fontsize,
            'ytick_fontsize': ytick_fontsize,
            'png_dpi': png_dpi,
        },
        'n_samples': int(df.shape[0]),
        'n_params': int(df.shape[1]),
        'per_sample': per_sample,
    }
    with open(os.path.join(outdir, 'clustering_meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print('OK')
    print('Wrote:', outdir)


if __name__ == '__main__':
    main()
