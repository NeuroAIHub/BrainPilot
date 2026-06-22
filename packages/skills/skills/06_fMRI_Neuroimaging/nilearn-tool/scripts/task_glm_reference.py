from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import pandas as pd
from nilearn.glm.first_level import FirstLevelModel
from nilearn.plotting import plot_design_matrix


def run_task_glm(
    bold_path: Path,
    events_path: Path,
    output_dir: Path,
    tr: float,
    contrast: str,
    confounds_path: Path | None = None,
    mask_path: Path | None = None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    events = pd.read_csv(events_path, sep=None, engine="python")
    confounds = pd.read_csv(confounds_path, sep=None, engine="python") if confounds_path is not None else None

    model = FirstLevelModel(t_r=tr, mask_img=str(mask_path) if mask_path is not None else None)
    model = model.fit(str(bold_path), events=events, confounds=confounds)

    design_matrix = model.design_matrices_[0]
    design_matrix.to_csv(output_dir / "design_matrix.csv", index=False)
    plot_design_matrix(design_matrix).figure.savefig(output_dir / "design_matrix.png", dpi=150, bbox_inches="tight")

    z_map = model.compute_contrast(contrast, output_type="z_score")
    effect_map = model.compute_contrast(contrast, output_type="effect_size")
    nib.save(z_map, str(output_dir / "z_map.nii.gz"))
    nib.save(effect_map, str(output_dir / "effect_map.nii.gz"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn snippet for first-level task GLM.")
    parser.add_argument("--bold", type=Path, required=True, help="Input preprocessed task BOLD NIfTI.")
    parser.add_argument("--events", type=Path, required=True, help="Events TSV/CSV with onset, duration, and trial_type.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for GLM outputs.")
    parser.add_argument("--tr", type=float, required=True, help="Repetition time in seconds.")
    parser.add_argument("--contrast", type=str, required=True, help="Named contrast expression.")
    parser.add_argument("--confounds", type=Path, default=None, help="Optional confounds TSV/CSV.")
    parser.add_argument("--mask", type=Path, default=None, help="Optional mask image.")
    args = parser.parse_args()

    run_task_glm(
        bold_path=args.bold,
        events_path=args.events,
        output_dir=args.output_dir,
        tr=args.tr,
        contrast=args.contrast,
        confounds_path=args.confounds,
        mask_path=args.mask,
    )
    print(f"Saved first-level GLM outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()