#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""H5 radar plotting utilities (all-samples overlay OR group-mean comparison).

Reads kinematic parameter HDF5 files with (preferred) layout:
  /KinematicParameter/ParameterName  (params,)
  /KinematicParameter/ParameterData  (frames, params)

Modes:
  - mode=per_sample: generate one radar per sample (single-sample, all parameters)
  - mode=group_means: infer group from filename token and plot one polygon per group (group mean)
  - mode=both: generate per_sample + group_means outputs
  - mode=all_samples: (legacy) overlay all samples in one radar + per-sample radars

Outputs (default):
  results/h5_radar/<mode>/

Run example:
  python plot_h5_radar.py --project_dir "C:\\path\\to\\folder" --mode group_means
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

try:
    import h5py
except Exception as e:
    raise SystemExit(
        "Missing dependency: h5py. In your conda env, run e.g.\n"
        "  conda install -c conda-forge h5py numpy pandas matplotlib\n"
        f"Original import error: {e}"
    )


def apply_publication_style():
    """A clean, journal-like style (Cell/Nature-ish)."""
    matplotlib.rcParams.update(
        {
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "savefig.facecolor": "white",
            "font.size": 10,
            "font.family": "sans-serif",
            "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
            "pdf.fonttype": 42,  # editable text
            "ps.fonttype": 42,
            "axes.linewidth": 1.0,
            "grid.color": "#D0D0D0",
            "grid.linestyle": "-",
            "grid.linewidth": 0.8,
        }
    )


def nature_like_palette() -> List[str]:
    return [
        "#3C5488",  # blue
        "#E64B35",  # red/orange
        "#00A087",  # green
        "#4DBBD5",  # cyan
        "#F39B7F",  # salmon
        "#8491B4",  # lavender
        "#91D1C2",  # mint
        "#DC0000",  # red
        "#7E6148",  # brown
        "#B09C85",  # tan
    ]


def _decode_if_bytes(x):
    if isinstance(x, (bytes, np.bytes_)):
        return x.decode("utf-8", errors="ignore")
    return str(x)


def guess_group_from_filename(name: str, regex: str = r"rec-\d+-([^-_]+)[-_]") -> str:
    m = re.search(regex, name)
    return m.group(1) if m else "unknown"


def find_dataset_by_candidates(h5: h5py.File, candidates: List[str]) -> Optional[h5py.Dataset]:
    for p in candidates:
        if p in h5:
            obj = h5[p]
            if isinstance(obj, h5py.Dataset):
                return obj

    found = []

    def visitor(name, obj):
        if isinstance(obj, h5py.Dataset):
            base = name.split("/")[-1]
            if base in {c.split("/")[-1] for c in candidates}:
                found.append(obj)

    h5.visititems(visitor)
    return found[0] if found else None


def read_kinematic_features(h5_path: Path, stat: str = "mean") -> pd.Series:
    with h5py.File(h5_path, "r") as h5:
        ds_names = find_dataset_by_candidates(
            h5,
            [
                "/KinematicParameter/ParameterName",
                "KinematicParameter/ParameterName",
                "/ParameterName",
            ],
        )
        ds_data = find_dataset_by_candidates(
            h5,
            [
                "/KinematicParameter/ParameterData",
                "KinematicParameter/ParameterData",
                "/ParameterData",
            ],
        )

        if ds_names is None or ds_data is None:
            keys = list(h5.keys())
            raise KeyError(
                f"Cannot find ParameterName/ParameterData in {h5_path.name}. "
                f"Top-level keys: {keys}. Expected /KinematicParameter/..."
            )

        param_names = [_decode_if_bytes(x) for x in np.array(ds_names)]
        data = np.array(ds_data)

        if data.ndim != 2:
            raise ValueError(
                f"ParameterData must be 2D (frames x params). Got shape {data.shape} in {h5_path.name}."
            )
        if data.shape[1] != len(param_names):
            if data.shape[0] == len(param_names):
                data = data.T
            else:
                raise ValueError(
                    f"Mismatch: ParameterName len={len(param_names)} but ParameterData shape={data.shape} in {h5_path.name}."
                )

        if stat == "mean":
            vec = np.nanmean(data, axis=0)
        elif stat == "median":
            vec = np.nanmedian(data, axis=0)
        elif stat == "max":
            vec = np.nanmax(data, axis=0)
        else:
            raise ValueError(f"Unknown stat: {stat}")

        return pd.Series(vec, index=param_names, name=h5_path.stem)


