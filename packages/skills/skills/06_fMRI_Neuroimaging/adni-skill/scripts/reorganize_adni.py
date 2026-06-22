#!/usr/bin/env python3
import argparse
import gzip
import os
import re
import shutil
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Iterable, List, Optional, Set, Tuple

SIDECAREXT = [".json", ".bval", ".bvec"]
DATE_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2})")


def canonical_name(name: str) -> str:
    # Normalize folder names by removing all non-alphanumeric characters.
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def resolve_modality(folder_name: str) -> Optional[str]:
    key = canonical_name(folder_name)

    # T1
    if "mprage" in key:
        return "T1"

    # Flair
    if "flair" in key:
        return "Flair"

    # T2
    if "t2space" in key or ("t2" in key and "space" in key):
        return "T2"

    # PD
    if "pd" in key and "fse" in key:
        return "PD"

    # DTI
    if "dti" in key:
        return "DTI"

    # fMRI
    if "rsfmri" in key or "fmri" in key:
        return "fmri"

    return None


def normalize_date_name(folder_name: str) -> Optional[str]:
    # Extract only YYYY-MM-DD from names like 2006-05-02_12_31_52.0
    match = DATE_PATTERN.search(folder_name)
    if match:
        return match.group(1)
    return None


def is_nifti_file(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith(".nii") or name.endswith(".nii.gz")


def is_related_output_file(path: Path) -> bool:
    name = path.name.lower()
    if name.endswith(".nii") or name.endswith(".nii.gz"):
        return True
    return any(name.endswith(ext) for ext in SIDECAREXT)


def nifti_stem(filename: str) -> str:
    if filename.endswith(".nii.gz"):
        return filename[:-7]
    if filename.endswith(".nii"):
        return filename[:-4]
    return Path(filename).stem


def gunzip_to_nii(src_gz: Path, dst_nii: Path) -> None:
    dst_nii.parent.mkdir(parents=True, exist_ok=True)
    if dst_nii.exists():
        dst_nii.unlink()
    with gzip.open(src_gz, "rb") as f_in, open(dst_nii, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    src_gz.unlink()


def move_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        dst.unlink()
    if os.path.abspath(str(src)) != os.path.abspath(str(dst)):
        shutil.move(str(src), str(dst))


def cleanup_target_files(output_dir: Path, out_name: str) -> None:
    candidates = [
        output_dir / f"{out_name}.nii",
        output_dir / f"{out_name}.nii.gz",
    ]
    for ext in SIDECAREXT:
        candidates.append(output_dir / f"{out_name}{ext}")

    for path in candidates:
        if path.exists():
            path.unlink()


def move_sidecars(src_dir: Path, old_stem: str, dst_dir: Path, new_stem: str) -> None:
    for ext in SIDECAREXT:
        src = src_dir / f"{old_stem}{ext}"
        dst = dst_dir / f"{new_stem}{ext}"
        if src.exists():
            move_file(src, dst)


def relocate_output(primary_src: Path, output_dir: Path, out_name: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    final_nii = output_dir / f"{out_name}.nii"
    old_stem = nifti_stem(primary_src.name)

    if primary_src.name.endswith(".nii.gz"):
        gunzip_to_nii(primary_src, final_nii)
    elif primary_src.name.endswith(".nii"):
        move_file(primary_src, final_nii)
    else:
        raise RuntimeError(f"Unsupported NIfTI output: {primary_src}")

    move_sidecars(primary_src.parent, old_stem, output_dir, out_name)
    return final_nii


def run_command(cmd: List[str], cwd: Optional[Path] = None) -> Tuple[int, str]:
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return result.returncode, result.stdout


def snapshot_related_files(roots: Iterable[Path]) -> Set[str]:
    files: Set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file() and is_related_output_file(path):
                files.add(str(path.resolve()))
    return files


def find_recent_nifti_files(roots: Iterable[Path], start_time: float) -> List[Path]:
    candidates: List[Path] = []
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if not is_nifti_file(path):
                continue
            try:
                if path.stat().st_mtime >= start_time - 2:
                    candidates.append(path)
            except FileNotFoundError:
                continue
    candidates.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates


def finalize_named_output(output_dir: Path, out_name: str) -> Optional[Path]:
    exact_nii = output_dir / f"{out_name}.nii"
    if exact_nii.exists():
        return exact_nii

    exact_niigz = output_dir / f"{out_name}.nii.gz"
    if exact_niigz.exists():
        return relocate_output(exact_niigz, output_dir, out_name)

    candidates = []
    candidates.extend(output_dir.glob(f"{out_name}*.nii"))
    candidates.extend(output_dir.glob(f"{out_name}*.nii.gz"))
    candidates = sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True)

    if candidates:
        return relocate_output(candidates[0], output_dir, out_name)

    return None


def finalize_new_output(
    roots: Iterable[Path],
    before: Set[str],
    output_dir: Path,
    out_name: str,
    start_time: float,
) -> Optional[Path]:
    after = snapshot_related_files(roots)
    new_files = [Path(p) for p in sorted(after - before)]
    nifti_candidates = [p for p in new_files if is_nifti_file(p)]

    if not nifti_candidates:
        nifti_candidates = find_recent_nifti_files(roots, start_time)

    nifti_candidates = sorted(
        nifti_candidates,
        key=lambda p: p.stat().st_mtime if p.exists() else 0,
        reverse=True,
    )

    if not nifti_candidates:
        return None

    return relocate_output(nifti_candidates[0], output_dir, out_name)


def convert_series(
    dicom_dir: Path,
    output_dir: Path,
    out_name: str,
    cmd_name: str,
    overwrite: bool = False,
) -> Path:
    final_nii = output_dir / f"{out_name}.nii"
    if final_nii.exists() and not overwrite:
        return final_nii

    if overwrite:
        cleanup_target_files(output_dir, out_name)

    output_dir.mkdir(parents=True, exist_ok=True)
    logs = []

    # Try dcm2niix-style arguments first.
    before1 = snapshot_related_files([output_dir])
    start_time1 = time.time()
    rc1, log1 = run_command(
        [cmd_name, "-o", str(output_dir), "-f", out_name, "-z", "n", str(dicom_dir)]
    )
    logs.append(f"[Attempt 1]\n{log1}")

    named_result = finalize_named_output(output_dir, out_name)
    if named_result is not None:
        return named_result

    recent_result = finalize_new_output([output_dir], before1, output_dir, out_name, start_time1)
    if rc1 == 0 and recent_result is not None:
        return recent_result

    # Fallback to legacy dcm2nii-style invocation.
    search_roots = list({output_dir, dicom_dir, dicom_dir.parent})
    before2 = snapshot_related_files(search_roots)
    start_time2 = time.time()
    rc2, log2 = run_command([cmd_name, str(dicom_dir)], cwd=output_dir)
    logs.append(f"[Attempt 2]\n{log2}")

    result = finalize_new_output(search_roots, before2, output_dir, out_name, start_time2)
    if result is not None:
        return result

    full_log = "\n".join(logs)
    raise RuntimeError(
        f"Conversion failed for {dicom_dir}\n"
        f"Command: {cmd_name}\n"
        f"Could not locate generated NIfTI output.\n"
        f"{full_log}"
    )


def find_first_dicom_container(date_dir: Path, max_depth: int = 6) -> Optional[Path]:
    # Open the first child folder under the date folder, then keep descending
    # into the first subfolder until files are found.
    if not date_dir.is_dir():
        return None

    first_level_subdirs = sorted([p for p in date_dir.iterdir() if p.is_dir()], key=lambda p: p.name)
    current = first_level_subdirs[0] if first_level_subdirs else date_dir

    for _ in range(max_depth + 1):
        try:
            entries = list(current.iterdir())
        except Exception:
            return None

        if any(e.is_file() for e in entries):
            return current

        subdirs = sorted([e for e in entries if e.is_dir()], key=lambda p: p.name)
        if not subdirs:
            return None

        current = subdirs[0]

    try:
        if any(e.is_file() for e in current.iterdir()):
            return current
    except Exception:
        return None

    return None


def is_subject_dir(path: Path) -> bool:
    if not path.is_dir():
        return False

    try:
        for child in path.iterdir():
            if child.is_dir() and resolve_modality(child.name):
                return True
    except Exception:
        return False

    return False


def process_subject(
    subject_dir: Path,
    cmd_name: str,
    overwrite: bool = False,
    cleanup: bool = False,
) -> Tuple[int, int, int]:
    converted = 0
    skipped = 0
    failed = 0
    subject_has_failure = False
    modality_dirs: List[Path] = []
    # Tracks modality/date combinations that have already produced an output.
    resolved_modality_dates: Set[Tuple[str, str]] = set()

    for modality_dir in sorted(subject_dir.iterdir(), key=lambda p: p.name):
        if not modality_dir.is_dir():
            continue

        modality_name = resolve_modality(modality_dir.name)
        if modality_name is None:
            print(f"[INFO] {subject_dir.name} | ignored unknown folder: {modality_dir.name}")
            continue

        modality_dirs.append(modality_dir)

        # Group all time folders by YYYY-MM-DD.
        date_groups = defaultdict(list)
        for raw_date_dir in sorted(modality_dir.iterdir(), key=lambda p: p.name):
            if not raw_date_dir.is_dir():
                continue

            date_key = normalize_date_name(raw_date_dir.name)
            if date_key is None:
                print(f"[WARN] {subject_dir.name} | {modality_name} | invalid date folder name: {raw_date_dir.name}")
                failed += 1
                subject_has_failure = True
                continue

            date_groups[date_key].append(raw_date_dir)

        for date_key in sorted(date_groups.keys()):
            same_day_dirs = sorted(date_groups[date_key], key=lambda p: p.name)
            source_date_dir = same_day_dirs[0]
            modality_date_key = (modality_name, date_key)

            if modality_date_key in resolved_modality_dates:
                print(
                    f"[SKIP] {subject_dir.name} | {date_key} | {modality_name} "
                    f"already resolved from another source folder"
                )
                skipped += 1
                continue

            if len(same_day_dirs) > 1:
                ignored_names = ", ".join(p.name for p in same_day_dirs[1:])
                print(
                    f"[WARN] {subject_dir.name} | {date_key} | {modality_name} "
                    f"multiple time folders found, using first: {source_date_dir.name}; ignored: {ignored_names}"
                )

            target_date_dir = subject_dir / date_key
            target_nii = target_date_dir / f"{modality_name}.nii"

            if target_nii.exists() and not overwrite:
                print(f"[SKIP] {subject_dir.name} | {date_key} | {modality_name} already exists")
                resolved_modality_dates.add(modality_date_key)
                skipped += 1
                continue

            dicom_dir = find_first_dicom_container(source_date_dir)
            if dicom_dir is None:
                print(f"[WARN] {subject_dir.name} | {date_key} | {modality_name} no DICOM folder found")
                failed += 1
                subject_has_failure = True
                continue

            try:
                target_date_dir.mkdir(parents=True, exist_ok=True)
                result = convert_series(
                    dicom_dir=dicom_dir,
                    output_dir=target_date_dir,
                    out_name=modality_name,
                    cmd_name=cmd_name,
                    overwrite=overwrite,
                )
                print(f"[OK]   {subject_dir.name} | {date_key} | {modality_name} -> {result}")
                resolved_modality_dates.add(modality_date_key)
                converted += 1
            except Exception as e:
                print(f"[FAIL] {subject_dir.name} | {date_key} | {modality_name}")
                print(f"       {e}")
                failed += 1
                subject_has_failure = True
                if target_date_dir.exists():
                    try:
                        if not any(target_date_dir.iterdir()):
                            target_date_dir.rmdir()
                    except Exception:
                        pass

    if cleanup and modality_dirs:
        if subject_has_failure:
            print(f"[KEEP] {subject_dir.name} has failures, original modality folders are kept")
        else:
            for modality_dir in modality_dirs:
                print(f"[RM]   Removing original folder: {modality_dir}")
                shutil.rmtree(modality_dir)

    return converted, skipped, failed


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Reorganize ADNI folders from modality-based to date-based using YYYY-MM-DD."
    )
    parser.add_argument("--root", default=".", help="ADNI root directory, default is current directory")
    parser.add_argument("--cmd", default="dcm2nii", help="Converter command, default is dcm2nii")
    parser.add_argument("--overwrite", action="store_true", help="Overwrite existing output NIfTI files")
    parser.add_argument("--cleanup", action="store_true", help="Remove original modality folders after successful conversion")
    args = parser.parse_args()

    root = Path(args.root).resolve()

    if not root.exists() or not root.is_dir():
        print(f"Root directory does not exist: {root}", file=sys.stderr)
        return 1

    if shutil.which(args.cmd) is None:
        print(f"Command not found in PATH: {args.cmd}", file=sys.stderr)
        return 1

    subject_dirs = sorted([p for p in root.iterdir() if is_subject_dir(p)], key=lambda p: p.name)
    if not subject_dirs:
        print("No subject folders containing known modality folders were found.")
        return 0

    total_converted = 0
    total_skipped = 0
    total_failed = 0

    print(f"Found {len(subject_dirs)} subject folders")
    print(f"Using converter command: {args.cmd}")
    print("Date folders will be normalized to YYYY-MM-DD")
    print("Start processing...\n")

    for subject_dir in subject_dirs:
        print(f"=== Processing subject: {subject_dir.name} ===")
        converted, skipped, failed = process_subject(
            subject_dir=subject_dir,
            cmd_name=args.cmd,
            overwrite=args.overwrite,
            cleanup=args.cleanup,
        )
        total_converted += converted
        total_skipped += skipped
        total_failed += failed
        print(
            f"=== Done: {subject_dir.name} | converted={converted}, skipped={skipped}, failed={failed} ===\n"
        )

    print("All done")
    print(f"Converted: {total_converted}")
    print(f"Skipped:   {total_skipped}")
    print(f"Failed:    {total_failed}")

    return 0 if total_failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())