#!/usr/bin/env python3
"""Validate and reorganize AOMIC data into BIDS-compliant directory structure.

AOMIC (Amsterdam Open MRI Collection) data is typically already in BIDS format.
This script validates structure, handles edge cases, and normalizes across
sub-datasets (ID1000, PIOP1, PIOP2).
"""
import argparse
import json
import os
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# AOMIC task names recognized in BIDS
AOMIC_TASKS = [
    "rest",
    "emotion",
    "gambling",
    "motor",
    "language",
    "workingmemory",
    "stroop",
]

SIDECAR_EXTENSIONS = [".json", ".bval", ".bvec", ".tsv", ".txt"]


def validate_subject_id(subject_dir_name: str) -> Optional[str]:
    """Validate and normalize AOMIC subject ID to BIDS label.

    AOMIC uses sub-XXXX format already.
    """
    name = subject_dir_name.strip()
    if name.startswith("sub-"):
        label = name[4:]
    else:
        label = name

    # Must be alphanumeric
    clean = re.sub(r"[^a-zA-Z0-9]", "", label)
    if not clean:
        return None
    return f"sub-{clean}"


def detect_task_from_filename(filename: str) -> Optional[str]:
    """Extract BIDS task name from filename."""
    match = re.search(r"task-([a-zA-Z0-9]+)", filename)
    if match:
        return match.group(1).lower()
    return None


def validate_bids_filename(filename: str) -> bool:
    """Check if filename follows BIDS naming conventions."""
    # Must have sub- prefix for subject
    if not re.search(r"sub-[a-zA-Z0-9]+", filename):
        return False
    # Must end with known extensions
    valid_exts = [".nii", ".nii.gz", ".json", ".tsv", ".bval", ".bvec", ".txt", ".eeg", ".vhdr", ".vmrk"]
    return any(filename.endswith(ext) for ext in valid_exts)


def find_nifti_files(directory: Path) -> List[Path]:
    """Find all NIfTI files in a directory."""
    results = []
    for f in sorted(directory.rglob("*")):
        if f.is_file() and (f.name.endswith(".nii") or f.name.endswith(".nii.gz")):
            results.append(f)
    return results