def normalize_df(df: pd.DataFrame, method: str) -> pd.DataFrame:
    if method == "none":
        return df.copy()

    out = df.astype(float).copy()

    if method == "minmax":
        mins = out.min(axis=0, skipna=True)
        maxs = out.max(axis=0, skipna=True)
        denom = (maxs - mins).replace(0, np.nan)
        out = (out - mins) / denom
        out = out.fillna(0.5)
        return out

    if method == "zscore":
        mu = out.mean(axis=0, skipna=True)
        sd = out.std(axis=0, skipna=True).replace(0, np.nan)
        out = (out - mu) / sd
        out = out.fillna(0.0)
        return out

    raise ValueError(f"Unknown normalize method: {method}")


def _set_ylim_if_unit(ax, arr: np.ndarray):
    try:
        vmin = float(np.nanmin(arr))
        vmax = float(np.nanmax(arr))
        if vmin >= -1e-9 and vmax <= 1 + 1e-9:
            ax.set_ylim(0, 1)
    except Exception:
        pass


def radar_plot_all_samples(
    df: pd.DataFrame,
    out_png: Path,
    out_pdf: Path,
    title: str,
    groups: Optional[Dict[str, str]] = None,
    max_samples: int = 30,
    palette: Optional[List[str]] = None,
):
    if df.empty:
        return

    params = list(df.columns)
    n = len(params)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist() + [0.0]

    fig = plt.figure(figsize=(max(8, n * 0.22), max(8, n * 0.22)))
    ax = plt.subplot(111, polar=True)
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)
    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(params, fontsize=8)
    ax.tick_params(axis="y", labelsize=8)
    _set_ylim_if_unit(ax, df.to_numpy(dtype=float))

    plot_df = df.copy()
    if len(plot_df) > max_samples:
        keep = plot_df.var(axis=1).sort_values(ascending=False).head(max_samples).index
        plot_df = plot_df.loc[keep]

    if palette is None:
        palette = nature_like_palette()

    group_list = sorted({groups.get(s, "unknown") for s in plot_df.index}) if groups else ["all"]
    group_color = {g: palette[i % len(palette)] for i, g in enumerate(group_list)}

    for sample in plot_df.index:
        values = plot_df.loc[sample].to_numpy(dtype=float).tolist()
        values += values[:1]
        g = groups.get(sample, "unknown") if groups else "all"
        ax.plot(angles, values, linewidth=1.4, alpha=0.85, color=group_color[g])

    if groups:
        handles = [plt.Line2D([0], [0], color=group_color[g], lw=2) for g in group_list]
        ax.legend(handles, group_list, loc="upper right", bbox_to_anchor=(1.18, 1.18), fontsize=9)

    ax.set_title(title, y=1.08)
    fig.tight_layout()

    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=200)
    fig.savefig(out_pdf)
    plt.close(fig)


def radar_plot_single(sample: str, row: pd.Series, out_png: Path, out_pdf: Path, title: str, color: str):
    params = list(row.index)
    n = len(params)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist() + [0.0]

    values = row.to_numpy(dtype=float).tolist()
    values += values[:1]

    fig = plt.figure(figsize=(max(7, n * 0.18), max(7, n * 0.18)))
    ax = plt.subplot(111, polar=True)
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(params, fontsize=8)
    ax.plot(angles, values, linewidth=2.0, color=color)
    ax.fill(angles, values, alpha=0.12, color=color)

    ax.set_title(title, y=1.08)
    fig.tight_layout()

    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=200)
    fig.savefig(out_pdf)
    plt.close(fig)


