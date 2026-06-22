#!/usr/bin/env python3
"""Extract and merge MND phenotype data.

Reads MND phenotype files (diagnosis, clinical measures)
and produces a merged phenotype table aligned with imaging subject list.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional

# Column mapping for MND phenotype data
COLUMN_MAP = {
    "subject_id": ["subject", "Subject", "participant_id", "SubID"],
    "age": ["age", "Age", "Age_in_Yrs"],
    "sex": ["sex", "Sex", "Gender"],
    "handedness": ["handedness", "Handedness"],
    # Diagnosis
    "diagnosis": ["diagnosis", "Diagnosis", "Group"],
    "diagnosis_detail": ["diagnosis_detail", "Diagnosis_Detail"],
    "patient_control": ["patient_control", "Patient_Control"],
    # Clinical measures
    "alsfrs_r": ["ALSFRS_R", "alsfrs_r_score"],
    "alsfrs_r_total": ["ALSFRS_R_Total", "alsfrs_r_total"],
    "disease_duration": ["disease_duration", "Disease_Duration"],
    "onset_age": ["onset_age", "Onset_Age"],
    "onset_site": ["onset_site", "Onset_Site"],
    # Motor measures
    "fvc_percent": ["FVC_Percent", "fvc_percent"],
    "als_frs_bulbar": ["ALSFRS_Bulbar", "als_frs_bulbar"],
    "als_frs_motor": ["ALSFRS_Motor", "als_frs_motor"],
    "als_frs_respiratory": ["ALSFRS_Respiratory", "als_frs_respiratory"],
}


def load_csv(path: Path) -> List[Dict[str, str]]:
    """Load CSV/TSV file and return list of dicts."""
    delimiter = "\t" if path.suffix == ".tsv" else ","
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        return list(reader)


def find_column(row: Dict[str, str], candidates: List[str]) -> Optional[str]:
    """Find the first matching column name in a row."""
    for col in candidates:
        if col in row:
            return col
    return None


def extract_phenotype(
    phenotype_files: List[Path],
    imaging_ids: Optional[List[str]] = None,
    columns: Optional[List[str]] = None,
) -> List[Dict[str, str]]:
    """Extract and merge phenotype data from multiple files."""
    all_data = []
    for fpath in phenotype_files:
        rows = load_csv(fpath)
        all_data.extend(rows)

    if not all_data:
        return []

    target_columns = columns if columns else list(COLUMN_MAP.keys())
    merged = {}

    for row in all_data:
        subj_col = find_column(row, COLUMN_MAP["subject_id"])
        if subj_col is None:
            continue
        subj_id = row[subj_col].strip()
        if not subj_id:
            continue

        if subj_id not in merged:
            merged[subj_id] = {"subject_id": subj_id}

        for target_col in target_columns:
            if target_col == "subject_id":
                continue
            if target_col in merged[subj_id] and merged[subj_id][target_col]:
                continue
            candidates = COLUMN_MAP.get(target_col, [target_col])
            src_col = find_column(row, candidates)
            if src_col and row.get(src_col, "").strip():
                merged[subj_id][target_col] = row[src_col].strip()

    result = list(merged.values())
    if imaging_ids:
        imaging_set = set(imaging_ids)
        result = [r for r in result if r["subject_id"] in imaging_set]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract MND phenotype data."
    )
    parser.add_argument("--phenotype-files", required=True, nargs="+",
                        help="Paths to MND phenotype CSV/TSV files")
    parser.add_argument("--output", required=True, help="Output path for merged phenotype CSV")
    parser.add_argument("--imaging-ids", help="Text file with imaging subject IDs to filter")
    parser.add_argument("--columns", help="Comma-separated columns to extract")
    args = parser.parse_args()

    phenotype_files = [Path(f).resolve() for f in args.phenotype_files]
    for f in phenotype_files:
        if not f.exists():
            print(f"File not found: {f}", file=sys.stderr)
            return 1

    imaging_ids = None
    if args.imaging_ids:
        id_file = Path(args.imaging_ids).resolve()
        if id_file.exists():
            imaging_ids = [l.strip() for l in id_file.read_text().splitlines() if l.strip()]

    columns = None
    if args.columns:
        columns = [c.strip() for c in args.columns.split(",")]

    merged = extract_phenotype(phenotype_files, imaging_ids, columns)
    if not merged:
        print("[ERROR] No phenotype data extracted.", file=sys.stderr)
        return 1

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = list(merged[0].keys())
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged)

    print(f"Phenotype: {len(merged)} subjects, {len(fieldnames)} columns -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
