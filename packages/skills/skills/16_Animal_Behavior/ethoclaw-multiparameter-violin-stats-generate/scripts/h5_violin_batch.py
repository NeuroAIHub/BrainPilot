#!/usr/bin/env python3
"""Batch-generate violin plots for *all parameters* from a folder of .h5 files.

Designed to match `h5-multiparameter-violin-stats` rules + config, but works in batch mode:
- Reads every *.h5/*.hdf5 under --input-dir (non-recursive by default)
- Infers group from filename: rec-<id>-<group>-<timestamp>.h5
- Extracts:
  - AdvancedParameters/*  (scalar per file)
  - KinematicParameter/*  (per-file mean across frames)
- Writes one violin plot per parameter to --out-dir.

Config:
- Default config: ../config.toml (in this skill folder)
- Supports Python 3.11+ tomllib, and Python<3.11 via `toml` package.

Usage:
  python h5_violin_batch.py --input-dir /path/to/project/random_project

Windows example (conda python):
  D:\\Anaconda3\\python.exe h5_violin_batch.py \\
    --input-dir C:\\Users\\ASUS\\Desktop\\2Dxy_test_project\\random_project
"""

from __future__ import annotations

import argparse
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Literal, Sequence, Tuple


Method = Literal["auto", "ttest", "mannwhitney", "anova", "kruskal"]

FNAME_RE = re.compile(r"rec-(?P<rec>\d+)-(?P<group>[A-Za-z]+)-(?P<ts>\d+)\.h5$", re.IGNORECASE)


def _die(msg: str, code: int = 2) -> "NoReturn":
    raise SystemExit(f"ERROR: {msg}")


def _deep_get(d: dict, keys: list[str], default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict) or k not in cur:
            return default
        cur = cur[k]
    return cur


def _load_toml(path: str) -> dict:
    # Prefer tomllib (py3.11+). For older Python, avoid extra deps by parsing with stdlib.
    try:
        import tomllib  # type: ignore

        with open(path, "rb") as f:
            return tomllib.load(f)
    except Exception:
        pass

    # Minimal TOML parser for this skill's simple config (sections + key = value).
    # Supports: strings, ints, floats, booleans.
    cfg: dict = {}
    cur: dict = cfg
    section: list[str] = []

    def set_in(d: dict, keys: list[str], k: str, v):
        node = d
        for kk in keys:
            node = node.setdefault(kk, {})
        node[k] = v

    def parse_value(s: str):
        s = s.strip()
        if not s:
            return ""
        if s.lower() in {"true", "false"}:
            return s.lower() == "true"
        if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
            return s[1:-1]
        # number
        try:
            if "." in s or "e" in s.lower():
                return float(s)
            return int(s)
        except Exception:
            return s

    with open(path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("[") and line.endswith("]"):
                sec = line[1:-1].strip()
                section = [x.strip() for x in sec.split(".") if x.strip()]
                continue
            if "=" not in line:
                continue
            k, v = line.split("=", 1)
            k = k.strip()
            # strip inline comment
            v = v.split("#", 1)[0].strip()
            set_in(cfg, section, k, parse_value(v))

    return cfg


def _default_config_path() -> str:
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(here), "config.toml")


def _parse_group(p: Path) -> str:
    m = FNAME_RE.search(p.name)
    if not m:
        return "unknown"
    return m.group("group")


@dataclass
class TestResult:
    test: str
    p_value: float
    statistic: float | None = None


def _holm_bonferroni(p_values: Sequence[float]) -> list[float]:
    m = len(p_values)
    order = sorted(range(m), key=lambda i: p_values[i])
    adj = [0.0] * m
    prev = 0.0
    for k, i in enumerate(order):
        raw = p_values[i]
        val = (m - k) * raw
        val = max(val, prev)
        prev = val
        adj[i] = min(val, 1.0)
    return adj


def _choose_method(n_groups: int, method: Method, cfg: dict) -> str:
    if method != "auto":
        return method
    m2 = _deep_get(cfg, ["stats", "default_2_groups"], "ttest")
    m3 = _deep_get(cfg, ["stats", "default_3plus_groups"], "kruskal")
    return str(m2) if n_groups == 2 else str(m3)


def _run_overall(groups: List[str], values: List[float], method: str) -> TestResult:
    import numpy as np
    from scipy import stats

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

    if method == "anova":
        stat, p = stats.f_oneway(*arrays)
        return TestResult("One-way ANOVA", float(p), float(stat))
    if method == "kruskal":
        stat, p = stats.kruskal(*arrays)
        return TestResult("Kruskal–Wallis", float(p), float(stat))

    _die(f"method '{method}' incompatible with {len(uniq)} groups")


