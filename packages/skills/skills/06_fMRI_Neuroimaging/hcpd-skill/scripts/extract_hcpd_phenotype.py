#!/usr/bin/env python3
"""Extract and merge HCP Development phenotype data.

Focuses on developmental measures: cognitive maturation, behavioral
assessment, pubertal status, and age-appropriate cognitive tasks.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional

COLUMN_MAP = {
    "subject_id": ["Subject", "subject", "PIN"],
    "age": ["Age_in_Yrs", "Age"],
    "sex": ["Gender", "Sex"],
    "handedness": ["Handedness"],
    "race": ["Race"],
    "ethnicity": ["Ethnicity"],
    # Developmental measures
    "pubertal_status": ["PDS_PubertalStatus", "PubertalStatus"],
    "pubertal_category": ["PDS_Category"],
    # Cognitive measures (age-appropriate)
    "pmat24_a_cr": ["PMAT24_A_CR"],
    "cardsort_unadj": ["CardSort_Unadj"],
    "flanker_unadj": ["Flanker_Unadj"],
    "list_unadj": ["List_Unadj"],
    "picvocab_unadj": ["PicVocab_Unadj"],
    "procsp_unadj": ["ProcSpeed_Unadj"],
    "readeng_unadj": ["ReadEng_Unadj"],
    "picseq_unadj": ["PicSeq_Unadj"],
    "pattern_unadj": ["Pattern_Unadj"],
    # Behavioral
    "cbcl_internalizing": ["CBCL_Internalizing"],
    "cbcl_externalizing": ["CBCL_Externalizing"],
    "cbcl_total": ["CBCL_Total"],
    "upps_negative_urgency": ["UPPS_Negative_Urgency"],
    "upps_lack_perseverance": ["UPPS_Lack_Perseverance"],
    "upps_positive_urgency": ["UPPS_Positive_Urgency"],
    "upps_sensation_seeking": ["UPPS_Sensation_Seeking"],
    "upps_lack_planning": ["UPPS_Lack_Planning"],
    # Physical measures
    "height": ["Height", "Height_In"],
    "weight": ["Weight", "BMI"],
    "bmi_percentile": ["BMI_Percentile"],
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
        all_data.extend(load_csv(fpath))

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
    parser = argparse.ArgumentParser(description="Extract HCP Development phenotype data.")
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
