#!/usr/bin/env python3
"""Extract and merge HCP Young Adult phenotype data.

Reads HCP-YA phenotype CSV files (cognitive, behavioral, demographic)
and produces a merged phenotype table aligned with imaging subject list.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional

# Column mapping: target column name -> possible source column names
COLUMN_MAP = {
    "subject_id": ["Subject", "subject", "PIN", "PIN_Subject"],
    "age": ["Age_in_Yrs", "Age"],
    "sex": ["Gender", "Sex"],
    "handedness": ["Handedness", "Handed"],
    "race": ["Race", "Ethnicity"],
    "ethnicity": ["Ethnicity"],
    "education": ["SSAGA_Educ", "Education"],
    "income": ["SSAGA_Income", "Income"],
    "height": ["Height_In", "Height"],
    "weight": ["Weight", "BMI"],
    "bp_systolic": ["BP_Systolic"],
    "bp_diastolic": ["BP_Diastolic"],
    # Cognitive measures
    "pmat24_a_cr": ["PMAT24_A_CR"],  # Raven's progressive matrices
    "pmat24_a_si": ["PMAT24_A_SI"],
    "pmat24_a_rtcr": ["PMAT24_A_RTCR"],
    "cardsort_unadj": ["CardSort_Unadj"],  # Dimensional change card sort
    "flanker_unadj": ["Flanker_Unadj"],  # Flanker task
    "list_unadj": ["List_Unadj"],  # List sorting
    "picvocab_unadj": ["PicVocab_Unadj"],  # Picture vocabulary
    "procsp_unadj": ["ProcSpeed_Unadj"],  # Processing speed
    "readeng_unadj": ["ReadEng_Unadj"],  # Reading
    "picseq_unadj": ["PicSeq_Unadj"],  # Picture sequence memory
    "strength_unadj": ["Strength_Unadj"],  # Grip strength
    "endurance_unadj": ["Endurance_Unadj"],  # Endurance
    "gait_speed_unadj": ["GaitSpeed_Unadj"],  # Gait speed
    "dexterity_unadj": ["Dexterity_Unadj"],  # Dexterity
    # Behavioral/psychiatric
    "nih_total": ["NIH_TLC"],  # NIH Toolbox Total
    "neuroticism": ["NEOFAC_N"],
    "extraversion": ["NEOFAC_E"],
    "openness": ["NEOFAC_O"],
    "agreeableness": ["NEOFAC_A"],
    "conscientiousness": ["NEOFAC_C"],
    "psqi_global": ["PSQI_Score"],  # Sleep quality
    "bis_bas_bis": ["BIS_BAS_BIS"],
    "bis_bas_bas_rr": ["BIS_BAS_BAS_RR"],
    "bis_bas_bas_d": ["BIS_BAS_BAS_D"],
    "bis_bas_bas_fs": ["BIS_BAS_BAS_FS"],
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
    # Load all files
    all_data = []
    for fpath in phenotype_files:
        rows = load_csv(fpath)
        for row in rows:
            all_data.append(row)

    if not all_data:
        return []

    # Determine which columns to extract
    if columns:
        target_columns = columns
    else:
        target_columns = list(COLUMN_MAP.keys())

    # Extract and merge
    merged = {}
    for row in all_data:
        # Find subject ID
        subj_col = find_column(row, COLUMN_MAP["subject_id"])
        if subj_col is None:
            continue
        subj_id = row[subj_col].strip()
        if not subj_id:
            continue

        if subj_id not in merged:
            merged[subj_id] = {"subject_id": subj_id}

        # Extract requested columns
        for target_col in target_columns:
            if target_col == "subject_id":
                continue
            if target_col in merged[subj_id] and merged[subj_id][target_col]:
                continue  # Already have a value

            candidates = COLUMN_MAP.get(target_col, [target_col])
            src_col = find_column(row, candidates)
            if src_col and row.get(src_col, "").strip():
                merged[subj_id][target_col] = row[src_col].strip()

    # Filter to imaging subjects if provided
    result = list(merged.values())
    if imaging_ids:
        imaging_set = set(imaging_ids)
        result = [r for r in result if r["subject_id"] in imaging_set]

    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract and merge HCP Young Adult phenotype data."
    )
    parser.add_argument(
        "--phenotype-files", required=True, nargs="+",
        help="Paths to HCP phenotype CSV/TSV files"
    )
    parser.add_argument("--output", required=True, help="Output path for merged phenotype CSV")
    parser.add_argument("--imaging-ids", help="Text file with imaging subject IDs to filter")
    parser.add_argument("--columns", help="Comma-separated column names to extract (default: all)")
    args = parser.parse_args()

    phenotype_files = [Path(f).resolve() for f in args.phenotype_files]
    for f in phenotype_files:
        if not f.exists():
            print(f"Phenotype file not found: {f}", file=sys.stderr)
            return 1

    # Load imaging IDs if provided
    imaging_ids = None
    if args.imaging_ids:
        id_file = Path(args.imaging_ids).resolve()
        if id_file.exists():
            imaging_ids = [line.strip() for line in id_file.read_text().splitlines() if line.strip()]
            print(f"Imaging IDs: {len(imaging_ids)} subjects")

    # Parse columns
    columns = None
    if args.columns:
        columns = [c.strip() for c in args.columns.split(",")]
        print(f"Requested columns: {columns}")

    # Extract phenotype
    print(f"Extracting phenotype from {len(phenotype_files)} files...")
    merged = extract_phenotype(phenotype_files, imaging_ids, columns)

    if not merged:
        print("[ERROR] No phenotype data extracted.", file=sys.stderr)
        return 1

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = list(merged[0].keys())
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(merged)

    print(f"\nPhenotype Summary:")
    print(f"  Subjects: {len(merged)}")
    print(f"  Columns: {len(fieldnames)}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