def _run_pairwise(groups: List[str], values: List[float], base_method: str, correction: str) -> List[dict]:
    import numpy as np
    from scipy import stats

    uniq = sorted(set(groups))
    by = {u: np.asarray([v for g, v in zip(groups, values) if g == u], dtype=float) for u in uniq}

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


def _mean_sem(arr) -> Tuple[float, float]:
    import numpy as np

    x = np.asarray(arr, dtype=float)
    x = x[np.isfinite(x)]
    if x.size == 0:
        return (math.nan, math.nan)
    mean = float(np.mean(x))
    sem = float(np.std(x, ddof=1) / math.sqrt(x.size)) if x.size > 1 else 0.0
    return mean, sem


def _p_to_stars(p: float) -> str:
    if p <= 1e-4:
        return "****"
    if p <= 1e-3:
        return "***"
    if p <= 1e-2:
        return "**"
    if p <= 5e-2:
        return "*"
    return "ns"


def _add_sig_brackets(
    ax,
    order: list[str],
    d,
    y_col: str,
    comparisons: list[dict],
    cfg: dict,
    alpha: float,
) -> None:
    """Add pairwise significance brackets to an existing Axes.

    comparisons: list of dicts with keys: a, b, p (and optional p_adj).
    """

    import numpy as np

    if not comparisons:
        return

    show = bool(_deep_get(cfg, ["annotate", "show"], True))
    if not show:
        return

    use_adj = bool(_deep_get(cfg, ["annotate", "use_p_adj"], True))
    show_ns = bool(_deep_get(cfg, ["annotate", "show_ns"], False))
    only_sig = bool(_deep_get(cfg, ["annotate", "only_sig"], True))
    max_pairs = int(_deep_get(cfg, ["annotate", "max_pairs"], 10))
    fmt = str(_deep_get(cfg, ["annotate", "label_format"], "stars+p")).lower()

    # choose which p to display
    def pick_p(row: dict) -> float:
        if use_adj and ("p_adj" in row) and (row["p_adj"] is not None):
            return float(row["p_adj"])
        return float(row["p"])

    rows = []
    for r in comparisons:
        p = pick_p(r)
        if only_sig and p > alpha:
            continue
        if (not show_ns) and _p_to_stars(p) == "ns":
            continue
        rows.append((r["a"], r["b"], p))

    if not rows:
        return

    rows = rows[:max_pairs]

    # map group -> x position
    x_of = {g: i for i, g in enumerate(order)}

    # compute baseline height
    y = d[y_col].astype(float).to_numpy()
    y = y[np.isfinite(y)]
    if y.size == 0:
        return
    y_min = float(np.min(y))
    y_max = float(np.max(y))
    yr = y_max - y_min
    if yr <= 0:
        yr = 1.0

    base = y_max + 0.05 * yr
    step = float(_deep_get(cfg, ["annotate", "step"], 0.08)) * yr
    h = float(_deep_get(cfg, ["annotate", "bracket_height"], 0.02)) * yr

    for k, (a, b, p) in enumerate(rows):
        if a not in x_of or b not in x_of:
            continue
        x1, x2 = x_of[a], x_of[b]
        if x1 == x2:
            continue
        if x1 > x2:
            x1, x2 = x2, x1

        yk = base + k * step

        # bracket
        ax.plot([x1, x1, x2, x2], [yk, yk + h, yk + h, yk], lw=1.2, c="black")

        stars = _p_to_stars(p)
        ptxt = f"p={p:.3g}"
        if fmt == "stars":
            label = stars
        elif fmt == "p":
            label = ptxt
        else:
            label = f"{stars}\n{ptxt}" if stars != "ns" else ptxt

        ax.text(
            (x1 + x2) / 2,
            yk + h,
            label,
            ha="center",
            va="bottom",
            fontsize=float(_deep_get(cfg, ["annotate", "fontsize"], 9)),
        )

    # make room on top
    ax.set_ylim(top=base + (len(rows) + 1) * step)


