#!/usr/bin/env python3
import argparse
import ipdb
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

import pandas as pd

DATE_PATTERN = re.compile(r"(\d{4}-\d{2}-\d{2})")
PTID_PATTERN = re.compile(r"(\d{3})[_-]?S[_-]?(\d{4})", re.IGNORECASE)

MODALITY_ORDER = ["T1", "T2", "FLAIR", "PD", "DTI", "fMRI"]


def strip_nii_suffix(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".nii.gz"):
        return name[:-7]
    if lower.endswith(".nii"):
        return name[:-4]
    return name


def canonical_token(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def normalize_subject_id(value: object) -> Optional[str]:
    if value is None or pd.isna(value):
        return None

    text = str(value).strip()
    if not text:
        return None

    match = PTID_PATTERN.search(text)
    if match:
        return f"{match.group(1)}_S_{match.group(2)}"

    text = text.upper().replace("-", "_").replace(" ", "")
    if text.startswith("SUB_"):
        text = text[4:]

    return text or None


def normalize_date(value: object) -> Optional[str]:
    if value is None or pd.isna(value):
        return None

    text = str(value).strip()
    if not text:
        return None

    match = DATE_PATTERN.search(text)
    if match:
        text = match.group(1)

    dt = pd.to_datetime(text, errors="coerce")
    if pd.isna(dt):
        return None

    return dt.strftime("%Y-%m-%d")


def safe_int(value: object) -> Optional[int]:
    if value is None or pd.isna(value):
        return None

    try:
        return int(float(value))
    except Exception:
        return None


def diagnosis_text(code: object) -> Optional[str]:
    code = safe_int(code)
    mapping = {
        1: "CN",
        2: "MCI",
        3: "Dementia",
    }
    return mapping.get(code)


def find_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    lower_map = {str(col).lower(): col for col in df.columns}
    for candidate in candidates:
        if candidate.lower() in lower_map:
            return lower_map[candidate.lower()]
    return None


def detect_modality_from_file(file_path: Path) -> Optional[str]:
    name = strip_nii_suffix(file_path.name)
    key = canonical_token(name)

    if key in {"t1", "t1w"}:
        return "T1"
    if key == "t2":
        return "T2"
    if key == "flair":
        return "FLAIR"
    if key == "pd":
        return "PD"
    if key == "dti":
        return "DTI"
    if key in {"fmri", "rsfmri"}:
        return "fMRI"

    return None


def is_nifti_file(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith(".nii") or name.endswith(".nii.gz")


def quote_sh(value: object) -> str:
    return shlex.quote(str(value))


def ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def none_if_na(value: object) -> Optional[object]:
    if value is None or pd.isna(value):
        return None
    return value


def is_subject_dir(path: Path) -> bool:
    if not path.is_dir():
        return False

    try:
        for child in path.iterdir():
            if child.is_dir() and normalize_date(child.name):
                return True
    except Exception:
        return False

    return False


def scan_dataset(root: Path) -> pd.DataFrame:
    records: List[Dict[str, object]] = []

    for subject_dir in sorted(root.iterdir(), key=lambda p: p.name):
        if not is_subject_dir(subject_dir):
            continue

        subject_folder = subject_dir.name
        subject_id = normalize_subject_id(subject_folder) or subject_folder

        for date_dir in sorted(subject_dir.iterdir(), key=lambda p: p.name):
            if not date_dir.is_dir():
                continue

            visit_date = normalize_date(date_dir.name)
            if visit_date is None:
                continue

            modality_paths: Dict[str, str] = {}
            for item in sorted(date_dir.iterdir(), key=lambda p: p.name):
                if not item.is_file():
                    continue
                if not is_nifti_file(item):
                    continue

                modality = detect_modality_from_file(item)
                if modality is None:
                    continue

                if modality not in modality_paths:
                    modality_paths[modality] = str(item.resolve())

            if not modality_paths:
                continue

            record: Dict[str, object] = {
                "subject_id": subject_id,
                "subject_folder": subject_folder,
                "visit_date": visit_date,
                "visit_folder_path": str(date_dir.resolve()),
            }

            available_modalities = []
            for modality in MODALITY_ORDER:
                has_modality = int(modality in modality_paths)
                record[f"has_{modality}"] = has_modality
                record[f"{modality}_path"] = modality_paths.get(modality)
                if has_modality:
                    available_modalities.append(modality)

            record["available_modalities"] = "|".join(available_modalities)
            record["omnibrainbench_minimum_modalities"] = int(
                record["has_T1"] == 1 and record["has_FLAIR"] == 1
            )

            records.append(record)

    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    df["visit_ts"] = pd.to_datetime(df["visit_date"], errors="coerce")
    df = df.sort_values(["subject_id", "visit_ts"]).reset_index(drop=True)
    return df


def auto_find_csv(root: Path, prefix: str) -> Optional[Path]:
    candidates = sorted(root.glob(f"{prefix}*.csv"))
    if not candidates:
        return None
    return candidates[0]


def derive_diagnosis_code(
    row: pd.Series,
    diagnosis_col: Optional[str],
    dxchange_col: Optional[str],
    dxcurren_col: Optional[str],
) -> Optional[int]:
    if diagnosis_col is not None:
        code = safe_int(row.get(diagnosis_col))
        if code in {1, 2, 3}:
            return code

    if dxchange_col is not None:
        dxchange = safe_int(row.get(dxchange_col))
        dxchange_map = {
            1: 1,
            2: 2,
            3: 3,
            4: 2,
            5: 3,
            6: 3,
            7: 1,
            8: 2,
            9: 1,
        }
        if dxchange in dxchange_map:
            return dxchange_map[dxchange]

    if dxcurren_col is not None:
        code = safe_int(row.get(dxcurren_col))
        if code in {1, 2, 3}:
            return code

    return None


def load_dxsum_table(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)

    ptid_col = find_column(df, ["PTID", "SUBJECT", "SUBJECT_ID"])
    date_col = find_column(df, ["EXAMDATE", "VISDATE", "USERDATE", "COLDATE", "SCANDATE"])
    phase_col = find_column(df, ["PHASE", "COLPROT", "PROTOCOL"])
    viscode_col = find_column(df, ["VISCODE2", "VISCODE"])
    diagnosis_col = find_column(df, ["DIAGNOSIS"])
    dxchange_col = find_column(df, ["DXCHANGE"])
    dxcurren_col = find_column(df, ["DXCURREN"])

    if ptid_col is None:
        raise RuntimeError(f"PTID column not found in {csv_path}")
    if date_col is None:
        raise RuntimeError(f"Date column not found in {csv_path}")

    rows: List[Dict[str, object]] = []
    for _, row in df.iterrows():
        subject_id = normalize_subject_id(row.get(ptid_col))
        source_date = normalize_date(row.get(date_col))
        if subject_id is None or source_date is None:
            continue

        diag_code = derive_diagnosis_code(row, diagnosis_col, dxchange_col, dxcurren_col)
        if diag_code is None:
            continue

        rows.append(
            {
                "subject_id": subject_id,
                "source_date": source_date,
                "source_ts": pd.to_datetime(source_date, errors="coerce"),
                "diagnosis_code": diag_code,
                "diagnosis": diagnosis_text(diag_code),
                "phase": row.get(phase_col) if phase_col else None,
                "viscode": row.get(viscode_col) if viscode_col else None,
            }
        )

    out = pd.DataFrame(rows)
    if out.empty:
        return out

    out = out.sort_values(["subject_id", "source_ts"]).drop_duplicates(
        subset=["subject_id", "source_date"], keep="first"
    )
    out = out.reset_index(drop=True)
    return out


def load_ucsf_table(csv_path: Path) -> pd.DataFrame:
    df = pd.read_csv(csv_path, low_memory=False)

    ptid_col = find_column(df, ["PTID", "SUBJECT", "SUBJECT_ID"])
    date_col = find_column(df, ["EXAMDATE", "SCANDATE", "VISDATE", "USERDATE", "COLDATE"])
    qc_col = find_column(df, ["OVERALLQC"])
    phase_col = find_column(df, ["PHASE", "COLPROT", "PROTOCOL"])
    viscode_col = find_column(df, ["VISCODE2", "VISCODE"])

    if ptid_col is None:
        raise RuntimeError(f"PTID column not found in {csv_path}")
    if date_col is None:
        raise RuntimeError(f"Date column not found in {csv_path}")
    if qc_col is None:
        raise RuntimeError(f"OVERALLQC column not found in {csv_path}")

    rows: List[Dict[str, object]] = []
    for _, row in df.iterrows():
        subject_id = normalize_subject_id(row.get(ptid_col))
        source_date = normalize_date(row.get(date_col))
        overall_qc = safe_int(row.get(qc_col))

        if subject_id is None or source_date is None:
            continue
        if overall_qc != 1:
            continue

        rows.append(
            {
                "subject_id": subject_id,
                "source_date": source_date,
                "source_ts": pd.to_datetime(source_date, errors="coerce"),
                "overallqc": overall_qc,
                "phase": row.get(phase_col) if phase_col else None,
                "viscode": row.get(viscode_col) if viscode_col else None,
            }
        )

    out = pd.DataFrame(rows)
    if out.empty:
        return out

    out = out.sort_values(["subject_id", "source_ts"]).drop_duplicates(
        subset=["subject_id", "source_date"], keep="first"
    )
    out = out.reset_index(drop=True)
    return out


def pick_best_match(
    source_df: pd.DataFrame,
    visit_ts: pd.Timestamp,
    max_days: int,
) -> Tuple[Optional[pd.Series], Optional[int], Optional[str]]:
    if source_df.empty or pd.isna(visit_ts):
        return None, None, None

    exact = source_df[source_df["source_ts"] == visit_ts]
    if not exact.empty:
        return exact.iloc[0], 0, "exact"

    tmp = source_df.copy()
    tmp["match_days"] = (tmp["source_ts"] - visit_ts).abs().dt.days
    tmp = tmp[tmp["match_days"] <= max_days]
    if tmp.empty:
        return None, None, None

    tmp = tmp.sort_values(["match_days", "source_ts"])
    best = tmp.iloc[0]
    return best, int(best["match_days"]), "nearest"


def attach_matches(
    visits_df: pd.DataFrame,
    source_df: pd.DataFrame,
    prefix: str,
    payload_cols: List[str],
    max_days: int,
) -> pd.DataFrame:
    out = visits_df.copy()

    out[f"{prefix}_source_date"] = pd.NA
    out[f"{prefix}_match_days"] = pd.NA
    out[f"{prefix}_match_type"] = pd.NA
    for col in payload_cols:
        out[f"{prefix}_{col}"] = pd.NA

    if source_df.empty:
        return out

    grouped = {sid: grp.reset_index(drop=True) for sid, grp in source_df.groupby("subject_id")}

    for idx, row in out.iterrows():
        sid = row["subject_id"]
        visit_ts = row["visit_ts"]

        if sid not in grouped:
            continue

        best_row, match_days, match_type = pick_best_match(grouped[sid], visit_ts, max_days)
        if best_row is None:
            continue

        out.at[idx, f"{prefix}_source_date"] = best_row["source_date"]
        out.at[idx, f"{prefix}_match_days"] = match_days
        out.at[idx, f"{prefix}_match_type"] = match_type

        for col in payload_cols:
            out.at[idx, f"{prefix}_{col}"] = best_row.get(col)

    return out


def build_task2_df(merged_df: pd.DataFrame) -> pd.DataFrame:
    cols = [
        "subject_id",
        "subject_folder",
        "visit_date",
        "visit_folder_path",
        "available_modalities",
        "omnibrainbench_minimum_modalities",
        "has_T1",
        "T1_path",
        "has_T2",
        "T2_path",
        "has_FLAIR",
        "FLAIR_path",
        "has_PD",
        "PD_path",
        "has_DTI",
        "DTI_path",
        "has_fMRI",
        "fMRI_path",
    ]
    out = merged_df[cols].copy()
    out = out.rename(
        columns={
            "omnibrainbench_minimum_modalities": "task2_omnibrainbench_minimum_modalities",
            "available_modalities": "task2_available_modalities",
        }
    )
    return out


def build_task3_df(merged_df: pd.DataFrame) -> pd.DataFrame:
    out = merged_df[
        [
            "subject_id",
            "subject_folder",
            "visit_date",
            "visit_folder_path",
            "dx_source_date",
            "dx_match_days",
            "dx_match_type",
            "dx_diagnosis_code",
            "dx_diagnosis",
            "dx_phase",
            "dx_viscode",
        ]
    ].copy()

    out["task3_label_available"] = out["dx_diagnosis_code"].apply(lambda x: int(safe_int(x) in {1, 2, 3}))
    out["task3_any_cognitive_impairment"] = out["dx_diagnosis_code"].apply(
        lambda x: 1 if safe_int(x) in {2, 3} else (0 if safe_int(x) in {1} else pd.NA)
    )
    out["task3_dementia"] = out["dx_diagnosis_code"].apply(
        lambda x: 1 if safe_int(x) == 3 else (0 if safe_int(x) in {1, 2} else pd.NA)
    )

    out = out.rename(
        columns={
            "dx_source_date": "task3_dx_source_date",
            "dx_match_days": "task3_dx_match_days",
            "dx_match_type": "task3_dx_match_type",
            "dx_diagnosis_code": "task3_diagnosis_code",
            "dx_diagnosis": "task3_diagnosis",
            "dx_phase": "task3_dx_phase",
            "dx_viscode": "task3_dx_viscode",
        }
    )
    return out


def build_subject_risk_summary(long_df: pd.DataFrame) -> pd.DataFrame:
    rows: List[Dict[str, object]] = []

    for subject_id, group in long_df.sort_values(["subject_id", "visit_ts"]).groupby("subject_id", sort=False):
        group = group.reset_index(drop=True)
        labeled = group[group["current_diagnosis_code"].notna()].copy()

        baseline_code = None
        baseline_text = None
        baseline_date = None
        last_code = None
        last_text = None
        last_date = None

        if not labeled.empty:
            baseline_code = safe_int(labeled.iloc[0]["current_diagnosis_code"])
            baseline_text = diagnosis_text(baseline_code)
            baseline_date = labeled.iloc[0]["visit_date"]
            last_code = safe_int(labeled.iloc[-1]["current_diagnosis_code"])
            last_text = diagnosis_text(last_code)
            last_date = labeled.iloc[-1]["visit_date"]

        rows.append(
            {
                "subject_id": subject_id,
                "task5_subject_n_visits": len(group),
                "task5_subject_n_labeled_visits": len(labeled),
                "task5_has_longitudinal_followup": int(len(group) > 1),
                "task5_baseline_diagnosis_code": baseline_code,
                "task5_baseline_diagnosis": baseline_text,
                "task5_baseline_labeled_visit_date": baseline_date,
                "task5_last_diagnosis_code": last_code,
                "task5_last_diagnosis": last_text,
                "task5_last_labeled_visit_date": last_date,
            }
        )

    return pd.DataFrame(rows)


def add_longitudinal_labels(merged_df: pd.DataFrame) -> pd.DataFrame:
    out = merged_df.sort_values(["subject_id", "visit_ts"]).reset_index(drop=True).copy()
    out["current_diagnosis_code"] = out["dx_diagnosis_code"].apply(safe_int)
    out["current_diagnosis"] = out["current_diagnosis_code"].apply(diagnosis_text)

    new_cols = [
        "task5_has_future_visit",
        "task5_has_future_labeled_visit",
        "task5_next_labeled_visit_date",
        "task5_next_labeled_diagnosis_code",
        "task5_next_labeled_diagnosis",
        "task5_days_to_next_labeled_visit",
        "task5_future_decline",
        "task5_days_to_first_decline",
        "task5_future_any_impairment",
        "task5_future_dementia",
        "task5_stable_cn_followup",
        "task5_mci_to_dementia_risk",
        "task5_risk_label",
    ]
    for col in new_cols:
        out[col] = pd.NA

    for subject_id, group in out.groupby("subject_id", sort=False):
        idxs = list(group.index)
        rows = []
        for idx in idxs:
            rows.append(
                {
                    "idx": idx,
                    "visit_ts": out.at[idx, "visit_ts"],
                    "code": safe_int(out.at[idx, "current_diagnosis_code"]),
                }
            )

        for i, current in enumerate(rows):
            current_idx = current["idx"]
            current_ts = current["visit_ts"]
            current_code = current["code"]

            future_all = rows[i + 1 :]
            future_labeled = [r for r in future_all if r["code"] in {1, 2, 3}]

            out.at[current_idx, "task5_has_future_visit"] = int(len(future_all) > 0)
            out.at[current_idx, "task5_has_future_labeled_visit"] = int(len(future_labeled) > 0)

            if future_labeled:
                next_row = future_labeled[0]
                next_code = next_row["code"]
                next_ts = next_row["visit_ts"]

                out.at[current_idx, "task5_next_labeled_visit_date"] = next_ts.strftime("%Y-%m-%d")
                out.at[current_idx, "task5_next_labeled_diagnosis_code"] = next_code
                out.at[current_idx, "task5_next_labeled_diagnosis"] = diagnosis_text(next_code)
                out.at[current_idx, "task5_days_to_next_labeled_visit"] = int((next_ts - current_ts).days)

            if current_code not in {1, 2, 3} or not future_labeled:
                continue

            future_codes = [r["code"] for r in future_labeled]

            first_decline = None
            for r in future_labeled:
                if r["code"] > current_code:
                    first_decline = r
                    break

            out.at[current_idx, "task5_future_decline"] = int(first_decline is not None)
            if first_decline is not None:
                out.at[current_idx, "task5_days_to_first_decline"] = int((first_decline["visit_ts"] - current_ts).days)

            if current_code == 1:
                has_future_impairment = any(code in {2, 3} for code in future_codes)
                stable_cn = all(code == 1 for code in future_codes)

                out.at[current_idx, "task5_future_any_impairment"] = int(has_future_impairment)
                out.at[current_idx, "task5_future_dementia"] = int(any(code == 3 for code in future_codes))
                out.at[current_idx, "task5_stable_cn_followup"] = int(stable_cn)
                out.at[current_idx, "task5_mci_to_dementia_risk"] = 0
                out.at[current_idx, "task5_risk_label"] = (
                    "CN_to_impairment_risk" if has_future_impairment else "stable_CN_short_term"
                )

            elif current_code == 2:
                progresses_to_dementia = any(code == 3 for code in future_codes)

                out.at[current_idx, "task5_future_any_impairment"] = 1
                out.at[current_idx, "task5_future_dementia"] = int(progresses_to_dementia)
                out.at[current_idx, "task5_stable_cn_followup"] = 0
                out.at[current_idx, "task5_mci_to_dementia_risk"] = int(progresses_to_dementia)
                out.at[current_idx, "task5_risk_label"] = (
                    "MCI_to_dementia_risk" if progresses_to_dementia else "stable_or_reverting_MCI"
                )

            elif current_code == 3:
                out.at[current_idx, "task5_future_any_impairment"] = 1
                out.at[current_idx, "task5_future_dementia"] = 1
                out.at[current_idx, "task5_stable_cn_followup"] = 0
                out.at[current_idx, "task5_mci_to_dementia_risk"] = 0
                out.at[current_idx, "task5_risk_label"] = "established_dementia"

    summary_df = build_subject_risk_summary(out)
    out = out.merge(summary_df, on="subject_id", how="left")
    return out


def build_task5_df(merged_df: pd.DataFrame) -> pd.DataFrame:
    long_df = add_longitudinal_labels(merged_df)

    cols = [
        "subject_id",
        "subject_folder",
        "visit_date",
        "visit_folder_path",
        "current_diagnosis_code",
        "current_diagnosis",
        "task5_subject_n_visits",
        "task5_subject_n_labeled_visits",
        "task5_has_longitudinal_followup",
        "task5_baseline_diagnosis_code",
        "task5_baseline_diagnosis",
        "task5_baseline_labeled_visit_date",
        "task5_last_diagnosis_code",
        "task5_last_diagnosis",
        "task5_last_labeled_visit_date",
        "task5_has_future_visit",
        "task5_has_future_labeled_visit",
        "task5_next_labeled_visit_date",
        "task5_next_labeled_diagnosis_code",
        "task5_next_labeled_diagnosis",
        "task5_days_to_next_labeled_visit",
        "task5_future_decline",
        "task5_days_to_first_decline",
        "task5_future_any_impairment",
        "task5_future_dementia",
        "task5_stable_cn_followup",
        "task5_mci_to_dementia_risk",
        "task5_risk_label",
        "dx_source_date",
        "dx_match_days",
        "dx_match_type",
    ]
    out = long_df[cols].copy()
    out = out.rename(
        columns={
            "current_diagnosis_code": "task5_current_diagnosis_code",
            "current_diagnosis": "task5_current_diagnosis",
            "dx_source_date": "task5_dx_source_date",
            "dx_match_days": "task5_dx_match_days",
            "dx_match_type": "task5_dx_match_type",
        }
    )
    return out


def build_task1_df(merged_df: pd.DataFrame, outdir: Path) -> pd.DataFrame:
    rows: List[Dict[str, object]] = []

    fs_subjects_dir = outdir / "task1_freesurfer_subjects"
    label_root = outdir / "task1_labels"
    log_root = outdir / "task1_logs"

    for _, row in merged_df.iterrows():
        subject_id = row["subject_id"]
        visit_date = row["visit_date"]
        t1_path = none_if_na(row.get("T1_path"))
        fs_qc_pass = 1 if safe_int(row.get("fs_overallqc")) == 1 else 0
        # Regeneration mode: task1 only requires T1 to be present.
        eligible = int(row["has_T1"] == 1)

        fs_subject_id = f"{subject_id}_{str(visit_date).replace('-', '')}"
        label_dir = label_root / subject_id / visit_date
        label_path = label_dir / "task1_anatomical_seg.nii.gz"
        aux_path = label_dir / "task1_aseg_aux.nii.gz"
        log_path = log_root / subject_id / visit_date / "task1_recon_all.log"

        recon_cmd = None
        convert_aparc_cmd = None
        convert_aseg_cmd = None

        if t1_path is not None:
            recon_cmd = (
                f"recon-all -sd {quote_sh(fs_subjects_dir)} -wsatlas -wsless -all "
                f"-s {quote_sh(fs_subject_id)} -i {quote_sh(t1_path)}"
            )
            convert_aparc_cmd = (
                f"mri_convert {quote_sh(fs_subjects_dir / fs_subject_id / 'mri' / 'aparc+aseg.mgz')} "
                f"{quote_sh(label_path)}"
            )
            convert_aseg_cmd = (
                f"mri_convert {quote_sh(fs_subjects_dir / fs_subject_id / 'mri' / 'aseg.mgz')} "
                f"{quote_sh(aux_path)}"
            )

        status = "generated" if label_path.exists() else ("pending" if eligible == 1 else "ineligible")

        rows.append(
            {
                "subject_id": subject_id,
                "subject_folder": row["subject_folder"],
                "visit_date": visit_date,
                "visit_folder_path": row["visit_folder_path"],
                "T1_path": t1_path,
                "task1_fs_source_date": none_if_na(row.get("fs_source_date")),
                "task1_fs_match_days": none_if_na(row.get("fs_match_days")),
                "task1_fs_match_type": none_if_na(row.get("fs_match_type")),
                "task1_fs_overallqc": safe_int(row.get("fs_overallqc")),
                "task1_fs_phase": none_if_na(row.get("fs_phase")),
                "task1_fs_viscode": none_if_na(row.get("fs_viscode")),
                "task1_fs_qc_pass": fs_qc_pass,
                "task1_eligible": eligible,
                "task1_freesurfer_subjects_dir": str(fs_subjects_dir.resolve()),
                "task1_freesurfer_subject_id": fs_subject_id,
                "task1_recon_all_cmd": recon_cmd,
                "task1_convert_aparc_aseg_cmd": convert_aparc_cmd,
                "task1_convert_aseg_cmd": convert_aseg_cmd,
                "task1_label_type": "aparc+aseg_multiclass_segmentation",
                "task1_label_path": str(label_path.resolve()),
                "task1_aux_aseg_path": str(aux_path.resolve()),
                "task1_log_path": str(log_path.resolve()),
                "task1_status": status,
            }
        )

    return pd.DataFrame(rows)


def build_task4_df(merged_df: pd.DataFrame, outdir: Path, wmh_image: str, use_gpu: bool) -> pd.DataFrame:
    rows: List[Dict[str, object]] = []

    label_root = outdir / "task4_labels"
    log_root = outdir / "task4_logs"

    for _, row in merged_df.iterrows():
        subject_id = row["subject_id"]
        visit_date = row["visit_date"]
        t1_path = none_if_na(row.get("T1_path"))
        flair_path = none_if_na(row.get("FLAIR_path"))

        eligible = int(row["has_T1"] == 1 and row["has_FLAIR"] == 1)

        label_dir = label_root / subject_id / visit_date
        label_path = label_dir / "task4_wmh_seg.nii.gz"
        log_path = log_root / subject_id / visit_date / "task4_wmh.log"

        docker_cmd = None
        if t1_path is not None and flair_path is not None:
            visit_dir = Path(row["visit_folder_path"])
            gpu_part = "--gpus all " if use_gpu else ""
            docker_cmd = (
                f'docker run --rm {gpu_part}-v {quote_sh(str(visit_dir.resolve()) + ":/data")} '
                f"{quote_sh(wmh_image)} --flair {quote_sh('/data/' + Path(flair_path).name)} "
                f"--t1 {quote_sh('/data/' + Path(t1_path).name)}"
            )

        status = "generated" if label_path.exists() else ("pending" if eligible == 1 else "ineligible")

        rows.append(
            {
                "subject_id": subject_id,
                "subject_folder": row["subject_folder"],
                "visit_date": visit_date,
                "visit_folder_path": row["visit_folder_path"],
                "T1_path": t1_path,
                "FLAIR_path": flair_path,
                "task4_eligible": eligible,
                "task4_wmh_image": wmh_image,
                "task4_docker_cmd": docker_cmd,
                "task4_label_path": str(label_path.resolve()),
                "task4_log_path": str(log_path.resolve()),
                "task4_status": status,
            }
        )

    return pd.DataFrame(rows)


def find_freesurfer_lut() -> Optional[Path]:
    candidates: List[Path] = []

    fs_home = os.environ.get("FREESURFER_HOME")
    if fs_home:
        candidates.append(Path(fs_home) / "FreeSurferColorLUT.txt")

    candidates.extend(
        [
            Path("/usr/local/freesurfer/FreeSurferColorLUT.txt"),
            Path("/opt/freesurfer/FreeSurferColorLUT.txt"),
        ]
    )

    for path in candidates:
        if path.exists():
            return path

    return None


def parse_freesurfer_lut(lut_path: Path) -> pd.DataFrame:
    rows: List[Dict[str, object]] = []

    with open(lut_path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            text = line.strip()
            if not text or text.startswith("#"):
                continue

            parts = text.split()
            if len(parts) < 2:
                continue

            try:
                label_id = int(parts[0])
            except Exception:
                continue

            structure_name = parts[1]
            red = safe_int(parts[2]) if len(parts) > 2 else None
            green = safe_int(parts[3]) if len(parts) > 3 else None
            blue = safe_int(parts[4]) if len(parts) > 4 else None
            alpha = safe_int(parts[5]) if len(parts) > 5 else None

            rows.append(
                {
                    "label_id": label_id,
                    "structure_name": structure_name,
                    "red": red,
                    "green": green,
                    "blue": blue,
                    "alpha": alpha,
                }
            )

    out = pd.DataFrame(rows)
    if not out.empty:
        out = out.sort_values("label_id").reset_index(drop=True)
    return out


def write_task1_shell(task1_df: pd.DataFrame, shell_path: Path) -> None:
    ensure_parent(shell_path)

    with open(shell_path, "w", encoding="utf-8") as f:
        f.write("#!/usr/bin/env bash\n")
        f.write("set -euo pipefail\n\n")
        f.write("run_one() {\n")
        f.write('  local fs_subjects_dir="$1"\n')
        f.write('  local fs_subject_id="$2"\n')
        f.write('  local t1_path="$3"\n')
        f.write('  local label_path="$4"\n')
        f.write('  local aux_path="$5"\n')
        f.write('  local log_path="$6"\n')
        f.write('  mkdir -p "$fs_subjects_dir" "$(dirname "$label_path")" "$(dirname "$aux_path")" "$(dirname "$log_path")"\n')
        f.write('  if [[ -f "$label_path" ]]; then\n')
        f.write('    echo "[SKIP] $label_path already exists"\n')
        f.write("    return 0\n")
        f.write("  fi\n")
        f.write('  if [[ ! -f "$fs_subjects_dir/$fs_subject_id/mri/aparc+aseg.mgz" ]]; then\n')
        f.write('    recon-all -sd "$fs_subjects_dir" -wsatlas -wsless -all -s "$fs_subject_id" -i "$t1_path" >"$log_path" 2>&1\n')
        f.write("  else\n")
        f.write('    echo "[INFO] Existing FreeSurfer subject found, converting only" >"$log_path"\n')
        f.write("  fi\n")
        f.write('  mri_convert "$fs_subjects_dir/$fs_subject_id/mri/aparc+aseg.mgz" "$label_path" >>"$log_path" 2>&1\n')
        f.write('  mri_convert "$fs_subjects_dir/$fs_subject_id/mri/aseg.mgz" "$aux_path" >>"$log_path" 2>&1\n')
        f.write('  echo "[OK] $label_path"\n')
        f.write("}\n\n")

        eligible_df = task1_df[task1_df["task1_eligible"] == 1].copy()
        for _, row in eligible_df.iterrows():
            f.write(
                "run_one "
                f"{quote_sh(row['task1_freesurfer_subjects_dir'])} "
                f"{quote_sh(row['task1_freesurfer_subject_id'])} "
                f"{quote_sh(row['T1_path'])} "
                f"{quote_sh(row['task1_label_path'])} "
                f"{quote_sh(row['task1_aux_aseg_path'])} "
                f"{quote_sh(row['task1_log_path'])}\n"
            )

    os.chmod(shell_path, 0o755)


def write_task4_shell(task4_df: pd.DataFrame, shell_path: Path, use_gpu: bool) -> None:
    ensure_parent(shell_path)
    gpu_flag = '--gpus all' if use_gpu else ''

    with open(shell_path, "w", encoding="utf-8") as f:
        f.write("#!/usr/bin/env bash\n")
        f.write("set -euo pipefail\n\n")
        f.write("run_one() {\n")
        f.write('  local visit_dir="$1"\n')
        f.write('  local t1_name="$2"\n')
        f.write('  local flair_name="$3"\n')
        f.write('  local output_path="$4"\n')
        f.write('  local log_path="$5"\n')
        f.write('  local image_name="$6"\n')
        f.write('  mkdir -p "$(dirname "$output_path")" "$(dirname "$log_path")"\n')
        f.write('  if [[ -f "$output_path" ]]; then\n')
        f.write('    echo "[SKIP] $output_path already exists"\n')
        f.write("    return 0\n")
        f.write("  fi\n")
        f.write('  local before_file after_file new_file\n')
        f.write('  before_file="$(mktemp)"\n')
        f.write('  after_file="$(mktemp)"\n')
        f.write('  find "$visit_dir" -type f \\( -name "*.nii" -o -name "*.nii.gz" \\) | sort >"$before_file"\n')
        if gpu_flag:
            f.write(
                f'  docker run --rm {gpu_flag} -v "$visit_dir:/data" "$image_name" --flair "/data/$flair_name" --t1 "/data/$t1_name" >"$log_path" 2>&1\n'
            )
        else:
            f.write(
                '  docker run --rm -v "$visit_dir:/data" "$image_name" --flair "/data/$flair_name" --t1 "/data/$t1_name" >"$log_path" 2>&1\n'
            )
        f.write('  find "$visit_dir" -type f \\( -name "*.nii" -o -name "*.nii.gz" \\) | sort >"$after_file"\n')
        f.write('  new_file="$(comm -13 "$before_file" "$after_file" | grep -v -F "$visit_dir/$t1_name" | grep -v -F "$visit_dir/$flair_name" | tail -n 1 || true)"\n')
        f.write('  if [[ -z "$new_file" ]]; then\n')
        f.write('    new_file="$(find "$visit_dir" -type f \\( -name "*.nii" -o -name "*.nii.gz" \\) ! -name "$t1_name" ! -name "$flair_name" -printf "%T@ %p\\n" | sort -nr | head -n 1 | cut -d" " -f2-)"\n')
        f.write("  fi\n")
        f.write('  rm -f "$before_file" "$after_file"\n')
        f.write('  if [[ -z "$new_file" ]]; then\n')
        f.write('    echo "[FAIL] No WMH output NIfTI found for $visit_dir" >&2\n')
        f.write("    return 1\n")
        f.write("  fi\n")
        f.write('  mv -f "$new_file" "$output_path"\n')
        f.write('  echo "[OK] $output_path"\n')
        f.write("}\n\n")

        eligible_df = task4_df[task4_df["task4_eligible"] == 1].copy()
        for _, row in eligible_df.iterrows():
            t1_name = Path(row["T1_path"]).name
            flair_name = Path(row["FLAIR_path"]).name
            f.write(
                "run_one "
                f"{quote_sh(row['visit_folder_path'])} "
                f"{quote_sh(t1_name)} "
                f"{quote_sh(flair_name)} "
                f"{quote_sh(row['task4_label_path'])} "
                f"{quote_sh(row['task4_log_path'])} "
                f"{quote_sh(row['task4_wmh_image'])}\n"
            )

    os.chmod(shell_path, 0o755)


def run_command_to_log(cmd: List[str], log_path: Path, cwd: Optional[Path] = None) -> int:
    ensure_parent(log_path)
    with open(log_path, "w", encoding="utf-8") as f:
        result = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            stdout=f,
            stderr=subprocess.STDOUT,
            text=True,
        )
    return result.returncode


def snapshot_nifti_files(root: Path) -> Set[str]:
    files: Set[str] = set()
    if not root.exists():
        return files

    for path in root.rglob("*"):
        if path.is_file() and is_nifti_file(path):
            files.add(str(path.resolve()))
    return files


def pick_task4_output_file(
    visit_dir: Path,
    before: Set[str],
    input_paths: Set[str],
    start_time: float,
) -> Optional[Path]:
    after = snapshot_nifti_files(visit_dir)
    new_files = [Path(p) for p in sorted(after - before)]
    candidates = [p for p in new_files if str(p.resolve()) not in input_paths]

    if not candidates:
        for path in visit_dir.rglob("*"):
            if not path.is_file():
                continue
            if not is_nifti_file(path):
                continue
            if str(path.resolve()) in input_paths:
                continue
            try:
                if path.stat().st_mtime >= start_time - 2:
                    candidates.append(path)
            except FileNotFoundError:
                continue

    if not candidates:
        return None

    candidates = sorted(candidates, key=lambda p: p.stat().st_mtime, reverse=True)
    return candidates[0]


def run_task1_jobs(task1_df: pd.DataFrame) -> None:
    eligible_df = task1_df[task1_df["task1_eligible"] == 1].copy()
    if eligible_df.empty:
        print("No eligible task1 jobs found.")
        return

    print(f"Running task1 FreeSurfer jobs: {len(eligible_df)}")

    for _, row in eligible_df.iterrows():
        label_path = Path(row["task1_label_path"])
        aux_path = Path(row["task1_aux_aseg_path"])
        log_path = Path(row["task1_log_path"])
        fs_subjects_dir = Path(row["task1_freesurfer_subjects_dir"])
        fs_subject_id = row["task1_freesurfer_subject_id"]
        t1_path = Path(row["T1_path"])

        if label_path.exists():
            print(f"[SKIP] task1 exists: {label_path}")
            continue

        fs_subjects_dir.mkdir(parents=True, exist_ok=True)
        ensure_parent(label_path)
        ensure_parent(aux_path)

        aparc_mgz = fs_subjects_dir / fs_subject_id / "mri" / "aparc+aseg.mgz"
        aseg_mgz = fs_subjects_dir / fs_subject_id / "mri" / "aseg.mgz"

        if not aparc_mgz.exists():
            print(f"[RUN]  task1 recon-all | {row['subject_id']} | {row['visit_date']}")
            recon_cmd = [
                "recon-all",
                "-sd",
                str(fs_subjects_dir),
                "-wsatlas",
                "-wsless",
                "-all",
                "-s",
                str(fs_subject_id),
                "-i",
                str(t1_path),
            ]
            recon_cmd_str = " ".join(quote_sh(part) for part in recon_cmd)
            ipdb.set_trace()
            rc = run_command_to_log(
                recon_cmd,
                log_path=log_path,
            )
            if rc != 0:
                print(f"[FAIL] task1 recon-all failed: {row['subject_id']} | {row['visit_date']}")
                continue
        else:
            ensure_parent(log_path)
            with open(log_path, "w", encoding="utf-8") as f:
                f.write("Existing FreeSurfer subject found. Conversion only.\n")

        print(f"[RUN]  task1 mri_convert | {row['subject_id']} | {row['visit_date']}")
        rc1 = run_command_to_log(
            ["mri_convert", str(aparc_mgz), str(label_path)],
            log_path=log_path,
        )
        rc2 = run_command_to_log(
            ["mri_convert", str(aseg_mgz), str(aux_path)],
            log_path=log_path,
        )

        if rc1 == 0 and rc2 == 0 and label_path.exists():
            print(f"[OK]   task1 label -> {label_path}")
        else:
            print(f"[FAIL] task1 conversion failed: {row['subject_id']} | {row['visit_date']}")


def run_task4_jobs(task4_df: pd.DataFrame, use_gpu: bool) -> None:
    eligible_df = task4_df[task4_df["task4_eligible"] == 1].copy()
    if eligible_df.empty:
        print("No eligible task4 jobs found.")
        return

    print(f"Running task4 WMH jobs: {len(eligible_df)}")

    for _, row in eligible_df.iterrows():
        label_path = Path(row["task4_label_path"])
        log_path = Path(row["task4_log_path"])
        visit_dir = Path(row["visit_folder_path"])
        t1_path = Path(row["T1_path"])
        flair_path = Path(row["FLAIR_path"])
        image_name = row["task4_wmh_image"]

        if label_path.exists():
            print(f"[SKIP] task4 exists: {label_path}")
            continue

        ensure_parent(label_path)
        ensure_parent(log_path)

        before = snapshot_nifti_files(visit_dir)
        start_time = time.time()

        cmd = ["docker", "run", "--rm"]
        if use_gpu:
            cmd.extend(["--gpus", "all"])
        cmd.extend(
            [
                "-v",
                f"{visit_dir.resolve()}:/data",
                str(image_name),
                "--flair",
                f"/data/{flair_path.name}",
                "--t1",
                f"/data/{t1_path.name}",
            ]
        )

        print(f"[RUN]  task4 WMH | {row['subject_id']} | {row['visit_date']}")
        rc = run_command_to_log(cmd, log_path=log_path)
        if rc != 0:
            print(f"[FAIL] task4 docker failed: {row['subject_id']} | {row['visit_date']}")
            continue

        output_file = pick_task4_output_file(
            visit_dir=visit_dir,
            before=before,
            input_paths={str(t1_path.resolve()), str(flair_path.resolve())},
            start_time=start_time,
        )
        if output_file is None:
            print(f"[FAIL] task4 output not found: {row['subject_id']} | {row['visit_date']}")
            continue

        if label_path.exists():
            label_path.unlink()

        shutil.move(str(output_file), str(label_path))
        print(f"[OK]   task4 label -> {label_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate ADNI task1-task5 label files.")
    parser.add_argument("--root", default=".", help="Dataset root directory")
    parser.add_argument("--dxsum", default=None, help="Path to DXSUM CSV")
    parser.add_argument("--ucsf", default=None, help="Path to UCSFFSX7 CSV")
    parser.add_argument("--outdir", default="task_outputs", help="Output directory")
    parser.add_argument("--dx-match-window-days", type=int, default=180, help="Max day difference for DXSUM matching")
    parser.add_argument("--fs-match-window-days", type=int, default=180, help="Max day difference for UCSF matching")
    parser.add_argument("--run-task1", action="store_true", help="Run FreeSurfer task1 jobs now")
    parser.add_argument("--run-task4", action="store_true", help="Run WMH task4 jobs now")
    parser.add_argument("--wmh-image", default="mars-wmh-nnunet:latest", help="Docker image for WMH inference")
    parser.add_argument("--wmh-no-gpu", action="store_true", help="Run WMH docker without --gpus all")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    outdir = Path(args.outdir).resolve()
    outdir.mkdir(parents=True, exist_ok=True)

    if not root.exists() or not root.is_dir():
        print(f"Root directory does not exist: {root}", file=sys.stderr)
        return 1

    dxsum_path = Path(args.dxsum).resolve() if args.dxsum else auto_find_csv(root, "DXSUM")
    ucsf_path = Path(args.ucsf).resolve() if args.ucsf else auto_find_csv(root, "UCSFFSX7")

    if dxsum_path is None or not dxsum_path.exists():
        print("DXSUM CSV not found. Put DXSUM*.csv in the current directory or pass --dxsum.", file=sys.stderr)
        return 1

    if ucsf_path is None or not ucsf_path.exists():
        print("UCSFFSX7 CSV not found. Put UCSFFSX7*.csv in the current directory or pass --ucsf.", file=sys.stderr)
        return 1

    use_gpu = not args.wmh_no_gpu

    print(f"Dataset root: {root}")
    print(f"DXSUM CSV: {dxsum_path}")
    print(f"UCSFFSX7 CSV: {ucsf_path}")
    print(f"Output dir: {outdir}")

    visits_df = scan_dataset(root)
    if visits_df.empty:
        print("No visits with NIfTI files were found.", file=sys.stderr)
        return 1

    print(f"Scanned visits: {len(visits_df)}")
    print(f"Scanned subjects: {visits_df['subject_id'].nunique()}")

    dx_df = load_dxsum_table(dxsum_path)
    fs_df = load_ucsf_table(ucsf_path)

    print(f"DX rows after filtering: {len(dx_df)}")
    print(f"UCSF rows after OVERALLQC=1 filtering: {len(fs_df)}")

    merged_df = attach_matches(
        visits_df,
        dx_df,
        prefix="dx",
        payload_cols=["diagnosis_code", "diagnosis", "phase", "viscode"],
        max_days=args.dx_match_window_days,
    )
    merged_df = attach_matches(
        merged_df,
        fs_df,
        prefix="fs",
        payload_cols=["overallqc", "phase", "viscode"],
        max_days=args.fs_match_window_days,
    )

    task1_df = build_task1_df(merged_df, outdir)
    task2_df = build_task2_df(merged_df)
    task3_df = build_task3_df(merged_df)
    task4_df = build_task4_df(merged_df, outdir, args.wmh_image, use_gpu)
    task5_df = build_task5_df(merged_df)

    task1_shell = outdir / "task1_run_freesurfer.sh"
    task4_shell = outdir / "task4_run_wmh.sh"
    write_task1_shell(task1_df, task1_shell)
    write_task4_shell(task4_df, task4_shell, use_gpu=use_gpu)

    lut_path = find_freesurfer_lut()
    if lut_path is not None:
        lut_df = parse_freesurfer_lut(lut_path)
        lut_out = outdir / "task1_anatomical_structure_label_lookup.csv"
        lut_df.to_csv(lut_out, index=False)
        print(f"Task1 label lookup: {lut_out}")
    else:
        print("Warning: FreeSurferColorLUT.txt not found. task1 label lookup CSV was not generated.")

    if args.run_task1:
        run_task1_jobs(task1_df)
        task1_df = build_task1_df(merged_df, outdir)

    if args.run_task4:
        run_task4_jobs(task4_df, use_gpu=use_gpu)
        task4_df = build_task4_df(merged_df, outdir, args.wmh_image, use_gpu)

    task1_csv = outdir / "task1_anatomical_structure_identification_labels.csv"
    task2_csv = outdir / "task2_imaging_modality_identification_labels.csv"
    task3_csv = outdir / "task3_disease_abnormality_diagnosis_labels.csv"
    task4_csv = outdir / "task4_lesion_localization_wmh_labels.csv"
    task5_csv = outdir / "task5_risk_forecasting_treatment_related_labels.csv"

    task1_df.to_csv(task1_csv, index=False)
    task2_df.to_csv(task2_csv, index=False)
    task3_df.to_csv(task3_csv, index=False)
    task4_df.to_csv(task4_csv, index=False)
    task5_df.drop(columns=["visit_ts"], errors="ignore").to_csv(task5_csv, index=False)

    task1_eligible = int((task1_df["task1_eligible"] == 1).sum())
    task1_generated = int((task1_df["task1_status"] == "generated").sum())
    task3_labeled = int((task3_df["task3_label_available"] == 1).sum())
    task4_eligible = int((task4_df["task4_eligible"] == 1).sum())
    task4_generated = int((task4_df["task4_status"] == "generated").sum())
    task5_with_future = int((task5_df["task5_has_future_labeled_visit"] == 1).sum())

    print("\nDone")
    print(f"Task1 CSV: {task1_csv}")
    print(f"Task2 CSV: {task2_csv}")
    print(f"Task3 CSV: {task3_csv}")
    print(f"Task4 CSV: {task4_csv}")
    print(f"Task5 CSV: {task5_csv}")
    print(f"Task1 shell: {task1_shell}")
    print(f"Task4 shell: {task4_shell}")
    print("")
    print(f"Task1 eligible visits:   {task1_eligible}")
    print(f"Task1 generated labels:  {task1_generated}")
    print(f"Task3 labeled visits:    {task3_labeled}")
    print(f"Task4 eligible visits:   {task4_eligible}")
    print(f"Task4 generated labels:  {task4_generated}")
    print(f"Task5 future-labeled:    {task5_with_future}")

    return 0


if __name__ == "__main__":
    sys.exit(main())