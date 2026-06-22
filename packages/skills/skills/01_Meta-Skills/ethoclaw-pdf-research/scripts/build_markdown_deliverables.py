#!/usr/bin/env python3
import argparse
import subprocess
import sys
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parent


def run(cmd):
    subprocess.run(cmd, check=True)


def main():
    parser = argparse.ArgumentParser(description="Create markdown deliverable scaffolds from a PDF bundle manifest.")
    parser.add_argument("manifest", help="Path to manifest.json produced by extract_pdf_bundle.py")
    parser.add_argument("--output-dir", required=True, help="Directory for markdown deliverables")
    parser.add_argument("--title", default="", help="Optional title override")
    args = parser.parse_args()

    manifest = Path(args.manifest).expanduser().resolve()
    outdir = Path(args.output_dir).expanduser().resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    summary_path = outdir / "summary.md"
    research_log_path = outdir / "research-log.md"

    common = [str(manifest)]
    if args.title:
        common += ["--title", args.title]

    run([sys.executable, str(SCRIPT_DIR / "build_summary_md.py"), *common, "--output", str(summary_path)])
    run([sys.executable, str(SCRIPT_DIR / "build_research_log.py"), *common, "--output", str(research_log_path)])

    print(summary_path)
    print(research_log_path)


if __name__ == "__main__":
    main()
