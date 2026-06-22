#!/usr/bin/env python3
"""Validate NSD BIDS structure and generate compliance report.

Checks directory structure, subject completeness, session counts,
and stimulus file presence for the Natural Scenes Dataset.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

# NSD expected subjects
NSD_SUBJECTS = [f"subj0{i}" for i in range(1, 9)]  # subj01-subj08

# Expected modalities per subject
EXPECTED_MODALITIES = {
    "func": ["task-nsd_bold"],
    "anat": ["T1w"],
}


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    """Validate a single subject's NSD BIDS structure."""
    report = {
        "subject": subject_dir.name,
        "anat_complete": False,
        "func_complete": False,
        "n_sessions": 0,
        "n_func_runs": 0,
        "stimulus_present": False,
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
        bold_files = list(func_dir.glob("*_task-nsd_bold.nii.gz"))
        report["n_func_runs"] = len(bold_files)
        report["func_complete"] = len(bold_files) > 0

        # Count unique sessions from filenames
        sessions = set()
        for f in bold_files:
            parts = f.name.split("_")
            for p in parts:
                if p.startswith("ses-"):
                    sessions.add(p)
        report["n_sessions"] = len(sessions)

        if not bold_files:
            report["missing_files"].append("func/*_task-nsd_bold.nii.gz")
    else:
        report["missing_files"].append("func/")

    # Check stimulus files
    stim_dir = subject_dir / "func"
    if stim_dir.exists():
        stim_files = list(stim_dir.glob("*_events.tsv"))
        report["stimulus_present"] = len(stim_files) > 0

    # Warnings for session count
    if report["n_sessions"] > 0 and report["n_sessions"] < 30:
        report["warnings"].append(
            f"Only {report['n_sessions']} sessions found (expected ~30-40)"
        )

    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate NSD BIDS structure."
    )
    parser.add_argument("--input", required=True, help="Path to NSD BIDS directory")
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

    fieldnames = [
        "subject", "anat_complete", "func_complete",
        "n_sessions", "n_func_runs", "stimulus_present",
        "missing_files", "warnings",
    ]
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
    print(f"  Complete (anat + func): {complete_subjects}")
    print(f"  With T1w: {sum(1 for r in results if r['anat_complete'])}")
    print(f"  With task-fMRI: {sum(1 for r in results if r['func_complete'])}")
    print(f"  With stimulus events: {sum(1 for r in results if r['stimulus_present'])}")
    total_runs = sum(r['n_func_runs'] for r in results)
    print(f"  Total fMRI runs: {total_runs}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
