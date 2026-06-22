from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
from nilearn.decoding import SpaceNetClassifier


def load_image_list(list_path: Path) -> list[str]:
    with list_path.open("r", encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def run_spacenet(
    input_list: Path,
    labels_path: Path,
    output_dir: Path,
    target: str,
    mask_path: Path | None = None,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    images = load_image_list(input_list)
    labels = pd.read_csv(labels_path)
    y = labels[target].to_numpy()

    model = SpaceNetClassifier(mask=mask_path, penalty="tv-l1", standardize=True, cv=3, n_jobs=1)
    model.fit(images, y)

    predictions = model.predict(images)
    pd.DataFrame({"y_true": y, "y_pred": predictions}).to_csv(output_dir / "predictions.csv", index=False)

    coef_img = model.coef_img_
    if isinstance(coef_img, (list, tuple)):
        coef_img = coef_img[0]
    nib.save(coef_img, str(output_dir / "coef_map.nii.gz"))

    decision = model.decision_function(images)
    pd.DataFrame({"decision_score": np.ravel(decision)}).to_csv(output_dir / "decision_scores.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn snippet for SpaceNet disease classification.")
    parser.add_argument("--input-list", type=Path, required=True, help="Text file listing aligned subject images.")
    parser.add_argument("--labels", type=Path, required=True, help="CSV label table.")
    parser.add_argument("--target", type=str, required=True, help="Target column in label table.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for classifier outputs.")
    parser.add_argument("--mask", type=Path, default=None, help="Optional mask image.")
    args = parser.parse_args()

    run_spacenet(args.input_list, args.labels, args.output_dir, args.target, args.mask)
    print(f"Saved SpaceNet outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()