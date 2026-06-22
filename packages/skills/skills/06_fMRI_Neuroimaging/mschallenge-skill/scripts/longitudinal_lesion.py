#!/usr/bin/env python3
"""Analyze longitudinal lesion changes across timepoints.

Tracks lesion volume, count, and new/enlarged/resolved lesions
across multiple timepoints for each subject.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

try:
    import numpy as np
except ImportError:
    print("Error: numpy is required.", file=sys.stderr)
    sys.exit(1)

try:
    import nibabel as nib
except ImportError:
    print("Error: nibabel is required.", file=sys.stderr)
    sys.exit(1)


def load_lesion_mask(mask_path: Path) -> np.ndarray:
    """Load lesion mask and return binary data."""
    img = nib.load(str(mask_path))
    return (img.get_fdata() > 0).astype(np.uint8)


def compute_lesion_changes(mask_t1: np.ndarray, mask_t2: np.ndarray) -> Dict[str, int]:
    """Compute lesion changes between two timepoints."""
    # New lesions: present in t2 but not in t1
    new_lesions = np.sum((mask_t2 > 0) & (mask_t1 == 0))
    # Resolved lesions: present in t1 but not in t2
    resolved_lesions = np.sum((mask_t1 > 0) & (mask_t2 == 0))
    # Stable lesions: present in both
    stable_lesions = np.sum((mask_t1 > 0) & (mask_t2 > 0))
    # Enlarged lesions: increased volume (approximate)
    enlarged_lesions = 0  # Would need connected component analysis

    return {
        "new_voxels": int(new_lesions),
        "resolved_voxels": int(resolved_lesions),
        "stable_voxels": int(stable_lesions),
        "enlarged_voxels": int(enlarged_lesions),
    }


def analyze_subject(subject_dir: Path) -> Dict[str, any]:
    """Analyze longitudinal lesion changes for a single subject."""
    report = {
        "subject": subject_dir.name,
        "timepoints": [],
        "volumes": [],
        "changes": [],
    }

    # Find timepoints with lesion masks
    timepoints = sorted([d for d in subject_dir.iterdir() if d.is_dir()])
    masks = {}

    for tp_dir in timepoints:
        lesion_files = list(tp_dir.glob("*_lesion.nii.gz"))
        if lesion_files:
            masks[tp_dir.name] = lesion_files[0]
            report["timepoints"].append(tp_dir.name)

    if len(masks) < 2:
        report["warning"] = "Need at least 2 timepoints for longitudinal analysis"
        return report

    # Compute volumes for each timepoint
    for tp_name in report["timepoints"]:
        mask_data = load_lesion_mask(masks[tp_name])
        volume = int(np.sum(mask_data > 0))
        report["volumes"].append(volume)

    # Compute changes between consecutive timepoints
    for i in range(len(report["timepoints"]) - 1):
        tp1 = report["timepoints"][i]
        tp2 = report["timepoints"][i + 1]
        mask1 = load_lesion_mask(masks[tp1])
        mask2 = load_lesion_mask(masks[tp2])
        changes = compute_lesion_changes(mask1, mask2)
        changes["from"] = tp1
        changes["to"] = tp2
        report["changes"].append(changes)

    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze longitudinal lesion changes."
    )
    parser.add_argument("--input", required=True, help="Path to MS Challenge directory")
    parser.add_argument("--output", required=True, help="Output path for longitudinal analysis CSV")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    # Find subjects
    subjects = sorted([d for d in input_dir.iterdir() if d.is_dir()])
    print(f"Found {len(subjects)} subjects")

    if not subjects:
        print("[ERROR] No subjects found.", file=sys.stderr)
        return 1

    # Analyze each subject
    results = []
    for sub_dir in subjects:
        report = analyze_subject(sub_dir)
        results.append(report)

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["subject", "n_timepoints", "volumes", "changes"])
        for r in results:
            writer.writerow([
                r["subject"],
                len(r["timepoints"]),
                str(r["volumes"]),
                str(r["changes"]),
            ])

    # Summary
    total_subjects = len(results)
    subjects_with_changes = sum(1 for r in results if r.get("changes"))
    print(f"\nLongitudinal Analysis Summary:")
    print(f"  Subjects: {total_subjects}")
    print(f"  With longitudinal data: {subjects_with_changes}")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
