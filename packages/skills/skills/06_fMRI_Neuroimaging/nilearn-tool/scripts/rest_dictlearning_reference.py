from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import pandas as pd
from nilearn.decomposition import DictLearning


def load_image_list(list_path: Path) -> list[str]:
    with list_path.open("r", encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def run_dictlearning(input_list: Path, output_dir: Path, n_components: int, mask_path: Path | None = None) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    images = load_image_list(input_list)

    model = DictLearning(
        n_components=n_components,
        mask=mask_path,
        random_state=0,
        memory="nilearn_cache",
        memory_level=1,
    )
    model.fit(images)

    nib.save(model.components_img_, str(output_dir / "components.nii.gz"))

    frames = []
    for index, image_path in enumerate(images):
        series = model.transform(image_path)
        frame = pd.DataFrame(series)
        frame.insert(0, "subject_index", index)
        frame.to_csv(output_dir / f"subject_{index:03d}_timeseries.csv", index=False)
        frames.append(frame)

    if frames:
        pd.concat(frames, ignore_index=True).to_csv(output_dir / "all_subject_timeseries.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn snippet for resting-state DictLearning.")
    parser.add_argument("--input-list", type=Path, required=True, help="Text file listing preprocessed resting-state BOLD images.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for DictLearning outputs.")
    parser.add_argument("--n-components", type=int, default=20, help="Number of dictionary components.")
    parser.add_argument("--mask", type=Path, default=None, help="Optional mask image.")
    args = parser.parse_args()

    run_dictlearning(args.input_list, args.output_dir, args.n_components, args.mask)
    print(f"Saved DictLearning outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()