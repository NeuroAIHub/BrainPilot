#!/usr/bin/env python3
"""Reorganize ABCD Study raw data into BIDS-compliant directory structure.

Handles NDAR-style subject IDs, ABCD event names, and multimodal routing
for T1w, T2w, dMRI, rs-fMRI, and task-fMRI.
"""
import argparse
import json
import os
import re
import shutil
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# ABCD event name -> BIDS session label mapping
ABCD_SESSION_MAP = {
    "baselineYear1Arm1": "baselineYear1Arm1",
    "1YearFollowUpYArm1": "1YearFollowUpYArm1",
    "2YearFollowUpYArm1": "2YearFollowUpYArm1",
    "3YearFollowUpYArm1": "3YearFollowUpYArm1",
    "4YearFollowUpYArm1": "4YearFollowUpYArm1",
}

# Modality keywords -> BIDS modality mapping
MODALITY_PATTERNS = [
    (re.compile(r"T1w|t1w|T1|mprage", re.IGNORECASE), "T1w", "anat"),
    (re.compile(r"T2w|t2w|T2", re.IGNORECASE), "T2w", "anat"),
    (re.compile(r"dMRI|dmri|DWI|dwi|DTI|dti", re.IGNORECASE), "dwi", "dwi"),
    (re.compile(r"rsfMRI|rs-fMRI|rest_bold|task-rest", re.IGNORECASE), "task-rest_bold", "func"),
    (re.compile(r"task-fMRI|tfMRI|task-[a-zA-Z]+_bold", re.IGNORECASE), None, "func"),  # dynamic task name
]

SIDECAR_EXTENSIONS = [".json", ".bval", ".bvec", ".tsv"]


def normalize_ndar_id(raw_id: str) -> str:
    """Convert NDAR subject ID to BIDS-compatible label.

    NDAR_INV000ABC0 -> sub-NDARINV000ABC0
    """
    clean = raw_id.strip()
    if clean.startswith("sub-"):
        clean = clean[4:]
    # Remove any non-alphanumeric characters except underscore
    clean = re.sub(r"[^a-zA-Z0-9_]", "", clean)
    return f"sub-{clean}"


def normalize_session(event_name: str) -> str:
    """Convert ABCD event name to BIDS session label."""
    event_name = event_name.strip()
    if event_name.startswith("ses-"):
        event_name = event_name[4:]
    if event_name in ABCD_SESSION_MAP:
        return f"ses-{ABCD_SESSION_MAP[event_name]}"
    # Fallback: sanitize
    clean = re.sub(r"[^a-zA-Z0-9]", "", event_name)
    return f"ses-{clean}"


def detect_modality(filename: str) -> Optional[Tuple[str, str, str]]:
    """Detect BIDS modality suffix and folder from filename.

    Returns (bids_suffix, bids_folder, task_name) or None.
    """
    for pattern, suffix, folder in MODALITY_PATTERNS:
        if pattern.search(filename):
            # For task-fMRI, extract task name if present
            if folder == "func" and suffix is None:
                task_match = re.search(r"task-([a-zA-Z]+)", filename)
                if task_match:
                    task_name = task_match.group(1)
                    return (f"task-{task_name}_bold", "func", task_name)
                return ("task-unknown_bold", "func", "unknown")
            return (suffix, folder, "")
    return None


def find_nifti_files(directory: Path) -> List[Path]:
    """Find all NIfTI files in a directory."""
    results = []
    for f in directory.rglob("*"):
        if f.is_file() and (f.name.endswith(".nii") or f.name.endswith(".nii.gz")):
            results.append(f)
    return results


def copy_with_sidecars(src_nifti: Path, dst_dir: Path, dst_stem: str) -> List[Path]:
    """Copy NIfTI file and its sidecar files to destination."""
    dst_dir.mkdir(parents=True, exist_ok=True)
    copied = []

    # Copy main NIfTI
    ext = ".nii.gz" if src_nifti.name.endswith(".nii.gz") else ".nii"
    dst_nifti = dst_dir / f"{dst_stem}{ext}"
    if not dst_nifti.exists():
        shutil.copy2(str(src_nifti), str(dst_nifti))
    copied.append(dst_nifti)

    # Copy sidecars
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


