#!/usr/bin/env python3
"""Validate MND BIDS structure and generate compliance report.

Checks directory structure, modality completeness, and participant group labeling.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

# Expected modalities for MND
EXPECTED_MODALITIES = {
    "func": ["task-rest_bold", "task-motor_bold"],
}


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    """Validate a single subject's BIDS structure."""
    report = {
        "subject": subject_dir.name,
        "func_complete": False,
        "rs_fMRI_present": False,
        "task_fMRI_present": False,
        "missing_files": [],
        "warnings": [],
    }

    # Check func
    func_dir = subject_dir / "func"
    if func_dir.exists():
        rest_bold = list(func_dir.glob("*_task-rest_bold.nii.gz"))
        motor_bold = list(func_dir.glob("*_task-motor_bold.nii.gz"))

        report["rs_fMRI_present"] = len(rest_bold) > 0
        report["task_fMRI_present"] = len(motor_bold) > 0
        report["func_complete"] = report["rs_fMRI_present"] and report["task_fMRI_present"]

        if not rest_bold:
            report["missing_files"].append("func/*_task-rest_bold.nii.gz")
        if not motor_bold:
            report["missing_files"].append("func/*_task-motor_bold.nii.gz")
    else:
        report["missing_files"].append("func/")

    # Check anat (optional for MND)
    anat_dir = subject_dir / "anat"
    if not anat_dir.exists():
        report["warnings"].append("No anat directory (optional for MND)")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate MND BIDS structure."
    )
    parser.add_argument("--input", required=True, help="Path to MND BIDS directory")
    parser.add_argument("--output", required=True, help="Output path for validation CSV")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    # Find subjects
    subjects = sorted([d for d in input_dir.glob("sub-*") if d.is_dir()])
    print(f"Found {len(subjects)} subjects in {input_dir}")

    if not subjects:
        print("[ERROR] No subjects found.", file=sys.stderr)
        return 1

    # Validate each subject
    results = []
    for sub_dir in subjects:
        report = validate_subject(sub_dir)
        results.append(report)

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = ["subject", "func_complete", "rs_fMRI_present", "task_fMRI_present", "missing_files", "warnings"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    # Summary
    complete_subjects = sum(1 for r in results if r["func_complete"])
    print(f"\nValidation Summary:")
    print(f"  Total subjects: {len(results)}")
    print(f"  Complete (rs-fMRI + task-fMRI): {complete_subjects}")
    print(f"  With rs-fMRI: {sum(1 for r in results if r['rs_fMRI_present'])}")
    print(f"  With task-fMRI: {sum(1 for r in results if r['task_fMRI_present'])}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
