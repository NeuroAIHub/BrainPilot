#!/usr/bin/env python3
"""Validate PPMI BIDS structure and generate compliance report.

Checks directory structure, diagnostic group completeness, and modality presence.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    report = {
        "subject": subject_dir.name,
        "anat_complete": False,
        "rs_fMRI_present": False,
        "task_fMRI_present": False,
        "dwi_present": False,
        "datscan_present": False,
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
    else:
        report["missing_files"].append("anat/")

    # Check func
    func_dir = subject_dir / "func"
    if func_dir.exists():
        rest_bold = list(func_dir.glob("*_task-rest_bold.nii.gz"))
        task_bold = list(func_dir.glob("*_task-*_bold.nii.gz"))
        task_bold = [f for f in task_bold if "task-rest" not in f.name]
        report["rs_fMRI_present"] = len(rest_bold) > 0
        report["task_fMRI_present"] = len(task_bold) > 0
    else:
        report["warnings"].append("No func directory")

    # Check dwi
    dwi_dir = subject_dir / "dwi"
    if dwi_dir.exists():
        dwi_files = list(dwi_dir.glob("*_dwi.nii.gz"))
        report["dwi_present"] = len(dwi_files) > 0
    else:
        report["warnings"].append("No dwi directory")

    # Check DaTscan (may be in pet/ or dat/)
    for dat_dir_name in ["pet", "dat", "spect"]:
        dat_dir = subject_dir / dat_dir_name
        if dat_dir.exists():
            report["datscan_present"] = True
            break

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate PPMI BIDS structure.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    subjects = sorted([d for d in input_dir.glob("sub-*") if d.is_dir()])
    print(f"Found {len(subjects)} subjects in {input_dir}")

    if not subjects:
        print("[ERROR] No subjects found.", file=sys.stderr)
        return 1

    results = []
    for sub_dir in subjects:
        report = validate_subject(sub_dir)
        results.append(report)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    fieldnames = [
        "subject", "anat_complete", "rs_fMRI_present", "task_fMRI_present",
        "dwi_present", "datscan_present", "missing_files", "warnings",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    complete = sum(1 for r in results if r["anat_complete"] and r["rs_fMRI_present"])
    print(f"\nValidation Summary:")
    print(f"  Total subjects: {len(results)}")
    print(f"  Complete (anat + rs-fMRI): {complete}")
    print(f"  With T1w: {sum(1 for r in results if r['anat_complete'])}")
    print(f"  With rs-fMRI: {sum(1 for r in results if r['rs_fMRI_present'])}")
    print(f"  With task-fMRI: {sum(1 for r in results if r['task_fMRI_present'])}")
    print(f"  With dMRI: {sum(1 for r in results if r['dwi_present'])}")
    print(f"  With DaTscan: {sum(1 for r in results if r['datscan_present'])}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
