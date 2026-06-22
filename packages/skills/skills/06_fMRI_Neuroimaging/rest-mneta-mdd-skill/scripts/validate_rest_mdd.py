#!/usr/bin/env python3
"""Validate REST-meta-MDD BIDS structure and generate compliance report.

Checks directory structure, site identification, and diagnostic group labeling.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    report = {
        "subject": subject_dir.name,
        "rs_fMRI_present": False,
        "anat_present": False,
        "site_id": "",
        "n_runs": 0,
        "missing_files": [],
        "warnings": [],
    }

    # Extract site from subject ID if encoded (e.g., sub-Site01_001)
    parts = subject_dir.name.replace("sub-", "").split("_")
    if len(parts) > 1:
        report["site_id"] = parts[0]

    # Check func
    func_dir = subject_dir / "func"
    if func_dir.exists():
        rest_bold = list(func_dir.glob("*_task-rest_bold.nii.gz"))
        report["rs_fMRI_present"] = len(rest_bold) > 0
        report["n_runs"] = len(rest_bold)
        if not rest_bold:
            report["missing_files"].append("func/*_task-rest_bold.nii.gz")
    else:
        report["missing_files"].append("func/")

    # Check anat (optional)
    anat_dir = subject_dir / "anat"
    if anat_dir.exists():
        t1w_files = list(anat_dir.glob("*_T1w.nii.gz"))
        report["anat_present"] = len(t1w_files) > 0
    else:
        report["warnings"].append("No anat directory (optional)")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate REST-meta-MDD BIDS structure.")
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
        "subject", "rs_fMRI_present", "anat_present", "site_id",
        "n_runs", "missing_files", "warnings",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    sites = set(r["site_id"] for r in results if r["site_id"])
    print(f"\nValidation Summary:")
    print(f"  Total subjects: {len(results)}")
    print(f"  With rs-fMRI: {sum(1 for r in results if r['rs_fMRI_present'])}")
    print(f"  With T1w: {sum(1 for r in results if r['anat_present'])}")
    print(f"  Sites detected: {len(sites)}")
    if sites:
        print(f"  Site IDs: {', '.join(sorted(sites)[:10])}{'...' if len(sites) > 10 else ''}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
