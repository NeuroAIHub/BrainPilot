#!/usr/bin/env python3
"""Generate QC summaries for UK Biobank brain-related data.

Tracks data completeness, imaging availability, and exclusion criteria.

Usage:
    python ukb_qc_summary.py --input ukb_raw.csv --output qc_summary.csv
    python ukb_qc_summary.py --input ukb_raw.csv --imaging-check --output qc_imaging.csv
"""
import argparse
import sys
from pathlib import Path
from typing import Dict, List

import pandas as pd


def check_completeness(df: pd.DataFrame, required_cols: List[str]) -> Dict:
    """Check data completeness for required columns."""
    stats = {}
    for col in required_cols:
        if col in df.columns:
            n_missing = df[col].isna().sum()
            stats[col] = {
                "n_present": len(df) - n_missing,
                "n_missing": n_missing,
                "pct_complete": (len(df) - n_missing) / len(df) * 100,
            }
        else:
            stats[col] = {"n_present": 0, "n_missing": len(df), "pct_complete": 0}
    return stats


def check_imaging_availability(df: pd.DataFrame) -> Dict:
    """Check brain imaging data availability."""
    imaging_checks = {
        "T1w": ["p25000_i0", "p25001_i0", "p25002_i0"],  # Brain volume IDPs
        "T2_FLAIR": ["p25004_i0"],  # WMH volume
        "dMRI": ["p25008_i0", "p25009_i0"],  # DTI IDPs
        "rsfMRI": ["p25010_i0", "p25011_i0"],  # fMRI IDPs
    }

    results = {}
    for modality, cols in imaging_checks.items():
        available = [c for c in cols if c in df.columns]
        if available:
            # Has data if at least one imaging column is non-null
            has_data = df[available].notna().any(axis=1).sum()
            results[modality] = {"n_available": has_data, "pct": has_data / len(df) * 100}
        else:
            results[modality] = {"n_available": 0, "pct": 0}

    return results


def generate_qc(
    df: pd.DataFrame,
    required_cols: List[str] = None,
    imaging_check: bool = False,
    age_range: tuple = None,
) -> pd.DataFrame:
    """Generate per-subject QC summary."""
    if required_cols is None:
        required_cols = ["p31", "p21022", "p21001_i0"]  # sex, age, bmi

    result = pd.DataFrame({"eid": df["eid"]})

    # Age filtering
    if age_range and "p21022" in df.columns:
        age = df["p21022"]
        result["in_age_range"] = ((age >= age_range[0]) & (age <= age_range[1])).astype(int)
    else:
        result["in_age_range"] = 1

    # Missing data count
    available_required = [c for c in required_cols if c in df.columns]
    if available_required:
        result["n_missing_covariates"] = df[available_required].isna().sum(axis=1)
        result["complete_covariates"] = (result["n_missing_covariates"] == 0).astype(int)
    else:
        result["n_missing_covariates"] = 0
        result["complete_covariates"] = 1

    # Imaging availability
    if imaging_check:
        imaging_cols = {
            "has_brain_volume": ["p25000_i0"],
            "has_gm_volume": ["p25001_i0"],
            "has_wm_volume": ["p25002_i0"],
            "has_hippocampus": ["p25003_i0"],
            "has_wmh": ["p25004_i0"],
        }
        for name, cols in imaging_cols.items():
            available = [c for c in cols if c in df.columns]
            if available:
                result[name] = df[available].notna().any(axis=1).astype(int)
            else:
                result[name] = 0

    # Overall QC pass
    qc_pass = (result["complete_covariates"] == 1) & (result["in_age_range"] == 1)
    result["qc_pass"] = qc_pass.astype(int)

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate UKB QC summary.")
    parser.add_argument("--input", required=True, help="Path to UKB raw CSV")
    parser.add_argument("--output", required=True, help="Output path for QC summary CSV")
    parser.add_argument("--imaging-check", action="store_true", help="Include imaging availability check")
    parser.add_argument("--age-min", type=float, default=None, help="Minimum age filter")
    parser.add_argument("--age-max", type=float, default=None, help="Maximum age filter")
    parser.add_argument("--required-cols", help="Comma-separated required column names")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    df = pd.read_csv(input_path, low_memory=False)
    print(f"Loaded {len(df)} subjects")

    required_cols = None
    if args.required_cols:
        required_cols = [c.strip() for c in args.required_cols.split(",")]

    age_range = None
    if args.age_min is not None and args.age_max is not None:
        age_range = (args.age_min, args.age_max)

    result = generate_qc(df, required_cols, args.imaging_check, age_range)

    # Summary
    n_total = len(result)
    n_pass = result["qc_pass"].sum()
    print(f"\nQC Summary:")
    print(f"  Total subjects: {n_total}")
    print(f"  QC pass: {n_pass} ({n_pass/n_total*100:.1f}%)")
    print(f"  QC fail: {n_total - n_pass} ({(n_total-n_pass)/n_total*100:.1f}%)")

    if args.imaging_check:
        for col in ["has_brain_volume", "has_gm_volume", "has_wm_volume", "has_hippocampus", "has_wmh"]:
            if col in result.columns:
                n = result[col].sum()
                print(f"  {col}: {n} ({n/n_total*100:.1f}%)")

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output_path, index=False)
    print(f"Saved -> {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
