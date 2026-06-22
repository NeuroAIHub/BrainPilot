#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

MODALITY_ORDER = ["T1", "T2", "FLAIR", "PD", "DTI", "fMRI"]

MODALITY_DISPLAY = {
    "T1": "T1W",
    "T2": "T2W",
    "FLAIR": "FLAIR",
    "PD": "PD",
    "DTI": "DTI",
    "fMRI": "fMRI",
}

TASK2_OPTIONS = ["T1W", "T2W", "FLAIR", "PD", "DTI", "fMRI"]
TASK3_DIAGNOSIS_OPTIONS = ["CN", "MCI", "Dementia"]
YES_NO_OPTIONS = ["Yes", "No"]

RISK_LABEL_TEXT = {
    "CN_to_impairment_risk": "Elevated risk of future cognitive impairment",
    "stable_CN_short_term": "Stable CN in short-term follow-up",
    "MCI_to_dementia_risk": "Risk of progression from MCI to dementia",
    "stable_or_reverting_MCI": "Stable or reverting MCI",
    "established_dementia": "Established dementia",
}

TASK5_RISK_OPTIONS = [
    RISK_LABEL_TEXT["CN_to_impairment_risk"],
    RISK_LABEL_TEXT["stable_CN_short_term"],
    RISK_LABEL_TEXT["MCI_to_dementia_risk"],
    RISK_LABEL_TEXT["stable_or_reverting_MCI"],
    RISK_LABEL_TEXT["established_dementia"],
]

TASK2_TEMPLATES = [
    "What imaging modality is shown in this brain image?",
    "Which MRI modality does the provided image correspond to?",
    "Identify the imaging modality of this brain scan.",
]

TASK3_DIAGNOSIS_TEMPLATES = [
    "What is the cognitive diagnosis label for this visit?",
    "Which diagnostic category best matches this visit?",
    "What is the patient's cognitive status at this visit?",
]

TASK3_IMPAIRMENT_TEMPLATES = [
    "Does this visit indicate any cognitive impairment?",
    "Is the patient cognitively impaired at this visit?",
    "Is any cognitive impairment present at this visit?",
]

TASK3_DEMENTIA_TEMPLATES = [
    "Is this visit labeled as dementia?",
    "Does this visit correspond to dementia?",
    "Is the diagnosis for this visit dementia?",
]

TASK5_RISK_TEMPLATES = [
    "Based on the patient's longitudinal imaging history up to the current visit, what is the most appropriate prognosis label?",
    "Considering the visit history up to the current date, which future risk label best applies?",
    "Using the patient's longitudinal records up to this visit, which prognostic category is most appropriate?",
]

TASK5_DECLINE_TEMPLATES = [
    "Is there documented future cognitive decline after this visit?",
    "Does the patient show later cognitive decline after the current visit?",
    "Is future cognitive decline observed after this visit?",
]

TASK5_DEMENTIA_TEMPLATES = [
    "Does the patient later progress to dementia after this visit?",
    "Is future conversion to dementia observed after the current visit?",
    "Does this patient develop dementia at a later labeled visit?",
]


def safe_int(value: object) -> Optional[int]:
    if value is None or pd.isna(value):
        return None
    try:
        return int(float(value))
    except Exception:
        return None


def none_if_na(value: object) -> Optional[object]:
    if value is None or pd.isna(value):
        return None
    return value


def stable_pick(templates: List[str], key: str) -> str:
    if not templates:
        raise ValueError("Template list must not be empty.")
    digest = hashlib.md5(key.encode("utf-8")).hexdigest()
    index = int(digest, 16) % len(templates)
    return templates[index]


def yes_no_answer(flag: object) -> Optional[str]:
    value = safe_int(flag)
    if value is None:
        return None
    return "Yes" if value == 1 else "No"


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def parse_modalities_arg(text: str) -> List[str]:
    if not text:
        return []
    parts = [x.strip() for x in text.split(",")]
    valid = []
    for part in parts:
        if not part:
            continue
        if part not in MODALITY_ORDER:
            raise ValueError(f"Unknown modality in argument: {part}")
        valid.append(part)
    return valid


