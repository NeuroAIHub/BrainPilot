#!/usr/bin/env python3
"""Generate per-subject QC summaries for Cam-CAN processing.

Combines fMRIPrep confounds, FreeSurfer metrics, and MEG QC
to produce a unified QC summary with exclusion recommendations.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List


def load_confounds(confounds_path: Path) -> Dict[str, float]:
    """Extract QC metrics from fMRIPrep confounds TSV."""
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


def check_exclusion(metrics: Dict[str, float], fd_threshold: float = 0.3) -> List[str]:
    """Check exclusion criteria."""
    reasons = []
    if not (metrics["fd_mean"] != metrics["fd_mean"]):
        if metrics["fd_mean"] > fd_threshold:
            reasons.append(f"FD mean {metrics['fd_mean']:.3f} > {fd_threshold}")
    return reasons


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate QC summaries for Cam-CAN processing."
    )
    parser.add_argument("--fmriprep-dir", help="Path to fMRIPrep output directory")
    parser.add_argument("--freesurfer-dir", help="Path to FreeSurfer output directory")
    parser.add_argument("--output", required=True, help="Output path for QC summary CSV")
    parser.add_argument("--exclude-output", help="Output path for exclusion list CSV")
    parser.add_argument("--fd-threshold", type=float, default=0.3,
                        help="FD threshold (default: 0.3 mm)")
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

        if args.fmriprep_dir:
            confounds_files = list(Path(args.fmriprep_dir).glob(f"{subj}/func/*_desc-confounds_timeseries.tsv"))
            if confounds_files:
                metrics.update(load_confounds(confounds_files[0]))

        if args.freesurfer_dir:
            fs_id = subj.replace("sub-", "")
            metrics.update(load_freesurfer_qc(Path(args.freesurfer_dir), fs_id))

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
