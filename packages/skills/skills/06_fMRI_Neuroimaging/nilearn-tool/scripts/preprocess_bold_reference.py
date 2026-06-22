from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
from nilearn.datasets import load_mni152_template
from nilearn.image import resample_to_img, smooth_img
from scipy.signal import butter, filtfilt


def drop_dummies(image: nib.spatialimages.SpatialImage, n_dummies: int) -> nib.Nifti1Image:
    data = image.get_fdata()[..., n_dummies:]
    return nib.Nifti1Image(data, image.affine, image.header)


def bandpass_filter(image: nib.spatialimages.SpatialImage, tr: float, high_pass: float, low_pass: float) -> nib.Nifti1Image:
    data = image.get_fdata()
    n_timepoints = data.shape[3]
    nyquist = 0.5 / tr
    b_coef, a_coef = butter(2, [high_pass / nyquist, low_pass / nyquist], btype="band")

    flat = data.reshape(-1, n_timepoints)
    mask = np.std(flat, axis=1) > 0
    result = flat.copy()
    result[mask] = filtfilt(b_coef, a_coef, flat[mask], axis=1)
    return nib.Nifti1Image(result.reshape(data.shape), image.affine, image.header)


def preprocess_bold(
    bold_path: Path,
    output_path: Path,
    tr: float,
    fwhm: float,
    high_pass: float,
    low_pass: float,
    n_dummies: int,
) -> None:
    image = nib.load(str(bold_path))
    processed = drop_dummies(image, n_dummies=n_dummies)
    processed = smooth_img(processed, fwhm=fwhm)
    processed = bandpass_filter(processed, tr=tr, high_pass=high_pass, low_pass=low_pass)

    template = load_mni152_template(resolution=2)
    processed = resample_to_img(processed, template, interpolation="linear")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    nib.save(processed, str(output_path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn preprocessing snippet for resting-state BOLD.")
    parser.add_argument("--bold", type=Path, required=True, help="Input 4D BOLD NIfTI.")
    parser.add_argument("--output", type=Path, required=True, help="Output preprocessed BOLD NIfTI.")
    parser.add_argument("--tr", type=float, default=1.0, help="Repetition time in seconds.")
    parser.add_argument("--fwhm", type=float, default=6.0, help="Smoothing kernel FWHM in mm.")
    parser.add_argument("--high-pass", type=float, default=0.01, help="High-pass frequency in Hz.")
    parser.add_argument("--low-pass", type=float, default=0.10, help="Low-pass frequency in Hz.")
    parser.add_argument("--n-dummies", type=int, default=5, help="Number of initial dummy scans to drop.")
    args = parser.parse_args()

    preprocess_bold(
        bold_path=args.bold,
        output_path=args.output,
        tr=args.tr,
        fwhm=args.fwhm,
        high_pass=args.high_pass,
        low_pass=args.low_pass,
        n_dummies=args.n_dummies,
    )
    print(f"Saved preprocessed BOLD to: {args.output}")


if __name__ == "__main__":
    main()