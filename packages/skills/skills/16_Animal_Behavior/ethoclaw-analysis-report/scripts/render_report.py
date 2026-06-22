from __future__ import annotations

import argparse
from pathlib import Path

from report_utils import load_json, render_report_html, render_report_markdown, write_text


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render markdown and HTML outputs from a manifest.json file.")
    parser.add_argument("--manifest", required=True, help="Path to an existing manifest JSON file.")
    parser.add_argument("--output-dir", help="Directory for rendered report outputs.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    manifest = load_json(manifest_path)
    project_path = Path(manifest["project_path"]).resolve()

    output_dir = Path(args.output_dir).resolve() if args.output_dir else (project_path / "report_output")
    output_dir.mkdir(parents=True, exist_ok=True)

    markdown_text = render_report_markdown(manifest)
    html_text = render_report_html(manifest, markdown_text)

    write_text(output_dir / "report.md", markdown_text)
    write_text(output_dir / "report.html", html_text)
    print(f"Rendered HTML report to {output_dir}")


if __name__ == "__main__":
    main()
