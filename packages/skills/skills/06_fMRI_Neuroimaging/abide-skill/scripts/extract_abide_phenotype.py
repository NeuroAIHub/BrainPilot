#!/usr/bin/env python3
"""Extract and merge ABIDE phenotype tables for downstream analysis.

Reads ABIDE phenotype CSV files, standardizes diagnosis labels,
selects columns, and optionally cross-references with imaging subject lists.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set

try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required. Install with: pip install pandas", file=sys.stderr)
    sys.exit(1)


# ABIDE column name standardization
COLUMN_MAP = {
    "SUBJECT_ID": "subject_id",
    "subject": "subject_id",
    "Subject": "subject_id",
    "DX_GROUP": "diagnosis",
    "DX": "diagnosis",
    "AGE_AT_SCAN": "age",
    "AGE": "age",
    "SEX": "sex",
    "FIQ": "fiq",
    "VIQ": "viq",
    "PIQ": "piq",
    "SITE_ID": "site",
    "SITE": "site",
    "HANDEDNESS_CATEGORY": "handedness",
    "HANDEDNESS": "handedness",
}

# Diagnosis label mapping
DIAGNOSIS_MAP = {
    "1": "ASD",
    "2": "control",
    1: "ASD",
    2: "control",
    "ASD": "ASD",
    "Control": "control",
    "CONTROL": "control",
    "TD": "control",
}


def read_phenotype_file(file_path: Path) -> Optional["pd.DataFrame"]:
    """Read an ABIDE phenotype file."""
    try:
        # Try tab first, then comma
        df = pd.read_csv(file_path, sep=None, engine="python", low_memory=False)
        return df
    except Exception as e:
        print(f"[WARN] Failed to read {file_path}: {e}", file=sys.stderr)
        return None


def standardize_columns(df: "pd.DataFrame") -> "pd.DataFrame":
    """Standardize ABIDE column names."""
    rename_map = {}
    for old_name, new_name in COLUMN_MAP.items():
        if old_name in df.columns and new_name not in df.columns:
            rename_map[old_name] = new_name
    if rename_map:
        df = df.rename(columns=rename_map)
    return df


def standardize_diagnosis(df: "pd.DataFrame") -> "pd.DataFrame":
    """Standardize diagnosis labels."""
    if "diagnosis" in df.columns:
        df["diagnosis"] = df["diagnosis"].map(DIAGNOSIS_MAP).fillna(df["diagnosis"])
    return df


def normalize_subject_id(raw_id) -> str:
    """Normalize subject ID for matching."""
    clean = str(raw_id).strip()
    if clean.startswith("sub-"):
        clean = clean[4:]
    # Remove non-alphanumeric characters
    import re
    clean = re.sub(r"[^a-zA-Z0-9]", "", clean)
    return f"sub-{clean}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract and merge ABIDE phenotype tables."
    )
    parser.add_argument(
        "--phenotype-dir",
        help="Directory containing ABIDE phenotype CSV files",
    )
    parser.add_argument(
        "--phenotype-file",
        help="Direct path to ABIDE phenotype CSV file",
    )
    parser.add_argument(
        "--output", required=True, help="Output path for merged phenotype CSV"
    )
    parser.add_argument(
        "--columns",
        help="Comma-separated list of columns to select (default: all common columns)",
    )
    parser.add_argument(
        "--imaging-ids",
        help="Path to BIDS participants.tsv or file with imaging subject IDs",
    )
    parser.add_argument(
        "--missing-threshold",
        type=float,
        default=0.5,
        help="Drop columns with more than this fraction of missing values (default: 0.5)",
    )
    parser.add_argument(
        "--abide-version",
        default="I",
        help="ABIDE version: I or II (default: I)",
    )
    args = parser.parse_args()

    # Find phenotype files
    phenotype_files = []
    if args.phenotype_file:
        p = Path(args.phenotype_file).resolve()
        if p.exists():
            phenotype_files.append(p)
        else:
            print(f"Phenotype file not found: {p}", file=sys.stderr)
            return 1
    elif args.phenotype_dir:
        phenotype_dir = Path(args.phenotype_dir).resolve()
        if phenotype_dir.exists():
            for f in sorted(phenotype_dir.iterdir()):
                if f.is_file() and f.suffix in (".csv", ".tsv"):
                    phenotype_files.append(f)
        else:
            print(f"Phenotype directory not found: {phenotype_dir}", file=sys.stderr)
            return 1
    else:
        print("Error: specify --phenotype-file or --phenotype-dir", file=sys.stderr)
        return 1

    if not phenotype_files:
        print("[ERROR] No phenotype files found.", file=sys.stderr)
        return 1

    print(f"Found {len(phenotype_files)} phenotype file(s):")
    for f in phenotype_files:
        print(f"  - {f.name}")

    # Read and merge
    dataframes = []
    for f in phenotype_files:
        df = read_phenotype_file(f)
        if df is not None and len(df) > 0:
            df = standardize_columns(df)
            df = standardize_diagnosis(df)
            dataframes.append(df)

    if not dataframes:
        print("[ERROR] No data loaded.", file=sys.stderr)
        return 1

    # Merge: concatenate if same columns, merge if different
    if len(dataframes) == 1:
        merged = dataframes[0]
    else:
        # Try merge on subject_id
        common_cols = set(dataframes[0].columns)
        for df in dataframes[1:]:
            common_cols &= set(df.columns)

        if "subject_id" in common_cols:
            merged = dataframes[0]
            for df in dataframes[1:]:
                new_cols = [c for c in df.columns if c not in merged.columns or c == "subject_id"]
                merged = pd.merge(merged, df[new_cols], on="subject_id", how="outer", suffixes=("", "_dup"))
            # Drop duplicate columns
            dup_cols = [c for c in merged.columns if c.endswith("_dup")]
            if dup_cols:
                merged = merged.drop(columns=dup_cols)
        else:
            merged = pd.concat(dataframes, ignore_index=True)

    # Filter by imaging IDs
    if args.imaging_ids:
        imaging_path = Path(args.imaging_ids).resolve()
        if imaging_path.exists():
            imaging_ids = set()
            try:
                id_df = pd.read_csv(imaging_path, sep="\t")
                for col in ["participant_id", "subject_id", "SUBJECT_ID"]:
                    if col in id_df.columns:
                        imaging_ids = set(id_df[col].astype(str).str.strip())
                        break
            except Exception:
                pass

            if imaging_ids and "subject_id" in merged.columns:
                # Normalize for matching
                normalized = set()
                for sid in imaging_ids:
                    normalized.add(normalize_subject_id(sid))
                    normalized.add(sid)

                before_count = len(merged)
                merged["_norm_id"] = merged["subject_id"].apply(normalize_subject_id)
                mask = merged["_norm_id"].isin(normalized) | merged["subject_id"].astype(str).isin(normalized)
                merged = merged[mask].drop(columns=["_norm_id"])
                print(f"Filtered to imaging subjects: {before_count} -> {len(merged)} rows")

    # Select specific columns
    if args.columns:
        requested = [c.strip() for c in args.columns.split(",")]
        available = [c for c in requested if c in merged.columns]
        missing = [c for c in requested if c not in merged.columns]
        if missing:
            print(f"[WARN] Columns not found (skipped): {missing}")
        if available:
            # Always include subject_id
            if "subject_id" not in available and "subject_id" in merged.columns:
                available = ["subject_id"] + available
            merged = merged[available]

    # Drop columns with too many missing values
    if args.missing_threshold < 1.0:
        missing_frac = merged.isnull().mean()
        cols_to_drop = missing_frac[missing_frac > args.missing_threshold].index.tolist()
        # Keep subject_id and diagnosis
        cols_to_drop = [c for c in cols_to_drop if c not in ("subject_id", "diagnosis")]
        if cols_to_drop:
            print(f"Dropping {len(cols_to_drop)} columns with >{args.missing_threshold*100}% missing")
            merged = merged.drop(columns=cols_to_drop)

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(output_path, index=False)
    print(f"\nWrote {len(merged)} rows x {len(merged.columns)} columns to {output_path}")

    # Print summary stats
    if "diagnosis" in merged.columns:
        dx_counts = merged["diagnosis"].value_counts()
        print(f"\nDiagnosis distribution:")
        for dx, count in dx_counts.items():
            print(f"  {dx}: {count}")

    if "site" in merged.columns:
        site_counts = merged["site"].value_counts()
        print(f"\nSite distribution ({len(site_counts)} sites):")
        for site, count in site_counts.head(10).items():
            print(f"  {site}: {count}")
        if len(site_counts) > 10:
            print(f"  ... and {len(site_counts) - 10} more sites")

    return 0


if __name__ == "__main__":
    sys.exit(main())