def write_dataset_description(bids_root: Path, release_version: str = "5.1") -> None:
    """Write BIDS dataset_description.json."""
    desc = {
        "Name": f"ABCD Study {release_version}",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "GeneratedBy": [
            {
                "Name": "NeuroClaw abcd-skill",
                "Description": "ABCD raw data reorganized to BIDS structure",
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


def detect_subject_layout(input_dir: Path) -> str:
    """Detect whether input follows flat or nested ABCD layout.

    Returns 'flat' if subject dirs are direct children,
    'nested' if organized as subject/session/modality,
    'ndar_package' if following NDA download package structure.
    """
    children = list(input_dir.iterdir())
    if not children:
        return "flat"

    # Check for NDA package structure (collection directories)
    for child in children:
        if child.is_dir() and child.name.startswith("collection_"):
            return "ndar_package"

    # Check for subject/session/modality nesting
    first_child = children[0]
    if first_child.is_dir():
        sub_children = list(first_child.iterdir())
        if sub_children:
            # If children have modality-like names, it's flat
            for sc in sub_children:
                if sc.is_dir() and detect_modality(sc.name):
                    return "flat"
            # If children look like session names, it's nested
            for sc in sub_children:
                if sc.is_dir() and any(
                    k in sc.name for k in ["baseline", "Year", "FollowUp"]
                ):
                    return "nested"

    return "flat"


def process_flat_layout(
    input_dir: Path,
    bids_root: Path,
    participants: List[str],
    dry_run: bool = False,
) -> Tuple[int, int, int]:
    """Process flat ABCD layout: subject/modality/files."""
    converted = 0
    skipped = 0
    failed = 0

    subject_dirs = sorted(
        [p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    )

    for subject_dir in subject_dirs:
        sub_label = normalize_ndar_id(subject_dir.name)
        participants.append(sub_label)

        for modality_dir in sorted(subject_dir.iterdir()):
            if not modality_dir.is_dir():
                continue

            nifti_files = find_nifti_files(modality_dir)
            for nifti in nifti_files:
                result = detect_modality(nifti.name)
                if result is None:
                    # Try parent folder name
                    result = detect_modality(modality_dir.name)
                if result is None:
                    print(f"[WARN] {sub_label} | cannot detect modality: {nifti.name}")
                    failed += 1
                    continue

                bids_suffix, bids_folder, task_name = result

                # Default session
                ses_label = "ses-baselineYear1Arm1"

                bids_sub_dir = bids_root / sub_label / ses_label / bids_folder
                dst_stem = f"{sub_label}_{ses_label}_{bids_suffix}"

                if (bids_sub_dir / f"{dst_stem}.nii").exists() or (
                    bids_sub_dir / f"{dst_stem}.nii.gz"
                ).exists():
                    skipped += 1
                    continue

                if dry_run:
                    print(f"[DRY] {sub_label}/{ses_label}/{bids_folder}/{dst_stem}")
                    converted += 1
                else:
                    copy_with_sidecars(nifti, bids_sub_dir, dst_stem)
                    print(f"[OK] {sub_label}/{ses_label}/{bids_folder}/{dst_stem}")
                    converted += 1

    return converted, skipped, failed


def process_nested_layout(
    input_dir: Path,
    bids_root: Path,
    participants: List[str],
    dry_run: bool = False,
) -> Tuple[int, int, int]:
    """Process nested ABCD layout: subject/session/modality/files."""
    converted = 0
    skipped = 0
    failed = 0

    subject_dirs = sorted(
        [p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    )

    for subject_dir in subject_dirs:
        sub_label = normalize_ndar_id(subject_dir.name)
        participants.append(sub_label)

        for session_dir in sorted(subject_dir.iterdir()):
            if not session_dir.is_dir():
                continue

            ses_label = normalize_session(session_dir.name)

            for modality_dir in sorted(session_dir.iterdir()):
                if not modality_dir.is_dir():
                    continue

                nifti_files = find_nifti_files(modality_dir)
                if not nifti_files:
                    # Try detecting modality from folder name
                    result = detect_modality(modality_dir.name)
                    if result:
                        nifti_files = find_nifti_files(session_dir)
                        nifti_files = [
                            f
                            for f in nifti_files
                            if f.parent == modality_dir or f.parent == session_dir
                        ]

                for nifti in nifti_files:
                    result = detect_modality(nifti.name)
                    if result is None:
                        result = detect_modality(modality_dir.name)
                    if result is None:
                        print(
                            f"[WARN] {sub_label}/{ses_label} | cannot detect modality: {nifti.name}"
                        )
                        failed += 1
                        continue

                    bids_suffix, bids_folder, task_name = result
                    bids_sub_dir = bids_root / sub_label / ses_label / bids_folder
                    dst_stem = f"{sub_label}_{ses_label}_{bids_suffix}"

                    if (bids_sub_dir / f"{dst_stem}.nii").exists() or (
                        bids_sub_dir / f"{dst_stem}.nii.gz"
                    ).exists():
                        skipped += 1
                        continue

                    if dry_run:
                        print(
                            f"[DRY] {sub_label}/{ses_label}/{bids_folder}/{dst_stem}"
                        )
                        converted += 1
                    else:
                        copy_with_sidecars(nifti, bids_sub_dir, dst_stem)
                        print(
                            f"[OK] {sub_label}/{ses_label}/{bids_folder}/{dst_stem}"
                        )
                        converted += 1

    return converted, skipped, failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reorganize ABCD Study raw data into BIDS-compliant structure."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to ABCD raw data directory",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to output BIDS directory",
    )
    parser.add_argument(
        "--participants-file",
        help="Optional: path to ABCD phenotype file for participant metadata",
    )
    parser.add_argument(
        "--release-version",
        default="5.1",
        help="ABCD release version (default: 5.1)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview without copying files",
    )
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    if not input_dir.exists() or not input_dir.is_dir():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    participants: List[str] = []

    # Detect layout
    layout = detect_subject_layout(input_dir)
    print(f"Detected layout: {layout}")
    print(f"Input:  {input_dir}")
    print(f"Output: {output_dir}")
    print(f"{'[DRY RUN] ' if args.dry_run else ''}Starting reorganization...\n")

    if layout == "nested":
        converted, skipped, failed = process_nested_layout(
            input_dir, output_dir, participants, args.dry_run
        )
    else:
        converted, skipped, failed = process_flat_layout(
            input_dir, output_dir, participants, args.dry_run
        )

    # Write BIDS metadata
    if not args.dry_run and converted > 0:
        write_dataset_description(output_dir, args.release_version)
        write_participants_tsv(output_dir, participants)

    print(f"\nDone. Converted={converted}, Skipped={skipped}, Failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
