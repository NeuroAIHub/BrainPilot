#!/usr/bin/env python3
"""Validate MS Lesion Challenge directory structure.

Checks directory structure, modality completeness, ground truth presence,
and longitudinal timepoint consistency.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

# Expected modalities
EXPECTED_MODALITIES = ["T1", "T2", "FLAIR", "PD"]


def validate_subject(subject_dir: Path, has_ground_truth: bool = True) -> Dict[str, any]:
    """Validate a single subject's directory structure."""
    report = {
        "subject": subject_dir.name,
        "timepoints": [],
        "modalities_complete": {},
        "ground_truth_present": {},
        "missing_files": [],
        "warnings": [],
    }

    # Find timepoints
    timepoints = sorted([d for d in subject_dir.iterdir() if d.is_dir()])
    report["timepoints"] = [tp.name for tp in timepoints]

    if not timepoints:
        report["warnings"].append("No timepoints found")
        return report

    for tp_dir in timepoints:
        tp_name = tp_dir.name
        report["modalities_complete"][tp_name] = {}
        report["ground_truth_present"][tp_name] = False

        # Check each modality
        for mod in EXPECTED_MODALITIES:
            mod_files = list(tp_dir.glob(f"*_{mod}.nii.gz"))
            if not mod_files:
                mod_files = list(tp_dir.glob(f"*_{mod.lower()}.nii.gz"))
            report["modalities_complete"][tp_name][mod] = len(mod_files) > 0
            if not mod_files:
                report["missing_files"].append(f"{tp_name}/*_{mod}.nii.gz")

        # Check ground truth
        if has_ground_truth:
            lesion_files = list(tp_dir.glob("*_lesion.nii.gz"))
            report["ground_truth_present"][tp_name] = len(lesion_files) > 0
            if not lesion_files and tp_name == report["timepoints"][0]:
                report["warnings"].append(f"Missing ground truth in first timepoint: {tp_name}")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate MS Lesion Challenge directory structure."
    )
    parser.add_argument("--input", required=True, help="Path to MS Challenge directory")
    parser.add_argument("--output", required=True, help="Output path for validation CSV")
    parser.add_argument("--no-ground-truth", action="store_true",
                        help="Skip ground truth validation (for test data)")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    # Find subjects
    subjects = sorted([d for d in input_dir.iterdir() if d.is_dir()])
    print(f"Found {len(subjects)} subjects in {input_dir}")

    if not subjects:
        print("[ERROR] No subjects found.", file=sys.stderr)
        return 1

    # Validate each subject
    results = []
    for sub_dir in subjects:
        report = validate_subject(sub_dir, has_ground_truth=not args.no_ground_truth)
        results.append(report)

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["subject", "timepoints", "modalities_complete", "ground_truth_present", "warnings"])
        for r in results:
            writer.writerow([
                r["subject"],
                len(r["timepoints"]),
                str(r["modalities_complete"]),
                str(r["ground_truth_present"]),
                "; ".join(r["warnings"]),
            ])

    # Summary
    total_timepoints = sum(len(r["timepoints"]) for r in results)
    print(f"\nValidation Summary:")
    print(f"  Subjects: {len(results)}")
    print(f"  Total timepoints: {total_timepoints}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
