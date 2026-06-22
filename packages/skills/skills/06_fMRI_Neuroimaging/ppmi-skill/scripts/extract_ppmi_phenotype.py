#!/usr/bin/env python3
"""Extract and merge PPMI phenotype data.

Reads PPMI phenotype files (MDS-UPDRS, MoCA, DAT, demographics)
and produces a merged phenotype table aligned with imaging subject list.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional

COLUMN_MAP = {
    "subject_id": ["subject", "Subject", "participant_id", "SubID", "PATNO"],
    "age": ["age", "Age", "Age_at_visit"],
    "sex": ["sex", "Sex", "Gender"],
    "diagnosis": ["diagnosis", "Diagnosis", "Group", "COHORT"],
    "diagnosis_detail": ["diagnosis_detail", "Diagnosis_Detail"],
    # Motor
    "mds_updrs_iii": ["MDS_UPDRS_III", "mds_updrs_iii", "NP3TOT"],
    "mds_updrs_total": ["MDS_UPDRS_Total", "mds_updrs_total"],
    "h_y": ["H_Y", "h_y", "HoehnYahr"],
    # Cognitive
    "moca": ["MoCA", "moca", "MCATOT"],
    # Olfaction
    "upsit": ["UPSIT", "upsit", "UPSIT_Total"],
    # Sleep
    "rbdsq": ["RBDSQ", "rbdsq"],
    # DAT imaging
    "dat_sbr": ["DAT_SBR", "dat_sbr", "CAUDATE_SBR", "PUTAMEN_SBR"],
    # Biomarkers
    "csf_abeta": ["CSF_ABeta", "csf_abeta"],
    "csf_tau": ["CSF_tau", "csf_tau"],
    "csf_ptau": ["CSF_ptau", "csf_ptau"],
}


def load_csv(path: Path) -> List[Dict[str, str]]:
    delimiter = "\t" if path.suffix == ".tsv" else ","
    with open(path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter=delimiter)
        return list(reader)


def find_column(row: Dict[str, str], candidates: List[str]) -> Optional[str]:
    for col in candidates:
        if col in row:
            return col
    return None


def extract_phenotype(
    phenotype_files: List[Path],
    imaging_ids: Optional[List[str]] = None,
    columns: Optional[List[str]] = None,
) -> List[Dict[str, str]]:
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
    parser = argparse.ArgumentParser(description="Extract PPMI phenotype data.")
    parser.add_argument("--phenotype-files", required=True, nargs="+")
    parser.add_argument("--output", required=True)
    parser.add_argument("--imaging-ids")
    parser.add_argument("--columns")
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
