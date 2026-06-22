#!/usr/bin/env python3
"""Generate per-subject QC summaries and exclusion lists for ABCD Study.

Combines fMRIPrep confounds, FreeSurfer recon-all metrics, and ABCD native
QC flags to produce a unified QC report with configurable exclusion criteria.
"""
import argparse
import json
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
    """Collect QC metrics from fMRIPrep outputs.

    Reads confounds TSV files to extract framewise displacement (FD) and DVARS.

    Returns:
        Dict mapping subject_id -> {mean_fd, max_fd, mean_dvars, n_volumes}
    """
    qc = {}

    # Look for confounds files in fMRIPrep output structure
    confounds_patterns = [
        "**/desc-confounds_timeseries.tsv",
        "**/*_desc-confounds_timeseries.tsv",
        "**/confounds.tsv",
    ]

    confounds_files = []
    for pattern in confounds_patterns:
        confounds_files.extend(fmriprep_dir.rglob(pattern))

    for confounds_file in confounds_files:
        # Extract subject ID from path
        subject_id = None
        parts = confounds_file.parts
        for part in parts:
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

        # Extract FD
        fd_col = None
        for col_name in ["framewise_displacement", "fd", "FD"]:
            if col_name in df.columns:
                fd_col = col_name
                break

        # Extract DVARS
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
            else:
                metrics["mean_dvars"] = 0.0

        # Aggregate per-subject (take worst/best across runs)
        if subject_id in qc:
            existing = qc[subject_id]
            existing["mean_fd"] = max(existing.get("mean_fd", 0), metrics.get("mean_fd", 0))
            existing["max_fd"] = max(existing.get("max_fd", 0), metrics.get("max_fd", 0))
            existing["n_volumes"] = existing.get("n_volumes", 0) + metrics.get("n_volumes", 0)
        else:
            qc[subject_id] = metrics

    return qc


