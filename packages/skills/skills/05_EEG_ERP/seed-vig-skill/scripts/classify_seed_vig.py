#!/usr/bin/env python3
"""Classify vigilance states from SEED-VIG features.

Supports binary (alert vs. drowsy) and multi-class vigilance detection.
"""
import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np


def load_features(features_path: Path) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Load features and labels from CSV."""
    import pandas as pd
    df = pd.read_csv(features_path)

    label_col = None
    for col in ["vigilance", "label", "kss", "state"]:
        if col in df.columns:
            label_col = col
            break

    if label_col is None:
        raise ValueError("No vigilance label column found")

    feature_cols = [c for c in df.columns if c.startswith("ch") and "_" in c]

    X = df[feature_cols].values.astype(float)
    y_raw = df[label_col].values

    # Binarize if needed (e.g., KSS 1-4 -> alert, 5-9 -> drowsy)
    try:
        y = y_raw.astype(int)
        if y.max() > 2:
            y = (y >= 5).astype(int)  # KSS-based binarization
    except ValueError:
        unique = np.unique(y_raw)
        y = np.array([0 if v == unique[0] else 1 for v in y_raw])

    subjects = df["subject"].tolist() if "subject" in df.columns else [f"sub-{i}" for i in range(len(y))]

    return X, y, subjects


def classify_svm(X: np.ndarray, y: np.ndarray, subjects: List[str]) -> Dict:
    """SVM classification with LOSO CV."""
    from sklearn.svm import SVC
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import LeaveOneGroupOut
    from sklearn.metrics import classification_report, roc_auc_score

    scaler = StandardScaler()
    logo = LeaveOneGroupOut()
    y_pred_all, y_true_all, y_score_all = [], [], []

    for train_idx, test_idx in logo.split(X, y, subjects):
        X_train = scaler.fit_transform(X[train_idx])
        X_test = scaler.transform(X[test_idx])
        svm = SVC(kernel="rbf", C=1.0, gamma="scale", probability=True)
        svm.fit(X_train, y[train_idx])
        y_pred_all.extend(svm.predict(X_test))
        y_true_all.extend(y[test_idx])
        y_score_all.extend(svm.predict_proba(X_test)[:, 1])

    y_pred_all = np.array(y_pred_all)
    y_true_all = np.array(y_true_all)
    y_score_all = np.array(y_score_all)

    accuracy = float(np.mean(y_pred_all == y_true_all))
    try:
        auc = float(roc_auc_score(y_true_all, y_score_all))
    except ValueError:
        auc = 0.0

    return {
        "method": "SVM (RBF)",
        "cv": "Leave-One-Subject-Out",
        "accuracy": accuracy,
        "auc": auc,
        "n_subjects": len(set(subjects)),
        "n_samples": len(y_true_all),
    }


def classify_rf(X: np.ndarray, y: np.ndarray, subjects: List[str]) -> Dict:
    """Random Forest classification with LOSO CV."""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import LeaveOneGroupOut
    from sklearn.metrics import roc_auc_score

    scaler = StandardScaler()
    logo = LeaveOneGroupOut()
    y_pred_all, y_true_all, y_score_all = [], [], []

    for train_idx, test_idx in logo.split(X, y, subjects):
        X_train = scaler.fit_transform(X[train_idx])
        X_test = scaler.transform(X[test_idx])
        rf = RandomForestClassifier(n_estimators=100, random_state=42)
        rf.fit(X_train, y[train_idx])
        y_pred_all.extend(rf.predict(X_test))
        y_true_all.extend(y[test_idx])
        y_score_all.extend(rf.predict_proba(X_test)[:, 1])

    y_pred_all = np.array(y_pred_all)
    y_true_all = np.array(y_true_all)
    y_score_all = np.array(y_score_all)

    accuracy = float(np.mean(y_pred_all == y_true_all))
    try:
        auc = float(roc_auc_score(y_true_all, y_score_all))
    except ValueError:
        auc = 0.0

    return {
        "method": "Random Forest (100 trees)",
        "cv": "Leave-One-Subject-Out",
        "accuracy": accuracy,
        "auc": auc,
        "n_subjects": len(set(subjects)),
        "n_samples": len(y_true_all),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify SEED-VIG vigilance states.")
    parser.add_argument("--input", required=True, help="Path to features CSV")
    parser.add_argument("--output", required=True, help="Output path for results")
    parser.add_argument("--method", choices=["svm", "rf", "both"], default="both")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    X, y, subjects = load_features(input_path)
    print(f"Loaded {len(y)} samples, classes: {np.unique(y)}, {len(set(subjects))} subjects")

    results = []
    if args.method in ("svm", "both"):
        svm_result = classify_svm(X, y, subjects)
        results.append(svm_result)
        print(f"SVM accuracy: {svm_result['accuracy']:.4f}, AUC: {svm_result['auc']:.4f}")

    if args.method in ("rf", "both"):
        rf_result = classify_rf(X, y, subjects)
        results.append(rf_result)
        print(f"RF accuracy: {rf_result['accuracy']:.4f}, AUC: {rf_result['auc']:.4f}")

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, default=str)

    print(f"Results saved to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
