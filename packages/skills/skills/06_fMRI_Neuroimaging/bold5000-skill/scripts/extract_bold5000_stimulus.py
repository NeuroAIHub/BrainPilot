#!/usr/bin/env python3
"""Extract and organize BOLD5000 stimulus metadata for downstream analysis."""
import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Dict, List


def extract_stimulus_metadata(stimulus_dir: Path, events_dir: Path = None) -> List[Dict[str, str]]:
    """Extract stimulus metadata from BOLD5000 stimulus files."""
    metadata = []

    # Look for stimulus images
    image_extensions = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}
    image_files = sorted(
        f for f in stimulus_dir.rglob("*")
        if f.is_file() and f.suffix.lower() in image_extensions
    )

    for img in image_files:
        entry = {
            "stimulus_file": img.name,
            "stimulus_path": str(img.relative_to(stimulus_dir)),
            "category": _extract_category(img),
        }
        metadata.append(entry)

    # Look for event files if events_dir provided
    if events_dir and events_dir.exists():
        event_files = sorted(events_dir.rglob("*events.tsv"))
        for ef in event_files:
            try:
                with open(ef, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f, delimiter="\t")
                    for row in reader:
                        if "stim_file" in row or "stimulus_file" in row:
                            stim = row.get("stim_file", row.get("stimulus_file", ""))
                            for entry in metadata:
                                if entry["stimulus_file"] == stim:
                                    entry["onset"] = row.get("onset", "")
                                    entry["duration"] = row.get("duration", "")
                                    entry["trial_type"] = row.get("trial_type", "")
                                    break
            except Exception:
                pass

    return metadata


def _extract_category(image_path: Path) -> str:
    """Try to extract category from image filename or parent directory."""
    # BOLD5000 uses COCO categories in filenames
    name = image_path.stem.lower()
    parent = image_path.parent.name.lower()

    # Common COCO/scene categories
    categories = [
        "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train",
        "truck", "boat", "traffic", "fire", "stop", "parking", "bench", "bird",
        "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
        "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
        "skis", "snowboard", "sports", "kite", "baseball", "skateboard", "surfboard",
        "tennis", "bottle", "wine", "cup", "fork", "knife", "spoon", "bowl",
        "banana", "apple", "sandwich", "orange", "broccoli", "carrot", "hot",
        "pizza", "donut", "cake", "chair", "couch", "potted", "bed", "dining",
        "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell",
        "microwave", "oven", "toaster", "sink", "refrigerator", "book", "clock",
        "vase", "scissors", "teddy", "hair", "toothbrush", "indoor", "outdoor",
        "scene", "building", "mountain", "forest", "ocean", "beach", "desert",
    ]

    for cat in categories:
        if cat in name or cat in parent:
            return cat

    return "unknown"


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract BOLD5000 stimulus metadata.")
    parser.add_argument("--stimulus-dir", required=True, help="Path to BOLD5000 stimuli directory")
    parser.add_argument("--events-dir", help="Path to BOLD5000 events directory")
    parser.add_argument("--output", required=True, help="Output path for stimulus metadata CSV")
    args = parser.parse_args()

    stimulus_dir = Path(args.stimulus_dir).resolve()
    events_dir = Path(args.events_dir).resolve() if args.events_dir else None

    if not stimulus_dir.exists():
        print(f"Stimulus directory not found: {stimulus_dir}", file=sys.stderr)
        return 1

    print(f"Extracting stimulus metadata from {stimulus_dir}...")
    metadata = extract_stimulus_metadata(stimulus_dir, events_dir)

    if not metadata:
        print("[WARN] No stimulus files found.")
        return 1

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=metadata[0].keys(), delimiter="\t")
        writer.writeheader()
        writer.writerows(metadata)

    print(f"Wrote {len(metadata)} stimulus entries to {output_path}")

    # Print category summary
    categories = {}
    for entry in metadata:
        cat = entry.get("category", "unknown")
        categories[cat] = categories.get(cat, 0) + 1
    print(f"\nCategory distribution ({len(categories)} categories):")
    for cat, count in sorted(categories.items(), key=lambda x: -x[1])[:15]:
        print(f"  {cat}: {count}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