def collect_freesurfer_qc(freesurfer_dir: Path) -> Dict[str, Dict[str, float]]:
    """Collect QC metrics from FreeSurfer recon-all outputs.

    Reads the scripts/recon-all.log to check for completion, and optionally
    the aseg.stats for volume metrics.

    Returns:
        Dict mapping subject_id -> {completed, total_brain_volume, estimated_total_intracranial_volume}
    """
    qc = {}

    # Check for recon-all completion
    for subject_dir in sorted(freesurfer_dir.rglob("sub-*")):
        if not subject_dir.is_dir():
            continue

        subject_id = subject_dir.name
        if subject_id.startswith("sub-"):
            pass
        else:
            # Check parent dirs
            for part in subject_dir.parts:
                if part.startswith("sub-"):
                    subject_id = part
                    break

        # Check for recon-all log
        recon_log = None
        for candidate in [
            subject_dir / "scripts" / "recon-all.log",
            subject_dir / "ses-*" / "scripts" / "recon-all.log",
        ]:
            matches = list(freesurfer_dir.rglob(f"{subject_id}/**/recon-all.log"))
            if matches:
                recon_log = matches[0]
                break

        completed = False
        if recon_log and recon_log.exists():
            try:
                with open(recon_log, "r", encoding="utf-8", errors="ignore") as f:
                    content = f.read()
                    completed = "finished without error" in content.lower() or "recon-all -done" in content.lower()
            except Exception:
                pass

        # Try to read aseg.stats for volume metrics
        aseg_matches = list(freesurfer_dir.rglob(f"{subject_id}**/aseg.stats"))
        total_brain_vol = None
        etiv = None

        if aseg_matches:
            aseg_file = aseg_matches[0]
            try:
                with open(aseg_file, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if "EstimatedTotalIntraCranialVol" in line:
                            parts = line.split()
                            if len(parts) >= 4:
                                try:
                                    etiv = float(parts[3])
                                except ValueError:
                                    pass
                        elif "BrainSegVol" in line and "Not" not in line:
                            parts = line.split()
                            if len(parts) >= 4:
                                try:
                                    total_brain_vol = float(parts[3])
                                except ValueError:
                                    pass
            except Exception:
                pass

        metrics = {"completed": completed}
        if total_brain_vol is not None:
            metrics["total_brain_volume"] = total_brain_vol
        if etiv is not None:
            metrics["estimated_total_intracranial_volume"] = etiv

        qc[subject_id] = metrics

    return qc


def collect_abcd_native_qc(raw_qc_file: Path) -> Dict[str, Dict[str, float]]:
    """Collect ABCD native QC flags (e.g., imgincl01).

    Returns:
        Dict mapping subject_id -> {include_t1, include_dti, include_rsfmri, etc.}
    """
    qc = {}
    if not raw_qc_file.exists():
        return qc

    delimiter = detect_delimiter(raw_qc_file)
    try:
        df = pd.read_csv(raw_qc_file, sep=delimiter, low_memory=False)
    except Exception as e:
        print(f"[WARN] Failed to read {raw_qc_file}: {e}", file=sys.stderr)
        return qc

    # Standardize ID column
    id_col = None
    for col_name in ["src_subject_id", "SUBJECTKEY", "subject_id"]:
        if col_name in df.columns:
            id_col = col_name
            break

    if not id_col:
        print(f"[WARN] No subject ID column found in {raw_qc_file}", file=sys.stderr)
        return qc

    # Look for include flags
    include_cols = [c for c in df.columns if c.startswith("include_") or c.startswith("imgincl")]
    event_col = "eventname" if "eventname" in df.columns else None

    for _, row in df.iterrows():
        sid = str(row[id_col]).strip()
        event = str(row[event_col]).strip() if event_col else ""

        # Use baseline by default
        if event and "baseline" not in event.lower() and "1year" not in event.lower():
            continue

        metrics = {}
        for col in include_cols:
            val = row.get(col)
            if pd.notna(val):
                try:
                    metrics[col] = int(val)
                except (ValueError, TypeError):
                    metrics[col] = val

        if sid in qc:
            # Update only if current entry is empty
            if not qc[sid]:
                qc[sid] = metrics
        else:
            qc[sid] = metrics

    return qc


def generate_qc_summary(
    fmriprep_qc: Dict[str, Dict[str, float]],
    freesurfer_qc: Dict[str, Dict[str, float]],
    abcd_qc: Dict[str, Dict[str, float]],
    fd_threshold: float = 0.3,
    max_fd_threshold: float = 5.0,
    coverage_threshold: float = 0.8,
) -> Tuple["pd.DataFrame", List[str]]:
    """Generate QC summary DataFrame and exclusion list.

    Args:
        fmriprep_qc: fMRIPrep QC metrics.
        freesurfer_qc: FreeSurfer QC metrics.
        abcd_qc: ABCD native QC flags.
        fd_threshold: Mean FD threshold for exclusion.
        max_fd_threshold: Max FD threshold for exclusion.
        coverage_threshold: Minimum fraction of usable volumes.

    Returns:
        Tuple of (QC summary DataFrame, list of excluded subject IDs).
    """
    # Collect all unique subject IDs
    all_subjects = set()
    all_subjects.update(fmriprep_qc.keys())
    all_subjects.update(freesurfer_qc.keys())
    all_subjects.update(abcd_qc.keys())

    rows = []
    excluded = []

    for sub_id in sorted(all_subjects):
        row = {"subject_id": sub_id}
        exclude_reasons = []

        # fMRIPrep metrics
        fp = fmriprep_qc.get(sub_id, {})
        row["mean_fd"] = fp.get("mean_fd", None)
        row["max_fd"] = fp.get("max_fd", None)
        row["median_fd"] = fp.get("median_fd", None)
        row["mean_dvars"] = fp.get("mean_dvars", None)
        row["n_volumes"] = fp.get("n_volumes", None)

        # FreeSurfer metrics
        fs = freesurfer_qc.get(sub_id, {})
        row["fs_completed"] = fs.get("completed", None)
        row["total_brain_volume"] = fs.get("total_brain_volume", None)
        row["etiv"] = fs.get("estimated_total_intracranial_volume", None)

        # ABCD native QC
        abcd = abcd_qc.get(sub_id, {})
        for key, val in abcd.items():
            row[f"abcd_{key}"] = val

        # Apply exclusion criteria
        if row["mean_fd"] is not None and row["mean_fd"] > fd_threshold:
            exclude_reasons.append(f"mean_fd={row['mean_fd']:.3f}>{fd_threshold}")

        if row["max_fd"] is not None and row["max_fd"] > max_fd_threshold:
            exclude_reasons.append(f"max_fd={row['max_fd']:.3f}>{max_fd_threshold}")

        if row["fs_completed"] is False:
            exclude_reasons.append("FreeSurfer recon-all incomplete")

        # Check ABCD include flags
        for key in ["include_t1", "include_dti", "include_rsfmri", "include_tfmri"]:
            abcd_key = f"abcd_{key}"
            if abcd_key in row and row[abcd_key] == 0:
                exclude_reasons.append(f"ABCD {key}=0")

        row["exclude"] = len(exclude_reasons) > 0
        row["exclude_reasons"] = "; ".join(exclude_reasons) if exclude_reasons else ""

        if exclude_reasons:
            excluded.append(sub_id)

        rows.append(row)

    df = pd.DataFrame(rows)
    return df, excluded


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate per-subject QC summaries and exclusion lists for ABCD Study."
    )
    parser.add_argument(
        "--fmriprep-dir",
        help="Path to fMRIPrep output directory",
    )
    parser.add_argument(
        "--freesurfer-dir",
        help="Path to FreeSurfer output directory",
    )
    parser.add_argument(
        "--raw-qc",
        help="Path to ABCD native QC file (e.g., abcd_imgincl01.csv)",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output path for QC summary CSV",
    )
    parser.add_argument(
        "--exclude-output",
        help="Output path for exclusion list CSV",
    )
    parser.add_argument(
        "--fd-threshold",
        type=float,
        default=0.3,
        help="Mean framewise displacement threshold for exclusion (default: 0.3)",
    )
    parser.add_argument(
        "--max-fd-threshold",
        type=float,
        default=5.0,
        help="Maximum framewise displacement threshold for exclusion (default: 5.0)",
    )
    parser.add_argument(
        "--coverage-threshold",
        type=float,
        default=0.8,
        help="Minimum fraction of usable volumes (default: 0.8)",
    )
    args = parser.parse_args()

    # Collect QC metrics
    fmriprep_qc = {}
    freesurfer_qc = {}
    abcd_qc = {}

    if args.fmriprep_dir:
        fp_dir = Path(args.fmriprep_dir).resolve()
        if fp_dir.exists():
            print(f"Collecting fMRIPrep QC from {fp_dir}...")
            fmriprep_qc = collect_fmriprep_qc(fp_dir)
            print(f"  Found {len(fmriprep_qc)} subjects")
        else:
            print(f"[WARN] fMRIPrep directory not found: {fp_dir}")

    if args.freesurfer_dir:
        fs_dir = Path(args.freesurfer_dir).resolve()
        if fs_dir.exists():
            print(f"Collecting FreeSurfer QC from {fs_dir}...")
            freesurfer_qc = collect_freesurfer_qc(fs_dir)
            print(f"  Found {len(freesurfer_qc)} subjects")
        else:
            print(f"[WARN] FreeSurfer directory not found: {fs_dir}")

    if args.raw_qc:
        raw_qc_path = Path(args.raw_qc).resolve()
        if raw_qc_path.exists():
            print(f"Collecting ABCD native QC from {raw_qc_path}...")
            abcd_qc = collect_abcd_native_qc(raw_qc_path)
            print(f"  Found {len(abcd_qc)} subjects")
        else:
            print(f"[WARN] ABCD QC file not found: {raw_qc_path}")

    if not fmriprep_qc and not freesurfer_qc and not abcd_qc:
        print("[ERROR] No QC data collected. Check input paths.", file=sys.stderr)
        return 1

    # Generate summary
    summary_df, excluded = generate_qc_summary(
        fmriprep_qc=fmriprep_qc,
        freesurfer_qc=freesurfer_qc,
        abcd_qc=abcd_qc,
        fd_threshold=args.fd_threshold,
        max_fd_threshold=args.max_fd_threshold,
        coverage_threshold=args.coverage_threshold,
    )

    # Write QC summary
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    summary_df.to_csv(output_path, index=False)
    print(f"\nQC Summary: {len(summary_df)} subjects -> {output_path}")
    print(f"  Excluded: {len(excluded)} / {len(summary_df)} ({100*len(excluded)/max(len(summary_df),1):.1f}%)")

    # Write exclusion list
    if args.exclude_output:
        exclude_path = Path(args.exclude_output).resolve()
        exclude_path.parent.mkdir(parents=True, exist_ok=True)
        exclude_df = summary_df[summary_df["exclude"] == True][["subject_id", "exclude_reasons"]]
        exclude_df.to_csv(exclude_path, index=False)
        print(f"  Exclusion list: {exclude_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
