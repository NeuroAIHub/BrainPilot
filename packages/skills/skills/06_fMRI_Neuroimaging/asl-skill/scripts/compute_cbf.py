#!/usr/bin/env python3
"""Compute CBF (Cerebral Blood Flow) maps from ASL perfusion MRI.

Implements the Buxton single-compartment model for pCASL/CASL/PASL
quantification. Outputs CBF map as NIfTI and optional ROI summary as CSV.
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

# Physical constants
DEFAULT_PARAMS = {
    "pcasl": {"alpha": 0.85, "tau": 1.8, "pld": 1.8},
    "casl": {"alpha": 0.95, "tau": 2.0, "pld": 1.5},
    "pasl": {"alpha": 0.98, "tau": 0.7, "pld": 1.8},
}

# T1 of arterial blood (seconds)
T1B = {1.5: 1.35, 3.0: 1.65, 7.0: 2.1}

# Blood-tissue water partition coefficient (mL/g)
LAMBDA = 0.9

# Conversion factor: mL/g/s -> mL/100g/min
CONVERSION = 6000


def compute_cbf_pcasl_casl(
    diff_data: np.ndarray,
    m0_data: np.ndarray,
    alpha: float,
    tau: float,
    pld: float,
    t1b: float,
) -> np.ndarray:
    """Compute CBF from pCASL/CASL using the Buxton model.

    CBF = (6000 * ΔM * λ) / (2 * α * M0 * T1b * (exp(-w/T1b) - exp(-(τ+w)/T1b)))

    Returns CBF in mL/100g/min.
    """
    m0_safe = np.where(m0_data > 0, m0_data, 1.0)
    numerator = CONVERSION * diff_data * LAMBDA
    denominator = 2.0 * alpha * m0_safe * t1b * (np.exp(-pld / t1b) - np.exp(-(tau + pld) / t1b))

    cbf = np.where(m0_data > 0, numerator / denominator, 0.0)
    return cbf


def compute_cbf_pasl(
    diff_data: np.ndarray,
    m0_data: np.ndarray,
    alpha: float,
    ti1: float,
    ti2: float,
    t1b: float,
    bolus_thickness: float = 0.15,
) -> np.ndarray:
    """Compute CBF from PASL (QUIPSS II).

    CBF = (6000 * ΔM * λ * TI1) / (2 * α * M0 * T1b * (TI2 - TI1) * exp(-TI2/T1b))

    Returns CBF in mL/100g/min.
    """
    m0_safe = np.where(m0_data > 0, m0_data, 1.0)
    numerator = CONVERSION * diff_data * LAMBDA * ti1
    denominator = 2.0 * alpha * m0_safe * t1b * (ti2 - ti1) * np.exp(-ti2 / t1b)

    cbf = np.where(m0_data > 0, numerator / denominator, 0.0)
    return cbf


def extract_roi_mean(data: np.ndarray, atlas: np.ndarray, labels: Optional[List[int]] = None) -> Dict[int, float]:
    """Extract mean CBF for each ROI in the atlas."""
    unique_labels = np.unique(atlas[atlas > 0]).astype(int)
    if labels is not None:
        unique_labels = [l for l in unique_labels if l in labels]

    results = {}
    for label in unique_labels:
        mask = atlas == label
        values = data[mask]
        values = values[~np.isnan(values)]
        if len(values) > 0:
            results[int(label)] = float(np.mean(values))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute CBF maps from ASL perfusion MRI."
    )
    parser.add_argument("--diff", required=True, help="Path to ASL difference image (control - label)")
    parser.add_argument("--m0", help="Path to M0 reference image (required for absolute CBF)")
    parser.add_argument("--output", required=True, help="Output path for CBF map NIfTI")
    parser.add_argument("--roi-summary", help="Optional: output path for ROI summary CSV")
    parser.add_argument("--roi-atlas", help="Optional: path to atlas NIfTI for ROI extraction")
    parser.add_argument("--roi-labels", help="Optional: comma-separated ROI label IDs to extract")
    parser.add_argument("--label-strategy", default="pcasl", choices=["pcasl", "casl", "pasl"],
                        help="ASL labeling strategy (default: pcasl)")
    parser.add_argument("--alpha", type=float, help="Labeling efficiency (overrides default)")
    parser.add_argument("--tau", type=float, help="Label duration in seconds (overrides default)")
    parser.add_argument("--pld", type=float, help="Post-labeling delay in seconds (overrides default)")
    parser.add_argument("--field-strength", type=float, default=3.0, choices=[1.5, 3.0, 7.0],
                        help="MRI field strength in Tesla (default: 3.0)")
    parser.add_argument("--no-m0", action="store_true", help="Compute relative CBF without M0 normalization")
    args = parser.parse_args()

    diff_path = Path(args.diff).resolve()
    if not diff_path.exists():
        print(f"Difference image not found: {diff_path}", file=sys.stderr)
        return 1

    # Load ASL difference image
    print(f"Loading ASL difference image: {diff_path}")
    diff_img = nib.load(str(diff_path))
    diff_data = diff_img.get_fdata()
    print(f"  Shape: {diff_data.shape}, range: [{diff_data.min():.4f}, {diff_data.max():.4f}]")

    # Load M0
    m0_data = None
    if not args.no_m0:
        if not args.m0:
            print("[ERROR] --m0 is required for absolute CBF quantification. Use --no-m0 for relative CBF.", file=sys.stderr)
            return 1
        m0_path = Path(args.m0).resolve()
        if not m0_path.exists():
            print(f"M0 image not found: {m0_path}", file=sys.stderr)
            return 1
        m0_img = nib.load(str(m0_path))
        m0_data = m0_img.get_fdata()
        print(f"  M0 shape: {m0_data.shape}, range: [{m0_data.min():.4f}, {m0_data.max():.4f}]")
    else:
        m0_data = np.ones_like(diff_data)
        print("  No M0 normalization (relative CBF)")

    # Get quantification parameters
    strategy = args.label_strategy
    params = DEFAULT_PARAMS[strategy].copy()

    if args.alpha is not None:
        params["alpha"] = args.alpha
    if args.tau is not None:
        params["tau"] = args.tau
    if args.pld is not None:
        params["pld"] = args.pld

    t1b = T1B[args.field_strength]

    print(f"\nCBF Quantification Parameters:")
    print(f"  Strategy: {strategy}")
    print(f"  α (labeling efficiency): {params['alpha']}")
    print(f"  τ (label duration): {params['tau']} s")
    print(f"  PLD (post-labeling delay): {params['pld']} s")
    print(f"  T1b (blood T1 at {args.field_strength}T): {t1b} s")
    print(f"  λ (partition coefficient): {LAMBDA} mL/g")

    # Compute CBF
    if strategy in ("pcasl", "casl"):
        cbf_data = compute_cbf_pcasl_casl(
            diff_data, m0_data,
            alpha=params["alpha"], tau=params["tau"], pld=params["pld"], t1b=t1b,
        )
    else:
        cbf_data = compute_cbf_pasl(
            diff_data, m0_data,
            alpha=params["alpha"], ti1=params["tau"], ti2=params["pld"], t1b=t1b,
        )

    # Clip negative values
    cbf_data = np.clip(cbf_data, 0, None)

    # Save CBF map
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cbf_img = nib.Nifti1Image(cbf_data, diff_img.affine, diff_img.header)
    nib.save(cbf_img, str(output_path))
    print(f"\nCBF map saved: {output_path}")
    print(f"  Range: [{cbf_data.min():.2f}, {cbf_data.max():.2f}] mL/100g/min")
    print(f"  Mean (non-zero): {cbf_data[cbf_data > 0].mean():.2f} mL/100g/min")

    # ROI extraction
    if args.roi_atlas and args.roi_summary:
        atlas_path = Path(args.roi_atlas).resolve()
        if not atlas_path.exists():
            print(f"[WARN] Atlas not found: {atlas_path}", file=sys.stderr)
        else:
            atlas_img = nib.load(str(atlas_path))
            atlas_data = atlas_img.get_fdata()

            labels = None
            if args.roi_labels:
                labels = [int(l.strip()) for l in args.roi_labels.split(",")]

            roi_values = extract_roi_mean(cbf_data, atlas_data, labels)

            import csv
            summary_path = Path(args.roi_summary).resolve()
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            with open(summary_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["roi_label", "mean_cbf_ml_100g_min"])
                for label, mean_cbf in sorted(roi_values.items()):
                    writer.writerow([label, f"{mean_cbf:.2f}"])
            print(f"\nROI summary ({len(roi_values)} ROIs) -> {summary_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
