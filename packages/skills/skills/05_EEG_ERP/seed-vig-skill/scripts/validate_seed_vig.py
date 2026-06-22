#!/usr/bin/env python3
"""Validate SEED-VIG BIDS structure and generate compliance report.

Checks directory structure, subject completeness, and EEG file presence.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    report = {
        "subject": subject_dir.name,
        "eeg_present": False,
        "n_eeg_files": 0,
        "vigilance_labels": False,
        "missing_files": [],
        "warnings": [],
    }

    eeg_dir = subject_dir / "eeg"
    if eeg_dir.exists():
        eeg_files = list(eeg_dir.glob("*.edf")) + list(eeg_dir.glob("*.set")) + \
                    list(eeg_dir.glob("*.vhdr")) + list(eeg_dir.glob("*.mat"))
        report["n_eeg_files"] = len(eeg_files)
        report["eeg_present"] = len(eeg_files) > 0

        # Check for vigilance labels
        events = list(eeg_dir.glob("*_events.tsv"))
        report["vigilance_labels"] = len(events) > 0

        if not eeg_files:
            report["missing_files"].append("eeg/*.{edf,set,vhdr,mat}")
    else:
        report["missing_files"].append("eeg/")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate SEED-VIG BIDS structure.")
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

    fieldnames = ["subject", "eeg_present", "n_eeg_files", "vigilance_labels", "missing_files", "warnings"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    print(f"\nValidation Summary:")
    print(f"  Total subjects: {len(results)}")
    print(f"  With EEG: {sum(1 for r in results if r['eeg_present'])}")
    print(f"  With vigilance labels: {sum(1 for r in results if r['vigilance_labels'])}")
    print(f"  Total EEG files: {sum(r['n_eeg_files'] for r in results)}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
