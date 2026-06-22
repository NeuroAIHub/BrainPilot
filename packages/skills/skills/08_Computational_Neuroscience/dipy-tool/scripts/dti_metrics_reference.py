from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
from dipy.core.gradients import gradient_table
from dipy.io.gradients import read_bvals_bvecs
from dipy.io.image import load_nifti, save_nifti
from dipy.reconst.dti import TensorModel, fractional_anisotropy


def fit_dti(data: np.ndarray, bvals: np.ndarray, bvecs: np.ndarray, mask: np.ndarray, b0_threshold: float, dti_bmax: float):
    keep = (bvals <= dti_bmax) | (bvals < b0_threshold)
    if not np.any(keep):
        raise ValueError("No DTI-compatible volumes retained after b-value filtering.")

    gtab = gradient_table(bvals[keep], bvecs[keep], b0_threshold=b0_threshold)
    model = TensorModel(gtab)
    return model.fit(data[..., keep], mask=mask.astype(bool))


def save_metrics(tenfit, affine: np.ndarray, mask: np.ndarray, output_dir: Path) -> None:
    evals = np.clip(tenfit.evals, 0, None)
    fa = fractional_anisotropy(evals)
    fa[~np.isfinite(fa)] = 0.0
    fa[mask == 0] = 0.0

    metrics = {
        "FA.nii.gz": fa.astype(np.float32),
        "MD.nii.gz": tenfit.md.astype(np.float32),
        "AD.nii.gz": tenfit.ad.astype(np.float32),
        "RD.nii.gz": tenfit.rd.astype(np.float32),
    }
    for name, values in metrics.items():
        values[~np.isfinite(values)] = 0.0
        save_nifti(str(output_dir / name), values, affine)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference DIPY snippet for DTI fitting and FA/MD/AD/RD export.")
    parser.add_argument("--dwi", type=Path, required=True, help="Input DWI 4D NIfTI.")
    parser.add_argument("--bval", type=Path, required=True, help="Input bvals file.")
    parser.add_argument("--bvec", type=Path, required=True, help="Input bvecs file.")
    parser.add_argument("--mask", type=Path, required=True, help="Brain mask NIfTI in DWI space.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for tensor metrics.")
    parser.add_argument("--b0-threshold", type=float, default=50.0, help="Threshold for identifying b0 volumes.")
    parser.add_argument("--dti-bmax", type=float, default=1200.0, help="Max b-value for tensor fitting.")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    data, affine = load_nifti(str(args.dwi))
    bvals, bvecs = read_bvals_bvecs(str(args.bval), str(args.bvec))
    mask = nib.load(str(args.mask)).get_fdata() > 0

    tenfit = fit_dti(
        data=data.astype(np.float32),
        bvals=bvals.astype(float),
        bvecs=bvecs.astype(float),
        mask=mask.astype(np.uint8),
        b0_threshold=args.b0_threshold,
        dti_bmax=args.dti_bmax,
    )
    save_metrics(tenfit, affine, mask.astype(np.uint8), args.output_dir)
    print(f"Saved tensor metrics to: {args.output_dir}")


if __name__ == "__main__":
    main()