def _make_violin(
    df,
    param: str,
    out_path: Path,
    cfg: dict,
    title: str,
    comparisons: list[dict] | None = None,
    alpha: float = 0.05,
) -> None:
    import numpy as np
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns

    style = _deep_get(cfg, ["plot", "style"], "whitegrid")
    context = _deep_get(cfg, ["plot", "context"], "notebook")
    sns.set_theme(style=style, context=context)

    palette = _deep_get(cfg, ["plot", "palette"], "Set2")

    fig_w = float(_deep_get(cfg, ["plot", "fig_width"], 10))
    fig_h = float(_deep_get(cfg, ["plot", "fig_height"], 5))
    cut = float(_deep_get(cfg, ["plot", "cut"], 0))

    summary = str(_deep_get(cfg, ["plot", "summary"], "mean_sem")).lower()
    inner = None
    if summary in {"box", "quartile"}:
        inner = "box" if summary == "box" else "quartile"

    d = df[["group", param]].dropna().copy()
    d = d[np.isfinite(d[param].astype(float))]

    # keep a stable group order (alphabetical) for consistent bracket placement
    order = sorted(d["group"].astype(str).unique().tolist())

    plt.figure(figsize=(fig_w, fig_h))
    ax = sns.violinplot(
        data=d,
        x="group",
        y=param,
        inner=inner,
        cut=cut,
        palette=palette,
        order=order,
    )

    if bool(_deep_get(cfg, ["plot", "show_points"], True)):
        sns.stripplot(
            data=d,
            x="group",
            y=param,
            color=_deep_get(cfg, ["plot", "point_color"], "black"),
            size=float(_deep_get(cfg, ["plot", "point_size"], 3)),
            alpha=float(_deep_get(cfg, ["plot", "point_alpha"], 0.4)),
            jitter=float(_deep_get(cfg, ["plot", "point_jitter"], 0.2)),
            order=order,
        )

    if summary == "mean_sem":
        uniq = order
        xs = np.arange(len(uniq))
        col = _deep_get(cfg, ["plot", "summary_color"], "black")
        cap = float(_deep_get(cfg, ["plot", "summary_capsize"], 4))
        lw = float(_deep_get(cfg, ["plot", "summary_linewidth"], 1.5))

        centers = []
        errs = []
        for u in uniq:
            arr = d.loc[d["group"].astype(str) == u, param].astype(float).to_numpy()
            m, sem = _mean_sem(arr)
            centers.append(m)
            errs.append(sem)

        ax.errorbar(xs, centers, yerr=errs, fmt="o", color=col, capsize=cap, lw=lw, ms=4, zorder=10)

    # significance brackets (pairwise) — default uses adjusted p if available
    if comparisons:
        _add_sig_brackets(ax, order=order, d=d, y_col=param, comparisons=comparisons, cfg=cfg, alpha=alpha)

    ax.set_xlabel("Group")
    ax.set_ylabel(param)
    ax.set_title(title)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    dpi = int(_deep_get(cfg, ["dump", "png_dpi"], 200))
    save_pdf = bool(_deep_get(cfg, ["dump", "save_pdf"], False))

    plt.tight_layout()

    # Always save PNG
    png_path = out_path
    if png_path.suffix.lower() != ".png":
        png_path = png_path.with_suffix(".png")
    plt.savefig(str(png_path), dpi=dpi)

    # Optionally save PDF alongside
    if save_pdf:
        pdf_path = png_path.with_suffix(".pdf")
        plt.savefig(str(pdf_path))

    plt.close()


def _read_one_file(p: Path) -> Dict[str, float]:
    import numpy as np
    import h5py

    row: Dict[str, float] = {}
    with h5py.File(str(p), "r") as f:
        # AdvancedParameters
        if "AdvancedParameters" in f and "ParameterName" in f["AdvancedParameters"]:
            names = [x.decode() if isinstance(x, (bytes, np.bytes_)) else str(x) for x in f["AdvancedParameters/ParameterName"][()]]
            vals = np.asarray(f["AdvancedParameters/ParameterData"][()], dtype=float)
            for n, v in zip(names, vals):
                row[str(n)] = float(v)

        # KinematicParameter means
        if "KinematicParameter" in f and "ParameterName" in f["KinematicParameter"]:
            names = [x.decode() if isinstance(x, (bytes, np.bytes_)) else str(x) for x in f["KinematicParameter/ParameterName"][()]]
            data = np.asarray(f["KinematicParameter/ParameterData"], dtype=float)  # (frames, params)
            means = np.nanmean(data, axis=0)
            for n, v in zip(names, means):
                row[f"mean_{str(n)}"] = float(v)

    return row


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", required=True, help="Folder containing .h5 files")
    p.add_argument(
        "--out-dir",
        default="",
        help="Output folder (default: <input-dir>/results/violin_chart)",
    )
    p.add_argument(
        "--config",
        default="",
        help="Path to config.toml (default: ../config.toml relative to this script)",
    )
    p.add_argument(
        "--method",
        default="auto",
        choices=["auto", "ttest", "mannwhitney", "anova", "kruskal"],
        help="Override stat method; auto uses config defaults",
    )
    p.add_argument("--alpha", type=float, default=0.05)
    p.add_argument("--glob", default="*.h5", help="Glob pattern for input files")
    return p


