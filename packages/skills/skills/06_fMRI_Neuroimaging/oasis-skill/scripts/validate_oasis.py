#!/usr/bin/env python3
"""Validate OASIS BIDS structure and generate compliance report.

Checks directory structure, version detection, and modality completeness.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def detect_version(input_dir: Path) -> str:
    """Detect OASIS version from directory structure."""
    subjects = list(input_dir.glob("sub-*"))
    if not subjects:
        return "unknown"
    # OASIS-1: sub-OAS1* pattern, OASIS-2: longitudinal with sessions
    sample = subjects[0]
    if "OAS1" in sample.name:
        sessions = list(sample.glob("ses-*"))
        return "OASIS-2" if sessions else "OASIS-1"
    if "OAS3" in sample.name:
        return "OASIS-3"
    return "unknown"


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    report = {
        "subject": subject_dir.name,
        "anat_complete": False,
        "n_sessions": 0,
        "pet_present": False,
        "asl_present": False,
        "missing_files": [],
        "warnings": [],
    }

    # Count sessions
    sessions = [d for d in subject_dir.glob("ses-*") if d.is_dir()]
    report["n_sessions"] = len(sessions) if sessions else 1

    # Check anat (in first session or root)
    anat_dir = subject_dir / "anat"
    if not anat_dir.exists() and sessions:
        anat_dir = sessions[0] / "anat"

    if anat_dir.exists():
        t1w_files = list(anat_dir.glob("*_T1w.nii.gz"))
        report["anat_complete"] = len(t1w_files) > 0
        if not t1w_files:
            report["missing_files"].append("anat/*_T1w.nii.gz")
    else:
        report["missing_files"].append("anat/")

    # Check PET
    pet_dir = subject_dir / "pet"
    if pet_dir.exists() or any(s / "pet" for s in sessions if (s / "pet").exists()):
        report["pet_present"] = True

    # Check ASL
    asl_dir = subject_dir / "perf"
    if asl_dir.exists() or any(s / "perf" for s in sessions if (s / "perf").exists()):
        report["asl_present"] = True

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate OASIS BIDS structure.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    version = detect_version(input_dir)
    print(f"Detected OASIS version: {version}")

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

    fieldnames = ["subject", "anat_complete", "n_sessions", "pet_present", "asl_present", "missing_files", "warnings"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    print(f"\nValidation Summary:")
    print(f"  Version: {version}")
    print(f"  Total subjects: {len(results)}")
    print(f"  With T1w: {sum(1 for r in results if r['anat_complete'])}")
    print(f"  With PET: {sum(1 for r in results if r['pet_present'])}")
    print(f"  With ASL: {sum(1 for r in results if r['asl_present'])}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
