#!/usr/bin/env python3
"""Reorganize ADHD-200 raw data into BIDS-compliant directory structure.

Handles FCP/INDI-style subject directories, site extraction, and modality
routing for T1w and rs-fMRI.
"""
import argparse
import csv
import json
import re
import shutil
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

SIDECAR_EXTENSIONS = [".json", ".bval", ".bvec", ".tsv"]

ADHD200_SITES = [
    "Peking", "Brown", "NYU", "KKI", "NeuroImage",
    "OHSU", "Pitt", "WashU", "Washington",
]


def normalize_subject_id(raw_id: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9]", "", str(raw_id).strip())
    return f"sub-{clean}"


def detect_site_from_path(file_path: Path, root_dir: Path) -> str:
    rel = file_path.relative_to(root_dir)
    for part in rel.parts:
        for site in ADHD200_SITES:
            if site.lower() in part.lower():
                return site
    return "unknown"


def detect_modality(directory: Path, filename: str) -> Optional[Tuple[str, str]]:
    name_lower = (directory.name + " " + filename).lower()
    if any(k in name_lower for k in ["t1w", "t1", "anat", "mprage"]):
        if "bold" not in name_lower:
            return ("T1w", "anat")
    if any(k in name_lower for k in ["rest", "bold", "fmri", "func", "rsfmri"]):
        return ("task-rest_bold", "func")
    return None


def find_nifti_files(directory: Path) -> List[Path]:
    return [
        f for f in directory.rglob("*")
        if f.is_file() and (f.name.endswith(".nii") or f.name.endswith(".nii.gz"))
    ]


def copy_with_sidecars(src_nifti: Path, dst_dir: Path, dst_stem: str) -> None:
    dst_dir.mkdir(parents=True, exist_ok=True)
    ext = ".nii.gz" if src_nifti.name.endswith(".nii.gz") else ".nii"
    dst_nifti = dst_dir / f"{dst_stem}{ext}"
    if not dst_nifti.exists():
        shutil.copy2(str(src_nifti), str(dst_nifti))

    src_stem = src_nifti.name[:-7] if src_nifti.name.endswith(".nii.gz") else src_nifti.name[:-4]
    for sidecar_ext in SIDECAR_EXTENSIONS:
        src_sidecar = src_nifti.parent / f"{src_stem}{sidecar_ext}"
        if src_sidecar.exists():
            dst_sidecar = dst_dir / f"{dst_stem}{sidecar_ext}"
            if not dst_sidecar.exists():
                shutil.copy2(str(src_sidecar), str(dst_sidecar))


def write_dataset_description(bids_root: Path) -> None:
    desc = {
        "Name": "ADHD-200",
        "BIDSVersion": "1.8.0",
        "DatasetType": "raw",
        "GeneratedBy": [{"Name": "NeuroClaw adhd200-skill", "Version": "1.0.0"}],
    }
    (bids_root / "dataset_description.json").write_text(
        json.dumps(desc, indent=2), encoding="utf-8"
    )


def write_participants_tsv(bids_root: Path, participants: List[Dict[str, str]], phenotype_file: Optional[Path] = None) -> None:
    phenotype_map: Dict[str, Dict[str, str]] = {}
    if phenotype_file and phenotype_file.exists():
        try:
            with open(phenotype_file, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    sid = row.get("subject", row.get("SUBJECT_ID", row.get("Subject", "")))
                    if sid:
                        phenotype_map[normalize_subject_id(sid)] = row
        except Exception:
            pass

    tsv_path = bids_root / "participants.tsv"
    headers = ["participant_id", "site"]
    if phenotype_map:
        sample = next(iter(phenotype_map.values()))
        for col in sample:
            if col not in headers and col not in ("subject", "SUBJECT_ID", "Subject"):
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
            pheno = phenotype_map.get(pid, {})
            for col in headers[2:]:
                row.append(pheno.get(col, "n/a"))
            writer.writerow(row)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reorganize ADHD-200 raw data into BIDS structure.")
    parser.add_argument("--input", required=True, help="Path to ADHD-200 raw data directory")
    parser.add_argument("--output", required=True, help="Path to output BIDS directory")
    parser.add_argument("--phenotype", help="Path to ADHD-200 phenotype CSV file")
    parser.add_argument("--dry-run", action="store_true", help="Preview without copying files")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()

    if not input_dir.exists():
        print(f"Input directory does not exist: {input_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)
    participants: List[Dict[str, str]] = []
    converted = skipped = failed = 0

    print(f"{'[DRY RUN] ' if args.dry_run else ''}Starting ADHD-200 reorganization...\n")

    subject_dirs = sorted([p for p in input_dir.iterdir() if p.is_dir() and not p.name.startswith(".")])

    for subject_dir in subject_dirs:
        site = detect_site_from_path(subject_dir, input_dir)
        nifti_files = find_nifti_files(subject_dir)

        if not nifti_files:
            # Treat as site directory
            for sub_dir in sorted(subject_dir.iterdir()):
                if not sub_dir.is_dir():
                    continue
                sub_label = normalize_subject_id(sub_dir.name)
                participants.append({"participant_id": sub_label, "site": site})
                for nifti in find_nifti_files(sub_dir):
                    result = detect_modality(nifti.parent, nifti.name)
                    if result is None:
                        result = detect_modality(sub_dir, nifti.name)
                    if result is None:
                        failed += 1
                        continue
                    bids_suffix, bids_folder = result
                    bids_sub_dir = output_dir / sub_label / "ses-1" / bids_folder
                    dst_stem = f"{sub_label}_ses-1_{bids_suffix}"
                    if (bids_sub_dir / f"{dst_stem}.nii.gz").exists():
                        skipped += 1
                        continue
                    if args.dry_run:
                        print(f"[DRY] {sub_label}/ses-1/{bids_folder}/{dst_stem}")
                    else:
                        copy_with_sidecars(nifti, bids_sub_dir, dst_stem)
                        print(f"[OK] {sub_label} ({site}) / {bids_folder} / {dst_stem}")
                    converted += 1
        else:
            sub_label = normalize_subject_id(subject_dir.name)
            participants.append({"participant_id": sub_label, "site": site})
            for nifti in nifti_files:
                result = detect_modality(nifti.parent, nifti.name)
                if result is None:
                    result = detect_modality(subject_dir, nifti.name)
                if result is None:
                    failed += 1
                    continue
                bids_suffix, bids_folder = result
                bids_sub_dir = output_dir / sub_label / "ses-1" / bids_folder
                dst_stem = f"{sub_label}_ses-1_{bids_suffix}"
                if (bids_sub_dir / f"{dst_stem}.nii.gz").exists():
                    skipped += 1
                    continue
                if args.dry_run:
                    print(f"[DRY] {sub_label}/ses-1/{bids_folder}/{dst_stem}")
                else:
                    copy_with_sidecars(nifti, bids_sub_dir, dst_stem)
                    print(f"[OK] {sub_label} ({site}) / {bids_folder} / {dst_stem}")
                converted += 1

    if not args.dry_run and converted > 0:
        write_dataset_description(output_dir)
        phenotype_path = Path(args.phenotype).resolve() if args.phenotype else None
        write_participants_tsv(output_dir, participants, phenotype_path)

    print(f"\nDone. Converted={converted}, Skipped={skipped}, Failed={failed}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
