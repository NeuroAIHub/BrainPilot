#!/usr/bin/env python3
"""Extract and merge ABCD Study phenotype tables for downstream analysis.

Reads ABCD tab-delimited phenotype files, selects columns, aligns visits,
and optionally cross-references with imaging subject lists.
"""
import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set

try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required. Install with: pip install pandas", file=sys.stderr)
    sys.exit(1)

# Standard ABCD event names in temporal order
ABCD_EVENTS = [
    "baselineYear1Arm1",
    "1YearFollowUpYArm1",
    "2YearFollowUpYArm1",
    "3YearFollowUpYArm1",
    "4YearFollowUpYArm1",
]

# Default phenotype files to look for
DEFAULT_PHENOTYPE_FILES = [
    "abcd_p_tab.csv",
    "abcd_p_tab.tsv",
    "mental_health.csv",
    "mental_health.tsv",
    "cbcl.csv",
    "cbcl.tsv",
    "ksads.csv",
    "ksads.tsv",
    "nihtb.csv",
    "nihtb.tsv",
    "abcd_imgincl01.csv",
    "abcd_imgincl01.tsv",
]


def detect_delimiter(file_path: Path) -> str:
    """Detect whether file uses tab or comma delimiter."""
    with open(file_path, "r", encoding="utf-8") as f:
        first_line = f.readline()
    if "\t" in first_line:
        return "\t"
    return ","


def read_phenotype_file(file_path: Path) -> Optional["pd.DataFrame"]:
    """Read a single ABCD phenotype file."""
    delimiter = detect_delimiter(file_path)
    try:
        df = pd.read_csv(file_path, sep=delimiter, low_memory=False)
        return df
    except Exception as e:
        print(f"[WARN] Failed to read {file_path}: {e}", file=sys.stderr)
        return None


def find_common_columns(dataframes: List["pd.DataFrame"]) -> List[str]:
    """Find columns present in all dataframes."""
    if not dataframes:
        return []
    common = set(dataframes[0].columns)
    for df in dataframes[1:]:
        common &= set(df.columns)
    return sorted(common)


def merge_phenotype_tables(
    phenotype_dir: Path,
    columns: Optional[List[str]] = None,
    events: Optional[List[str]] = None,
    imaging_ids: Optional[Set[str]] = None,
    drop_missing_threshold: float = 0.5,
) -> "pd.DataFrame":
    """Merge multiple ABCD phenotype tables.

    Args:
        phenotype_dir: Directory containing phenotype CSV/TSV files.
        columns: Specific columns to select (None = all).
        events: ABCD event names to include (None = all).
        imaging_ids: Set of subject IDs from imaging data to filter by.
        drop_missing_threshold: Drop columns with > this fraction of missing values.

    Returns:
        Merged DataFrame.
    """
    phenotype_files = []
    for f in sorted(phenotype_dir.iterdir()):
        if f.is_file() and f.suffix in (".csv", ".tsv"):
            phenotype_files.append(f)

    if not phenotype_files:
        # Try default filenames
        for name in DEFAULT_PHENOTYPE_FILES:
            candidate = phenotype_dir / name
            if candidate.exists():
                phenotype_files.append(candidate)

    if not phenotype_files:
        print(f"[ERROR] No phenotype files found in {phenotype_dir}", file=sys.stderr)
        return pd.DataFrame()

    print(f"Found {len(phenotype_files)} phenotype files:")
    for f in phenotype_files:
        print(f"  - {f.name}")

    # Read all files
    dataframes = []
    for f in phenotype_files:
        df = read_phenotype_file(f)
        if df is not None and len(df) > 0:
            # Standardize ID column name
            if "src_subject_id" in df.columns:
                df = df.rename(columns={"src_subject_id": "subject_id"})
            elif "SUBJECTKEY" in df.columns:
                df = df.rename(columns={"SUBJECTKEY": "subject_id"})
            dataframes.append(df)

    if not dataframes:
        return pd.DataFrame()

    # Find common columns across all tables
    common_cols = find_common_columns(dataframes)
    print(f"Common columns across all tables: {len(common_cols)}")

    # Merge on subject_id + eventname
    merge_keys = []
    if "subject_id" in common_cols:
        merge_keys.append("subject_id")
    if "eventname" in common_cols:
        merge_keys.append("eventname")

    if not merge_keys:
        print("[WARN] No merge keys found (subject_id/eventname). Concatenating instead.")
        merged = pd.concat(dataframes, ignore_index=True)
    else:
        merged = dataframes[0]
        for df in dataframes[1:]:
            # Columns to merge (excluding merge keys and duplicates)
            new_cols = [c for c in df.columns if c not in merged.columns or c in merge_keys]
            df_subset = df[new_cols]
            merged = pd.merge(merged, df_subset, on=merge_keys, how="outer", suffixes=("", "_dup"))

    # Drop duplicate columns
    dup_cols = [c for c in merged.columns if c.endswith("_dup")]
    if dup_cols:
        merged = merged.drop(columns=dup_cols)

    # Filter by events
    if events and "eventname" in merged.columns:
        merged = merged[merged["eventname"].isin(events)]
        print(f"Filtered to events: {events} -> {len(merged)} rows")

    # Filter by imaging IDs
    if imaging_ids and "subject_id" in merged.columns:
        # Normalize imaging IDs for matching
        normalized_imaging = set()
        for sid in imaging_ids:
            clean = sid.replace("sub-", "")
            normalized_imaging.add(clean)
            normalized_imaging.add(sid)

        before_count = len(merged)
        mask = merged["subject_id"].apply(
            lambda x: str(x).strip() in normalized_imaging
            or f"sub-{str(x).strip()}" in normalized_imaging
        )
        merged = merged[mask]
        print(f"Filtered to imaging subjects: {before_count} -> {len(merged)} rows")

    # Select specific columns
    if columns:
        available = [c for c in columns if c in merged.columns]
        missing = [c for c in columns if c not in merged.columns]
        if missing:
            print(f"[WARN] Columns not found (skipped): {missing}")
        if available:
            merged = merged[available]

    # Drop columns with too many missing values
    if drop_missing_threshold < 1.0:
        missing_frac = merged.isnull().mean()
        cols_to_drop = missing_frac[missing_frac > drop_missing_threshold].index.tolist()
        if cols_to_drop:
            print(f"Dropping {len(cols_to_drop)} columns with >{drop_missing_threshold*100}% missing")
            merged = merged.drop(columns=cols_to_drop)

    return merged


