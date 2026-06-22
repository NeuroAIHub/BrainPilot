#!/usr/bin/env python3
"""Reorganize ABIDE raw data into BIDS-compliant directory structure.

Handles FCP/INDI-style subject directories, site extraction, and modality
routing for T1w and rs-fMRI.
"""
import argparse
import csv
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

SIDECAR_EXTENSIONS = [".json", ".bval", ".bvec", ".tsv"]

# Known ABIDE site names
ABIDE_SITES = [
    "Caltech", "CMU", "KKI", "Leuven", "MaxMun", "NYU", "OHSU",
    "Olin", "Pitt", "SBL", "SDSU", "Stanford", "Trinity", "UCLA",
    "UMich", "USM", "Yale", "ABIDEII-KKI-ABIDEII", "ABIDEII-NYU-ABIDEII",
]


def normalize_subject_id(raw_id: str) -> str:
    """Convert ABIDE subject ID to BIDS-compatible label."""
    clean = raw_id.strip()
    if clean.startswith("sub-"):
        clean = clean[4:]
    # Remove non-alphanumeric characters
    clean = re.sub(r"[^a-zA-Z0-9]", "", clean)
    return f"sub-{clean}"


def detect_site_from_path(file_path: Path, root_dir: Path) -> str:
    """Extract site name from ABIDE directory structure."""
    rel = file_path.relative_to(root_dir)
    parts = rel.parts
    for part in parts:
        # Check if any known site name is in the path component
        for site in ABIDE_SITES:
            if site.lower() in part.lower():
                return site
    return "unknown"


def detect_modality(directory: Path, filename: str) -> Optional[Tuple[str, str]]:
    """Detect BIDS modality suffix and folder from directory name or filename.

    Returns (bids_suffix, bids_folder) or None.
    """
    name_lower = (directory.name + " " + filename).lower()

    # T1w
    if any(k in name_lower for k in ["t1w", "t1", "anat", "mprage", "spgr"]):
        if "bold" not in name_lower and "fmri" not in name_lower:
            return ("T1w", "anat")

    # T2w
    if any(k in name_lower for k in ["t2w", "t2"]):
        if "bold" not in name_lower:
            return ("T2w", "anat")

    # FLAIR
    if "flair" in name_lower:
        return ("FLAIR", "anat")

    # rs-fMRI / BOLD
    if any(k in name_lower for k in ["rest", "bold", "fmri", "func", "rsfmri", "rfmri"]):
        return ("task-rest_bold", "func")

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


def write_dataset_description(bids_root: Path, version: str = "I") -> None:
    """Write BIDS dataset_description.json."""
    desc = {
        "Name": f"ABIDE {version}",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "GeneratedBy": [
            {
                "Name": "NeuroClaw abide-skill",
                "Description": "ABIDE raw data reorganized to BIDS structure",
                "Version": "1.0.0",
            }
        ],
    }
    desc_path = bids_root / "dataset_description.json"
    with open(desc_path, "w", encoding="utf-8") as f:
        json.dump(desc, f, indent=2, ensure_ascii=False)
    print(f"[OK] Wrote {desc_path}")


