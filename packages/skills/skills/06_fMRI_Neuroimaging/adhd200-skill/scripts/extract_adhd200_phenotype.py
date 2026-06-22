#!/usr/bin/env python3
"""Extract and merge ADHD-200 phenotype tables for downstream analysis."""
import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set

try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required. Install with: pip install pandas", file=sys.stderr)
    sys.exit(1)

COLUMN_MAP = {
    "subject": "subject_id",
    "SUBJECT_ID": "subject_id",
    "Subject": "subject_id",
    "DX": "diagnosis",
    "DX_GROUP": "diagnosis",
    "AGE": "age",
    "AGE_AT_SCAN": "age",
    "SEX": "sex",
    "ADHD_Index": "adhd_index",
    "Inatt": "inattention",
    "HyperImp": "hyperactivity",
    "SITE_ID": "site",
    "HANDEDNESS": "handedness",
}


def normalize_subject_id(raw_id) -> str:
    clean = re.sub(r"[^a-zA-Z0-9]", "", str(raw_id).strip())
    return f"sub-{clean}"


def read_phenotype_file(file_path: Path) -> Optional["pd.DataFrame"]:
    try:
        return pd.read_csv(file_path, sep=None, engine="python", low_memory=False)
    except Exception as e:
        print(f"[WARN] Failed to read {file_path}: {e}", file=sys.stderr)
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract and merge ADHD-200 phenotype tables.")
    parser.add_argument("--phenotype-dir", help="Directory containing ADHD-200 phenotype CSV files")
    parser.add_argument("--phenotype-file", help="Direct path to ADHD-200 phenotype CSV file")
    parser.add_argument("--output", required=True, help="Output path for merged phenotype CSV")
    parser.add_argument("--columns", help="Comma-separated list of columns to select (default: all)")
    parser.add_argument("--imaging-ids", help="Path to BIDS participants.tsv for imaging subject filtering")
    parser.add_argument("--missing-threshold", type=float, default=0.5, help="Drop columns with > this fraction missing")
    args = parser.parse_args()

    phenotype_files = []
    if args.phenotype_file:
        p = Path(args.phenotype_file).resolve()
        if p.exists():
            phenotype_files.append(p)
    elif args.phenotype_dir:
        phenotype_dir = Path(args.phenotype_dir).resolve()
        if phenotype_dir.exists():
            phenotype_files = sorted(f for f in phenotype_dir.iterdir() if f.is_file() and f.suffix in (".csv", ".tsv"))

    if not phenotype_files:
        print("[ERROR] No phenotype files found.", file=sys.stderr)
        return 1

    print(f"Found {len(phenotype_files)} phenotype file(s)")

    dataframes = []
    for f in phenotype_files:
        df = read_phenotype_file(f)
        if df is not None and len(df) > 0:
            rename = {k: v for k, v in COLUMN_MAP.items() if k in df.columns and v not in df.columns}
            df = df.rename(columns=rename)
            dataframes.append(df)

    if not dataframes:
        print("[ERROR] No data loaded.", file=sys.stderr)
        return 1

    merged = dataframes[0]
    for df in dataframes[1:]:
        if "subject_id" in merged.columns and "subject_id" in df.columns:
            new_cols = [c for c in df.columns if c not in merged.columns or c == "subject_id"]
            merged = pd.merge(merged, df[new_cols], on="subject_id", how="outer", suffixes=("", "_dup"))
            dup_cols = [c for c in merged.columns if c.endswith("_dup")]
            if dup_cols:
                merged = merged.drop(columns=dup_cols)
        else:
            merged = pd.concat([merged, df], ignore_index=True)

    if args.imaging_ids:
        imaging_path = Path(args.imaging_ids).resolve()
        if imaging_path.exists() and "subject_id" in merged.columns:
            id_df = pd.read_csv(imaging_path, sep="\t")
            for col in ["participant_id", "subject_id"]:
                if col in id_df.columns:
                    imaging_ids = set(id_df[col].astype(str).str.strip())
                    normalized = {normalize_subject_id(sid) for sid in imaging_ids} | imaging_ids
                    merged["_norm"] = merged["subject_id"].apply(normalize_subject_id)
                    merged = merged[merged["_norm"].isin(normalized) | merged["subject_id"].astype(str).isin(normalized)]
                    merged = merged.drop(columns=["_norm"])
                    break

    if args.columns:
        requested = [c.strip() for c in args.columns.split(",")]
        available = [c for c in requested if c in merged.columns]
        if "subject_id" not in available and "subject_id" in merged.columns:
            available = ["subject_id"] + available
        if available:
            merged = merged[available]

    if args.missing_threshold < 1.0:
        missing_frac = merged.isnull().mean()
        cols_to_drop = [c for c in missing_frac[missing_frac > args.missing_threshold].index if c not in ("subject_id", "diagnosis")]
        if cols_to_drop:
            merged = merged.drop(columns=cols_to_drop)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(output_path, index=False)
    print(f"\nWrote {len(merged)} rows x {len(merged.columns)} columns to {output_path}")

    if "diagnosis" in merged.columns:
        print(f"\nDiagnosis distribution:\n{merged['diagnosis'].value_counts().to_string()}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
