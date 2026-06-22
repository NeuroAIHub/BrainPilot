#!/usr/bin/env python3
"""Read an HDF5 (.h5) file, compute group-difference statistics, and output violin plots.

This script is intended to be used by the OpenClaw skill `h5-multiparameter-violin-stats`.

Key behavior (per user spec):
- 2 groups: use t-test OR Mann–Whitney U
- >=3 groups: use one-way ANOVA OR Kruskal–Wallis; if overall significant, do pairwise

CLI usage (typical):
  python h5_violin_stats.py \
    --h5 data.h5 \
    --dataset /path/to/values \
    --group /path/to/group_labels \
    --method auto \
    --out outputs/violin.png

Expected inputs:
- dataset: numeric 1D array-like (N,)
- group: labels array-like (N,), str/int

If your H5 layout differs (e.g., multiple datasets per sample), adapt mapping or add a loader.

Dependencies:
  h5py numpy pandas scipy matplotlib seaborn
Config:
  Uses TOML (Python 3.11+ builtin tomllib). Default config is ../config.toml (relative to this script).
"""

from __future__ import annotations

import argparse
import math
import os
import sys
from dataclasses import dataclass
from typing import Iterable, Literal, Sequence


def _load_toml(path: str) -> dict:
    """Load TOML config. Python 3.11+: tomllib builtin."""
    try:
        import tomllib  # py3.11+
    except Exception as e:
        _die(f"tomllib not available (need Python 3.11+). Details: {e}")

    with open(path, "rb") as f:
        return tomllib.load(f)


def _default_config_path() -> str:
    # ../config.toml relative to this script file
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(here), "config.toml")


