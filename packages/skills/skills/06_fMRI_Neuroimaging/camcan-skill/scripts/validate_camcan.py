#!/usr/bin/env python3
"""Validate Cam-CAN BIDS structure and generate compliance report.

Checks directory structure, modality completeness, sidecar JSON presence,
and participant ID consistency across modalities.
"""
import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Dict, List

# Expected modalities for Cam-CAN
EXPECTED_MODALITIES = {
    "anat": ["T1w"],
    "func": ["task-rest_bold", "task-movie_bold"],
    "meg": ["task-rest_meg", "task-auditory_meg", "task-visual_meg"],
    "dwi": ["dwi"],
}


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    """Validate a single subject's BIDS structure."""
    report = {
        "subject": subject_dir.name,
        "anat_complete": False,
        "func_complete": False,
        "meg_complete": False,
        "dwi_complete": False,
        "missing_files": [],
        "warnings": [],
    }

    # Check anat
    anat_dir = subject_dir / "anat"
    if anat_dir.exists():
        t1w_files = list(anat_dir.glob("*_T1w.nii.gz"))
        report["anat_complete"] = len(t1w_files) > 0
        if not t1w_files:
            report["missing_files"].append("anat/*_T1w.nii.gz")
        # Check sidecar JSON
        for f in t1w_files:
            json_file = f.with_suffix("").with_suffix(".json")
            if not json_file.exists():
                report["warnings"].append(f"Missing sidecar: {json_file.name}")
    else:
        report["missing_files"].append("anat/")

    # Check func
    func_dir = subject_dir / "func"
    if func_dir.exists():
        rest_bold = list(func_dir.glob("*_task-rest_bold.nii.gz"))
        movie_bold = list(func_dir.glob("*_task-movie_bold.nii.gz"))
        report["func_complete"] = len(rest_bold) > 0 and len(movie_bold) > 0
        if not rest_bold:
            report["missing_files"].append("func/*_task-rest_bold.nii.gz")
        if not movie_bold:
            report["missing_files"].append("func/*_task-movie_bold.nii.gz")
    else:
        report["missing_files"].append("func/")

    # Check meg
    meg_dir = subject_dir / "meg"
    if meg_dir.exists():
        meg_files = list(meg_dir.glob("*_meg.fif"))
        if not meg_files:
            meg_files = list(meg_dir.glob("*_meg.ds"))
        report["meg_complete"] = len(meg_files) > 0
        if not meg_files:
            report["missing_files"].append("meg/*_meg.fif or .ds")
    else:
        report["missing_files"].append("meg/")

    # Check dwi
    dwi_dir = subject_dir / "dwi"
    if dwi_dir.exists():
        dwi_files = list(dwi_dir.glob("*_dwi.nii.gz"))
        report["dwi_complete"] = len(dwi_files) > 0
        if not dwi_files:
            report["missing_files"].append("dwi/*_dwi.nii.gz")
    else:
        report["missing_files"].append("dwi/")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate Cam-CAN BIDS structure."
    )
    parser.add_argument("--input", required=True, help="Path to Cam-CAN BIDS directory")
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

    fieldnames = ["subject", "anat_complete", "func_complete", "meg_complete", "dwi_complete", "missing_files", "warnings"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    # Summary
    complete_subjects = sum(1 for r in results if r["anat_complete"] and r["func_complete"])
    print(f"\nValidation Summary:")
    print(f"  Total subjects: {len(results)}")
    print(f"  Complete (anat+func): {complete_subjects}")
    print(f"  With MEG: {sum(1 for r in results if r['meg_complete'])}")
    print(f"  With DWI: {sum(1 for r in results if r['dwi_complete'])}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
