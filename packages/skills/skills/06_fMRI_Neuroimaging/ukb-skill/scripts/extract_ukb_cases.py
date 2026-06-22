#!/usr/bin/env python3
"""Extract disease cases from UK Biobank data using ICD-10/ICD-9 codes.

Adapted from UKBAnalytica_v2 case_extraction.R and ICD_diagnose.R.
Supports brain-related disease endpoints: dementia, stroke, Parkinson's, etc.

Usage:
    python extract_ukb_cases.py --input ukb_raw.csv --disease dementia --output cases.csv
    python extract_ukb_cases.py --input ukb_raw.csv --disease stroke --sources ICD10,Self-report --output stroke_cases.csv
    python extract_ukb_cases.py --input ukb_raw.csv --custom-icd G30 --output custom_cases.csv
"""
import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd

# Predefined brain-related disease definitions (ICD-10 patterns)
DISEASE_DEFINITIONS = {
    "dementia": {
        "description": "All-cause dementia",
        "icd10_pattern": "F0[0-9]",
        "icd10_codes": ["F00", "F01", "F02", "F03", "F09"],
        "self_report_codes": [1263],  # UKB self-report code for dementia
    },
    "alzheimers": {
        "description": "Alzheimer's disease",
        "icd10_pattern": "F00|G30",
        "icd10_codes": ["F00", "F000", "F001", "F002", "F009", "G30", "G300", "G301", "G308", "G309"],
        "self_report_codes": [1263],
    },
    "vascular_dementia": {
        "description": "Vascular dementia",
        "icd10_pattern": "F01",
        "icd10_codes": ["F010", "F011", "F012", "F013", "F018", "F019"],
        "self_report_codes": [],
    },
    "stroke": {
        "description": "Stroke (ischaemic + haemorrhagic)",
        "icd10_pattern": "I6[0-4]",
        "icd10_codes": ["I60", "I61", "I62", "I63", "I64"],
        "self_report_codes": [1081, 1491, 1583],
    },
    "ischaemic_stroke": {
        "description": "Ischaemic stroke",
        "icd10_pattern": "I63",
        "icd10_codes": ["I630", "I631", "I632", "I633", "I634", "I635", "I636", "I638", "I639"],
        "self_report_codes": [],
    },
    "haemorrhagic_stroke": {
        "description": "Haemorrhagic stroke",
        "icd10_pattern": "I6[0-2]",
        "icd10_codes": ["I60", "I61", "I62"],
        "self_report_codes": [],
    },
    "parkinsons": {
        "description": "Parkinson's disease",
        "icd10_pattern": "G20",
        "icd10_codes": ["G20"],
        "self_report_codes": [1254],
    },
    "multiple_sclerosis": {
        "description": "Multiple sclerosis",
        "icd10_pattern": "G35",
        "icd10_codes": ["G35"],
        "self_report_codes": [1258],
    },
    "epilepsy": {
        "description": "Epilepsy",
        "icd10_pattern": "G4[0-1]",
        "icd10_codes": ["G40", "G41"],
        "self_report_codes": [1262],
    },
    "migraine": {
        "description": "Migraine",
        "icd10_pattern": "G43",
        "icd10_codes": ["G430", "G431", "G432", "G433", "G438", "G439"],
        "self_report_codes": [1265],
    },
    "depression": {
        "description": "Major depressive disorder",
        "icd10_pattern": "F3[2-3]",
        "icd10_codes": ["F320", "F321", "F322", "F323", "F328", "F329", "F330", "F331", "F332", "F333", "F334", "F338", "F339"],
        "self_report_codes": [1286, 1530],
    },
    "anxiety": {
        "description": "Anxiety disorders",
        "icd10_pattern": "F4[0-1]",
        "icd10_codes": ["F400", "F401", "F402", "F408", "F409", "F410", "F411", "F412", "F413", "F418", "F419"],
        "self_report_codes": [1287, 1531],
    },
    "schizophrenia": {
        "description": "Schizophrenia",
        "icd10_pattern": "F20",
        "icd10_codes": ["F200", "F201", "F202", "F203", "F205", "F206", "F208", "F209"],
        "self_report_codes": [1289],
    },
    "bipolar": {
        "description": "Bipolar disorder",
        "icd10_pattern": "F31",
        "icd10_codes": ["F310", "F311", "F312", "F313", "F315", "F316", "F317", "F318", "F319"],
        "self_report_codes": [1291],
    },
    "brain_tumour": {
        "description": "Brain tumour (benign + malignant)",
        "icd10_pattern": "C71|D33|D43",
        "icd10_codes": ["C710", "C711", "C712", "C713", "C719", "D330", "D331", "D332", "D339", "D430", "D431", "D432", "D439"],
        "self_report_codes": [],
    },
    "tbi": {
        "description": "Traumatic brain injury",
        "icd10_pattern": "S0[6-9]",
        "icd10_codes": ["S060", "S061", "S062", "S063", "S064", "S065", "S066", "S068", "S069"],
        "self_report_codes": [],
    },
}