def _deep_get(d: dict, keys: list[str], default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


Method = Literal["auto", "ttest", "mannwhitney", "anova", "kruskal"]


def _die(msg: str, code: int = 2) -> "NoReturn":
    print(f"ERROR: {msg}", file=sys.stderr)
    raise SystemExit(code)


def _require_deps() -> None:
    missing = []
    for mod in ["h5py", "numpy", "pandas", "scipy", "matplotlib", "seaborn"]:
        try:
            __import__(mod)
        except Exception:
            missing.append(mod)
    if missing:
        _die(
            "missing dependencies: "
            + ", ".join(missing)
            + "\nInstall (Ubuntu/Debian example): apt install python3-pip python3-venv && pip install "
            + " ".join(missing)
        )


def _as_1d(seq) -> "list":
    # keep as python list to avoid depending on numpy early
    try:
        return list(seq)
    except Exception:
        return [seq]


def _holm_bonferroni(p_values: Sequence[float]) -> list[float]:
    """Holm–Bonferroni adjusted p-values (strong FWER control)."""
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    adj = [0.0] * m
    prev = 0.0
    for k, i in enumerate(order):
        raw = p_values[i]
        val = (m - k) * raw
        val = max(val, prev)  # enforce monotonicity
        prev = val
        adj[i] = min(val, 1.0)
    return adj


@dataclass
class TestResult:
    test: str
    p_value: float
    statistic: float | None = None


def _choose_method(n_groups: int, method: Method, cfg: dict) -> str:
    if method != "auto":
        return method

    m2 = _deep_get(cfg, ["stats", "default_2_groups"], "ttest")
    m3 = _deep_get(cfg, ["stats", "default_3plus_groups"], "anova")
    if n_groups == 2:
        return str(m2)
    return str(m3)


def _run_overall_test(groups: list[str], values: list[float], method: str) -> TestResult:
    import numpy as np
    from scipy import stats

    # build per-group arrays
    uniq = sorted(set(groups))
    arrays = [np.asarray([v for g, v in zip(groups, values) if g == u], dtype=float) for u in uniq]

    if len(uniq) == 2:
        a, b = arrays
        if method == "ttest":
            stat, p = stats.ttest_ind(a, b, equal_var=False, nan_policy="omit")
            return TestResult("Welch t-test", float(p), None if stat is None else float(stat))
        if method == "mannwhitney":
            stat, p = stats.mannwhitneyu(a, b, alternative="two-sided")
            return TestResult("Mann–Whitney U", float(p), float(stat))
        _die(f"method '{method}' incompatible with 2 groups")

    # >=3
    if method == "anova":
        stat, p = stats.f_oneway(*arrays)
        return TestResult("One-way ANOVA", float(p), float(stat))
    if method == "kruskal":
        stat, p = stats.kruskal(*arrays)
        return TestResult("Kruskal–Wallis", float(p), float(stat))

    _die(f"method '{method}' incompatible with {len(uniq)} groups")


def _run_pairwise(groups: list[str], values: list[float], base_method: str, correction: str = "holm") -> list[dict]:
    """Pairwise comparisons among groups.

    For parametric overall: use Welch t-test for pairs.
    For nonparametric overall: use Mann–Whitney U for pairs.

    Returns list of dicts: {a,b,test,p,stat}
    """
    import numpy as np
    from scipy import stats

    uniq = sorted(set(groups))
    by = {
        u: np.asarray([v for g, v in zip(groups, values) if g == u], dtype=float)
        for u in uniq
    }

    rows = []
    pvals = []
    for i in range(len(uniq)):
        for j in range(i + 1, len(uniq)):
            a_name, b_name = uniq[i], uniq[j]
            a, b = by[a_name], by[b_name]
            if base_method in {"anova", "ttest"}:
                stat, p = stats.ttest_ind(a, b, equal_var=False, nan_policy="omit")
                test = "Welch t-test (pairwise)"
                statv = None if stat is None else float(stat)
            else:
                stat, p = stats.mannwhitneyu(a, b, alternative="two-sided")
                test = "Mann–Whitney U (pairwise)"
                statv = float(stat)
            pvals.append(float(p))
            rows.append({"a": a_name, "b": b_name, "test": test, "p": float(p), "stat": statv})

    corr = (correction or "holm").lower()
    if corr == "holm":
        adj = _holm_bonferroni(pvals)
        for row, ap in zip(rows, adj):
            row["p_adj"] = float(ap)
            row["p_adj_method"] = "holm"
    elif corr == "bonferroni":
        m = len(pvals)
        for row in rows:
            row["p_adj"] = min(float(row["p"]) * m, 1.0)
            row["p_adj_method"] = "bonferroni"
    else:
        _die(f"unsupported pairwise_correction: {correction}")

    return rows


def _read_h5_1d(h5_path: str, dataset_path: str, group_path: str) -> tuple[list[float], list[str]]:
    import h5py
    import numpy as np

    with h5py.File(h5_path, "r") as h5:
        if dataset_path not in h5:
            _die(f"dataset path not found in h5: {dataset_path}")
        if group_path not in h5:
            _die(f"group path not found in h5: {group_path}")

        x = h5[dataset_path][...]
        g = h5[group_path][...]

    x = np.asarray(x).reshape(-1)
    g = np.asarray(g).reshape(-1)

    if x.shape[0] != g.shape[0]:
        _die(f"length mismatch: values N={x.shape[0]} vs groups N={g.shape[0]}")

    # decode bytes labels
    groups: list[str] = []
    for item in g.tolist():
        if isinstance(item, (bytes, bytearray)):
            groups.append(item.decode("utf-8", errors="replace"))
        else:
            groups.append(str(item))

    # numeric values
    values = [float(v) if v is not None and not (isinstance(v, float) and math.isnan(v)) else float("nan") for v in x.tolist()]

    return values, groups


def _make_violin(values: list[float], groups: list[str], out_path: str, title: str | None, cfg: dict) -> None:
    import numpy as np
    import pandas as pd
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns

    # theme
    style = _deep_get(cfg, ["plot", "style"], "whitegrid")
    context = _deep_get(cfg, ["plot", "context"], "notebook")
    sns.set_theme(style=style, context=context)

    palette = _deep_get(cfg, ["plot", "palette"], "Set2")

    df = pd.DataFrame({"value": values, "group": groups})

    fig_w = float(_deep_get(cfg, ["plot", "fig_width"], 10))
    fig_h = float(_deep_get(cfg, ["plot", "fig_height"], 5))
    cut = float(_deep_get(cfg, ["plot", "cut"], 0))

    summary = str(_deep_get(cfg, ["plot", "summary"], "box")).lower()

    inner = None
    if summary in {"box", "quartile"}:
        inner = "box" if summary == "box" else "quartile"

    plt.figure(figsize=(fig_w, fig_h))
    ax = sns.violinplot(data=df, x="group", y="value", inner=inner, cut=cut, palette=palette)

    # overlay points
    if bool(_deep_get(cfg, ["plot", "show_points"], True)):
        sns.stripplot(
            data=df,
            x="group",
            y="value",
            color=_deep_get(cfg, ["plot", "point_color"], "black"),
            size=float(_deep_get(cfg, ["plot", "point_size"], 3)),
            alpha=float(_deep_get(cfg, ["plot", "point_alpha"], 0.4)),
            jitter=float(_deep_get(cfg, ["plot", "point_jitter"], 0.2)),
        )

    # custom summary overlays
    if summary in {"mean_sem", "median_iqr"}:
        uniq = list(df["group"].unique())
        xs = np.arange(len(uniq))
        col = _deep_get(cfg, ["plot", "summary_color"], "black")
        cap = float(_deep_get(cfg, ["plot", "summary_capsize"], 4))
        lw = float(_deep_get(cfg, ["plot", "summary_linewidth"], 1.5))

        centers = []
        lows = []
        highs = []
        for u in uniq:
            arr = df.loc[df["group"] == u, "value"].dropna().to_numpy(dtype=float)
            if arr.size == 0:
                centers.append(np.nan)
                lows.append(np.nan)
                highs.append(np.nan)
                continue
            if summary == "mean_sem":
                center = float(np.mean(arr))
                sem = float(np.std(arr, ddof=1) / math.sqrt(arr.size)) if arr.size > 1 else 0.0
                centers.append(center)
                lows.append(center - sem)
                highs.append(center + sem)
            else:
                q1 = float(np.percentile(arr, 25))
                q2 = float(np.percentile(arr, 50))
                q3 = float(np.percentile(arr, 75))
                centers.append(q2)
                lows.append(q1)
                highs.append(q3)

        yerr = np.vstack([np.asarray(centers) - np.asarray(lows), np.asarray(highs) - np.asarray(centers)])
        ax.errorbar(xs, centers, yerr=yerr, fmt="o", color=col, capsize=cap, lw=lw, ms=4, zorder=10)

    ax.set_xlabel("Group")
    ax.set_ylabel("Value")
    if title:
        ax.set_title(title)

    plt.tight_layout()
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    dpi = int(_deep_get(cfg, ["dump", "png_dpi"], 200))
    save_pdf = bool(_deep_get(cfg, ["dump", "save_pdf"], False))

    # Always save PNG
    png_path = out_path
    root, ext = os.path.splitext(png_path)
    if ext.lower() != ".png":
        png_path = root + ".png"
    plt.savefig(png_path, dpi=dpi)

    # Optionally save PDF alongside
    if save_pdf:
        pdf_path = os.path.splitext(png_path)[0] + ".pdf"
        plt.savefig(pdf_path)

    plt.close()

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--config",
        default="",
        help="Path to config.toml (default: ../config.toml relative to this script)",
    )
    p.add_argument("--h5", required=True, help="Path to .h5/.hdf5 file")
    p.add_argument("--dataset", required=True, help="H5 path to numeric 1D dataset")
    p.add_argument("--group", required=True, help="H5 path to group labels (same length)")
    p.add_argument(
        "--method",
        default="auto",
        choices=["auto", "ttest", "mannwhitney", "anova", "kruskal"],
        help="Stat method selector. auto: ttest for 2 groups, anova for >=3",
    )
    p.add_argument("--alpha", type=float, default=0.05, help="Significance level")
    p.add_argument("--out", default="outputs/violin.png", help="Output image path")
    p.add_argument("--out-json", default="", help="Optional output json path")
    p.add_argument("--title", default="", help="Plot title")
    p.add_argument("--no-pairwise", action="store_true", help="Skip pairwise comparisons")
    return p


