from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
from nilearn import image
from nilearn.maskers import NiftiLabelsMasker


def load_labels(label_path: Path) -> list[str]:
    with label_path.open("r", encoding="utf-8", errors="ignore") as handle:
        return [line.strip() for line in handle if line.strip()]


def get_roi_center(atlas_data: np.ndarray, affine: np.ndarray, roi_id: int) -> list[float]:
    coords = np.argwhere(atlas_data == roi_id)
    if len(coords) == 0:
        return [0.0, 0.0, 0.0]
    center = np.median(coords, axis=0)
    xyz = nib.affines.apply_affine(affine, center)
    return np.round(xyz, 2).tolist()


def export_zalff_summary(
    bold_path: Path,
    atlas_path: Path,
    label_path: Path,
    mask_path: Path,
    output_dir: Path,
    tr: float,
    top_n: int,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    bold_img = nib.load(str(bold_path))
    mni_img = image.resample_to_img(bold_img, str(mask_path), interpolation="linear", force_resample=True)
    cleaned = image.clean_img(
        mni_img,
        detrend=True,
        standardize=False,
        low_pass=0.1,
        high_pass=0.01,
        t_r=tr,
        mask_img=str(mask_path),
    )

    alff = image.math_img("np.std(img, axis=3)", img=cleaned)
    mask_data = nib.load(str(mask_path)).get_fdata() > 0.5
    alff_values = alff.get_fdata()[mask_data]
    mean_value = float(np.mean(alff_values))
    std_value = float(np.std(alff_values))
    if std_value == 0:
        raise ValueError("zALFF normalization failed because the standard deviation is zero.")

    zalff = image.math_img(f"(img - {mean_value}) / {std_value}", img=alff)

    labels = load_labels(label_path)
    masker = NiftiLabelsMasker(labels_img=str(atlas_path), standardize=False)
    roi_values = masker.fit_transform(zalff)[0]

    summary = pd.DataFrame(
        {
            "Region_ID": range(1, len(roi_values) + 1),
            "Region_Name": labels[: len(roi_values)],
            "zALFF": roi_values,
        }
    ).sort_values(by="zALFF", ascending=False, ignore_index=True)

    atlas_img = nib.load(str(atlas_path))
    atlas_data = atlas_img.get_fdata()
    affine = atlas_img.affine
    coordinates = [get_roi_center(atlas_data, affine, int(region_id)) for region_id in summary["Region_ID"]]
    summary[["MNI_X", "MNI_Y", "MNI_Z"]] = pd.DataFrame(coordinates, index=summary.index)

    summary.head(top_n).to_csv(output_dir / "TOP_active_regions.csv", index=False)
    summary.head(top_n)[["Region_Name", "MNI_X", "MNI_Y", "MNI_Z", "zALFF"]].to_csv(
        output_dir / "top_coordinates.csv", index=False
    )
    summary.to_csv(output_dir / "all_brain_regions_activity.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn snippet for zALFF regional summaries.")
    parser.add_argument("--bold", type=Path, required=True, help="Input 4D BOLD NIfTI.")
    parser.add_argument("--atlas", type=Path, required=True, help="Atlas NIfTI for regional summaries.")
    parser.add_argument("--labels", type=Path, required=True, help="Atlas label text file.")
    parser.add_argument("--mask", type=Path, required=True, help="Mask image for resampling and cleaning.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for summary outputs.")
    parser.add_argument("--tr", type=float, default=1.0, help="Repetition time in seconds.")
    parser.add_argument("--top-n", type=int, default=10, help="Number of top regions to export.")
    args = parser.parse_args()

    export_zalff_summary(
        bold_path=args.bold,
        atlas_path=args.atlas,
        label_path=args.labels,
        mask_path=args.mask,
        output_dir=args.output_dir,
        tr=args.tr,
        top_n=args.top_n,
    )
    print(f"Saved zALFF summaries to: {args.output_dir}")


if __name__ == "__main__":
    main()