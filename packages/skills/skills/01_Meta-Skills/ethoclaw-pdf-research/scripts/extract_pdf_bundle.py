#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path


def run(cmd):
    return subprocess.run(cmd, check=True, text=True, capture_output=True)


def parse_pdfinfo(pdf_path: Path):
    result = run(["pdfinfo", str(pdf_path)])
    info = {}
    for line in result.stdout.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        info[key.strip()] = value.strip()
    pages = int(info.get("Pages", "0") or 0)
    return {"raw": info, "pages": pages}


def sanitize_text(text: str) -> str:
    text = text.replace("\x0c", "\n")
    text = text.replace("\r", "")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def extract_text(pdf_path: Path, output_path: Path, first_page=None, last_page=None):
    cmd = ["pdftotext", "-enc", "UTF-8", "-layout"]
    if first_page is not None:
        cmd += ["-f", str(first_page)]
    if last_page is not None:
        cmd += ["-l", str(last_page)]
    cmd += [str(pdf_path), "-"]
    result = run(cmd)
    text = sanitize_text(result.stdout)
    output_path.write_text(text, encoding="utf-8")
    return text


def render_pages(pdf_path: Path, output_dir: Path, start_page: int, end_page: int, dpi: int):
    prefix = output_dir / "page"
    cmd = [
        "pdftoppm",
        "-png",
        "-r",
        str(dpi),
        "-f",
        str(start_page),
        "-l",
        str(end_page),
        str(pdf_path),
        str(prefix),
    ]
    run(cmd)
    images = sorted(output_dir.glob("page-*.png"))
    renamed = []
    for image in images:
        m = re.search(r"page-(\d+)\.png$", image.name)
        if not m:
            continue
        page_num = int(m.group(1))
        new_path = output_dir / f"page-{page_num:04d}.png"
        image.rename(new_path)
        renamed.append(new_path)
    return renamed


def main():
    parser = argparse.ArgumentParser(description="Extract text and rendered pages from a PDF into a reusable analysis bundle.")
    parser.add_argument("pdf", help="Path to the input PDF")
    parser.add_argument("--output-dir", required=True, help="Directory for extracted artifacts")
    parser.add_argument("--text-first-page", type=int, default=1, help="First page for text extraction")
    parser.add_argument("--text-last-page", type=int, default=0, help="Last page for text extraction; 0 means all pages")
    parser.add_argument("--render-first-page", type=int, default=1, help="First page to render as images")
    parser.add_argument("--render-last-page", type=int, default=8, help="Last page to render as images")
    parser.add_argument("--dpi", type=int, default=144, help="PNG render DPI")
    parser.add_argument("--clean", action="store_true", help="Delete output directory before writing")
    args = parser.parse_args()

    pdf_path = Path(args.pdf).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not pdf_path.exists():
        raise SystemExit(f"PDF not found: {pdf_path}")

    if shutil.which("pdfinfo") is None or shutil.which("pdftotext") is None or shutil.which("pdftoppm") is None:
        raise SystemExit("Missing required commands. Need pdfinfo, pdftotext, and pdftoppm in PATH.")

    if args.clean and output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    info = parse_pdfinfo(pdf_path)
    total_pages = info["pages"]
    text_last_page = total_pages if args.text_last_page in (0, None) else min(args.text_last_page, total_pages)
    render_last_page = min(args.render_last_page, total_pages)

    text_path = output_dir / "document.txt"
    text = extract_text(pdf_path, text_path, args.text_first_page, text_last_page)
    char_count = len(text.strip())

    images_dir = output_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    image_paths = render_pages(pdf_path, images_dir, args.render_first_page, render_last_page, args.dpi)

    manifest = {
        "source_pdf": str(pdf_path),
        "output_dir": str(output_dir),
        "page_count": total_pages,
        "text": {
            "path": str(text_path),
            "first_page": args.text_first_page,
            "last_page": text_last_page,
            "char_count": char_count,
        },
        "images": {
            "dir": str(images_dir),
            "first_page": args.render_first_page,
            "last_page": render_last_page,
            "dpi": args.dpi,
            "files": [str(p) for p in image_paths],
        },
        "pdfinfo": info["raw"],
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
