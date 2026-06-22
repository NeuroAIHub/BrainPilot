from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
from dipy.io.gradients import read_bvals_bvecs
from dipy.io.image import load_nifti, save_nifti
from dipy.segment.mask import median_otsu


def load_dwi(dwi_path: Path, bval_path: Path, bvec_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    data, affine = load_nifti(str(dwi_path))
    bvals, bvecs = read_bvals_bvecs(str(bval_path), str(bvec_path))

    if data.ndim != 4:
        raise ValueError(f"DWI must be 4D. Got shape={data.shape}")
    if data.shape[-1] != len(bvals) or data.shape[-1] != len(bvecs):
        raise ValueError(
            "Gradient count does not match DWI volumes: "
            f"volumes={data.shape[-1]}, bvals={len(bvals)}, bvecs={len(bvecs)}"
        )

    return data.astype(np.float32), affine, bvals.astype(float), bvecs.astype(float)


def make_mask(data: np.ndarray, bvals: np.ndarray, affine: np.ndarray, out_mask_path: Path, b0_threshold: float) -> np.ndarray:
    b0_indices = np.where(bvals < b0_threshold)[0]
    if b0_indices.size == 0:
        raise ValueError("No b0 volumes found; cannot build mask with median_otsu.")

    _, mask = median_otsu(data, vol_idx=b0_indices, numpass=4, autocrop=False)
    save_nifti(str(out_mask_path), mask.astype(np.uint8), affine)
    return mask.astype(np.uint8)


def save_b0_mean(data: np.ndarray, bvals: np.ndarray, affine: np.ndarray, out_path: Path, b0_threshold: float) -> None:
    b0_indices = np.where(bvals < b0_threshold)[0]
    if b0_indices.size == 0:
        raise ValueError("No b0 volumes found; cannot save mean b0 image.")
    b0_mean = np.mean(data[..., b0_indices], axis=3)
    nib.save(nib.Nifti1Image(b0_mean.astype(np.float32), affine), str(out_path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference DIPY snippet for DWI loading and brain mask generation.")
    parser.add_argument("--dwi", type=Path, required=True, help="Input DWI 4D NIfTI.")
    parser.add_argument("--bval", type=Path, required=True, help="Input bvals file.")
    parser.add_argument("--bvec", type=Path, required=True, help="Input bvecs file.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for mask and summary outputs.")
    parser.add_argument("--b0-threshold", type=float, default=50.0, help="Threshold for identifying b0 volumes.")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    data, affine, bvals, bvecs = load_dwi(args.dwi, args.bval, args.bvec)
    mask = make_mask(data, bvals, affine, args.output_dir / "brain_mask.nii.gz", args.b0_threshold)
    save_b0_mean(data, bvals, affine, args.output_dir / "mean_b0.nii.gz", args.b0_threshold)

    summary = args.output_dir / "dwi_summary.txt"
    summary.write_text(
        "\n".join(
            [
                f"shape={data.shape}",
                f"n_bvals={len(bvals)}",
                f"n_bvecs={len(bvecs)}",
                f"mask_voxels={int(mask.sum())}",
            ]
        ),
        encoding="utf-8",
    )
    print(f"Saved mask and DWI summary to: {args.output_dir}")


if __name__ == "__main__":
    main()