def parse_icd10_diagnoses(df: pd.DataFrame) -> pd.DataFrame:
    """Parse ICD-10 diagnosis codes from UKB hospital inpatient data."""
    # p41270: ICD-10 main diagnoses; p41280: diagnosis dates
    # Stored as concatenated strings, e.g. "['I639','G20']"
    records = []
    icd10_col = None
    for col in ["p41270", "p41270_i0"]:
        if col in df.columns:
            icd10_col = col
            break

    if icd10_col is None:
        print("[WARN] No ICD-10 diagnosis column (p41270) found")
        return pd.DataFrame(columns=["eid", "icd10_code", "diag_date", "source"])

    for _, row in df.iterrows():
        eid = row["eid"]
        raw = row.get(icd10_col, "")
        if pd.isna(raw) or str(raw).strip() == "":
            continue

        # Parse list-like string: "['I639','G20']" or "I639,G20"
        codes = re.findall(r"[A-Z][0-9]{2,3}", str(raw).upper())
        for code in codes:
            records.append({"eid": eid, "icd10_code": code, "source": "ICD10"})

    return pd.DataFrame(records) if records else pd.DataFrame(columns=["eid", "icd10_code", "diag_date", "source"])


def parse_icd9_diagnoses(df: pd.DataFrame) -> pd.DataFrame:
    """Parse ICD-9 diagnosis codes from UKB hospital inpatient data."""
    records = []
    icd9_col = None
    for col in ["p41271", "p41271_i0"]:
        if col in df.columns:
            icd9_col = col
            break

    if icd9_col is None:
        return pd.DataFrame(columns=["eid", "icd9_code", "diag_date", "source"])

    for _, row in df.iterrows():
        eid = row["eid"]
        raw = row.get(icd9_col, "")
        if pd.isna(raw) or str(raw).strip() == "":
            continue

        codes = re.findall(r"[VE]?[0-9]{3,5}", str(raw).upper())
        for code in codes:
            records.append({"eid": eid, "icd9_code": code, "source": "ICD9"})

    return pd.DataFrame(records) if records else pd.DataFrame(columns=["eid", "icd9_code", "diag_date", "source"])


