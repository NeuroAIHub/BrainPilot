from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd


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


def export_atlas_centers(atlas_path: Path, label_path: Path, output_path: Path) -> None:
    atlas_img = nib.load(str(atlas_path))
    atlas_data = atlas_img.get_fdata()
    labels = load_labels(label_path)

    roi_ids = sorted(int(value) for value in np.unique(atlas_data) if value > 0)
    rows = []
    for roi_id in roi_ids:
        center = get_roi_center(atlas_data, atlas_img.affine, roi_id)
        label_name = labels[roi_id - 1] if roi_id - 1 < len(labels) else f"ROI_{roi_id}"
        rows.append(
            {
                "Region_ID": roi_id,
                "Region_Name": label_name,
                "MNI_X": center[0],
                "MNI_Y": center[1],
                "MNI_Z": center[2],
            }
        )

    table = pd.DataFrame(rows)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    table.to_csv(output_path, index=False)
    print(f"Saved atlas ROI centers to: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference script for atlas ROI center extraction with nibabel.")
    parser.add_argument("--atlas", type=Path, required=True, help="Input atlas NIfTI with integer ROI labels.")
    parser.add_argument("--labels", type=Path, required=True, help="Text file containing ROI labels.")
    parser.add_argument("--output", type=Path, required=True, help="Output CSV for ROI centers.")
    args = parser.parse_args()
    export_atlas_centers(args.atlas, args.labels, args.output)


if __name__ == "__main__":
    main()