def load_imaging_ids(imaging_ids_file: Path) -> Set[str]:
    """Load subject IDs from a BIDS participants.tsv or similar file."""
    ids = set()
    delimiter = detect_delimiter(imaging_ids_file)
    try:
        df = pd.read_csv(imaging_ids_file, sep=delimiter)
        id_col = None
        for col_name in ["participant_id", "subject_id", "SUBJECTKEY", "src_subject_id"]:
            if col_name in df.columns:
                id_col = col_name
                break
        if id_col:
            ids = set(df[id_col].astype(str).str.strip())
    except Exception as e:
        print(f"[WARN] Failed to read imaging IDs: {e}", file=sys.stderr)
    return ids


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract and merge ABCD Study phenotype tables."
    )
    parser.add_argument(
        "--phenotype-dir",
        required=True,
        help="Directory containing ABCD phenotype CSV/TSV files",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output path for merged phenotype CSV",
    )
    parser.add_argument(
        "--columns",
        help="Comma-separated list of columns to select (default: all)",
    )
    parser.add_argument(
        "--events",
        help=f"Comma-separated ABCD event names to include. Options: {', '.join(ABCD_EVENTS)}",
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
    args = parser.parse_args()

    phenotype_dir = Path(args.phenotype_dir).resolve()
    if not phenotype_dir.exists() or not phenotype_dir.is_dir():
        print(f"Phenotype directory does not exist: {phenotype_dir}", file=sys.stderr)
        return 1

    # Parse options
    columns = None
    if args.columns:
        columns = [c.strip() for c in args.columns.split(",")]

    events = None
    if args.events:
        events = [e.strip() for e in args.events.split(",")]

    imaging_ids = None
    if args.imaging_ids:
        imaging_ids_path = Path(args.imaging_ids).resolve()
        if imaging_ids_path.exists():
            imaging_ids = load_imaging_ids(imaging_ids_path)
            print(f"Loaded {len(imaging_ids)} imaging subject IDs")

    # Merge phenotype tables
    merged = merge_phenotype_tables(
        phenotype_dir=phenotype_dir,
        columns=columns,
        events=events,
        imaging_ids=imaging_ids,
        drop_missing_threshold=args.missing_threshold,
    )

    if merged.empty:
        print("[ERROR] No data after merging. Check input files.", file=sys.stderr)
        return 1

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(output_path, index=False)
    print(f"\nWrote {len(merged)} rows x {len(merged.columns)} columns to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