def extract_cases(
    df: pd.DataFrame,
    disease_key: str,
    custom_icd: Optional[str] = None,
    sources: List[str] = None,
) -> Tuple[pd.DataFrame, Dict]:
    """Extract cases for a given disease."""
    if sources is None:
        sources = ["ICD10", "ICD9"]

    # Use custom ICD pattern or predefined
    if custom_icd:
        disease_def = {"description": "Custom", "icd10_pattern": custom_icd, "icd10_codes": [custom_icd], "self_report_codes": []}
    elif disease_key in DISEASE_DEFINITIONS:
        disease_def = DISEASE_DEFINITIONS[disease_key]
    else:
        raise ValueError(f"Unknown disease: {disease_key}. Available: {list(DISEASE_DEFINITIONS.keys())}")

    pattern = disease_def["icd10_pattern"]
    case_eids = set()
    case_details = []

    # ICD-10 from hospital inpatient
    if "ICD10" in sources:
        icd10_df = parse_icd10_diagnoses(df)
        if not icd10_df.empty:
            mask = icd10_df["icd10_code"].str.match(pattern, na=False)
            matched = icd10_df[mask]
            for _, row in matched.iterrows():
                case_eids.add(row["eid"])
                case_details.append({"eid": row["eid"], "source": "ICD10", "code": row["icd10_code"]})

    # ICD-9 from hospital inpatient
    if "ICD9" in sources:
        icd9_df = parse_icd9_diagnoses(df)
        if not icd9_df.empty:
            # Basic ICD-9 matching (simplified)
            icd9_codes = disease_def.get("icd9_codes", [])
            for code in icd9_codes:
                mask = icd9_df["icd9_code"].str.startswith(code[:3], na=False)
                matched = icd9_df[mask]
                for _, row in matched.iterrows():
                    case_eids.add(row["eid"])
                    case_details.append({"eid": row["eid"], "source": "ICD9", "code": row["icd9_code"]})

    # Death register
    if "Death" in sources:
        death_col = None
        for col in ["p40001_i0", "p40001"]:
            if col in df.columns:
                death_col = col
                break
        if death_col:
            for _, row in df.iterrows():
                raw = row.get(death_col, "")
                if pd.isna(raw):
                    continue
                codes = re.findall(r"[A-Z][0-9]{2,3}", str(raw).upper())
                for code in codes:
                    if re.match(pattern, code):
                        case_eids.add(row["eid"])
                        case_details.append({"eid": row["eid"], "source": "Death", "code": code})

    # Build case table
    if case_details:
        details_df = pd.DataFrame(case_details)
        # Keep first occurrence per subject
        details_df = details_df.drop_duplicates(subset=["eid"], keep="first")
    else:
        details_df = pd.DataFrame(columns=["eid", "source", "code"])

    # Build full result: all subjects with case indicator
    result = pd.DataFrame({"eid": df["eid"]})
    result[f"{disease_key}_case"] = result["eid"].isin(case_eids).astype(int)

    stats = {
        "disease": disease_def["description"],
        "total_subjects": len(df),
        "cases": len(case_eids),
        "prevalence": len(case_eids) / len(df) * 100 if len(df) > 0 else 0,
        "sources_used": sources,
    }

    return result, stats


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract UKB disease cases.")
    parser.add_argument("--input", required=True, help="Path to UKB raw CSV")
    parser.add_argument("--output", required=True, help="Output path for cases CSV")
    parser.add_argument("--disease", help=f"Disease key. Available: {list(DISEASE_DEFINITIONS.keys())}")
    parser.add_argument("--custom-icd", help="Custom ICD-10 pattern (regex)")
    parser.add_argument("--sources", default="ICD10,ICD9,Death",
                        help="Comma-separated data sources: ICD10,ICD9,Death,Self-report")
    parser.add_argument("--list-diseases", action="store_true", help="List available diseases and exit")
    args = parser.parse_args()

    if args.list_diseases:
        print("Available brain-related disease definitions:")
        for key, info in DISEASE_DEFINITIONS.items():
            print(f"  {key}: {info['description']} (ICD-10: {info['icd10_pattern']})")
        return 0

    if not args.disease and not args.custom_icd:
        print("Error: --disease or --custom-icd is required", file=sys.stderr)
        return 1

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    df = pd.read_csv(input_path, low_memory=False)
    print(f"Loaded {len(df)} subjects")

    sources = [s.strip() for s in args.sources.split(",")]
    result, stats = extract_cases(df, args.disease or "custom", args.custom_icd, sources)

    print(f"\nCase extraction: {stats['disease']}")
    print(f"  Total subjects: {stats['total_subjects']}")
    print(f"  Cases: {stats['cases']} ({stats['prevalence']:.2f}%)")
    print(f"  Sources: {stats['sources_used']}")

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result.to_csv(output_path, index=False)
    print(f"Saved -> {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
