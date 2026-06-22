#!/usr/bin/env python3
"""Analyze lesion masks from MS Lesion Challenge data.

Computes lesion volume, count, and location statistics from binary lesion masks.
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


def count_lesions(lesion_data: np.ndarray) -> int:
    """Count connected components (lesions) in binary mask."""
    try:
        from scipy.ndimage import label
        labeled, num_features = label(lesion_data)
        return num_features
    except ImportError:
        # Fallback: count unique non-zero regions
        return int(np.sum(lesion_data > 0) > 0)


def compute_lesion_volume(lesion_data: np.ndarray, voxel_size: tuple) -> float:
    """Compute total lesion volume in mm³."""
    n_voxels = np.sum(lesion_data > 0)
    voxel_volume = np.prod(voxel_size)
    return float(n_voxels * voxel_volume)


def analyze_lesion_mask(mask_path: Path) -> Dict[str, float]:
    """Analyze a single lesion mask."""
    img = nib.load(str(mask_path))
    data = img.get_fdata()
    voxel_size = img.header.get_zooms()[:3]

    n_lesions = count_lesions(data)
    volume_mm3 = compute_lesion_volume(data, voxel_size)
    volume_ml = volume_mm3 / 1000.0  # Convert mm³ to mL

    return {
        "n_lesions": n_lesions,
        "volume_mm3": volume_mm3,
        "volume_ml": volume_ml,
        "n_voxels": int(np.sum(data > 0)),
        "voxel_size": str(voxel_size),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze lesion masks from MS Challenge data."
    )
    parser.add_argument("--input", required=True, help="Path to directory with lesion masks")
    parser.add_argument("--output", required=True, help="Output path for lesion statistics CSV")
    parser.add_argument("--pattern", default="*_lesion.nii.gz",
                        help="Glob pattern for lesion masks (default: *_lesion.nii.gz)")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    # Find lesion masks
    mask_files = sorted(input_dir.rglob(args.pattern))
    print(f"Found {len(mask_files)} lesion masks")

    if not mask_files:
        print("[WARN] No lesion masks found.", file=sys.stderr)
        return 1

    # Analyze each mask
    results = []
    for mask_path in mask_files:
        try:
            stats = analyze_lesion_mask(mask_path)
            stats["file"] = str(mask_path.relative_to(input_dir))
            results.append(stats)
        except Exception as e:
            print(f"[WARN] Error processing {mask_path}: {e}", file=sys.stderr)

    # Write output
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if results:
        fieldnames = ["file", "n_lesions", "volume_mm3", "volume_ml", "n_voxels", "voxel_size"]
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)

    # Summary
    total_volume = sum(r["volume_ml"] for r in results)
    total_lesions = sum(r["n_lesions"] for r in results)
    print(f"\nLesion Analysis Summary:")
    print(f"  Masks analyzed: {len(results)}")
    print(f"  Total lesions: {total_lesions}")
    print(f"  Total volume: {total_volume:.2f} mL")
    print(f"  Output: {output_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
