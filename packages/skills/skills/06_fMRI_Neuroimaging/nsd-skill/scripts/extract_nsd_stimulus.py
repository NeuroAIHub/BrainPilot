#!/usr/bin/env python3
"""Extract NSD stimulus metadata from COCO annotations.

Reads NSD stimulus information (COCO image IDs, captions, categories)
and produces a merged stimulus metadata table for stimulus-response analyses.
"""
import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional


def load_nsd_stimulus_info(stimulus_dir: Path) -> List[Dict]:
    """Load NSD stimulus info from nsd_stiminfo.tsv or equivalent."""
    stim_info = []
    stim_file = stimulus_dir / "nsd_stiminfo.tsv"
    if stim_file.exists():
        with open(stim_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")
            stim_info = list(reader)
    return stim_info


def load_coco_annotations(coco_dir: Path) -> Dict[int, Dict]:
    """Load COCO annotations (captions + categories) keyed by image_id."""
    coco_data = {}

    # Load captions
    captions_file = coco_dir / "annotations" / "captions_train2017.json"
    if captions_file.exists():
        with open(captions_file, "r", encoding="utf-8") as f:
            caps = json.load(f)
        for ann in caps.get("annotations", []):
            img_id = ann["image_id"]
            if img_id not in coco_data:
                coco_data[img_id] = {"captions": [], "categories": []}
            coco_data[img_id]["captions"].append(ann["caption"])

    # Load instances (categories)
    instances_file = coco_dir / "annotations" / "instances_train2017.json"
    if instances_file.exists():
        with open(instances_file, "r", encoding="utf-8") as f:
            instances = json.load(f)
        # Build category id -> name map
        cat_map = {c["id"]: c["name"] for c in instances.get("categories", [])}
        for ann in instances.get("annotations", []):
            img_id = ann["image_id"]
            if img_id not in coco_data:
                coco_data[img_id] = {"captions": [], "categories": []}
            cat_name = cat_map.get(ann["category_id"], "unknown")
            if cat_name not in coco_data[img_id]["categories"]:
                coco_data[img_id]["categories"].append(cat_name)

    return coco_data


def load_subject_trials(events_dir: Path, subject: str) -> List[Dict]:
    """Load trial-level stimulus info from a subject's events files."""
    trials = []
    pattern = f"{subject}_task-nsd*_events.tsv"
    for events_file in sorted(events_dir.glob(pattern)):
        with open(events_file, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f, delimiter="\t")
            for row in reader:
                row["_source_file"] = events_file.name
                trials.append(row)
    return trials


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Extract NSD stimulus metadata from COCO annotations."
    )
    parser.add_argument("--nsd-dir", required=True,
                        help="Path to NSD root directory (BIDS format)")
    parser.add_argument("--coco-dir",
                        help="Path to COCO annotations directory (optional)")
    parser.add_argument("--output", required=True,
                        help="Output path for stimulus metadata CSV")
    parser.add_argument("--subject", default=None,
                        help="Extract for specific subject only (e.g., subj01)")
    args = parser.parse_args()

    nsd_dir = Path(args.nsd_dir).resolve()
    if not nsd_dir.exists():
        print(f"NSD directory not found: {nsd_dir}", file=sys.stderr)
        return 1

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Load NSD stimulus info
    stim_info = load_nsd_stimulus_info(nsd_dir)
    print(f"Loaded {len(stim_info)} stimulus entries from nsd_stiminfo.tsv")

    # Load COCO annotations if available
    coco_data = {}
    if args.coco_dir:
        coco_dir = Path(args.coco_dir).resolve()
        if coco_dir.exists():
            coco_data = load_coco_annotations(coco_dir)
            print(f"Loaded COCO annotations for {len(coco_data)} images")

    # Determine subjects to process
    if args.subject:
        subjects = [args.subject]
    else:
        subjects = sorted([
            d.name for d in nsd_dir.glob("sub-*") if d.is_dir()
        ])

    # Collect trial-level data
    all_trials = []
    for subj in subjects:
        subj_dir = nsd_dir / subj / "func"
        if not subj_dir.exists():
            continue
        trials = load_subject_trials(subj_dir, subj)
        for t in trials:
            t["subject_id"] = subj
        all_trials.extend(trials)

    # Merge stimulus info with trials
    if stim_info and all_trials:
        # Build lookup by stimulus index if available
        stim_lookup = {}
        for s in stim_info:
            key = s.get("nsd_id") or s.get("stimulus_id") or s.get("0", "")
            if key:
                stim_lookup[str(key)] = s

        for trial in all_trials:
            stim_idx = trial.get("stimulus_index") or trial.get("stim_id", "")
            if stim_idx and str(stim_idx) in stim_lookup:
                for k, v in stim_lookup[str(stim_idx)].items():
                    if k not in trial:
                        trial[f"stim_{k}"] = v

    # Enrich with COCO data if available
    if coco_data and all_trials:
        for trial in all_trials:
            coco_id = trial.get("coco_id") or trial.get("stim_coco_id", "")
            if coco_id and str(coco_id).isdigit():
                cid = int(coco_id)
                if cid in coco_data:
                    trial["coco_captions"] = " | ".join(coco_data[cid]["captions"][:3])
                    trial["coco_categories"] = ", ".join(coco_data[cid]["categories"])

    # Output
    if not all_trials and stim_info:
        # Fallback: output stim_info directly
        all_trials = stim_info

    if not all_trials:
        print("[WARN] No stimulus data found.", file=sys.stderr)
        return 1

    fieldnames = list(all_trials[0].keys())
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_trials)

    print(f"Stimulus: {len(all_trials)} trials, {len(fieldnames)} columns -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