def radar_plot_group_means(group_means: pd.DataFrame, out_png: Path, out_pdf: Path, title: str, palette=None):
    if group_means.empty:
        return

    params = list(group_means.columns)
    n = len(params)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False).tolist() + [0.0]

    fig = plt.figure(figsize=(max(8, n * 0.22), max(8, n * 0.22)))
    ax = plt.subplot(111, polar=True)
    ax.set_theta_offset(np.pi / 2)
    ax.set_theta_direction(-1)

    ax.set_xticks(angles[:-1])
    ax.set_xticklabels(params, fontsize=8)
    ax.tick_params(axis="y", labelsize=8)
    _set_ylim_if_unit(ax, group_means.to_numpy(dtype=float))

    if palette is None:
        palette = nature_like_palette()

    for i, g in enumerate(group_means.index):
        color = palette[i % len(palette)]
        vals = group_means.loc[g].to_numpy(dtype=float).tolist()
        vals += vals[:1]
        ax.plot(angles, vals, linewidth=2.2, color=color, label=str(g))
        ax.fill(angles, vals, alpha=0.10, color=color)

    ax.legend(loc="upper right", bbox_to_anchor=(1.20, 1.18), fontsize=10)
    ax.set_title(title, y=1.08)
    fig.tight_layout()

    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=240)
    fig.savefig(out_pdf)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project_dir", type=str, required=True)
    ap.add_argument("--pattern", type=str, default="*.h5")
    ap.add_argument(
        "--mode",
        type=str,
        default="both",
        choices=["per_sample", "group_means", "both", "all_samples"],
        help="per_sample: one radar per sample; group_means: one radar per group mean; both: run both; all_samples: legacy combined overlay",
    )
    ap.add_argument("--out_dir", type=str, default="results/h5_radar")
    ap.add_argument("--stat", type=str, default="mean", choices=["mean", "median", "max"])
    ap.add_argument("--normalize", type=str, default="minmax", choices=["none", "minmax", "zscore"])
    ap.add_argument("--max_samples_combined", type=int, default=30)
    ap.add_argument("--n_params", type=int, default=0)
    ap.add_argument("--param_select", type=str, default="variance", choices=["variance", "first"])
    ap.add_argument("--style", type=str, default="nature", choices=["nature", "default"])
    ap.add_argument("--group_regex", type=str, default=r"rec-\d+-([^-_]+)[-_]",
                    help="Regex with 1 capture group for group name")
    args = ap.parse_args()

    if args.style == "nature":
        apply_publication_style()

    project_dir = Path(args.project_dir)
    if not project_dir.exists():
        raise SystemExit(f"project_dir not found: {project_dir}")

    h5_files = sorted(project_dir.glob(args.pattern))
    if not h5_files:
        raise SystemExit(f"No files matched: {project_dir / args.pattern}")

    out_dir = Path(args.out_dir)
    if not out_dir.is_absolute():
        out_dir = project_dir / out_dir

    # Decide output directory/ies
    if args.mode == "both":
        mode_dirs = {
            "per_sample": out_dir / "per_sample",
            "group_means": out_dir / "group_means",
        }
        for d in mode_dirs.values():
            d.mkdir(parents=True, exist_ok=True)
    else:
        mode_dir = out_dir / args.mode
        mode_dir.mkdir(parents=True, exist_ok=True)
        mode_dirs = {args.mode: mode_dir}

    series_list: List[pd.Series] = []
    groups: Dict[str, str] = {}
    skipped: List[Tuple[str, str]] = []

    for p in h5_files:
        try:
            s = read_kinematic_features(p, stat=args.stat)
        except Exception as e:
            skipped.append((p.name, str(e)))
            continue
        series_list.append(s)
        groups[s.name] = guess_group_from_filename(p.name, regex=args.group_regex)

    if not series_list:
        raise SystemExit("No valid .h5 files contained KinematicParameter/ParameterName + ParameterData.")

    df = pd.DataFrame(series_list)
    df.index.name = "sample"

    # Save matrices into each active mode folder (so artifacts are self-contained)
    df_norm = normalize_df(df, method=args.normalize)

    for md in mode_dirs.values():
        raw_csv = md / f"feature_matrix_{args.stat}.csv"
        df.to_csv(raw_csv, encoding="utf-8-sig")

        norm_csv = md / f"feature_matrix_{args.stat}__normalized_{args.normalize}.csv"
        df_norm.to_csv(norm_csv, encoding="utf-8-sig")

    df_plot = df_norm
    if args.n_params and 0 < args.n_params < df_norm.shape[1]:
        if args.param_select == "first":
            cols = list(df_norm.columns[: args.n_params])
        else:
            cols = df_norm.var(axis=0).sort_values(ascending=False).head(args.n_params).index.tolist()
        df_plot = df_norm.loc[:, cols]

    palette = nature_like_palette() if args.style == "nature" else None

    # Decide which sub-modes to run
    if args.mode == "both":
        run_modes = ["per_sample", "group_means"]
    else:
        run_modes = [args.mode]

    outputs: List[str] = []

    # --- per-sample radars (one radar per sample; all params) ---
    if "per_sample" in run_modes:
        md = mode_dirs["per_sample"]
        by_sample_dir = md / "radar_by_sample"
        by_sample_dir.mkdir(parents=True, exist_ok=True)

        color0 = (palette[0] if palette else "#3C5488")
        for sample in df_plot.index:
            row = df_plot.loc[sample]
            png = by_sample_dir / f"{sample}__{args.stat}__{args.normalize}__p{df_plot.shape[1]}.png"
            pdf = by_sample_dir / f"{sample}__{args.stat}__{args.normalize}__p{df_plot.shape[1]}.pdf"
            radar_plot_single(
                sample,
                row,
                png,
                pdf,
                title=f"{sample} (group={groups.get(sample, 'unknown')})",
                color=color0,
            )
        outputs.append(f"per_sample: {by_sample_dir}")

    # --- group means radar (one polygon per group mean) ---
    if "group_means" in run_modes:
        md = mode_dirs["group_means"]
        gser = pd.Series({s: groups.get(s, "unknown") for s in df_plot.index}, name="group")
        tmp = df_plot.copy()
        tmp.insert(0, "__group__", gser)
        group_means = tmp.groupby("__group__").mean(numeric_only=True)
        group_means.index.name = "group"

        gm_csv = md / f"group_means__{args.stat}__{args.normalize}__p{group_means.shape[1]}.csv"
        group_means.to_csv(gm_csv, encoding="utf-8-sig")

        out_png = md / f"radar_group_means__{args.stat}__{args.normalize}__p{group_means.shape[1]}.png"
        out_pdf = md / f"radar_group_means__{args.stat}__{args.normalize}__p{group_means.shape[1]}.pdf"
        title = (
            f"Radar (group means) | stat={args.stat} | norm={args.normalize} | "
            f"groups={len(group_means)} | p={group_means.shape[1]}"
        )
        radar_plot_group_means(group_means, out_png, out_pdf, title=title, palette=palette)
        outputs.append(f"group_means: {out_png}")

    # --- legacy all-samples overlay ---
    if "all_samples" in run_modes:
        md = mode_dirs["all_samples"]
        combined_png = md / f"radar_combined__{args.stat}__{args.normalize}__p{df_plot.shape[1]}.png"
        combined_pdf = md / f"radar_combined__{args.stat}__{args.normalize}__p{df_plot.shape[1]}.pdf"
        title = (
            f"Radar (all samples overlay) | stat={args.stat} | norm={args.normalize} | "
            f"n={len(df_plot)} | p={df_plot.shape[1]}"
        )
        radar_plot_all_samples(
            df_plot,
            combined_png,
            combined_pdf,
            title=title,
            groups=groups,
            max_samples=args.max_samples_combined,
            palette=palette,
        )

        by_sample_dir = md / "radar_by_sample"
        by_sample_dir.mkdir(parents=True, exist_ok=True)
        color0 = (palette[0] if palette else "#3C5488")
        for sample in df_plot.index:
            row = df_plot.loc[sample]
            png = by_sample_dir / f"{sample}__{args.stat}__{args.normalize}__p{df_plot.shape[1]}.png"
            pdf = by_sample_dir / f"{sample}__{args.stat}__{args.normalize}__p{df_plot.shape[1]}.pdf"
            radar_plot_single(
                sample,
                row,
                png,
                pdf,
                title=f"{sample} (group={groups.get(sample, 'unknown')})",
                color=color0,
            )
        outputs.append(f"all_samples: {combined_png}")

    # Save parameter order + skipped report into each produced folder
    for m in set(run_modes):
        md = mode_dirs[m]
        (md / "parameter_order.txt").write_text("\n".join(df.columns), encoding="utf-8")
        (md / f"parameter_order__p{df_plot.shape[1]}.txt").write_text(
            "\n".join(df_plot.columns), encoding="utf-8"
        )
        if skipped:
            rep = md / "skipped_files.txt"
            rep.write_text("\n".join([f"{name}\t{err}" for name, err in skipped]), encoding="utf-8")

    print("Done.")
    print(f"Mode: {args.mode}")
    for line in outputs:
        print(line)
    if skipped:
        print(f"Skipped files: {len(skipped)} (see skipped_files.txt under each output folder)")


if __name__ == "__main__":
    main()
