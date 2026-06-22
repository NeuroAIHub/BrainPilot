from __future__ import annotations

import argparse
from pathlib import Path

import nibabel.freesurfer as fs
import numpy as np


def summarize_freesurfer_files(surf_path: Path, annot_path: Path) -> None:
    coords, faces = fs.read_geometry(str(surf_path))
    labels, color_table, names = fs.read_annot(str(annot_path))

    unique_labels = np.unique(labels)
    print(f"Surface: {surf_path}")
    print(f"Vertices: {len(coords)}")
    print(f"Faces: {len(faces)}")
    print(f"Annotation: {annot_path}")
    print(f"Unique annotation ids: {len(unique_labels)}")
    print(f"Color table rows: {len(color_table)}")
    print(f"Annotation names: {len(names)}")
    print(f"Vertex coordinate sample: {coords[0].tolist() if len(coords) else []}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference script for FreeSurfer geometry and annotation I/O with nibabel.")
    parser.add_argument("--surf", type=Path, required=True, help="FreeSurfer surface file such as lh.pial.")
    parser.add_argument("--annot", type=Path, required=True, help="FreeSurfer annotation file such as lh.aparc.annot.")
    args = parser.parse_args()
    summarize_freesurfer_files(args.surf, args.annot)


if __name__ == "__main__":
    main()