def main(argv: Sequence[str]) -> int:
    _require_deps()

    args = build_parser().parse_args(argv)

    cfg_path = args.config.strip() or _default_config_path()
    if not os.path.exists(cfg_path):
        _die(f"config file not found: {cfg_path}")
    cfg = _load_toml(cfg_path)

    # allow config to set defaults
    alpha = float(_deep_get(cfg, ["stats", "alpha"], args.alpha))
    args.alpha = alpha

    values, groups = _read_h5_1d(args.h5, args.dataset, args.group)
    uniq = sorted(set(groups))
    method = _choose_method(len(uniq), args.method, cfg)

    overall = _run_overall_test(groups, values, method)

    pairwise = []
    pairwise_only_if_sig = bool(_deep_get(cfg, ["stats", "pairwise_only_if_overall_sig"], True))
    correction = str(_deep_get(cfg, ["stats", "pairwise_correction"], "holm"))

    if (not args.no_pairwise) and len(uniq) >= 3:
        if (not pairwise_only_if_sig) or (overall.p_value <= args.alpha):
            pairwise = _run_pairwise(groups, values, method, correction=correction)
    elif (not args.no_pairwise) and len(uniq) == 2:
        pairwise = []

    title = args.title.strip() or f"{overall.test}: p={overall.p_value:.3g}"
    _make_violin(values, groups, args.out, title=title, cfg=cfg)

    result = {
        "n": len(values),
        "groups": uniq,
        "config": cfg_path,
        "method_selected": method,
        "overall": {"test": overall.test, "p": overall.p_value, "stat": overall.statistic},
        "pairwise": pairwise,
        "alpha": args.alpha,
        "plot": args.out,
    }

    if args.out_json:
        import json

        os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
        with open(args.out_json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    # Always print a concise summary for chat-based usage
    print(f"Overall: {overall.test}  p={overall.p_value:.6g}")
    if len(uniq) >= 3 and pairwise:
        adj_method = pairwise[0].get("p_adj_method", "adj")
        print(f"Pairwise ({adj_method}-adjusted p):")
        for row in pairwise:
            print(
                f"  {row['a']} vs {row['b']}: p={row['p']:.4g}  p_adj={row['p_adj']:.4g}"
            )
    print(f"Saved plot: {args.out}")
    if args.out_json:
        print(f"Saved json: {args.out_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
