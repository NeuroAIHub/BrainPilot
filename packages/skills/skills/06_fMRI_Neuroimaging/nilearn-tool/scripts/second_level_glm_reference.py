from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import pandas as pd
from nilearn.glm.second_level import SecondLevelModel


def load_contrast_maps(list_path: Path) -> list[str]:
    with list_path.open("r", encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def run_second_level_glm(
    contrast_maps_path: Path,
    design_matrix_path: Path,
    output_dir: Path,
    contrast_name: str,
    mask_path: Path | None = None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    contrast_maps = load_contrast_maps(contrast_maps_path)
    design_matrix = pd.read_csv(design_matrix_path)

    model = SecondLevelModel(mask_img=str(mask_path) if mask_path is not None else None)
    model = model.fit(contrast_maps, design_matrix=design_matrix)
    z_map = model.compute_contrast(contrast_name, output_type="z_score")
    effect_map = model.compute_contrast(contrast_name, output_type="effect_size")

    nib.save(z_map, str(output_dir / "second_level_z_map.nii.gz"))
    nib.save(effect_map, str(output_dir / "second_level_effect_map.nii.gz"))
    design_matrix.to_csv(output_dir / "design_matrix.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn snippet for second-level GLM.")
    parser.add_argument("--contrast-maps", type=Path, required=True, help="Text file listing subject-level contrast maps.")
    parser.add_argument("--design-matrix", type=Path, required=True, help="CSV design matrix for group model.")
    parser.add_argument("--contrast", type=str, required=True, help="Column or contrast expression for group inference.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for second-level outputs.")
    parser.add_argument("--mask", type=Path, default=None, help="Optional mask image.")
    args = parser.parse_args()

    run_second_level_glm(
        contrast_maps_path=args.contrast_maps,
        design_matrix_path=args.design_matrix,
        output_dir=args.output_dir,
        contrast_name=args.contrast,
        mask_path=args.mask,
    )
    print(f"Saved second-level GLM outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()