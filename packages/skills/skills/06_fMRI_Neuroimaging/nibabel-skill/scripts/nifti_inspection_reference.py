from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib


def inspect_nifti(image_path: Path, copy_output: Path | None = None) -> None:
    image = nib.load(str(image_path))
    print(f"Path: {image_path}")
    print(f"Shape: {image.shape}")
    print(f"Data type: {image.get_data_dtype()}")
    print(f"Zooms: {image.header.get_zooms()}")
    print("Affine:")
    print(image.affine)

    if copy_output is not None:
        data = image.get_fdata()
        copied = nib.Nifti1Image(data, image.affine, image.header)
        copy_output.parent.mkdir(parents=True, exist_ok=True)
        nib.save(copied, str(copy_output))
        print(f"Saved copy to: {copy_output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference script for NIfTI inspection and save operations with nibabel.")
    parser.add_argument("--image", type=Path, required=True, help="Input NIfTI image (.nii or .nii.gz).")
    parser.add_argument("--copy-output", type=Path, default=None, help="Optional output path for saving an image copy.")
    args = parser.parse_args()
    inspect_nifti(args.image, args.copy_output)


if __name__ == "__main__":
    main()