#!/usr/bin/env python3
"""Harmonize multi-site neuroimaging data for REST-meta-MDD.

Provides reference implementations for site effect correction:
- ComBat harmonization
- Site-wise z-scoring
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np


def load_csv(path: Path) -> List[Dict[str, str]]:
    delimiter = "\t" if path.suffix == ".tsv" else ","
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        return list(reader)


def site_wise_zscore(
    data: np.ndarray,
    sites: np.ndarray,
) -> np.ndarray:
    """Apply site-wise z-score normalization."""
    harmonized = data.copy()
    unique_sites = np.unique(sites)
    for site in unique_sites:
        mask = sites == site
        site_data = data[mask]
        mean = np.nanmean(site_data, axis=0)
        std = np.nanstd(site_data, axis=0)
        std[std == 0] = 1  # avoid division by zero
        harmonized[mask] = (site_data - mean) / std
    return harmonized


def combat_harmonize(
    data: np.ndarray,
    sites: np.ndarray,
    covariates: Optional[np.ndarray] = None,
) -> np.ndarray:
    """ComBat harmonization (simplified reference implementation).

    For production use, consider the neuroCombat library:
    pip install neurocombat
    """
    try:
        from neuroCombat import neuroCombat
        import pandas as pd

        # Prepare data for neuroCombat
        df_data = pd.DataFrame(data)
        batch = sites.tolist()
        covars = None
        if covariates is not None:
            covars = pd.DataFrame(covariates, columns=["cov1"])

        result = neuroCombat(dat=df_data.T, batch=batch, covars=covars)
        return result["dat"].T
    except ImportError:
        print("[WARN] neuroCombat not installed, falling back to site-wise z-score.",
              file=sys.stderr)
        return site_wise_zscore(data, sites)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Harmonize multi-site neuroimaging data."
    )
    parser.add_argument("--input", required=True,
                        help="Input CSV/TSV with features (rows=subjects, cols=features)")
    parser.add_argument("--site-column", default="site",
                        help="Column name for site ID (default: site)")
    parser.add_argument("--method", choices=["zscore", "combat"], default="zscore",
                        help="Harmonization method (default: zscore)")
    parser.add_argument("--output", required=True,
                        help="Output path for harmonized data CSV")
    parser.add_argument("--covariates", help="CSV with covariates to preserve")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    rows = load_csv(input_path)
    if not rows:
        print("[ERROR] No data loaded.", file=sys.stderr)
        return 1

    # Extract subject IDs and sites
    subject_ids = [r.get("subject_id", r.get("subject", f"sub-{i}")) for i, r in enumerate(rows)]
    sites = np.array([r.get(args.site_column, "unknown") for r in rows])

    # Extract numeric feature columns
    feature_cols = [c for c in rows[0].keys()
                    if c not in ("subject_id", "subject", args.site_column)
                    and c not in ("diagnosis", "group", "age", "sex")]

    data = np.zeros((len(rows), len(feature_cols)))
    for i, row in enumerate(rows):
        for j, col in enumerate(feature_cols):
            try:
                data[i, j] = float(row.get(col, "nan"))
            except ValueError:
                data[i, j] = np.nan

    # Harmonize
    if args.method == "combat":
        covariates = None
        if args.covariates:
            cov_path = Path(args.covariates).resolve()
            if cov_path.exists():
                cov_rows = load_csv(cov_path)
                cov_cols = [c for c in cov_rows[0].keys() if c != "subject_id"]
                covariates = np.zeros((len(cov_rows), len(cov_cols)))
                for i, row in enumerate(cov_rows):
                    for j, col in enumerate(cov_cols):
                        try:
                            covariates[i, j] = float(row.get(col, "0"))
                        except ValueError:
                            covariates[i, j] = 0.0
        harmonized = combat_harmonize(data, sites, covariates)
    else:
        harmonized = site_wise_zscore(data, sites)

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["subject_id"] + feature_cols
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for i, sid in enumerate(subject_ids):
            row = {"subject_id": sid}
            for j, col in enumerate(feature_cols):
                row[col] = f"{harmonized[i, j]:.6f}"
            writer.writerow(row)

    unique_sites = np.unique(sites)
    print(f"Harmonized: {len(rows)} subjects, {len(feature_cols)} features, "
          f"{len(unique_sites)} sites (method={args.method}) -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
