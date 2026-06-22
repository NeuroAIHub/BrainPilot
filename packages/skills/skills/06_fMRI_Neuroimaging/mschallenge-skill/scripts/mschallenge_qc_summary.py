#!/usr/bin/env python3
"""Generate per-subject QC summaries for MS Challenge processing.

Checks modality completeness, ground truth presence, and data quality.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

EXPECTED_MODALITIES = ["T1", "T2", "FLAIR", "PD"]


def validate_subject(subject_dir: Path, has_ground_truth: bool = True) -> Dict[str, any]:
    """Validate a single subject's data quality."""
    report = {
        "subject": subject_dir.name,
        "n_timepoints": 0,
        "modalities_complete": False,
        "ground_truth_complete": False,
        "excluded": False,
        "exclusion_reasons": [],
    }

    # Find timepoints
    timepoints = sorted([d for d in subject_dir.iterdir() if d.is_dir()])
    report["n_timepoints"] = len(timepoints)

    if not timepoints:
        report["excluded"] = True
        report["exclusion_reasons"].append("No timepoints found")
        return report

    # Check modalities
    all_complete = True
    for tp_dir in timepoints:
        for mod in EXPECTED_MODALITIES:
            mod_files = list(tp_dir.glob(f"*_{mod}.nii.gz"))
            if not mod_files:
                mod_files = list(tp_dir.glob(f"*_{mod.lower()}.nii.gz"))
            if not mod_files:
                all_complete = False

    report["modalities_complete"] = all_complete
    if not all_complete:
        report["exclusion_reasons"].append("Missing modalities")

    # Check ground truth
    if has_ground_truth:
        gt_complete = True
        for tp_dir in timepoints:
            lesion_files = list(tp_dir.glob("*_lesion.nii.gz"))
            if not lesion_files:
                gt_complete = False
                break
        report["ground_truth_complete"] = gt_complete
        if not gt_complete:
            report["exclusion_reasons"].append("Missing ground truth")

    report["excluded"] = len(report["exclusion_reasons"]) > 0
    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate QC summaries for MS Challenge."
    )
    parser.add_argument("--input", required=True, help="Path to MS Challenge directory")
    parser.add_argument("--output", required=True, help="Output path for QC summary CSV")
    parser.add_argument("--exclude-output", help="Output path for exclusion list CSV")
    parser.add_argument("--no-ground-truth", action="store_true",
                        help="Skip ground truth validation (for test data)")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    # Find subjects
    subjects = sorted([d for d in input_dir.iterdir() if d.is_dir()])
    print(f"Found {len(subjects)} subjects")

    if not subjects:
        print("[ERROR] No subjects found.", file=sys.stderr)
        return 1

    # Process each subject
    results = []
    excluded = []
    for sub_dir in subjects:
        report = validate_subject(sub_dir, has_ground_truth=not args.no_ground_truth)
        results.append(report)
        if report["excluded"]:
            excluded.append({
                "subject": report["subject"],
                "reasons": "; ".join(report["exclusion_reasons"]),
            })

    # Write QC summary
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["subject", "n_timepoints", "modalities_complete", "ground_truth_complete", "excluded", "exclusion_reasons"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["exclusion_reasons"] = "; ".join(r["exclusion_reasons"])
            writer.writerow(r)

    # Write exclusion list
    if args.exclude_output and excluded:
        exclude_path = Path(args.exclude_output).resolve()
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        with open(exclude_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["subject", "reasons"])
            writer.writeheader()
            writer.writerows(excluded)

    # Summary
    print(f"\nQC Summary:")
    print(f"  Subjects: {len(results)}")
    print(f"  Excluded: {len(excluded)}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
