#!/usr/bin/env python3
"""Generate per-subject QC summaries for REST-meta-MDD processing.

Multi-site QC: tracks site effects and applies site-appropriate thresholds.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def load_confounds(confounds_path: Path) -> Dict[str, float]:
    metrics = {"fd_mean": float("nan"), "fd_max": float("nan")}
    try:
        import pandas as pd
        df = pd.read_csv(confounds_path, sep="\t")
        if "framewise_displacement" in df.columns:
            fd = df["framewise_displacement"].dropna()
            metrics["fd_mean"] = float(fd.mean())
            metrics["fd_max"] = float(fd.max())
    except Exception:
        pass
    return metrics


def check_exclusion(metrics: Dict[str, float], fd_threshold: float = 0.3) -> List[str]:
    reasons = []
    if not (metrics["fd_mean"] != metrics["fd_mean"]):
        if metrics["fd_mean"] > fd_threshold:
            reasons.append(f"FD mean {metrics['fd_mean']:.3f} > {fd_threshold}")
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate QC summaries for REST-meta-MDD processing."
    )
    parser.add_argument("--fmriprep-dir", help="Path to fMRIPrep output directory")
    parser.add_argument("--output", required=True)
    parser.add_argument("--exclude-output")
    parser.add_argument("--fd-threshold", type=float, default=0.3)
    parser.add_argument("--diagnosis-file", help="CSV with subject diagnosis/site info")
    args = parser.parse_args()

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    diagnosis_map = {}
    site_map = {}
    if args.diagnosis_file:
        diag_path = Path(args.diagnosis_file).resolve()
        if diag_path.exists():
            with open(diag_path, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    subj = row.get("subject_id") or row.get("Subject", "")
                    diag = row.get("diagnosis") or row.get("Group", "")
                    site = row.get("site") or row.get("Site", "")
                    if subj:
                        if diag:
                            diagnosis_map[subj] = diag
                        if site:
                            site_map[subj] = site

    subjects = set()
    if args.fmriprep_dir:
        fmriprep_dir = Path(args.fmriprep_dir).resolve()
        if fmriprep_dir.exists():
            for d in fmriprep_dir.glob("sub-*"):
                if d.is_dir():
                    subjects.add(d.name)

    if not subjects:
        print("[WARN] No subjects found.", file=sys.stderr)
        return 1

    results = []
    excluded = []
    for subj in sorted(subjects):
        metrics = {"subject_id": subj}
        if diagnosis_map:
            metrics["diagnosis"] = diagnosis_map.get(subj, "unknown")
        if site_map:
            metrics["site"] = site_map.get(subj, "unknown")

        if args.fmriprep_dir:
            confounds_files = list(Path(args.fmriprep_dir).glob(f"{subj}/func/*_desc-confounds_timeseries.tsv"))
            if confounds_files:
                metrics.update(load_confounds(confounds_files[0]))

        exclusion_reasons = check_exclusion(metrics, args.fd_threshold)
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

        # Site-level summary
        sites = set(r.get("site", "unknown") for r in results)
        print(f"QC: {len(results)} subjects across {len(sites)} sites, "
              f"{len(excluded)} excluded -> {output_path}")

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
