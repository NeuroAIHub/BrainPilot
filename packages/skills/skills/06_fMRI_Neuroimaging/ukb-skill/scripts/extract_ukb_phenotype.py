#!/usr/bin/env python3
"""Extract and preprocess UK Biobank phenotype data for brain-related analysis.

Adapted from UKBAnalytica_v2 variable_preprocess.R (Nan He, Southern Medical University).
Provides field ID mapping, automatic preprocessing, and covariate table generation.

Usage:
    python extract_ukb_phenotype.py --input ukb_raw.csv --output phenotype.csv
    python extract_ukb_phenotype.py --input ukb_raw.csv --variables sex,age,bmi,smoking --output covariates.csv
    python extract_ukb_phenotype.py --input ukb_raw.csv --custom-mapping mapping.json --output custom.csv
"""
import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

import pandas as pd

# UKB field ID -> column name mapping (adapted from UKBAnalytica_v2)
VARIABLE_MAPPING = {
    # Demographics
    "sex": {"field_id": 31, "ukb_col": "p31", "description": "Sex (0=Female, 1=Male)"},
    "age": {"field_id": 21022, "ukb_col": "p21022", "description": "Age at recruitment"},
    "ethnicity": {"field_id": 21000, "ukb_col": "p21000_i0", "description": "Ethnic background"},
    "birth_year": {"field_id": 34, "ukb_col": "p34", "description": "Year of birth"},
    "assessment_centre": {"field_id": 54, "ukb_col": "p54_i0", "description": "UK Biobank assessment centre"},
    "baseline_date": {"field_id": 53, "ukb_col": "p53_i0", "description": "Date of baseline assessment"},

    # Anthropometrics
    "bmi": {"field_id": 21001, "ukb_col": "p21001_i0", "description": "BMI (kg/m^2)"},
    "height": {"field_id": 50, "ukb_col": "p50_i0", "description": "Standing height (cm)"},
    "weight": {"field_id": 21002, "ukb_col": "p21002_i0", "description": "Weight (kg)"},
    "waist": {"field_id": 48, "ukb_col": "p48_i0", "description": "Waist circumference (cm)"},

    # Lifestyle
    "smoking": {"field_id": 20116, "ukb_col": "p20116_i0", "description": "Smoking status (0=Never, 1=Previous, 2=Current)"},
    "drinking": {"field_id": 20117, "ukb_col": "p20117_i0", "description": "Alcohol drinker status"},
    "sleep_duration": {"field_id": 1160, "ukb_col": "p1160_i0", "description": "Sleep duration (hours/day)"},
    "physical_activity": {"field_id": 22032, "ukb_col": "p22032_i0", "description": "Physical activity level"},

    # Socioeconomic
    "education": {"field_id": 6138, "ukb_col": "p6138_i0", "description": "Qualifications"},
    "income": {"field_id": 738, "ukb_col": "p738_i0", "description": "Average total household income"},
    "townsend": {"field_id": 189, "ukb_col": "p189", "description": "Townsend deprivation index"},

    # Blood Pressure
    "sbp_auto": {"field_id": 4080, "ukb_col": "p4080_i0_a0", "description": "SBP automated reading"},
    "dbp_auto": {"field_id": 4079, "ukb_col": "p4079_i0_a0", "description": "DBP automated reading"},

    # Biomarkers
    "triglycerides": {"field_id": 30870, "ukb_col": "p30870_i0", "description": "Triglycerides (mmol/L)"},
    "ldl": {"field_id": 30780, "ukb_col": "p30780_i0", "description": "LDL cholesterol (mmol/L)"},
    "hdl": {"field_id": 30760, "ukb_col": "p30760_i0", "description": "HDL cholesterol (mmol/L)"},
    "hba1c": {"field_id": 30750, "ukb_col": "p30750_i0", "description": "HbA1c (mmol/mol)"},
    "glucose": {"field_id": 30740, "ukb_col": "p30740_i0", "description": "Glucose (mmol/L)"},
    "crp": {"field_id": 30710, "ukb_col": "p30710_i0", "description": "C-reactive protein"},

    # Brain imaging (IDPs)
    "brain_volume": {"field_id": 25000, "ukb_col": "p25000_i0", "description": "Total brain volume (GM+WM)"},
    "gm_volume": {"field_id": 25001, "ukb_col": "p25001_i0", "description": "Grey matter volume"},
    "wm_volume": {"field_id": 25002, "ukb_col": "p25002_i0", "description": "White matter volume"},
    "hippocampus_volume": {"field_id": 25003, "ukb_col": "p25003_i0", "description": "Hippocampal volume"},
    "wmh_volume": {"field_id": 25004, "ukb_col": "p25004_i0", "description": "White matter hyperintensity volume"},
    "ventricular_volume": {"field_id": 25005, "ukb_col": "p25005_i0", "description": "Ventricular volume"},

    # Cognition
    "fluid_intelligence": {"field_id": 20016, "ukb_col": "p20016_i0", "description": "Fluid intelligence score"},
    "reaction_time": {"field_id": 20023, "ukb_col": "p20023_i0", "description": "Mean reaction time"},
    "memory_pairs": {"field_id": 399, "ukb_col": "p399_i0", "description": "Numeric memory (max digits)"},
    "trail_making_a": {"field_id": 20156, "ukb_col": "p20156_i0", "description": "Trail making test A"},
    "trail_making_b": {"field_id": 20157, "ukb_col": "p20157_i0", "description": "Trail making test B"},

    # APOE genotype
    "apoe": {"field_id": 22616, "ukb_col": "p22616", "description": "APOE genotype"},

    # Death
    "death_date": {"field_id": 40000, "ukb_col": "p40000_i0", "description": "Date of death"},
    "death_cause": {"field_id": 40001, "ukb_col": "p40001_i0", "description": "Primary cause of death (ICD-10)"},

    # Hospital inpatient
    "icd10_primary": {"field_id": 41202, "ukb_col": "p41202", "description": "ICD-10 primary diagnoses"},
    "icd10_date": {"field_id": 41280, "ukb_col": "p41280", "description": "ICD-10 diagnosis dates"},
}

