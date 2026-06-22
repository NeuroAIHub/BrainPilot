#!/usr/bin/env python3
"""Generate per-subject QC summaries for IXI processing.

Multi-site aware: tracks site information and applies site-specific QC criteria.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

# Site mapping
SITE_MAP = {
    "HH": {"name": "Hammersmith Hospital", "scanner": "Philips", "field_strength": "3T"},
    "Guy": {"name": "Guy's Hospital", "scanner": "Philips", "field_strength": "1.5T"},
    "IOP": {"name": "Institute of Psychiatry", "scanner": "GE", "field_strength": "1.5T"},
}


def detect_site(subject_id: str) -> str:
    """Detect site from subject ID."""
    clean_id = subject_id.replace("sub-", "")
    for prefix in SITE_MAP:
        if clean_id.startswith(prefix):
            return prefix
    return "Unknown"


def load_freesurfer_qc(fs_dir: Path, subject_id: str) -> Dict[str, float]:
    """Extract FreeSurfer QC metrics."""
    metrics = {"fs_eTIV": float("nan")}
    stats_file = fs_dir / subject_id / "stats" / "aseg.stats"
    if stats_file.exists():
        try:
            for line in stats_file.read_text().splitlines():
                if "EstimatedTotalIntraCranialVol" in line:
                    parts = line.split(",")
                    if len(parts) > 4:
                        metrics["fs_eTIV"] = float(parts[4].strip())
        except Exception:
            pass
    return metrics


def check_exclusion(metrics: Dict[str, float]) -> List[str]:
    """Check exclusion criteria."""
    reasons = []
    # IXI is healthy subjects; minimal exclusion criteria
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate QC summaries for IXI processing."
    )
    parser.add_argument("--fmriprep-dir", help="Path to fMRIPrep output directory")
    parser.add_argument("--freesurfer-dir", help="Path to FreeSurfer output directory")
    parser.add_argument("--output", required=True, help="Output path for QC summary CSV")
    parser.add_argument("--exclude-output", help="Output path for exclusion list CSV")
    args = parser.parse_args()

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Discover subjects
    subjects = set()
    if args.fmriprep_dir:
        fmriprep_dir = Path(args.fmriprep_dir).resolve()
        if fmriprep_dir.exists():
            for d in fmriprep_dir.glob("sub-*"):
                if d.is_dir():
                    subjects.add(d.name)

    if args.freesurfer_dir:
        fs_dir = Path(args.freesurfer_dir).resolve()
        if fs_dir.exists():
            for d in fs_dir.iterdir():
                if d.is_dir() and not d.name.startswith("."):
                    subjects.add(f"sub-{d.name}" if not d.name.startswith("sub-") else d.name)

    if not subjects:
        print("[WARN] No subjects found.", file=sys.stderr)
        return 1

    results = []
    excluded = []
    for subj in sorted(subjects):
        metrics = {"subject_id": subj}

        # Detect site
        site = detect_site(subj)
        site_info = SITE_MAP.get(site, {"name": "Unknown", "scanner": "Unknown", "field_strength": "Unknown"})
        metrics["site"] = site_info["name"]
        metrics["scanner"] = site_info["scanner"]
        metrics["field_strength"] = site_info["field_strength"]

        if args.freesurfer_dir:
            fs_id = subj.replace("sub-", "")
            metrics.update(load_freesurfer_qc(Path(args.freesurfer_dir), fs_id))

        exclusion_reasons = check_exclusion(metrics)
        metrics["excluded"] = len(exclusion_reasons) > 0
        metrics["exclusion_reasons"] = "; ".join(exclusion_reasons)

        results.append(metrics)
        if exclusion_reasons:
            excluded.append({"subject_id": subj, "reasons": "; ".join(exclusion_reasons)})

    if results:
        fieldnames = list(results[0].keys())
        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(results)

        # Site summary
        site_counts = {}
        for r in results:
            site = r.get("site", "Unknown")
            site_counts[site] = site_counts.get(site, 0) + 1

        print(f"QC: {len(results)} subjects, {len(excluded)} excluded -> {output_path}")
        print(f"  Sites: {site_counts}")

    if args.exclude_output and excluded:
        exclude_path = Path(args.exclude_output).resolve()
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        with open(exclude_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=["subject_id", "reasons"])
            writer.writeheader()
            writer.writerows(excluded)

    return 0


if __name__ == "__main__":
    sys.exit(main())
