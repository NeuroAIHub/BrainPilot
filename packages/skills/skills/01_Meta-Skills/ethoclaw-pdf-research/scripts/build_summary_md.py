#!/usr/bin/env python3
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Build a markdown summary template from an extracted PDF bundle manifest.")
    parser.add_argument("manifest", help="Path to manifest.json produced by extract_pdf_bundle.py")
    parser.add_argument("--title", default="", help="Override document title")
    parser.add_argument("--output", default="", help="Write markdown to this path; otherwise print to stdout")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pdfinfo = manifest.get("pdfinfo", {})
    title = args.title or pdfinfo.get("Title") or Path(manifest["source_pdf"]).stem

    md = f"""# Summary: {title}

## Source
- PDF: {manifest['source_pdf']}
- Total pages: {manifest.get('page_count', 'unknown')}
- Extracted text: {manifest['text']['path']}
- Preview images: {manifest['images']['dir']}

## Executive summary
- Topic:
- Purpose:
- Core message:

## Key findings
- 
- 
- 

## Evidence / basis
- 
- 
- 

## Practical takeaway
- 
- 

## Caveats
- 
- 

## Suggested next step
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
