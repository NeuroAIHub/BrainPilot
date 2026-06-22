# -*- coding: utf-8 -*-
"""All-params all-samples kinematic clustermap (no config editing required).

Run it from ANY project folder that contains .h5 files:

  cd /d C:/path/to/your_project
  python <skill>/scripts/cluster_all_params.py

Or pass an explicit root:

  python scripts/cluster_all_params.py --root "C:/path/to/your_project"

Outputs default to:
  <root>/results/cluster_all_kinematic_params/

You can optionally tweak behavior via CLI flags (no file edits):
  --summary mean|median|max
  --style nature|cell|minimal
  --cmap RdBu_r|coolwarm|vlag|icefire|...
"""

import argparse, os, re, glob, json
import numpy as np

import h5py
import pandas as pd
import seaborn as sns
import matplotlib
matplotlib.use('Agg')

from scipy.cluster.hierarchy import linkage

PARAM_NAME_DS_DEFAULT = 'KinematicParameter/ParameterName'
PARAM_DATA_DS_DEFAULT = 'KinematicParameter/ParameterData'


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='.', help='Project folder containing .h5 files (default: current directory)')
    ap.add_argument('--outdir', default='', help='Output folder (default: results/cluster_all_kinematic_params under root)')

    ap.add_argument('--param-name-ds', default=PARAM_NAME_DS_DEFAULT)
    ap.add_argument('--param-data-ds', default=PARAM_DATA_DS_DEFAULT)

    ap.add_argument('--summary', default='mean', choices=['mean','median','max'])
    ap.add_argument('--normalize', default='col_zscore', choices=['col_zscore','none'])

    ap.add_argument('--linkage', dest='linkage_method', default='average', choices=['average','complete','ward','single'])
    ap.add_argument('--metric', default='euclidean', choices=['euclidean','correlation'])

    ap.add_argument('--style', default='nature', choices=['nature','cell','minimal'])
    ap.add_argument('--cmap', default='RdBu_r', help='Matplotlib cmap name (used when style does not override)')

    ap.add_argument('--linewidths', type=float, default=0.4)
    ap.add_argument('--linecolor', default='white')
    ap.add_argument('--figwidth', type=float, default=18)
    ap.add_argument('--figheight', type=float, default=10)
    ap.add_argument('--xtick-rotation', type=float, default=90)
    ap.add_argument('--xtick-fontsize', type=float, default=7)
    ap.add_argument('--ytick-fontsize', type=float, default=8)

    ap.add_argument('--save-png', action='store_true', default=True)
    ap.add_argument('--no-save-png', action='store_false', dest='save_png')
    ap.add_argument('--save-pdf', action='store_true', default=True)
    ap.add_argument('--no-save-pdf', action='store_false', dest='save_pdf')
    ap.add_argument('--png-dpi', type=int, default=300)

    args = ap.parse_args()

    root = os.path.abspath(args.root)
    outdir = args.outdir.strip()
    if not outdir:
        outdir = os.path.join(root, 'results', 'cluster_all_kinematic_params')
    elif not os.path.isabs(outdir):
        outdir = os.path.join(root, outdir)
    os.makedirs(outdir, exist_ok=True)

    h5_files = sorted(glob.glob(os.path.join(root, '*.h5')), key=natural_key)
    if not h5_files:
        raise SystemExit(f'No .h5 files found under: {root}')

    sample_names = []
    feats_list = []
    per_sample = {}
    param_names_ref = None

    for hp in h5_files:
        sample = os.path.splitext(os.path.basename(hp))[0]
        with h5py.File(hp, 'r') as h5:
            if args.param_name_ds not in h5 or args.param_data_ds not in h5:
                continue
            names_raw = h5[args.param_name_ds][()]
            param_names = [_decode(n).strip() for n in names_raw]
            data = np.asarray(h5[args.param_data_ds][()])
            if data.ndim != 2:
                continue

            if param_names_ref is None:
                param_names_ref = param_names
            else:
                if len(param_names) != len(param_names_ref) or any(a != b for a, b in zip(param_names, param_names_ref)):
                    raise SystemExit(f"ParameterName mismatch in {os.path.basename(hp)}; cannot combine reliably.")

            feats = [summarize_ts(data[:, j], args.summary) for j in range(data.shape[1])]

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
    if args.normalize == 'col_zscore':
        M = col_zscore(M)

    df = pd.DataFrame(M, index=sample_names, columns=param_names_ref)
    df.to_csv(os.path.join(outdir, 'feature_matrix.csv'))

    row_link = linkage(df.values, method=args.linkage_method, metric=args.metric)
    col_link = linkage(df.values.T, method=args.linkage_method, metric=args.metric)

    np.save(os.path.join(outdir, 'row_linkage.npy'), row_link)
    np.save(os.path.join(outdir, 'col_linkage.npy'), col_link)

    # style presets
    style_l = str(args.style).lower()
    if style_l == 'cell':
        sns.set_theme(style='white', context='paper', font_scale=0.9)
        cmap_use = 'RdBu_r'
    elif style_l == 'nature':
        sns.set_theme(style='white', context='paper', font_scale=0.95)
        cmap_use = 'vlag'
    elif style_l == 'minimal':
        sns.set_theme(style='white', context='paper', font_scale=0.9)
        cmap_use = args.cmap
        args.linewidths = 0.0
    else:
        sns.set_theme(style='white', context='paper', font_scale=0.9)
        cmap_use = args.cmap

    g = sns.clustermap(
        df,
        row_linkage=row_link,
        col_linkage=col_link,
        cmap=cmap_use,
        center=0.0 if args.normalize == 'col_zscore' else None,
        linewidths=args.linewidths,
        linecolor=args.linecolor,
        xticklabels=True,
        yticklabels=True,
        figsize=(args.figwidth, args.figheight),
    )

    try:
        g.ax_heatmap.set_xticklabels(g.ax_heatmap.get_xticklabels(), rotation=args.xtick_rotation, ha='right', fontsize=args.xtick_fontsize)
        g.ax_heatmap.set_yticklabels(g.ax_heatmap.get_yticklabels(), fontsize=args.ytick_fontsize)
    except Exception:
        pass

    g.fig.suptitle(
        f"All kinematic params ({args.summary}) | norm={args.normalize} | linkage={args.linkage_method}, metric={args.metric}",
        y=1.02,
    )

    if args.save_png:
        g.savefig(os.path.join(outdir, 'clustermap_all_params.png'), dpi=args.png_dpi, bbox_inches='tight')
    if args.save_pdf:
        g.savefig(os.path.join(outdir, 'clustermap_all_params.pdf'), bbox_inches='tight')

    meta = {
        'root': root,
        'outdir': outdir,
        'source': {'param_name_dataset': args.param_name_ds, 'param_data_dataset': args.param_data_ds},
        'summary': args.summary,
        'normalize': args.normalize,
        'linkage_method': args.linkage_method,
        'distance_metric': args.metric,
        'plot': {
            'style': args.style,
            'cmap': cmap_use,
            'linewidths': args.linewidths,
            'linecolor': args.linecolor,
            'xtick_rotation': args.xtick_rotation,
            'xtick_fontsize': args.xtick_fontsize,
            'ytick_fontsize': args.ytick_fontsize,
            'png_dpi': args.png_dpi,
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
