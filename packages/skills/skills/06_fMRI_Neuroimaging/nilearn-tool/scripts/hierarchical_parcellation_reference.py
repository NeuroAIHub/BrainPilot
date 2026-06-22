from __future__ import annotations

import argparse
from pathlib import Path

import nibabel as nib
import numpy as np
import pandas as pd
from nilearn.maskers import NiftiMasker
from sklearn.cluster import AgglomerativeClustering


def load_image_list(list_path: Path) -> list[str]:
    with list_path.open("r", encoding="utf-8") as handle:
        return [line.strip() for line in handle if line.strip()]


def build_feature_matrix(images: list[str], masker: NiftiMasker) -> np.ndarray:
    subject_vectors = [masker.fit_transform(image_path) for image_path in images]
    stacked = np.vstack(subject_vectors)
    return stacked.reshape(len(images), -1, stacked.shape[-1]).mean(axis=0)


def run_hierarchical(input_list: Path, output_dir: Path, n_clusters: int, mask_path: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    images = load_image_list(input_list)

    masker = NiftiMasker(mask_img=str(mask_path), standardize=True)
    features = build_feature_matrix(images, masker)
    model = AgglomerativeClustering(n_clusters=n_clusters, linkage="ward")
    labels = model.fit_predict(features)

    label_img = masker.inverse_transform(labels[:, None].astype(float))
    nib.save(label_img, str(output_dir / "parcel_labels.nii.gz"))
    pd.DataFrame({"cluster": np.arange(n_clusters), "size": np.bincount(labels, minlength=n_clusters)}).to_csv(
        output_dir / "cluster_summary.csv", index=False
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference snippet for hierarchical neuroimaging parcellation.")
    parser.add_argument("--input-list", type=Path, required=True, help="Text file listing aligned images.")
    parser.add_argument("--mask", type=Path, required=True, help="Mask image defining spatial units.")
    parser.add_argument("--n-clusters", type=int, required=True, help="Number of clusters / parcels.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for parcellation outputs.")
    args = parser.parse_args()

    run_hierarchical(args.input_list, args.output_dir, args.n_clusters, args.mask)
    print(f"Saved hierarchical parcellation outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()