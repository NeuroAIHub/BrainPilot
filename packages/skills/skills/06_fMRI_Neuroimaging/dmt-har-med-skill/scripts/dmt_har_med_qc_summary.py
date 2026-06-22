#!/usr/bin/env python3
"""Generate per-subject QC summaries and exclusion lists for DMT-HAR-MED."""
import argparse
import sys
from pathlib import Path
from typing import Dict, List, Tuple

try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required.", file=sys.stderr)
    sys.exit(1)


def detect_delimiter(file_path: Path) -> str:
    with open(file_path, "r", encoding="utf-8") as f:
        return "\t" if "\t" in f.readline() else ","


def collect_fmriprep_qc(fmriprep_dir: Path) -> Dict[str, Dict[str, float]]:
    qc = {}
    for confounds_file in fmriprep_dir.rglob("**/*_desc-confounds_timeseries.tsv"):
        subject_id = next((p for p in confounds_file.parts if p.startswith("sub-")), None)
        if not subject_id:
            continue
        try:
            df = pd.read_csv(confounds_file, sep=detect_delimiter(confounds_file), low_memory=False)
        except Exception:
            continue
        fd_col = next((c for c in ["framewise_displacement", "fd", "FD"] if c in df.columns), None)
        if fd_col:
            fd = pd.to_numeric(df[fd_col], errors="coerce").dropna()
            if len(fd) > 0:
                metrics = {"mean_fd": float(fd.mean()), "max_fd": float(fd.max()), "n_volumes": len(df)}
                if subject_id in qc:
                    qc[subject_id]["mean_fd"] = max(qc[subject_id].get("mean_fd", 0), metrics["mean_fd"])
                    qc[subject_id]["max_fd"] = max(qc[subject_id].get("max_fd", 0), metrics["max_fd"])
                    qc[subject_id]["n_volumes"] = qc[subject_id].get("n_volumes", 0) + metrics["n_volumes"]
                else:
                    qc[subject_id] = metrics
    return qc


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate DMT-HAR-MED QC summaries.")
    parser.add_argument("--fmriprep-dir", help="Path to fMRIPrep output directory")
    parser.add_argument("--output", required=True, help="Output path for QC summary CSV")
    parser.add_argument("--exclude-output", help="Output path for exclusion list CSV")
    parser.add_argument("--fd-threshold", type=float, default=0.3, help="Mean FD threshold (default: 0.3)")
    parser.add_argument("--max-fd-threshold", type=float, default=5.0, help="Max FD threshold (default: 5.0)")
    args = parser.parse_args()

    fmriprep_qc = {}
    if args.fmriprep_dir:
        fp_dir = Path(args.fmriprep_dir).resolve()
        if fp_dir.exists():
            print(f"Collecting fMRIPrep QC from {fp_dir}...")
            fmriprep_qc = collect_fmriprep_qc(fp_dir)
            print(f"  Found {len(fmriprep_qc)} subjects")

    if not fmriprep_qc:
        print("[ERROR] No QC data collected.", file=sys.stderr)
        return 1

    rows = []
    excluded = []
    for sub_id in sorted(fmriprep_qc.keys()):
        fp = fmriprep_qc[sub_id]
        reasons = []
        if fp.get("mean_fd", 0) > args.fd_threshold:
            reasons.append(f"mean_fd={fp['mean_fd']:.3f}>{args.fd_threshold}")
        if fp.get("max_fd", 0) > args.max_fd_threshold:
            reasons.append(f"max_fd={fp['max_fd']:.3f}>{args.max_fd_threshold}")
        row = {"subject_id": sub_id, "mean_fd": fp.get("mean_fd"), "max_fd": fp.get("max_fd"), "n_volumes": fp.get("n_volumes"), "exclude": bool(reasons), "exclude_reasons": "; ".join(reasons)}
        if reasons:
            excluded.append(sub_id)
        rows.append(row)

    summary_df = pd.DataFrame(rows)
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary_df.to_csv(output_path, index=False)
    print(f"\nQC Summary: {len(summary_df)} subjects -> {output_path}")
    print(f"  Excluded: {len(excluded)} / {len(summary_df)} ({100*len(excluded)/max(len(summary_df),1):.1f}%)")

    if args.exclude_output:
        exclude_path = Path(args.exclude_output).resolve()
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        summary_df[summary_df["exclude"] == True][["subject_id", "exclude_reasons"]].to_csv(exclude_path, index=False)
        print(f"  Exclusion list: {exclude_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