# UKB invalid codes (treated as missing)
INVALID_CODES = [-1, -3, -9]


def preprocess_variable(series: pd.Series, var_name: str, invalid_codes: List[int]) -> pd.Series:
    """Apply variable-specific preprocessing."""
    s = series.copy()

    # Replace invalid codes with NaN
    if s.dtype in ("int64", "float64"):
        for code in invalid_codes:
            s = s.replace(code, pd.NA)

    # Variable-specific transformations
    if var_name == "ethnicity":
        # Recode: White=0, non-White=1
        s = s.apply(lambda x: 0 if x == 1 else (1 if pd.notna(x) and x > 0 else pd.NA))

    elif var_name == "education":
        # Recode: College/University degree -> High; A levels/GCSEs -> Medium; None -> Low
        def edu_recode(x):
            if pd.isna(x):
                return pd.NA
            x = int(x)
            if x in [1, 2, 3, 4]:  # College/University
                return 3
            elif x in [5, 6]:  # A levels, O levels/GCSEs
                return 2
            elif x in [7]:  # CSEs
                return 1
            else:
                return 1
        s = s.apply(edu_recode)

    elif var_name == "smoking":
        # 0=Never, 1=Previous, 2=Current
        s = s.apply(lambda x: x if x in [0, 1, 2] else pd.NA)

    return s


def load_custom_mapping(path: Path) -> Dict:
    """Load custom variable mapping from JSON file."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def extract_phenotype(
    input_path: Path,
    variables: Optional[List[str]] = None,
    custom_mapping: Optional[Dict] = None,
    drop_missing: bool = False,
) -> pd.DataFrame:
    """Extract and preprocess UKB phenotype data."""
    df = pd.read_csv(input_path, low_memory=False)
    print(f"Loaded {len(df)} rows, {len(df.columns)} columns")

    # Merge mappings
    mapping = dict(VARIABLE_MAPPING)
    if custom_mapping:
        mapping.update(custom_mapping)

    # Default variables: demographics + key covariates
    if variables is None:
        variables = ["sex", "age", "ethnicity", "bmi", "smoking", "education", "townsend"]

    # Validate
    invalid = [v for v in variables if v not in mapping]
    if invalid:
        print(f"[WARN] Unknown variables: {invalid}")
        variables = [v for v in variables if v in mapping]

    # Process each variable
    result = pd.DataFrame()
    result["eid"] = df["eid"]

    processed = []
    for var in variables:
        var_info = mapping[var]
        ukb_col = var_info["ukb_col"]

        # Try exact column match, then prefix match
        if ukb_col in df.columns:
            col = ukb_col
        else:
            candidates = [c for c in df.columns if c.startswith(ukb_col)]
            col = candidates[0] if candidates else None

        if col is None:
            print(f"[WARN] Column '{ukb_col}' not found for variable '{var}', skipping")
            continue

        result[var] = preprocess_variable(df[col], var, INVALID_CODES)
        processed.append(var)

    print(f"Processed {len(processed)} variables: {processed}")

    if drop_missing:
        before = len(result)
        result = result.dropna(subset=processed)
        print(f"Dropped {before - len(result)} rows with missing values")

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract UKB phenotype data.")
    parser.add_argument("--input", required=True, help="Path to UKB raw CSV")
    parser.add_argument("--output", required=True, help="Output path for phenotype CSV")
    parser.add_argument("--variables", help="Comma-separated variable names (default: core covariates)")
    parser.add_argument("--custom-mapping", help="JSON file with custom variable mappings")
    parser.add_argument("--drop-missing", action="store_true", help="Drop rows with missing values")
    parser.add_argument("--list-variables", action="store_true", help="List available variables and exit")
    args = parser.parse_args()

    if args.list_variables:
        print("Available variables:")
        for name, info in VARIABLE_MAPPING.items():
            print(f"  {name}: {info['description']} (field {info['field_id']}, col {info['ukb_col']})")
        return 0

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    variables = None
    if args.variables:
        variables = [v.strip() for v in args.variables.split(",")]

    custom_mapping = None
    if args.custom_mapping:
        custom_mapping = load_custom_mapping(Path(args.custom_mapping).resolve())

    result = extract_phenotype(input_path, variables, custom_mapping, args.drop_missing)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output_path, index=False)
    print(f"Saved {len(result)} rows, {len(result.columns)} columns -> {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
