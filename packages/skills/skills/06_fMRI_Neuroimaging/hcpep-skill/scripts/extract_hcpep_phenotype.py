#!/usr/bin/env python3
"""Extract and merge HCP Early Psychosis phenotype data.

Focuses on clinical measures: diagnosis, symptom severity, medication,
cognitive assessment, and functional outcomes for early psychosis research.
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
    # Clinical diagnosis
    "diagnosis": ["Diagnosis", "Group"],
    "diagnosis_detail": ["Diagnosis_Detail"],
    "patient_control": ["Patient_Control"],
    # Symptom measures
    "panss_positive": ["PANSS_Positive"],
    "panss_negative": ["PANSS_Negative"],
    "panss_general": ["PANSS_General"],
    "panss_total": ["PANSS_Total"],
    "bprs_total": ["BPRS_Total"],
    "bprs_positive": ["BPRS_Positive"],
    "bprs_negative": ["BPRS_Negative"],
    "gaf_score": ["GAF_Score"],
    "saps_total": ["SAPS_Total"],
    "sans_total": ["SANS_Total"],
    # Medication
    "medication_status": ["Medication", "Med_Status"],
    "chlorpromazine_eq": ["CPZ_Equivalent", "Chlorpromazine_Eq"],
    # Functional measures
    "functioning_gaf": ["GAF_Functioning"],
    "role_functioning": ["Role_Functioning"],
    "social_functioning": ["Social_Functioning"],
    # Cognitive measures
    "matrics_overall": ["MCCB_Overall", "MATRICS_Overall"],
    "matrics_speed": ["MCCB_Speed", "Processing_Speed"],
    "matrics_attention": ["MCCB_Attention", "Attention_Vigilance"],
    "matrics_working_mem": ["MCCB_Working_Memory"],
    "matrics_verbal": ["MCCB_Verbal_Learning"],
    "matrics_visual": ["MCCB_Visual_Learning"],
    "matrics_reasoning": ["MCCB_Reasoning"],
    "matrics_social_cog": ["MCCB_Social_Cognition"],
    # Duration of illness
    "duration_illness": ["Duration_Illness", "DUI"],
    "duration_untreated": ["Duration_Untreated", "DUP"],
    "age_onset": ["Age_Onset"],
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
    parser = argparse.ArgumentParser(description="Extract HCP Early Psychosis phenotype data.")
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
