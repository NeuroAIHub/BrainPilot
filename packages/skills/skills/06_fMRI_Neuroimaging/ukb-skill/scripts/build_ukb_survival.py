#!/usr/bin/env python3
"""Build survival analysis datasets from UK Biobank data.

Adapted from UKBAnalytica_v2 survival.R (Nan He, Southern Medical University).
Computes follow-up time, event status, and handles prevalent/incident case separation.

Usage:
    python build_ukb_survival.py --input ukb_raw.csv --disease dementia --output survival.csv
    python build_ukb_survival.py --input ukb_raw.csv --disease stroke --censor-date 2023-10-31 --output stroke_survival.csv
"""
import argparse
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

# Import disease definitions from extract_ukb_cases
DISEASE_DEFINITIONS = {
    "dementia": {"icd10_pattern": "F0[0-9]", "self_report_codes": [1263]},
    "alzheimers": {"icd10_pattern": "F00|G30", "self_report_codes": [1263]},
    "stroke": {"icd10_pattern": "I6[0-4]", "self_report_codes": [1081, 1491, 1583]},
    "ischaemic_stroke": {"icd10_pattern": "I63", "self_report_codes": []},
    "parkinsons": {"icd10_pattern": "G20", "self_report_codes": [1254]},
    "multiple_sclerosis": {"icd10_pattern": "G35", "self_report_codes": [1258]},
    "epilepsy": {"icd10_pattern": "G4[0-1]", "self_report_codes": [1262]},
    "depression": {"icd10_pattern": "F3[2-3]", "self_report_codes": [1286, 1530]},
    "anxiety": {"icd10_pattern": "F4[0-1]", "self_report_codes": [1287, 1531]},
    "schizophrenia": {"icd10_pattern": "F20", "self_report_codes": [1289]},
}


def parse_dates(series: pd.Series) -> pd.Series:
    """Parse UKB date strings to datetime."""
    return pd.to_datetime(series, errors="coerce", format="mixed")


def find_first_diagnosis_date(
    row: pd.Series, pattern: str, date_cols: List[str], code_cols: List[str]
) -> Optional[datetime]:
    """Find the earliest diagnosis date matching ICD pattern for one subject."""
    earliest = None

    for code_col, date_col in zip(code_cols, date_cols):
        codes_raw = row.get(code_col, "")
        dates_raw = row.get(date_col, "")

        if pd.isna(codes_raw) or str(codes_raw).strip() == "":
            continue

        codes = re.findall(r"[A-Z][0-9]{2,3}", str(codes_raw).upper())

        # Parse corresponding dates
        if pd.notna(dates_raw):
            try:
                dates = re.findall(r"\d{4}-\d{2}-\d{2}", str(dates_raw))
            except Exception:
                dates = []
        else:
            dates = []

        for i, code in enumerate(codes):
            if re.match(pattern, code):
                if i < len(dates):
                    try:
                        dt = datetime.strptime(dates[i], "%Y-%m-%d")
                        if earliest is None or dt < earliest:
                            earliest = dt
                    except ValueError:
                        pass

    return earliest


def build_survival_dataset(
    df: pd.DataFrame,
    disease_key: str,
    censor_date: str = "2023-10-31",
    baseline_col: str = "p53_i0",
) -> pd.DataFrame:
    """Build survival dataset with prevalent/incident case separation."""
    disease_def = DISEASE_DEFINITIONS.get(disease_key)
    if disease_def is None:
        raise ValueError(f"Unknown disease: {disease_key}")

    pattern = disease_def["icd10_pattern"]
    censor_dt = datetime.strptime(censor_date, "%Y-%m-%d")

    # Find baseline date column
    baseline_date_col = None
    for col in [baseline_col, "p53_i0", "p53"]:
        if col in df.columns:
            baseline_date_col = col
            break

    # Find ICD-10 code and date columns
    code_cols = [c for c in df.columns if c.startswith("p41270")]
    date_cols = [c for c in df.columns if c.startswith("p41280")]

    # Find death date column
    death_date_col = None
    for col in ["p40000_i0", "p40000"]:
        if col in df.columns:
            death_date_col = col
            break

    records = []
    n_prevalent = 0
    n_incident = 0
    n_censored = 0

    for _, row in df.iterrows():
        eid = row["eid"]

        # Get baseline date
        baseline_dt = None
        if baseline_date_col:
            baseline_dt = pd.to_datetime(row.get(baseline_date_col), errors="coerce")

        # Find first diagnosis date from ICD-10
        diag_dt = find_first_diagnosis_date(row, pattern, date_cols, code_cols)

        # Get death date
        death_dt = None
        if death_date_col:
            death_dt = pd.to_datetime(row.get(death_date_col), errors="coerce")

        # Classify case status
        outcome_status = None
        follow_up_years = None

        if baseline_dt is None:
            # No baseline date, skip
            outcome_status = pd.NA
            follow_up_years = pd.NA
        elif diag_dt is not None and diag_dt <= baseline_dt:
            # Prevalent case: diagnosis before or at baseline
            outcome_status = pd.NA  # Not at risk
            follow_up_years = pd.NA
            n_prevalent += 1
        elif diag_dt is not None and diag_dt > baseline_dt:
            # Incident case
            outcome_status = 1
            follow_up_years = (diag_dt - baseline_dt).days / 365.25
            n_incident += 1
        else:
            # Censored: no diagnosis
            outcome_status = 0
            end_dt = min(
                d for d in [death_dt, censor_dt] if d is not None
            ) if death_dt is not None else censor_dt
            follow_up_years = (end_dt - baseline_dt).days / 365.25
            n_censored += 1

        records.append({
            "eid": eid,
            f"{disease_key}_prevalent": 1 if (diag_dt is not None and baseline_dt is not None and diag_dt <= baseline_dt) else 0,
            f"{disease_key}_incident": 1 if (diag_dt is not None and baseline_dt is not None and diag_dt > baseline_dt) else 0,
            "outcome_status": outcome_status,
            "survival_years": follow_up_years,
        })

    result = pd.DataFrame(records)

    # Summary
    total = len(df)
    print(f"\nSurvival dataset: {disease_key}")
    print(f"  Total subjects: {total}")
    print(f"  Prevalent cases: {n_prevalent} ({n_prevalent/total*100:.1f}%)")
    print(f"  Incident cases: {n_incident} ({n_incident/total*100:.1f}%)")
    print(f"  Censored: {n_censored} ({n_censored/total*100:.1f}%)")
    print(f"  At-risk for analysis: {n_incident + n_censored}")

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Build UKB survival dataset.")
    parser.add_argument("--input", required=True, help="Path to UKB raw CSV")
    parser.add_argument("--output", required=True, help="Output path for survival CSV")
    parser.add_argument("--disease", required=True,
                        help=f"Disease key. Available: {list(DISEASE_DEFINITIONS.keys())}")
    parser.add_argument("--censor-date", default="2023-10-31",
                        help="Administrative censoring date (default: 2023-10-31)")
    parser.add_argument("--baseline-col", default="p53_i0",
                        help="Column name for baseline assessment date")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    df = pd.read_csv(input_path, low_memory=False)
    print(f"Loaded {len(df)} subjects")

    result = build_survival_dataset(df, args.disease, args.censor_date, args.baseline_col)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output_path, index=False)
    print(f"Saved -> {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
