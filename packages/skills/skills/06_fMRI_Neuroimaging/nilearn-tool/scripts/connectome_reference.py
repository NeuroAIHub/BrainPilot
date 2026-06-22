from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
from nilearn.connectome import ConnectivityMeasure
from nilearn.maskers import NiftiLabelsMasker


def load_labels(label_path: Path) -> list[str]:
    with label_path.open("r", encoding="utf-8", errors="ignore") as handle:
        return [line.strip() for line in handle if line.strip()]


def export_connectome(
    bold_path: Path,
    atlas_path: Path,
    output_dir: Path,
    tr: float,
    label_path: Path | None = None,
) -> None:
    bold_img = nib.load(str(bold_path))
    masker = NiftiLabelsMasker(labels_img=str(atlas_path), t_r=tr, standardize=True, detrend=True)
    roi_time_series = masker.fit_transform(bold_img)

    connectome = ConnectivityMeasure(kind="correlation").fit_transform([roi_time_series])[0]
    output_dir.mkdir(parents=True, exist_ok=True)

    np.save(output_dir / "connectome.npy", connectome)
    pd.DataFrame(roi_time_series).to_csv(output_dir / "roi_timeseries.csv", index=False)

    if label_path is not None:
        labels = load_labels(label_path)
        count = min(len(labels), connectome.shape[0])
        pd.DataFrame(connectome[:count, :count], index=labels[:count], columns=labels[:count]).to_csv(
            output_dir / "connectome.csv"
        )
    else:
        pd.DataFrame(connectome).to_csv(output_dir / "connectome.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn snippet for ROI extraction and connectome computation.")
    parser.add_argument("--bold", type=Path, required=True, help="Input preprocessed BOLD NIfTI.")
    parser.add_argument("--atlas", type=Path, required=True, help="Atlas NIfTI for ROI extraction.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for ROI and connectome outputs.")
    parser.add_argument("--tr", type=float, default=1.0, help="Repetition time in seconds.")
    parser.add_argument("--labels", type=Path, default=None, help="Optional atlas label text file.")
    args = parser.parse_args()

    export_connectome(
        bold_path=args.bold,
        atlas_path=args.atlas,
        output_dir=args.output_dir,
        tr=args.tr,
        label_path=args.labels,
    )
    print(f"Saved connectome outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()