def copy_with_sidecars(src_nifti: Path, dst_dir: Path, dst_stem: str) -> List[Path]:
    """Copy NIfTI file and its sidecar files to destination."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    copied = []

    ext = ".nii.gz" if src_nifti.name.endswith(".nii.gz") else ".nii"
    dst_nifti = dst_dir / f"{dst_stem}{ext}"
    if not dst_nifti.exists():
        shutil.copy2(str(src_nifti), str(dst_nifti))
    copied.append(dst_nifti)

    src_stem = src_nifti.name
    if src_stem.endswith(".nii.gz"):
        src_stem = src_stem[:-7]
    elif src_stem.endswith(".nii"):
        src_stem = src_stem[:-4]

    for sidecar_ext in SIDECAR_EXTENSIONS:
        src_sidecar = src_nifti.parent / f"{src_stem}{sidecar_ext}"
        if src_sidecar.exists():
            dst_sidecar = dst_dir / f"{dst_stem}{sidecar_ext}"
            if not dst_sidecar.exists():
                shutil.copy2(str(src_sidecar), str(dst_sidecar))
            copied.append(dst_sidecar)

    return copied


def write_dataset_description(bids_root: Path, sub_dataset: str = "AOMIC") -> None:
    """Write BIDS dataset_description.json."""
    desc = {
        "Name": f"Amsterdam Open MRI Collection ({sub_dataset})",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "GeneratedBy": [
            {
                "Name": "NeuroClaw aomic-skill",
                "Description": f"AOMIC ({sub_dataset}) data validated and reorganized to BIDS structure",
                "Version": "1.0.0",
            }
        ],
    }
    desc_path = bids_root / "dataset_description.json"
    with open(desc_path, "w", encoding="utf-8") as f:
        json.dump(desc, f, indent=2, ensure_ascii=False)
    print(f"[OK] Wrote {desc_path}")


def write_participants_tsv(bids_root: Path, subject_ids: List[str]) -> None:
    """Write BIDS participants.tsv header."""
    tsv_path = bids_root / "participants.tsv"
    with open(tsv_path, "w", encoding="utf-8") as f:
        f.write("participant_id\n")
        for sid in sorted(set(subject_ids)):
            f.write(f"{sid}\n")
    print(f"[OK] Wrote {tsv_path} ({len(set(subject_ids))} participants)")


def process_aomic_subject(
    subject_dir: Path,
    bids_root: Path,
    sub_label: str,
    dry_run: bool = False,
    copy_mode: bool = False,
) -> Tuple[int, int, int]:
    """Process a single AOMIC subject directory.

    AOMIC data is typically already in BIDS layout. This function validates
    and optionally copies/reorganizes.

    Returns (converted, skipped, failed).
    """
    converted = 0
    skipped = 0
    failed = 0

    # Check for standard BIDS subdirectories
    anat_dir = subject_dir / "anat"
    func_dir = subject_dir / "func"
    dwi_dir = subject_dir / "dwi"

    nifti_files = find_nifti_files(subject_dir)

    if not nifti_files:
        print(f"[WARN] {sub_label}: no NIfTI files found")
        return 0, 0, 1

    for nifti in nifti_files:
        # Determine BIDS folder from relative path
        try:
            rel_path = nifti.relative_to(subject_dir)
        except ValueError:
            rel_path = Path(nifti.name)

        parts = rel_path.parts
        if len(parts) > 1:
            bids_folder = parts[0]  # anat, func, dwi
            bids_filename = parts[-1]
        else:
            bids_filename = nifti.name
            # Try to detect folder from filename
            if "T1w" in bids_filename or "T2w" in bids_filename:
                bids_folder = "anat"
            elif "bold" in bids_filename or "task-" in bids_filename:
                bids_folder = "func"
            elif "dwi" in bids_filename:
                bids_folder = "dwi"
            else:
                bids_folder = "anat"

        # Ensure filename has subject prefix
        if not bids_filename.startswith(sub_label):
            # Try to fix
            bids_filename = f"{sub_label}_{bids_filename.split('_', 1)[-1]}" if "_" in bids_filename else f"{sub_label}_{bids_filename}"

        dst_dir = bids_root / sub_label / bids_folder
        dst_stem = bids_filename.rsplit(".nii", 1)[0]
        if dst_stem.endswith("."):
            dst_stem = dst_stem[:-1]

        ext = ".nii.gz" if nifti.name.endswith(".nii.gz") else ".nii"
        if (dst_dir / f"{dst_stem}{ext}").exists():
            skipped += 1
            continue

        if dry_run:
            print(f"[DRY] {sub_label}/{bids_folder}/{dst_stem}")
            converted += 1
        elif copy_mode:
            copy_with_sidecars(nifti, dst_dir, dst_stem)
            print(f"[OK] {sub_label}/{bids_folder}/{dst_stem}")
            converted += 1
        else:
            # Validation-only mode
            if validate_bids_filename(bids_filename):
                print(f"[VALID] {sub_label}/{bids_folder}/{bids_filename}")
                converted += 1
            else:
                print(f"[WARN] {sub_label}/{bids_folder}/{bids_filename}: non-standard naming")
                failed += 1

    return converted, skipped, failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and reorganize AOMIC data into BIDS-compliant structure."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to AOMIC data directory",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to output BIDS directory",
    )
    parser.add_argument(
        "--sub-dataset",
        default="ID1000",
        choices=["ID1000", "PIOP1", "PIOP2", "all"],
        help="AOMIC sub-dataset (default: ID1000)",
    )
    parser.add_argument(
        "--participants-file",
        help="Optional: path to phenotype file for participant metadata",
    )
    parser.add_argument(
        "--copy",
        action="store_true",
        help="Copy files to output directory (default: validation only)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without processing files",
    )
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    if not input_dir.exists() or not input_dir.is_dir():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    participants: List[str] = []

    print(f"Sub-dataset: {args.sub_dataset}")
    print(f"Input:  {input_dir}")
    print(f"Output: {output_dir}")
    print(f"Mode:   {'DRY RUN' if args.dry_run else 'COPY' if args.copy else 'VALIDATE'}")
    print()

    # Find subject directories
    subject_dirs = sorted(
        [p for p in input_dir.iterdir() if p.is_dir() and (p.name.startswith("sub-") or re.match(r"^\d+$", p.name))]
    )

    if not subject_dirs:
        # Try nested structure (e.g., ID1000/sub-0001/)
        for child in sorted(input_dir.iterdir()):
            if child.is_dir():
                nested = sorted(
                    [p for p in child.iterdir() if p.is_dir() and (p.name.startswith("sub-") or re.match(r"^\d+$", p.name))]
                )
                subject_dirs.extend(nested)

    if not subject_dirs:
        print("[ERROR] No subject directories found.", file=sys.stderr)
        return 1

    print(f"Found {len(subject_dirs)} subject directories\n")

    total_converted = 0
    total_skipped = 0
    total_failed = 0

    for subject_dir in subject_dirs:
        sub_label = validate_subject_id(subject_dir.name)
        if not sub_label:
            print(f"[WARN] Skipping invalid directory: {subject_dir.name}")
            total_failed += 1
            continue

        participants.append(sub_label)
        converted, skipped, failed = process_aomic_subject(
            subject_dir, output_dir, sub_label, args.dry_run, args.copy
        )
        total_converted += converted
        total_skipped += skipped
        total_failed += failed

    # Write BIDS metadata
    if not args.dry_run and (args.copy or total_converted > 0):
        write_dataset_description(output_dir, args.sub_dataset)
        write_participants_tsv(output_dir, participants)

    print(f"\nDone. Converted={total_converted}, Skipped={total_skipped}, Failed={total_failed}")
    return 0 if total_failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
