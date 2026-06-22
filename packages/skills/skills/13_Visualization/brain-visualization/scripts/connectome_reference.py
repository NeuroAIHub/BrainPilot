from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import nibabel as nib
import numpy as np
from nilearn import plotting


def load_connectivity_matrix(matrix_path: Path) -> np.ndarray:
    if matrix_path.suffix.lower() == ".npy":
        matrix = np.load(matrix_path)
    else:
        matrix = np.loadtxt(matrix_path, delimiter=",")

    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1]:
        raise ValueError("Connectivity matrix must be square.")

    matrix = (matrix + matrix.T) / 2.0
    np.fill_diagonal(matrix, 0)
    return matrix


def keep_strongest_connections(matrix: np.ndarray, top_k: int) -> np.ndarray:
    if top_k <= 0:
        return matrix

    upper_indices = np.triu_indices_from(matrix, k=1)
    weights = matrix[upper_indices]
    positive = weights[weights > 0]
    if len(positive) == 0 or top_k >= len(positive):
        return matrix

    threshold = np.partition(positive, -top_k)[-top_k]
    filtered = matrix.copy()
    filtered[filtered < threshold] = 0
    return filtered


def plot_connectome_reference(
    atlas_path: Path,
    template_path: Path,
    matrix_path: Path,
    output_path: Path,
    top_k: int,
    node_size: int,
    brain_opacity: float,
) -> None:
    atlas_img = nib.load(str(atlas_path))
    coords = plotting.find_parcellation_cut_coords(atlas_img)

    matrix = load_connectivity_matrix(matrix_path)
    matrix = keep_strongest_connections(matrix, top_k)

    colors = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728"]
    node_colors = [colors[index % len(colors)] for index in range(len(coords))]

    fig, ax = plt.subplots(figsize=(12, 10), facecolor="white")
    plotting.plot_glass_brain(
        str(template_path),
        display_mode="ortho",
        axes=ax,
        alpha=brain_opacity,
    )
    plotting.plot_connectome(
        matrix,
        coords,
        node_color=node_colors,
        node_size=node_size,
        axes=ax,
        colorbar=True,
        edge_threshold=None,
        edge_vmin=-1,
        edge_vmax=1,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    plt.savefig(output_path, dpi=300, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference script for 3D brain connectome plotting.")
    parser.add_argument("--atlas", type=Path, required=True, help="Atlas NIfTI used to derive parcel coordinates.")
    parser.add_argument("--template", type=Path, required=True, help="Template T1 image for background display.")
    parser.add_argument("--matrix", type=Path, required=True, help="Connectivity matrix in .npy or .csv format.")
    parser.add_argument("--output", type=Path, required=True, help="Output PNG path.")
    parser.add_argument("--top-k", type=int, default=8, help="Number of strongest positive connections to keep.")
    parser.add_argument("--node-size", type=int, default=100, help="Node marker size.")
    parser.add_argument("--brain-opacity", type=float, default=0.18, help="Background template opacity.")
    args = parser.parse_args()

    plot_connectome_reference(
        atlas_path=args.atlas,
        template_path=args.template,
        matrix_path=args.matrix,
        output_path=args.output,
        top_k=args.top_k,
        node_size=args.node_size,
        brain_opacity=args.brain_opacity,
    )
    print(f"Saved connectome figure to: {args.output}")


if __name__ == "__main__":
    main()