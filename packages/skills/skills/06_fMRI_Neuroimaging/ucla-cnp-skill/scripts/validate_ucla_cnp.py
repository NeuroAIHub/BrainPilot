#!/usr/bin/env python3
"""Validate UCLA CNP BIDS structure and generate compliance report.

Checks directory structure, modality completeness, and task paradigm presence.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

EXPECTED_TASKS = ["stopsignal", "spatialwm", "facememory", "barts", "taskswitch"]


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    report = {
        "subject": subject_dir.name,
        "anat_complete": False,
        "task_fMRI_present": False,
        "dwi_present": False,
        "n_task_runs": 0,
        "tasks_found": [],
        "missing_files": [],
        "warnings": [],
    }

    anat_dir = subject_dir / "anat"
    if anat_dir.exists():
        t1w_files = list(anat_dir.glob("*_T1w.nii.gz"))
        report["anat_complete"] = len(t1w_files) > 0
        if not t1w_files:
            report["missing_files"].append("anat/*_T1w.nii.gz")
    else:
        report["missing_files"].append("anat/")

    func_dir = subject_dir / "func"
    if func_dir.exists():
        bold_files = list(func_dir.glob("*_bold.nii.gz"))
        report["n_task_runs"] = len(bold_files)

        tasks_found = set()
        for f in bold_files:
            name = f.name
            for task in EXPECTED_TASKS:
                if f"task-{task}" in name:
                    tasks_found.add(task)
        report["tasks_found"] = sorted(tasks_found)
        report["task_fMRI_present"] = len(tasks_found) > 0
    else:
        report["missing_files"].append("func/")

    dwi_dir = subject_dir / "dwi"
    if dwi_dir.exists():
        dwi_files = list(dwi_dir.glob("*_dwi.nii.gz"))
        report["dwi_present"] = len(dwi_files) > 0
    else:
        report["warnings"].append("No dwi directory")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate UCLA CNP BIDS structure.")
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
        "subject", "anat_complete", "task_fMRI_present", "dwi_present",
        "n_task_runs", "tasks_found", "missing_files", "warnings",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["tasks_found"] = "; ".join(r["tasks_found"])
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    print(f"\nValidation Summary:")
    print(f"  Total subjects: {len(results)}")
    print(f"  With T1w: {sum(1 for r in results if r['anat_complete'])}")
    print(f"  With task-fMRI: {sum(1 for r in results if r['task_fMRI_present'])}")
    print(f"  With dMRI: {sum(1 for r in results if r['dwi_present'])}")
    print(f"  Avg task runs: {sum(r['n_task_runs'] for r in results) / max(len(results), 1):.1f}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