def write_participants_tsv(
    bids_root: Path, participants: List[Dict[str, str]], phenotype_file: Optional[Path] = None
) -> None:
    """Write BIDS participants.tsv with optional phenotype metadata."""
    # Load phenotype data if available
    phenotype_map: Dict[str, Dict[str, str]] = {}
    if phenotype_file and phenotype_file.exists():
        try:
            with open(phenotype_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Standardize key columns
                    sid = row.get("SUBJECT_ID", row.get("subject", row.get("Subject", "")))
                    if sid:
                        clean_sid = normalize_subject_id(sid)
                        phenotype_map[clean_sid] = row
        except Exception as e:
            print(f"[WARN] Failed to read phenotype file: {e}")

    tsv_path = bids_root / "participants.tsv"
    # Collect all unique header columns
    headers = ["participant_id", "site"]
    if phenotype_map:
        sample = next(iter(phenotype_map.values()))
        for col in sample.keys():
            if col not in headers and col not in ("SUBJECT_ID", "subject", "Subject"):
                headers.append(col)

    with open(tsv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t")
        writer.writerow(headers)
        seen = set()
        for p in participants:
            pid = p["participant_id"]
            if pid in seen:
                continue
            seen.add(pid)
            row = [pid, p.get("site", "unknown")]
            # Add phenotype columns
            pheno = phenotype_map.get(pid, {})
            for col in headers[2:]:
                row.append(pheno.get(col, "n/a"))
            writer.writerow(row)
    print(f"[OK] Wrote {tsv_path} ({len(seen)} participants)")


def detect_subject_layout(input_dir: Path) -> str:
    """Detect whether input follows site-based or flat layout.

    Returns 'site_based' if organized as site/subject/...,
    'flat' if organized as subject/...,
    'bids_like' if already partially BIDS-formatted.
    """
    children = [p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    if not children:
        return "flat"

    # Check if children are site directories
    for child in children:
        if child.name in ABIDE_SITES or any(s.lower() in child.name.lower() for s in ABIDE_SITES):
            return "site_based"
        # Check if children contain subject-like numeric IDs
        sub_children = [p for p in child.iterdir() if p.is_dir()]
        if sub_children:
            for sc in sub_children:
                if sc.name.startswith("sub-") or sc.name.replace("_", "").isdigit():
                    return "site_based"

    # Check if top-level looks like subjects
    for child in children:
        if child.name.replace("_", "").isdigit() or child.name.startswith("sub-"):
            return "flat"

    # Check for BIDS-like structure
    for child in children:
        if (child / "anat").exists() or (child / "func").exists():
            return "bids_like"

    return "flat"


def process_site_based_layout(
    input_dir: Path,
    bids_root: Path,
    participants: List[Dict[str, str]],
    dry_run: bool = False,
) -> Tuple[int, int, int]:
    """Process site-based ABIDE layout: site/subject/session/modality/files."""
    converted = 0
    skipped = 0
    failed = 0

    site_dirs = sorted(
        [p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    )

    for site_dir in site_dirs:
        site_name = site_dir.name
        subject_dirs = sorted([p for p in site_dir.iterdir() if p.is_dir()])

        for subject_dir in subject_dirs:
            sub_label = normalize_subject_id(subject_dir.name)
            participants.append({"participant_id": sub_label, "site": site_name})

            # Walk through session/modality directories
            nifti_files = find_nifti_files(subject_dir)
            for nifti in nifti_files:
                # Try to detect modality from parent directory and filename
                result = detect_modality(nifti.parent, nifti.name)
                if result is None:
                    # Try grandparent
                    result = detect_modality(nifti.parent.parent, nifti.name)
                if result is None:
                    print(f"[WARN] {sub_label} ({site_name}) | cannot detect modality: {nifti.name}")
                    failed += 1
                    continue

                bids_suffix, bids_folder = result
                ses_label = "ses-1"
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
                    print(f"[OK] {sub_label} ({site_name}) / {bids_folder} / {dst_stem}")
                    converted += 1

    return converted, skipped, failed


def process_flat_layout(
    input_dir: Path,
    bids_root: Path,
    participants: List[Dict[str, str]],
    dry_run: bool = False,
) -> Tuple[int, int, int]:
    """Process flat ABIDE layout: subject/modality/files."""
    converted = 0
    skipped = 0
    failed = 0

    subject_dirs = sorted(
        [p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    )

    for subject_dir in subject_dirs:
        sub_label = normalize_subject_id(subject_dir.name)
        site = detect_site_from_path(subject_dir, input_dir)
        participants.append({"participant_id": sub_label, "site": site})

        nifti_files = find_nifti_files(subject_dir)
        for nifti in nifti_files:
            result = detect_modality(nifti.parent, nifti.name)
            if result is None:
                result = detect_modality(subject_dir, nifti.name)
            if result is None:
                print(f"[WARN] {sub_label} | cannot detect modality: {nifti.name}")
                failed += 1
                continue

            bids_suffix, bids_folder = result
            ses_label = "ses-1"
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
                print(f"[OK] {sub_label} / {bids_folder} / {dst_stem}")
                converted += 1

    return converted, skipped, failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reorganize ABIDE raw data into BIDS-compliant structure."
    )
    parser.add_argument(
        "--input", required=True, help="Path to ABIDE raw data directory"
    )
    parser.add_argument(
        "--output", required=True, help="Path to output BIDS directory"
    )
    parser.add_argument(
        "--phenotype", help="Path to ABIDE phenotype CSV file"
    )
    parser.add_argument(
        "--version",
        default="I",
        help="ABIDE version: I or II (default: I)",
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Preview without copying files"
    )
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    if not input_dir.exists() or not input_dir.is_dir():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    participants: List[Dict[str, str]] = []

    # Detect layout
    layout = detect_subject_layout(input_dir)
    print(f"Detected layout: {layout}")
    print(f"Input:  {input_dir}")
    print(f"Output: {output_dir}")
    print(f"{'[DRY RUN] ' if args.dry_run else ''}Starting reorganization...\n")

    if layout == "site_based":
        converted, skipped, failed = process_site_based_layout(
            input_dir, output_dir, participants, args.dry_run
        )
    else:
        converted, skipped, failed = process_flat_layout(
            input_dir, output_dir, participants, args.dry_run
        )

    # Write BIDS metadata
    if not args.dry_run and converted > 0:
        write_dataset_description(output_dir, args.version)
        phenotype_path = Path(args.phenotype).resolve() if args.phenotype else None
        write_participants_tsv(output_dir, participants, phenotype_path)

    print(f"\nDone. Converted={converted}, Skipped={skipped}, Failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
