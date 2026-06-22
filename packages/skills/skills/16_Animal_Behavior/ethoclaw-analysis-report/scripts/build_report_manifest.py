from __future__ import annotations

import argparse
from pathlib import Path

from report_utils import build_manifest, ensure_project_path, save_json


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a manifest.json for an Ethoclaw analysis project.")
    parser.add_argument("--project-path", required=True, help="Path to the project directory to analyze.")
    parser.add_argument("--output", help="Optional output file path for manifest.json.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    project_path = ensure_project_path(args.project_path)
    manifest = build_manifest(project_path)
    if args.output:
        save_json(Path(args.output), manifest)
    else:
        print(manifest)


if __name__ == "__main__":
    main()