def load_csv_required(path: Path, name: str) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"{name} not found: {path}")
    df = pd.read_csv(path, low_memory=False)
    required = ["subject_id", "visit_date"]
    for col in required:
        if col not in df.columns:
            raise RuntimeError(f"{name} is missing required column: {col}")
    df["subject_id"] = df["subject_id"].astype(str)
    df["visit_date"] = df["visit_date"].astype(str)
    return df


def build_task2_index(task2_df: pd.DataFrame) -> Dict[Tuple[str, str], pd.Series]:
    index: Dict[Tuple[str, str], pd.Series] = {}
    for _, row in task2_df.iterrows():
        key = (str(row["subject_id"]), str(row["visit_date"]))
        index[key] = row
    return index


def is_existing_path(path_str: str) -> bool:
    try:
        return Path(path_str).exists()
    except Exception:
        return False


def collect_images_from_task2_row(
    row: pd.Series,
    allowed_modalities: List[str],
    allow_missing_image_paths: bool = False,
    current_visit_date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    images: List[Dict[str, Any]] = []

    for modality in MODALITY_ORDER:
        if modality not in allowed_modalities:
            continue

        has_modality = safe_int(row.get(f"has_{modality}"))
        path_value = none_if_na(row.get(f"{modality}_path"))

        if has_modality != 1 or path_value is None:
            continue

        path_str = str(path_value)
        if not allow_missing_image_paths and not is_existing_path(path_str):
            continue

        visit_date = str(row["visit_date"])
        images.append(
            {
                "path": path_str,
                "modality": modality,
                "modality_display": MODALITY_DISPLAY[modality],
                "visit_date": visit_date,
                "is_current_visit": current_visit_date is None or visit_date == current_visit_date,
            }
        )

    return images


def collect_history_visits(
    task2_df: pd.DataFrame,
    subject_id: str,
    current_visit_date: str,
    allowed_modalities: List[str],
    max_history_visits: int,
    allow_missing_image_paths: bool = False,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    subset = task2_df[task2_df["subject_id"].astype(str) == str(subject_id)].copy()
    subset = subset[subset["visit_date"].astype(str) <= str(current_visit_date)].copy()
    subset = subset.sort_values("visit_date")

    if max_history_visits > 0 and len(subset) > max_history_visits:
        subset = subset.tail(max_history_visits)

    history_visits: List[Dict[str, Any]] = []
    flat_images: List[Dict[str, Any]] = []

    for _, row in subset.iterrows():
        visit_date = str(row["visit_date"])
        visit_images = collect_images_from_task2_row(
            row=row,
            allowed_modalities=allowed_modalities,
            allow_missing_image_paths=allow_missing_image_paths,
            current_visit_date=current_visit_date,
        )

        if not visit_images:
            continue

        history_visits.append(
            {
                "visit_date": visit_date,
                "visit_folder_path": str(none_if_na(row.get("visit_folder_path")) or ""),
                "images": visit_images,
                "image_paths": [img["path"] for img in visit_images],
                "image_modalities": [img["modality"] for img in visit_images],
            }
        )
        flat_images.extend(visit_images)

    return history_visits, flat_images


def build_vqa_item(
    pair_id: str,
    task_id: str,
    task_name: str,
    subtask: str,
    question_type: str,
    question: str,
    answer: str,
    options: Optional[List[str]],
    subject_id: str,
    visit_date: str,
    images: List[Dict[str, Any]],
    metadata: Dict[str, Any],
    history_visits: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    image_paths = [img["path"] for img in images]
    image_modalities = [img["modality"] for img in images]

    item = {
        "id": pair_id,
        "task_id": task_id,
        "task_name": task_name,
        "subtask": subtask,
        "question_type": question_type,
        "question": question,
        "answer": answer,
        "options": options if options is not None else [],
        "subject_id": subject_id,
        "visit_date": visit_date,
        "images": images,
        "image_paths": image_paths,
        "image_modalities": image_modalities,
        "history_visits": history_visits if history_visits is not None else [],
        "metadata": metadata,
    }
    return item


def generate_task2_pairs(
    task2_df: pd.DataFrame,
    allow_missing_image_paths: bool,
) -> List[Dict[str, Any]]:
    pairs: List[Dict[str, Any]] = []
    counter = 1

    for _, row in task2_df.iterrows():
        subject_id = str(row["subject_id"])
        visit_date = str(row["visit_date"])

        for modality in MODALITY_ORDER:
            has_modality = safe_int(row.get(f"has_{modality}"))
            path_value = none_if_na(row.get(f"{modality}_path"))

            if has_modality != 1 or path_value is None:
                continue

            path_str = str(path_value)
            if not allow_missing_image_paths and not is_existing_path(path_str):
                continue

            question = stable_pick(
                TASK2_TEMPLATES,
                f"task2|{subject_id}|{visit_date}|{modality}",
            )
            answer = MODALITY_DISPLAY[modality]

            images = [
                {
                    "path": path_str,
                    "modality": modality,
                    "modality_display": MODALITY_DISPLAY[modality],
                    "visit_date": visit_date,
                    "is_current_visit": True,
                }
            ]

            metadata = {
                "source_csv": "task2_imaging_modality_identification_labels.csv",
                "subject_folder": str(none_if_na(row.get("subject_folder")) or ""),
                "visit_folder_path": str(none_if_na(row.get("visit_folder_path")) or ""),
                "answer_modality_code": modality,
                "answer_modality_display": answer,
            }

            pairs.append(
                build_vqa_item(
                    pair_id=f"task2_{counter:08d}",
                    task_id="task2",
                    task_name="Imaging Modality Identification",
                    subtask="single_image_modality_classification",
                    question_type="single-choice",
                    question=question,
                    answer=answer,
                    options=TASK2_OPTIONS,
                    subject_id=subject_id,
                    visit_date=visit_date,
                    images=images,
                    metadata=metadata,
                )
            )
            counter += 1

    return pairs


def generate_task3_pairs(
    task3_df: pd.DataFrame,
    task2_index: Dict[Tuple[str, str], pd.Series],
    task3_modalities: List[str],
    allow_missing_image_paths: bool,
) -> List[Dict[str, Any]]:
    pairs: List[Dict[str, Any]] = []
    counter = 1

    for _, row in task3_df.iterrows():
        subject_id = str(row["subject_id"])
        visit_date = str(row["visit_date"])
        label_available = safe_int(row.get("task3_label_available"))

        if label_available != 1:
            continue

        task2_row = task2_index.get((subject_id, visit_date))
        if task2_row is None:
            continue

        images = collect_images_from_task2_row(
            row=task2_row,
            allowed_modalities=task3_modalities,
            allow_missing_image_paths=allow_missing_image_paths,
            current_visit_date=visit_date,
        )
        if not images:
            continue

        diagnosis = none_if_na(row.get("task3_diagnosis"))
        if diagnosis is None:
            continue
        diagnosis = str(diagnosis)

        common_metadata = {
            "source_csv": "task3_disease_abnormality_diagnosis_labels.csv",
            "subject_folder": str(none_if_na(row.get("subject_folder")) or ""),
            "visit_folder_path": str(none_if_na(row.get("visit_folder_path")) or ""),
            "task3_dx_source_date": str(none_if_na(row.get("task3_dx_source_date")) or ""),
            "task3_dx_match_days": safe_int(row.get("task3_dx_match_days")),
            "task3_dx_match_type": str(none_if_na(row.get("task3_dx_match_type")) or ""),
            "task3_diagnosis_code": safe_int(row.get("task3_diagnosis_code")),
            "task3_diagnosis": diagnosis,
        }

        # Multiclass diagnosis
        question = stable_pick(
            TASK3_DIAGNOSIS_TEMPLATES,
            f"task3_diag|{subject_id}|{visit_date}",
        )
        pairs.append(
            build_vqa_item(
                pair_id=f"task3_{counter:08d}",
                task_id="task3",
                task_name="Disease / Abnormality Diagnosis",
                subtask="multiclass_cognitive_diagnosis",
                question_type="single-choice",
                question=question,
                answer=diagnosis,
                options=TASK3_DIAGNOSIS_OPTIONS,
                subject_id=subject_id,
                visit_date=visit_date,
                images=images,
                metadata=common_metadata,
            )
        )
        counter += 1

        # Binary impairment
        impairment_answer = yes_no_answer(row.get("task3_any_cognitive_impairment"))
        if impairment_answer is not None:
            question = stable_pick(
                TASK3_IMPAIRMENT_TEMPLATES,
                f"task3_impairment|{subject_id}|{visit_date}",
            )
            metadata = dict(common_metadata)
            metadata["binary_target"] = "task3_any_cognitive_impairment"
            pairs.append(
                build_vqa_item(
                    pair_id=f"task3_{counter:08d}",
                    task_id="task3",
                    task_name="Disease / Abnormality Diagnosis",
                    subtask="binary_any_cognitive_impairment",
                    question_type="yes-no",
                    question=question,
                    answer=impairment_answer,
                    options=YES_NO_OPTIONS,
                    subject_id=subject_id,
                    visit_date=visit_date,
                    images=images,
                    metadata=metadata,
                )
            )
            counter += 1

        # Binary dementia
        dementia_answer = yes_no_answer(row.get("task3_dementia"))
        if dementia_answer is not None:
            question = stable_pick(
                TASK3_DEMENTIA_TEMPLATES,
                f"task3_dementia|{subject_id}|{visit_date}",
            )
            metadata = dict(common_metadata)
            metadata["binary_target"] = "task3_dementia"
            pairs.append(
                build_vqa_item(
                    pair_id=f"task3_{counter:08d}",
                    task_id="task3",
                    task_name="Disease / Abnormality Diagnosis",
                    subtask="binary_dementia",
                    question_type="yes-no",
                    question=question,
                    answer=dementia_answer,
                    options=YES_NO_OPTIONS,
                    subject_id=subject_id,
                    visit_date=visit_date,
                    images=images,
                    metadata=metadata,
                )
            )
            counter += 1

    return pairs


def generate_task5_pairs(
    task5_df: pd.DataFrame,
    task2_df: pd.DataFrame,
    task5_modalities: List[str],
    task5_max_history_visits: int,
    allow_missing_image_paths: bool,
) -> List[Dict[str, Any]]:
    pairs: List[Dict[str, Any]] = []
    counter = 1

    for _, row in task5_df.iterrows():
        subject_id = str(row["subject_id"])
        visit_date = str(row["visit_date"])

        has_future = safe_int(row.get("task5_has_future_labeled_visit"))
        current_diag = none_if_na(row.get("task5_current_diagnosis"))
        risk_label_raw = none_if_na(row.get("task5_risk_label"))

        if has_future != 1:
            continue
        if current_diag is None:
            continue

        history_visits, images = collect_history_visits(
            task2_df=task2_df,
            subject_id=subject_id,
            current_visit_date=visit_date,
            allowed_modalities=task5_modalities,
            max_history_visits=task5_max_history_visits,
            allow_missing_image_paths=allow_missing_image_paths,
        )
        if not images:
            continue

        common_metadata = {
            "source_csv": "task5_risk_forecasting_treatment_related_labels.csv",
            "subject_folder": str(none_if_na(row.get("subject_folder")) or ""),
            "visit_folder_path": str(none_if_na(row.get("visit_folder_path")) or ""),
            "task5_current_diagnosis_code": safe_int(row.get("task5_current_diagnosis_code")),
            "task5_current_diagnosis": str(current_diag),
            "task5_subject_n_visits": safe_int(row.get("task5_subject_n_visits")),
            "task5_subject_n_labeled_visits": safe_int(row.get("task5_subject_n_labeled_visits")),
            "task5_has_longitudinal_followup": safe_int(row.get("task5_has_longitudinal_followup")),
            "task5_baseline_diagnosis_code": safe_int(row.get("task5_baseline_diagnosis_code")),
            "task5_baseline_diagnosis": str(none_if_na(row.get("task5_baseline_diagnosis")) or ""),
            "task5_last_diagnosis_code": safe_int(row.get("task5_last_diagnosis_code")),
            "task5_last_diagnosis": str(none_if_na(row.get("task5_last_diagnosis")) or ""),
            "task5_next_labeled_visit_date": str(none_if_na(row.get("task5_next_labeled_visit_date")) or ""),
            "task5_next_labeled_diagnosis_code": safe_int(row.get("task5_next_labeled_diagnosis_code")),
            "task5_next_labeled_diagnosis": str(none_if_na(row.get("task5_next_labeled_diagnosis")) or ""),
            "task5_days_to_next_labeled_visit": safe_int(row.get("task5_days_to_next_labeled_visit")),
            "task5_history_visit_count_used": len(history_visits),
            "task5_modalities_used": task5_modalities,
        }

        # Multiclass risk label
        if risk_label_raw is not None:
            risk_label_raw = str(risk_label_raw)
            risk_answer = RISK_LABEL_TEXT.get(risk_label_raw)
            if risk_answer is not None:
                question = stable_pick(
                    TASK5_RISK_TEMPLATES,
                    f"task5_risk|{subject_id}|{visit_date}",
                )
                metadata = dict(common_metadata)
                metadata["task5_risk_label_raw"] = risk_label_raw
                metadata["task5_risk_label_text"] = risk_answer

                pairs.append(
                    build_vqa_item(
                        pair_id=f"task5_{counter:08d}",
                        task_id="task5",
                        task_name="Risk Forecasting & Treatment-Related Labels",
                        subtask="multiclass_prognostic_risk",
                        question_type="single-choice",
                        question=question,
                        answer=risk_answer,
                        options=TASK5_RISK_OPTIONS,
                        subject_id=subject_id,
                        visit_date=visit_date,
                        images=images,
                        metadata=metadata,
                        history_visits=history_visits,
                    )
                )
                counter += 1

        # Binary future decline
        future_decline_answer = yes_no_answer(row.get("task5_future_decline"))
        if future_decline_answer is not None:
            question = stable_pick(
                TASK5_DECLINE_TEMPLATES,
                f"task5_decline|{subject_id}|{visit_date}",
            )
            metadata = dict(common_metadata)
            metadata["binary_target"] = "task5_future_decline"

            pairs.append(
                build_vqa_item(
                    pair_id=f"task5_{counter:08d}",
                    task_id="task5",
                    task_name="Risk Forecasting & Treatment-Related Labels",
                    subtask="binary_future_decline",
                    question_type="yes-no",
                    question=question,
                    answer=future_decline_answer,
                    options=YES_NO_OPTIONS,
                    subject_id=subject_id,
                    visit_date=visit_date,
                    images=images,
                    metadata=metadata,
                    history_visits=history_visits,
                )
            )
            counter += 1

        # Binary future dementia
        future_dementia_answer = yes_no_answer(row.get("task5_future_dementia"))
        if future_dementia_answer is not None:
            question = stable_pick(
                TASK5_DEMENTIA_TEMPLATES,
                f"task5_future_dementia|{subject_id}|{visit_date}",
            )
            metadata = dict(common_metadata)
            metadata["binary_target"] = "task5_future_dementia"

            pairs.append(
                build_vqa_item(
                    pair_id=f"task5_{counter:08d}",
                    task_id="task5",
                    task_name="Risk Forecasting & Treatment-Related Labels",
                    subtask="binary_future_dementia",
                    question_type="yes-no",
                    question=question,
                    answer=future_dementia_answer,
                    options=YES_NO_OPTIONS,
                    subject_id=subject_id,
                    visit_date=visit_date,
                    images=images,
                    metadata=metadata,
                    history_visits=history_visits,
                )
            )
            counter += 1

    return pairs


def save_json(path: Path, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def save_jsonl(path: Path, rows: List[Dict[str, Any]]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def summarize_pairs(name: str, pairs: List[Dict[str, Any]]) -> None:
    subtype_counts: Dict[str, int] = {}
    for item in pairs:
        subtype = str(item.get("subtask", "unknown"))
        subtype_counts[subtype] = subtype_counts.get(subtype, 0) + 1

    print(f"{name}: {len(pairs)}")
    for subtype, count in sorted(subtype_counts.items()):
        print(f"  - {subtype}: {count}")


def main(argv: List[str]) -> int:
    parser = argparse.ArgumentParser(description="Generate VQA pairs from ADNI task2/task3/task5 labels.")
    parser.add_argument("--task-dir", default="task_outputs", help="Directory containing task CSV files")
    parser.add_argument("--outdir", default="vqa_outputs", help="Directory to save generated VQA pairs")
    parser.add_argument(
        "--task3-modalities",
        default="T1,FLAIR,T2,PD,DTI,fMRI",
        help="Comma-separated modalities used for task3 current visit images",
    )
    parser.add_argument(
        "--task5-modalities",
        default="T1,FLAIR,T2,PD",
        help="Comma-separated modalities used for task5 longitudinal history images",
    )
    parser.add_argument(
        "--task5-max-history-visits",
        type=int,
        default=3,
        help="Maximum number of history visits kept for task5, 0 means keep all",
    )
    parser.add_argument(
        "--allow-missing-image-paths",
        action="store_true",
        help="Keep samples even if the image path does not exist on disk",
    )
    args = parser.parse_args(argv)

    task_dir = Path(args.task_dir).resolve()
    outdir = Path(args.outdir).resolve()
    ensure_dir(outdir)

    if not task_dir.exists() or not task_dir.is_dir():
        print(f"Task directory does not exist: {task_dir}", file=sys.stderr)
        return 1

    task2_path = task_dir / "task2_imaging_modality_identification_labels.csv"
    task3_path = task_dir / "task3_disease_abnormality_diagnosis_labels.csv"
    task5_path = task_dir / "task5_risk_forecasting_treatment_related_labels.csv"

    try:
        task3_modalities = parse_modalities_arg(args.task3_modalities)
        task5_modalities = parse_modalities_arg(args.task5_modalities)
    except Exception as e:
        print(f"Invalid modality argument: {e}", file=sys.stderr)
        return 1

    try:
        task2_df = load_csv_required(task2_path, "task2 CSV")
        task3_df = load_csv_required(task3_path, "task3 CSV")
        task5_df = load_csv_required(task5_path, "task5 CSV")
    except Exception as e:
        print(f"Failed to load task CSVs: {e}", file=sys.stderr)
        return 1

    print("Generating VQA pairs...")
    print(f"Task dir: {task_dir}")
    print(f"Output dir: {outdir}")
    print(f"Task3 modalities: {task3_modalities}")
    print(f"Task5 modalities: {task5_modalities}")
    print(f"Task5 max history visits: {args.task5_max_history_visits}")
    print(f"Allow missing image paths: {args.allow_missing_image_paths}")

    task2_index = build_task2_index(task2_df)

    task2_pairs = generate_task2_pairs(
        task2_df=task2_df,
        allow_missing_image_paths=args.allow_missing_image_paths,
    )
    task3_pairs = generate_task3_pairs(
        task3_df=task3_df,
        task2_index=task2_index,
        task3_modalities=task3_modalities,
        allow_missing_image_paths=args.allow_missing_image_paths,
    )
    task5_pairs = generate_task5_pairs(
        task5_df=task5_df,
        task2_df=task2_df,
        task5_modalities=task5_modalities,
        task5_max_history_visits=args.task5_max_history_visits,
        allow_missing_image_paths=args.allow_missing_image_paths,
    )

    all_pairs = task2_pairs + task3_pairs + task5_pairs

    metadata = {
        "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "task_dir": str(task_dir),
        "counts": {
            "task2": len(task2_pairs),
            "task3": len(task3_pairs),
            "task5": len(task5_pairs),
            "all": len(all_pairs),
        },
        "task3_modalities": task3_modalities,
        "task5_modalities": task5_modalities,
        "task5_max_history_visits": args.task5_max_history_visits,
        "allow_missing_image_paths": args.allow_missing_image_paths,
    }

    save_json(outdir / "task2_vqa_pairs.json", task2_pairs)
    save_json(outdir / "task3_vqa_pairs.json", task3_pairs)
    save_json(outdir / "task5_vqa_pairs.json", task5_pairs)
    save_json(outdir / "all_vqa_pairs.json", {"metadata": metadata, "data": all_pairs})
    save_jsonl(outdir / "all_vqa_pairs.jsonl", all_pairs)

    print("\nDone")
    summarize_pairs("Task2 pairs", task2_pairs)
    summarize_pairs("Task3 pairs", task3_pairs)
    summarize_pairs("Task5 pairs", task5_pairs)
    print(f"All pairs: {len(all_pairs)}")
    print(f"\nSaved files:")
    print(f"  - {outdir / 'task2_vqa_pairs.json'}")
    print(f"  - {outdir / 'task3_vqa_pairs.json'}")
    print(f"  - {outdir / 'task5_vqa_pairs.json'}")
    print(f"  - {outdir / 'all_vqa_pairs.json'}")
    print(f"  - {outdir / 'all_vqa_pairs.jsonl'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))