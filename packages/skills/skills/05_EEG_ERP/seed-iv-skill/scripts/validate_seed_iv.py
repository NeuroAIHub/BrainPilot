#!/usr/bin/env python3
"""Validate SEED-IV BIDS structure and generate compliance report.

Checks directory structure, subject/session completeness, and EEG file presence.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def validate_subject(subject_dir: Path) -> Dict[str, any]:
    report = {
        "subject": subject_dir.name,
        "n_sessions": 0,
        "eeg_complete": False,
        "events_present": False,
        "missing_files": [],
        "warnings": [],
    }

    sessions = [d for d in subject_dir.glob("ses-*") if d.is_dir()]
    report["n_sessions"] = len(sessions)

    if not sessions:
        # Check root-level EEG
        eeg_dir = subject_dir / "eeg"
        if eeg_dir.exists():
            eeg_files = list(eeg_dir.glob("*.edf")) + list(eeg_dir.glob("*.set")) + list(eeg_dir.glob("*.vhdr"))
            report["eeg_complete"] = len(eeg_files) > 0
            events = list(eeg_dir.glob("*_events.tsv"))
            report["events_present"] = len(events) > 0
        else:
            report["missing_files"].append("eeg/")
    else:
        eeg_count = 0
        events_count = 0
        for ses in sessions:
            eeg_dir = ses / "eeg"
            if eeg_dir.exists():
                eeg_files = list(eeg_dir.glob("*.edf")) + list(eeg_dir.glob("*.set")) + list(eeg_dir.glob("*.vhdr"))
                eeg_count += len(eeg_files)
                events_count += len(list(eeg_dir.glob("*_events.tsv")))
            else:
                report["missing_files"].append(f"{ses.name}/eeg/")
        report["eeg_complete"] = eeg_count > 0
        report["events_present"] = events_count > 0

    if report["n_sessions"] < 3:
        report["warnings"].append(f"Only {report['n_sessions']} sessions (expected 3)")

    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate SEED-IV BIDS structure.")
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

    fieldnames = ["subject", "n_sessions", "eeg_complete", "events_present", "missing_files", "warnings"]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            r["missing_files"] = "; ".join(r["missing_files"])
            r["warnings"] = "; ".join(r["warnings"])
            writer.writerow(r)

    print(f"\nValidation Summary:")
    print(f"  Total subjects: {len(results)}")
    print(f"  With EEG: {sum(1 for r in results if r['eeg_complete'])}")
    print(f"  With events: {sum(1 for r in results if r['events_present'])}")
    print(f"  Total sessions: {sum(r['n_sessions'] for r in results)}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
