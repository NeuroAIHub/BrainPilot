#!/usr/bin/env python3
"""Inspect an HDF5 (.h5/.hdf5) file and print a tree of groups/datasets.

Usage:
  python h5_inspect.py path/to/file.h5

Notes:
- Requires: h5py
- Prints dataset shapes/dtypes and a preview for small 1D datasets.
"""

from __future__ import annotations

import sys
from typing import Any


def _fmt(obj: Any) -> str:
    try:
        return str(obj)
    except Exception:
        return repr(obj)


def _walk(h5, path: str = "/", indent: int = 0) -> None:
    import h5py  # local import for nicer dependency error

    item = h5[path]
    pad = "  " * indent

    if isinstance(item, h5py.Dataset):
        shape = item.shape
        dtype = item.dtype
        print(f"{pad}{path}  [Dataset] shape={shape} dtype={dtype}")
        # small preview
        try:
            if shape is not None and len(shape) == 1 and shape[0] <= 10:
                data = item[...]
                print(f"{pad}  preview: {_fmt(data)}")
        except Exception:
            pass
        return

    print(f"{pad}{path}  [Group]")
    for key in item.keys():
        child_path = (path.rstrip("/") + "/" + key) if path != "/" else "/" + key
        _walk(h5, child_path, indent + 1)


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[1] in {"-h", "--help"}:
        print(__doc__.strip())
        return 0

    h5_path = argv[1]

    try:
        import h5py  # noqa: F401
    except Exception as e:
        print(
            "ERROR: missing dependency 'h5py'.\n"
            "Install options:\n"
            "  - Ubuntu/Debian: apt install python3-pip python3-venv && pip install h5py\n"
            "  - Or use a dedicated venv/conda env.\n"
            f"Details: {e}",
            file=sys.stderr,
        )
        return 2

    import h5py

    with h5py.File(h5_path, "r") as h5:
        _walk(h5, "/", 0)

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
