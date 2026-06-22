#!/usr/bin/env python3
"""Generate per-subject QC summaries for NSD processing.

7T-specific QC: tracks session counts, motion metrics, and stimulus coverage.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def load_confounds(confounds_path: Path) -> Dict[str, float]:
    """Extract QC metrics from fMRIPrep confounds TSV."""
    metrics = {
        "fd_mean": float("nan"),
        "fd_max": float("nan"),
        "dvars_mean": float("nan"),
    }
    try:
        import pandas as pd
        df = pd.read_csv(confounds_path, sep="\t")
        if "framewise_displacement" in df.columns:
            fd = df["framewise_displacement"].dropna()
            metrics["fd_mean"] = float(fd.mean())
            metrics["fd_max"] = float(fd.max())
        if "dvars" in df.columns:
            dvars = df["dvars"].dropna()
            metrics["dvars_mean"] = float(dvars.mean())
    except Exception:
        pass
    return metrics


def check_exclusion(metrics: Dict[str, float], fd_threshold: float = 0.3) -> List[str]:
    """Check exclusion criteria for NSD."""
    reasons = []
    if not (metrics["fd_mean"] != metrics["fd_mean"]):  # not NaN
        if metrics["fd_mean"] > fd_threshold:
            reasons.append(f"FD mean {metrics['fd_mean']:.3f} > {fd_threshold}")
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate QC summaries for NSD processing."
    )
    parser.add_argument("--fmriprep-dir", help="Path to fMRIPrep output directory")
    parser.add_argument("--nsd-dir", help="Path to NSD BIDS root directory")
    parser.add_argument("--output", required=True, help="Output path for QC summary CSV")
    parser.add_argument("--exclude-output", help="Output path for exclusion list CSV")
    parser.add_argument("--fd-threshold", type=float, default=0.3,
                        help="FD threshold in mm (default: 0.3, typical for 7T)")
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
    if args.nsd_dir:
        nsd_dir = Path(args.nsd_dir).resolve()
        if nsd_dir.exists():
            for d in nsd_dir.glob("sub-*"):
                if d.is_dir():
                    subjects.add(d.name)

    if not subjects:
        print("[WARN] No subjects found.", file=sys.stderr)
        return 1

    results = []
    excluded = []
    for subj in sorted(subjects):
        metrics = {"subject_id": subj}

        # Count sessions from BIDS structure
        if args.nsd_dir:
            nsd_dir = Path(args.nsd_dir).resolve()
            subj_dir = nsd_dir / subj
            if subj_dir.exists():
                sessions = [d for d in subj_dir.glob("ses-*") if d.is_dir()]
                metrics["n_sessions"] = len(sessions)
                func_dir = subj_dir / "func"
                if func_dir.exists():
                    bold_runs = list(func_dir.glob("*_task-nsd_bold.nii.gz"))
                    metrics["n_func_runs"] = len(bold_runs)

        # Extract fMRIPrep confounds metrics
        if args.fmriprep_dir:
            confounds_files = list(
                Path(args.fmriprep_dir).glob(f"{subj}/func/*_desc-confounds_timeseries.tsv")
            )
            if confounds_files:
                # Average across runs
                fd_means = []
                fd_maxes = []
                for cf in confounds_files:
                    run_metrics = load_confounds(cf)
                    if run_metrics["fd_mean"] == run_metrics["fd_mean"]:  # not NaN
                        fd_means.append(run_metrics["fd_mean"])
                        fd_maxes.append(run_metrics["fd_max"])
                if fd_means:
                    metrics["fd_mean"] = sum(fd_means) / len(fd_means)
                    metrics["fd_max"] = max(fd_maxes)
                metrics["n_confounds_files"] = len(confounds_files)

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
        print(f"QC: {len(results)} subjects, {len(excluded)} excluded -> {output_path}")

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
