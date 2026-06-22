#!/usr/bin/env python3
"""Generate per-subject QC summaries and exclusion lists for ABIDE.

Combines fMRIPrep confounds, FreeSurfer recon-all metrics, and ABIDE native
QC flags to produce a unified QC report with configurable exclusion criteria.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

try:
    import pandas as pd
except ImportError:
    print("Error: pandas is required. Install with: pip install pandas", file=sys.stderr)
    sys.exit(1)


def detect_delimiter(file_path: Path) -> str:
    """Detect whether file uses tab or comma delimiter."""
    with open(file_path, "r", encoding="utf-8") as f:
        first_line = f.readline()
    if "\t" in first_line:
        return "\t"
    return ","


def collect_fmriprep_qc(fmriprep_dir: Path) -> Dict[str, Dict[str, float]]:
    """Collect QC metrics from fMRIPrep outputs."""
    qc = {}

    confounds_patterns = [
        "**/desc-confounds_timeseries.tsv",
        "**/*_desc-confounds_timeseries.tsv",
        "**/confounds.tsv",
    ]

    confounds_files = []
    for pattern in confounds_patterns:
        confounds_files.extend(fmriprep_dir.rglob(pattern))

    for confounds_file in confounds_files:
        subject_id = None
        for part in confounds_file.parts:
            if part.startswith("sub-"):
                subject_id = part
                break
        if not subject_id:
            continue

        delimiter = detect_delimiter(confounds_file)
        try:
            df = pd.read_csv(confounds_file, sep=delimiter, low_memory=False)
        except Exception as e:
            print(f"[WARN] Failed to read {confounds_file}: {e}", file=sys.stderr)
            continue

        fd_col = None
        for col_name in ["framewise_displacement", "fd", "FD"]:
            if col_name in df.columns:
                fd_col = col_name
                break

        dvars_col = None
        for col_name in ["dvars", "DVARS", "std_dvars"]:
            if col_name in df.columns:
                dvars_col = col_name
                break

        metrics = {"n_volumes": len(df)}

        if fd_col:
            fd_values = pd.to_numeric(df[fd_col], errors="coerce").dropna()
            if len(fd_values) > 0:
                metrics["mean_fd"] = float(fd_values.mean())
                metrics["max_fd"] = float(fd_values.max())
                metrics["median_fd"] = float(fd_values.median())
            else:
                metrics["mean_fd"] = 0.0
                metrics["max_fd"] = 0.0
                metrics["median_fd"] = 0.0

        if dvars_col:
            dvars_values = pd.to_numeric(df[dvars_col], errors="coerce").dropna()
            if len(dvars_values) > 0:
                metrics["mean_dvars"] = float(dvars_values.mean())

        if subject_id in qc:
            existing = qc[subject_id]
            existing["mean_fd"] = max(existing.get("mean_fd", 0), metrics.get("mean_fd", 0))
            existing["max_fd"] = max(existing.get("max_fd", 0), metrics.get("max_fd", 0))
            existing["n_volumes"] = existing.get("n_volumes", 0) + metrics.get("n_volumes", 0)
        else:
            qc[subject_id] = metrics

    return qc


def collect_freesurfer_qc(freesurfer_dir: Path) -> Dict[str, Dict[str, float]]:
    """Collect QC metrics from FreeSurfer recon-all outputs."""
    qc = {}

    for recon_log in freesurfer_dir.rglob("**/recon-all.log"):
        # Extract subject ID from path
        subject_id = None
        for part in recon_log.parts:
            if part.startswith("sub-"):
                subject_id = part
                break
        if not subject_id:
            continue

        completed = False
        try:
            with open(recon_log, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
                completed = "finished without error" in content.lower() or "recon-all -done" in content.lower()
        except Exception:
            pass

        metrics = {"completed": completed}

        # Try to read aseg.stats
        aseg_matches = list(freesurfer_dir.rglob(f"{subject_id}**/aseg.stats"))
        if aseg_matches:
            try:
                with open(aseg_matches[0], "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if "EstimatedTotalIntraCranialVol" in line:
                            parts = line.split()
                            if len(parts) >= 4:
                                try:
                                    metrics["etiv"] = float(parts[3])
                                except ValueError:
                                    pass
                        elif "BrainSegVol" in line and "Not" not in line:
                            parts = line.split()
                            if len(parts) >= 4:
                                try:
                                    metrics["total_brain_volume"] = float(parts[3])
                                except ValueError:
                                    pass
            except Exception:
                pass

        qc[subject_id] = metrics

    return qc


def collect_abide_native_qc(phenotype_file: Path) -> Dict[str, Dict[str, float]]:
    """Collect ABIDE native QC flags from phenotype file."""
    qc = {}
    if not phenotype_file.exists():
        return qc

    try:
        df = pd.read_csv(phenotype_file, sep=None, engine="python", low_memory=False)
    except Exception as e:
        print(f"[WARN] Failed to read {phenotype_file}: {e}", file=sys.stderr)
        return qc

    id_col = None
    for col_name in ["SUBJECT_ID", "subject", "Subject", "SUBJECT_KEY"]:
        if col_name in df.columns:
            id_col = col_name
            break
    if not id_col:
        return qc

    # Look for QC columns
    qc_cols = [c for c in df.columns if "qc" in c.lower() or "rater" in c.lower() or "perc_fd" in c.lower()]

    for _, row in df.iterrows():
        sid = str(row[id_col]).strip()
        metrics = {}
        for col in qc_cols:
            val = row.get(col)
            if pd.notna(val):
                try:
                    metrics[col] = float(val)
                except (ValueError, TypeError):
                    metrics[col] = str(val)
        qc[f"sub-{sid}"] = metrics

    return qc


def generate_qc_summary(
    fmriprep_qc: Dict[str, Dict[str, float]],
    freesurfer_qc: Dict[str, Dict[str, float]],
    abide_qc: Dict[str, Dict[str, float]],
    fd_threshold: float = 0.3,
    max_fd_threshold: float = 5.0,
    coverage_threshold: float = 0.8,
) -> Tuple["pd.DataFrame", List[str]]:
    """Generate QC summary DataFrame and exclusion list."""
    all_subjects = set()
    all_subjects.update(fmriprep_qc.keys())
    all_subjects.update(freesurfer_qc.keys())
    all_subjects.update(abide_qc.keys())

    rows = []
    excluded = []

    for sub_id in sorted(all_subjects):
        row = {"subject_id": sub_id}
        exclude_reasons = []

        fp = fmriprep_qc.get(sub_id, {})
        row["mean_fd"] = fp.get("mean_fd", None)
        row["max_fd"] = fp.get("max_fd", None)
        row["median_fd"] = fp.get("median_fd", None)
        row["mean_dvars"] = fp.get("mean_dvars", None)
        row["n_volumes"] = fp.get("n_volumes", None)

        fs = freesurfer_qc.get(sub_id, {})
        row["fs_completed"] = fs.get("completed", None)
        row["total_brain_volume"] = fs.get("total_brain_volume", None)
        row["etiv"] = fs.get("etiv", None)

        abcd = abide_qc.get(sub_id, {})
        for key, val in abcd.items():
            row[f"abide_{key}"] = val

        if row["mean_fd"] is not None and row["mean_fd"] > fd_threshold:
            exclude_reasons.append(f"mean_fd={row['mean_fd']:.3f}>{fd_threshold}")

        if row["max_fd"] is not None and row["max_fd"] > max_fd_threshold:
            exclude_reasons.append(f"max_fd={row['max_fd']:.3f}>{max_fd_threshold}")

        if row["fs_completed"] is False:
            exclude_reasons.append("FreeSurfer recon-all incomplete")

        row["exclude"] = len(exclude_reasons) > 0
        row["exclude_reasons"] = "; ".join(exclude_reasons) if exclude_reasons else ""

        if exclude_reasons:
            excluded.append(sub_id)

        rows.append(row)

    df = pd.DataFrame(rows)
    return df, excluded


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate per-subject QC summaries and exclusion lists for ABIDE."
    )
    parser.add_argument("--fmriprep-dir", help="Path to fMRIPrep output directory")
    parser.add_argument("--freesurfer-dir", help="Path to FreeSurfer output directory")
    parser.add_argument("--raw-qc", help="Path to ABIDE phenotype CSV with QC flags")
    parser.add_argument("--output", required=True, help="Output path for QC summary CSV")
    parser.add_argument("--exclude-output", help="Output path for exclusion list CSV")
    parser.add_argument("--fd-threshold", type=float, default=0.3, help="Mean FD threshold (default: 0.3)")
    parser.add_argument("--max-fd-threshold", type=float, default=5.0, help="Max FD threshold (default: 5.0)")
    parser.add_argument("--coverage-threshold", type=float, default=0.8, help="Coverage threshold (default: 0.8)")
    args = parser.parse_args()

    fmriprep_qc = {}
    freesurfer_qc = {}
    abide_qc = {}

    if args.fmriprep_dir:
        fp_dir = Path(args.fmriprep_dir).resolve()
        if fp_dir.exists():
            print(f"Collecting fMRIPrep QC from {fp_dir}...")
            fmriprep_qc = collect_fmriprep_qc(fp_dir)
            print(f"  Found {len(fmriprep_qc)} subjects")

    if args.freesurfer_dir:
        fs_dir = Path(args.freesurfer_dir).resolve()
        if fs_dir.exists():
            print(f"Collecting FreeSurfer QC from {fs_dir}...")
            freesurfer_qc = collect_freesurfer_qc(fs_dir)
            print(f"  Found {len(freesurfer_qc)} subjects")

    if args.raw_qc:
        raw_qc_path = Path(args.raw_qc).resolve()
        if raw_qc_path.exists():
            print(f"Collecting ABIDE native QC from {raw_qc_path}...")
            abide_qc = collect_abide_native_qc(raw_qc_path)
            print(f"  Found {len(abide_qc)} subjects")

    if not fmriprep_qc and not freesurfer_qc and not abide_qc:
        print("[ERROR] No QC data collected. Check input paths.", file=sys.stderr)
        return 1

    summary_df, excluded = generate_qc_summary(
        fmriprep_qc=fmriprep_qc,
        freesurfer_qc=freesurfer_qc,
        abide_qc=abide_qc,
        fd_threshold=args.fd_threshold,
        max_fd_threshold=args.max_fd_threshold,
        coverage_threshold=args.coverage_threshold,
    )

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary_df.to_csv(output_path, index=False)
    print(f"\nQC Summary: {len(summary_df)} subjects -> {output_path}")
    print(f"  Excluded: {len(excluded)} / {len(summary_df)} ({100*len(excluded)/max(len(summary_df),1):.1f}%)")

    if args.exclude_output:
        exclude_path = Path(args.exclude_output).resolve()
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        exclude_df = summary_df[summary_df["exclude"] == True][["subject_id", "exclude_reasons"]]
        exclude_df.to_csv(exclude_path, index=False)
        print(f"  Exclusion list: {exclude_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
