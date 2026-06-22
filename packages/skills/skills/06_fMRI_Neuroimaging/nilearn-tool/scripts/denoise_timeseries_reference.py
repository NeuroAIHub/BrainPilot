from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import pandas as pd
from nilearn import image


def run_denoising(
    bold_path: Path,
    output_dir: Path,
    tr: float,
    confounds_path: Path | None = None,
    mask_path: Path | None = None,
    detrend: bool = False,
    standardize: bool = True,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    confounds = pd.read_csv(confounds_path, sep=None, engine="python") if confounds_path is not None else None
    cleaned = image.clean_img(
        str(bold_path),
        confounds=confounds,
        detrend=detrend,
        standardize=standardize,
        mask_img=str(mask_path) if mask_path is not None else None,
        t_r=tr,
    )
    nib.save(cleaned, str(output_dir / "cleaned_bold.nii.gz"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn snippet for confound regression and detrending.")
    parser.add_argument("--bold", type=Path, required=True, help="Input preprocessed BOLD image.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for cleaned outputs.")
    parser.add_argument("--tr", type=float, required=True, help="Repetition time in seconds.")
    parser.add_argument("--confounds", type=Path, default=None, help="Optional confounds TSV/CSV.")
    parser.add_argument("--mask", type=Path, default=None, help="Optional mask image.")
    parser.add_argument("--detrend", action="store_true", help="Enable temporal detrending.")
    parser.add_argument("--no-standardize", action="store_true", help="Disable standardization.")
    args = parser.parse_args()

    run_denoising(
        bold_path=args.bold,
        output_dir=args.output_dir,
        tr=args.tr,
        confounds_path=args.confounds,
        mask_path=args.mask,
        detrend=args.detrend,
        standardize=not args.no_standardize,
    )
    print(f"Saved cleaned outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()