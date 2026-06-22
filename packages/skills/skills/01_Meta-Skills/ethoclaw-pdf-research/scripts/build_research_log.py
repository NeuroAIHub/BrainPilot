#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Build a markdown research-log template from an extracted PDF bundle manifest.")
    parser.add_argument("manifest", help="Path to manifest.json produced by extract_pdf_bundle.py")
    parser.add_argument("--title", default="", help="Override document title")
    parser.add_argument("--output", default="", help="Write markdown to this path; otherwise print to stdout")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pdfinfo = manifest.get("pdfinfo", {})
    title = args.title or pdfinfo.get("Title") or Path(manifest["source_pdf"]).stem

    image_files = manifest.get("images", {}).get("files", [])
    image_list = "\n".join(f"- {p}" for p in image_files[:12]) or "- (none)"

    md = f"""# Research Log: {title}

## Source
- PDF: {manifest['source_pdf']}
- Total pages: {manifest.get('page_count', 'unknown')}
- Extracted text: {manifest['text']['path']}
- Rendered preview pages: {manifest['images']['first_page']}-{manifest['images']['last_page']} @ {manifest['images']['dpi']} DPI

## Suggested reading plan for the model
1. Read `manifest.json` first for metadata.
2. Read `document.txt` for the raw extracted text.
3. If the text looks broken, inspect the rendered PNG pages directly.
4. Summarize the paper/report in the structure below.

## Rendered page files
{image_list}

## Summary
- One-paragraph overview:
- Document type / topic:
- Main question or purpose:

## Key points
- 
- 
- 

## Methods / data / evidence
- 
- 
- 

## Results / claims
- 
- 
- 

## Caveats
- 
- 
- 

## Useful quotes or numbers
- 
- 
- 

## My follow-up notes
- 
- 
- 
"""

    if args.output:
        out = Path(args.output).expanduser().resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(md, encoding="utf-8")
    else:
        print(md)


if __name__ == "__main__":
    main()
