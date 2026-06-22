from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd


def roi_stats(metric_path: Path, roi_path: Path, label_path: Path | None, out_csv: Path, min_voxels: int) -> None:
    metric = nib.load(str(metric_path)).get_fdata()
    roi = nib.load(str(roi_path)).get_fdata().astype(int)

    labels = None
    if label_path is not None:
        labels = [line.strip() for line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip()]

    rows = []
    for label_id in np.unique(roi):
        if label_id == 0:
            continue
        values = metric[roi == label_id]
        values = values[np.isfinite(values)]
        if values.size < min_voxels:
            continue

        rows.append(
            {
                "label": int(label_id),
                "label_name": labels[int(label_id) - 1] if labels is not None and int(label_id) - 1 < len(labels) else "",
                "n_vox": int(values.size),
                "mean": float(values.mean()),
                "median": float(np.median(values)),
                "std": float(values.std(ddof=1)) if values.size > 1 else 0.0,
                "p05": float(np.percentile(values, 5)),
                "p95": float(np.percentile(values, 95)),
            }
        )

    pd.DataFrame(rows).sort_values("label").to_csv(out_csv, index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference DIPY snippet for atlas-based ROI statistics on tensor metrics.")
    parser.add_argument("--metric", type=Path, required=True, help="Input metric NIfTI such as FA.nii.gz.")
    parser.add_argument("--roi", type=Path, required=True, help="Atlas or ROI label NIfTI in the same space as the metric.")
    parser.add_argument("--output", type=Path, required=True, help="Output CSV path.")
    parser.add_argument("--labels", type=Path, default=None, help="Optional atlas label text file.")
    parser.add_argument("--min-voxels", type=int, default=10, help="Minimum voxel count for a region to be reported.")
    args = parser.parse_args()

    args.output.parent.mkdir(parents=True, exist_ok=True)
    roi_stats(args.metric, args.roi, args.labels, args.output, args.min_voxels)
    print(f"Saved ROI statistics to: {args.output}")


if __name__ == "__main__":
    main()