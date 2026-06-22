from __future__ import annotations

import argparse
from pathlib import Path

import nibabel.freesurfer as fs
import numpy as np


def export_colored_ply(surf_path: Path, annot_path: Path, output_path: Path) -> None:
    coords, faces = fs.read_geometry(str(surf_path))
    labels, color_table, _ = fs.read_annot(str(annot_path))

    vertex_colors = np.zeros((len(coords), 3), dtype=np.uint8)
    for index, label in enumerate(labels):
        if 0 <= label < len(color_table):
            vertex_colors[index] = color_table[label, :3]
        else:
            vertex_colors[index] = [128, 128, 128]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as handle:
        handle.write("ply\n")
        handle.write("format ascii 1.0\n")
        handle.write(f"element vertex {len(coords)}\n")
        handle.write("property float x\n")
        handle.write("property float y\n")
        handle.write("property float z\n")
        handle.write("property uchar red\n")
        handle.write("property uchar green\n")
        handle.write("property uchar blue\n")
        handle.write(f"element face {len(faces)}\n")
        handle.write("property list uchar int vertex_indices\n")
        handle.write("end_header\n")

        for vertex, color in zip(coords, vertex_colors):
            handle.write(f"{vertex[0]:.6f} {vertex[1]:.6f} {vertex[2]:.6f} {color[0]} {color[1]} {color[2]}\n")
        for face in faces:
            handle.write(f"3 {face[0]} {face[1]} {face[2]}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference script for exporting FreeSurfer surfaces to colored PLY.")
    parser.add_argument("--surf", type=Path, required=True, help="FreeSurfer surface file such as lh.pial or rh.pial.")
    parser.add_argument("--annot", type=Path, required=True, help="FreeSurfer annotation file such as lh.aparc.annot.")
    parser.add_argument("--output", type=Path, required=True, help="Output PLY path.")
    args = parser.parse_args()

    export_colored_ply(args.surf, args.annot, args.output)
    print(f"Saved colored PLY to: {args.output}")


if __name__ == "__main__":
    main()