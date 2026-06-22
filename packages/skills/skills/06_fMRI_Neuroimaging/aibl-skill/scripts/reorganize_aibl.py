#!/usr/bin/env python3
"""Reorganize AIBL raw data into BIDS-compliant directory structure.

Handles AIBL-style subject IDs, visit names, and multimodal routing
for T1w MRI and PET (PiB, FDG, tau).
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

# AIBL visit name -> BIDS session label mapping
AIBL_SESSION_MAP = {
    "screening": "screening",
    "baseline": "baseline",
    "18month": "18month",
    "18_month": "18month",
    "18-month": "18month",
    "36month": "36month",
    "36_month": "36month",
    "36-month": "36month",
    "54month": "54month",
    "54_month": "54month",
    "54-month": "54month",
    "72month": "72month",
    "72_month": "72month",
    "72-month": "72month",
}

# Modality keywords -> BIDS modality mapping
MODALITY_PATTERNS = [
    (re.compile(r"T1w|T1|mprage|MPRAGE|SPGR", re.IGNORECASE), "T1w", "anat"),
    (re.compile(r"PET.*PiB|PiB.*PET|pib", re.IGNORECASE), "pet", "pet"),
    (re.compile(r"PET.*FDG|FDG.*PET|fdg", re.IGNORECASE), "pet", "pet"),
    (re.compile(r"PET.*tau|tau.*PET|18F.*AV.*1451|flortaucipir", re.IGNORECASE), "pet", "pet"),
    (re.compile(r"PET|pet", re.IGNORECASE), "pet", "pet"),
]

SIDECAR_EXTENSIONS = [".json", ".bval", ".bvec", ".tsv"]


def normalize_subject_id(raw_id: str) -> str:
    """Convert AIBL subject ID to BIDS-compatible label.

    002_S_0295 -> sub-002S0295
    """
    clean = raw_id.strip()
    if clean.startswith("sub-"):
        clean = clean[4:]
    # Remove underscores and non-alphanumeric characters
    clean = re.sub(r"[^a-zA-Z0-9]", "", clean)
    return f"sub-{clean}"


def normalize_session(visit_name: str) -> str:
    """Convert AIBL visit name to BIDS session label."""
    visit_name = visit_name.strip().lower()
    if visit_name.startswith("ses-"):
        visit_name = visit_name[4:]

    # Direct match
    if visit_name in AIBL_SESSION_MAP:
        return f"ses-{AIBL_SESSION_MAP[visit_name]}"

    # Fuzzy match
    for key, val in AIBL_SESSION_MAP.items():
        if key in visit_name or visit_name in key:
            return f"ses-{val}"

    # Fallback: sanitize
    clean = re.sub(r"[^a-zA-Z0-9]", "", visit_name)
    return f"ses-{clean}"


def detect_pet_tracer(filename: str) -> str:
    """Detect PET tracer from filename."""
    fname = filename.lower()
    if "pib" in fname:
        return "PiB"
    if "fdg" in fname:
        return "FDG"
    if "tau" in fname or "av1451" in fname or "flortaucipir" in fname:
        return "tau"
    return "unknown"


def detect_modality(filename: str) -> Optional[Tuple[str, str, str]]:
    """Detect BIDS modality suffix and folder from filename.

    Returns (bids_suffix, bids_folder, tracer) or None.
    """
    for pattern, suffix, folder in MODALITY_PATTERNS:
        if pattern.search(filename):
            if folder == "pet":
                tracer = detect_pet_tracer(filename)
                return (suffix, folder, tracer)
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


def write_dataset_description(bids_root: Path) -> None:
    """Write BIDS dataset_description.json."""
    desc = {
        "Name": "AIBL (Australian Imaging, Biomarkers and Lifestyle)",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "GeneratedBy": [
            {
                "Name": "NeuroClaw aibl-skill",
                "Description": "AIBL raw data reorganized to BIDS structure",
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
    """Detect whether input follows flat or nested AIBL layout.

    Returns 'flat' if subject dirs are direct children,
    'nested' if organized as subject/visit/modality.
    """
    children = list(input_dir.iterdir())
    if not children:
        return "flat"

    first_child = children[0]
    if first_child.is_dir():
        sub_children = list(first_child.iterdir())
        if sub_children:
            # Check if children look like visit names
            for sc in sub_children:
                if sc.is_dir() and any(
                    k in sc.name.lower() for k in ["screening", "baseline", "month", "visit"]
                ):
                    return "nested"
            # Check if children look like modality folders
            for sc in sub_children:
                if sc.is_dir() and detect_modality(sc.name):
                    return "flat"

    return "flat"


def process_flat_layout(
    input_dir: Path,
    bids_root: Path,
    participants: List[str],
    dry_run: bool = False,
) -> Tuple[int, int, int]:
    """Process flat AIBL layout: subject/modality/files."""
    converted = 0
    skipped = 0
    failed = 0

    subject_dirs = sorted(
        [p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    )

    for subject_dir in subject_dirs:
        sub_label = normalize_subject_id(subject_dir.name)
        participants.append(sub_label)

        for modality_dir in sorted(subject_dir.iterdir()):
            if not modality_dir.is_dir():
                continue

            nifti_files = find_nifti_files(modality_dir)
            for nifti in nifti_files:
                result = detect_modality(nifti.name)
                if result is None:
                    result = detect_modality(modality_dir.name)
                if result is None:
                    print(f"[WARN] {sub_label} | cannot detect modality: {nifti.name}")
                    failed += 1
                    continue

                bids_suffix, bids_folder, tracer = result

                ses_label = "ses-baseline"

                if bids_folder == "pet":
                    dst_stem = f"{sub_label}_{ses_label}_trc-{tracer}_{bids_suffix}"
                else:
                    dst_stem = f"{sub_label}_{ses_label}_{bids_suffix}"

                bids_sub_dir = bids_root / sub_label / ses_label / bids_folder

                ext = ".nii.gz" if nifti.name.endswith(".nii.gz") else ".nii"
                if (bids_sub_dir / f"{dst_stem}{ext}").exists():
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
    """Process nested AIBL layout: subject/visit/modality/files."""
    converted = 0
    skipped = 0
    failed = 0

    subject_dirs = sorted(
        [p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    )

    for subject_dir in subject_dirs:
        sub_label = normalize_subject_id(subject_dir.name)
        participants.append(sub_label)

        for visit_dir in sorted(subject_dir.iterdir()):
            if not visit_dir.is_dir():
                continue

            ses_label = normalize_session(visit_dir.name)

            for modality_dir in sorted(visit_dir.iterdir()):
                if not modality_dir.is_dir():
                    continue

                nifti_files = find_nifti_files(modality_dir)
                if not nifti_files:
                    nifti_files = find_nifti_files(visit_dir)
                    nifti_files = [f for f in nifti_files if f.parent == modality_dir]

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

                    bids_suffix, bids_folder, tracer = result

                    if bids_folder == "pet":
                        dst_stem = f"{sub_label}_{ses_label}_trc-{tracer}_{bids_suffix}"
                    else:
                        dst_stem = f"{sub_label}_{ses_label}_{bids_suffix}"

                    bids_sub_dir = bids_root / sub_label / ses_label / bids_folder

                    ext = ".nii.gz" if nifti.name.endswith(".nii.gz") else ".nii"
                    if (bids_sub_dir / f"{dst_stem}{ext}").exists():
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
        description="Reorganize AIBL raw data into BIDS-compliant structure."
    )
    parser.add_argument(
        "--input",
        required=True,
        help="Path to AIBL raw data directory",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Path to output BIDS directory",
    )
    parser.add_argument(
        "--participants-file",
        help="Optional: path to AIBL phenotype file for participant metadata",
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

    if not args.dry_run and converted > 0:
        write_dataset_description(output_dir)
        write_participants_tsv(output_dir, participants)

    print(f"\nDone. Converted={converted}, Skipped={skipped}, Failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