def main(argv: Sequence[str]) -> int:
    args = build_parser().parse_args(list(argv))

    cfg_path = args.config.strip() or _default_config_path()
    cfg = _load_toml(cfg_path)

    alpha = float(_deep_get(cfg, ["stats", "alpha"], args.alpha))
    args.alpha = alpha

    in_dir = Path(args.input_dir)
    if not in_dir.exists():
        _die(f"input-dir not found: {in_dir}")

    out_dir = Path(args.out_dir) if args.out_dir.strip() else (in_dir / "results" / "violin_chart")
    out_dir.mkdir(parents=True, exist_ok=True)

    h5_paths = sorted(in_dir.glob(args.glob))
    if not h5_paths:
        _die(f"no files matched: {in_dir / args.glob}")

    import pandas as pd

    rows = []
    for p in h5_paths:
        group = _parse_group(p)
        base = {"file": str(p), "record": p.stem, "group": group}
        try:
            base.update(_read_one_file(p))
        except Exception as e:
            # keep going; some files may be header-only
            base["_error"] = str(e)
        rows.append(base)

    df = pd.DataFrame(rows)

    # determine parameter columns
    meta_cols = {"file", "record", "group", "_error"}
    params = [c for c in df.columns if c not in meta_cols]
    params = [c for c in params if df[c].dropna().shape[0] > 0]

    if not params:
        _die("no parameters found in H5 files (AdvancedParameters/KinematicParameter missing?)")

    stats_rows = []
    pair_rows = []

    for param in params:
        d = df[["group", param]].dropna().copy()
        try:
            d[param] = d[param].astype(float)
        except Exception:
            continue
        d = d[~d[param].isna()]
        if d.shape[0] < 2:
            continue
        groups = d["group"].astype(str).tolist()
        vals = d[param].astype(float).tolist()
        uniq = sorted(set(groups))
        if len(uniq) < 2:
            continue

        method = _choose_method(len(uniq), args.method, cfg)
        overall = _run_overall(groups, vals, method)

        correction = str(_deep_get(cfg, ["stats", "pairwise_correction"], "holm"))
        pairwise_only_if_sig = bool(_deep_get(cfg, ["stats", "pairwise_only_if_overall_sig"], True))

        pairwise = []
        if len(uniq) >= 3:
            if (not pairwise_only_if_sig) or (overall.p_value <= args.alpha):
                pairwise = _run_pairwise(groups, vals, method, correction=correction)

        stats_rows.append(
            {
                "param": param,
                "n": int(len(vals)),
                "groups": ",".join(uniq),
                "method": method,
                "overall_test": overall.test,
                "overall_p": overall.p_value,
                "overall_stat": overall.statistic,
            }
        )
        for r in pairwise:
            r2 = dict(r)
            r2["param"] = param
            pair_rows.append(r2)

        title = f"{param} | {overall.test} p={overall.p_value:.3g}"
        out_path = out_dir / f"violin_{param}.png"

        # choose comparisons to annotate on plot
        # - if 2 groups: annotate the single overall test p
        # - if 3+ groups: annotate pairwise results (adjusted p by default)
        comparisons_for_plot: list[dict] = []
        if len(uniq) == 2:
            a, b = uniq[0], uniq[1]
            comparisons_for_plot = [{"a": a, "b": b, "p": float(overall.p_value)}]
        else:
            comparisons_for_plot = list(pairwise)

        _make_violin(
            df,
            param,
            out_path,
            cfg,
            title,
            comparisons=comparisons_for_plot,
            alpha=args.alpha,
        )

    # dump stats
    if stats_rows:
        pd.DataFrame(stats_rows).to_csv(out_dir / "stats_overall.csv", index=False, encoding="utf-8-sig")
    if pair_rows:
        pd.DataFrame(pair_rows).to_csv(out_dir / "stats_pairwise.csv", index=False, encoding="utf-8-sig")

    print(f"Done. Plots saved to: {out_dir}")
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
