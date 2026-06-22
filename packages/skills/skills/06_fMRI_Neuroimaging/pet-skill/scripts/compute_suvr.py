#!/usr/bin/env python3
"""Compute SUVR (Standardized Uptake Value Ratio) from a PET image and ROI masks.

Supports static PET (single frame) and mean-of-frames from dynamic PET.
Outputs per-region SUVR values as CSV and optional SUVR map as NIfTI.
"""
import argparse
import sys
from pathlib import Path
from typing import Dict, List, Optional

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


def load_mask(mask_path: Path) -> tuple:
    """Load a NIfTI mask and return (data array, affine)."""
    img = nib.load(str(mask_path))
    data = img.get_fdata()
    return data, img.affine, img.header


def extract_mean_signal(pet_data: np.ndarray, mask_data: np.ndarray) -> float:
    """Extract mean PET signal within a binary mask."""
    mask_bool = mask_data > 0
    if not np.any(mask_bool):
        return float("nan")
    return float(np.mean(pet_data[mask_bool]))


def compute_suvr_map(pet_data: np.ndarray, target_mask: np.ndarray, ref_mean: float) -> np.ndarray:
    """Compute voxelwise SUVR map within target mask."""
    suvr = np.zeros_like(pet_data)
    if ref_mean > 0:
        target_bool = target_mask > 0
        suvr[target_bool] = pet_data[target_bool] / ref_mean
    return suvr


def load_multi_frame_pet(pet_path: Path, frame_index: Optional[int] = None) -> np.ndarray:
    """Load PET image, optionally selecting a specific frame from 4D data."""
    img = nib.load(str(pet_path))
    data = img.get_fdata()

    if data.ndim == 4:
        if frame_index is not None:
            if frame_index >= data.shape[3]:
                print(f"[WARN] Frame index {frame_index} exceeds available frames {data.shape[3]}, using last frame")
                frame_index = data.shape[3] - 1
            data = data[:, :, :, frame_index]
        else:
            # Use mean across all frames
            print(f"  4D PET detected ({data.shape[3]} frames), computing mean across frames")
            data = np.mean(data, axis=3)

    return data


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute SUVR from a PET image and ROI/reference masks."
    )
    parser.add_argument(
        "--pet",
        required=True,
        help="Path to PET NIfTI file (3D static or 4D dynamic)",
    )
    parser.add_argument(
        "--ref-mask",
        required=True,
        help="Path to reference region binary mask (e.g., cerebellar cortex)",
    )
    parser.add_argument(
        "--target-mask",
        help="Path to target ROI binary mask (single region). If omitted, only reference mean is reported.",
    )
    parser.add_argument(
        "--roi-masks",
        help="Comma-separated list of additional ROI masks for multi-region SUVR computation",
    )
    parser.add_argument(
        "--roi-names",
        help="Comma-separated ROI names (must match --roi-masks order)",
    )
    parser.add_argument(
        "--frame",
        type=int,
        default=None,
        help="Frame index for 4D PET (default: mean across all frames)",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output path for SUVR values CSV",
    )
    parser.add_argument(
        "--suvr-map-output",
        help="Optional: output path for voxelwise SUVR map NIfTI (requires --target-mask)",
    )
    args = parser.parse_args()

    pet_path = Path(args.pet).resolve()
    ref_path = Path(args.ref_mask).resolve()

    if not pet_path.exists():
        print(f"PET file not found: {pet_path}", file=sys.stderr)
        return 1
    if not ref_path.exists():
        print(f"Reference mask not found: {ref_path}", file=sys.stderr)
        return 1

    # Load PET
    print(f"Loading PET: {pet_path}")
    pet_data = load_multi_frame_pet(pet_path, args.frame)
    print(f"  PET shape: {pet_data.shape}, range: [{pet_data.min():.2f}, {pet_data.max():.2f}]")

    # Load reference region
    print(f"Loading reference mask: {ref_path}")
    ref_data, ref_affine, ref_header = load_mask(ref_path)
    ref_mean = extract_mean_signal(pet_data, ref_data)
    print(f"  Reference region mean: {ref_mean:.4f}")

    if np.isnan(ref_mean) or ref_mean <= 0:
        print("[ERROR] Reference region mean is NaN or <= 0. Check mask alignment.", file=sys.stderr)
        return 1

    # Collect results
    results = []

    # Single target mask
    if args.target_mask:
        target_path = Path(args.target_mask).resolve()
        if not target_path.exists():
            print(f"Target mask not found: {target_path}", file=sys.stderr)
            return 1
        target_data, _, _ = load_mask(target_path)
        target_mean = extract_mean_signal(pet_data, target_data)
        suvr = target_mean / ref_mean if ref_mean > 0 else float("nan")
        results.append({"roi": "target", "mean_signal": target_mean, "ref_mean": ref_mean, "suvr": suvr})
        print(f"  Target mean: {target_mean:.4f}, SUVR: {suvr:.4f}")

        # Optional SUVR map
        if args.suvr_map_output:
            suvr_map = compute_suvr_map(pet_data, target_data, ref_mean)
            out_img = nib.Nifti1Image(suvr_map, ref_affine, ref_header)
            suvr_map_path = Path(args.suvr_map_output).resolve()
            suvr_map_path.parent.mkdir(parents=True, exist_ok=True)
            nib.save(out_img, str(suvr_map_path))
            print(f"  SUVR map saved: {suvr_map_path}")

    # Multiple ROI masks
    if args.roi_masks:
        roi_paths = [Path(p.strip()).resolve() for p in args.roi_masks.split(",")]
        roi_names = None
        if args.roi_names:
            roi_names = [n.strip() for n in args.roi_names.split(",")]
        if roi_names and len(roi_names) != len(roi_paths):
            print("[WARN] --roi-names count does not match --roi-masks count, using file stems", file=sys.stderr)
            roi_names = None

        for i, roi_path in enumerate(roi_paths):
            if not roi_path.exists():
                print(f"[WARN] ROI mask not found: {roi_path}", file=sys.stderr)
                continue
            roi_data, _, _ = load_mask(roi_path)
            roi_mean = extract_mean_signal(pet_data, roi_data)
            suvr = roi_mean / ref_mean if ref_mean > 0 else float("nan")
            name = roi_names[i] if roi_names else roi_path.stem
            results.append({"roi": name, "mean_signal": roi_mean, "ref_mean": ref_mean, "suvr": suvr})

    if not results:
        print("[WARN] No target or ROI masks provided. Only reference mean is reported.")
        results.append({"roi": "reference_only", "mean_signal": float("nan"), "ref_mean": ref_mean, "suvr": float("nan")})

    # Write CSV
    import csv

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["roi", "mean_signal", "ref_mean", "suvr"])
        writer.writeheader()
        writer.writerows(results)

    print(f"\nSUVR Summary ({len(results)} ROI(s)) -> {output_path}")
    for r in results:
        print(f"  {r['roi']}: SUVR = {r['suvr']:.4f}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
