#!/usr/bin/env python3
"""Classify emotions from SEED-IV features.

Supports SVM, Random Forest, and Leave-One-Subject-Out cross-validation.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np


def load_features(features_path: Path) -> Tuple[np.ndarray, np.ndarray, List[str]]:
    """Load features and labels from CSV."""
    import pandas as pd
    df = pd.read_csv(features_path)

    # Find label column
    label_col = None
    for col in ["emotion", "label", "emotion_label"]:
        if col in df.columns:
            label_col = col
            break

    if label_col is None:
        raise ValueError("No emotion label column found")

    # Find feature columns
    feature_cols = [c for c in df.columns if c.startswith("ch") and "_" in c]

    X = df[feature_cols].values.astype(float)
    y = df[label_col].values.astype(int)
    subjects = df["subject"].tolist() if "subject" in df.columns else [f"sub-{i}" for i in range(len(y))]

    return X, y, subjects


def classify_svm(X: np.ndarray, y: np.ndarray, subjects: List[str]) -> Dict:
    """SVM classification with Leave-One-Subject-Out CV."""
    from sklearn.svm import SVC
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import LeaveOneGroupOut

    scaler = StandardScaler()
    logo = LeaveOneGroupOut()
    y_pred_all = []
    y_true_all = []

    for train_idx, test_idx in logo.split(X, y, subjects):
        X_train = scaler.fit_transform(X[train_idx])
        X_test = scaler.transform(X[test_idx])
        svm = SVC(kernel="rbf", C=1.0, gamma="scale")
        svm.fit(X_train, y[train_idx])
        y_pred_all.extend(svm.predict(X_test))
        y_true_all.extend(y[test_idx])

    y_pred_all = np.array(y_pred_all)
    y_true_all = np.array(y_true_all)
    accuracy = np.mean(y_pred_all == y_true_all)

    # Per-class metrics
    classes = np.unique(y_true_all)
    per_class = {}
    for cls in classes:
        mask = y_true_all == cls
        per_class[int(cls)] = {
            "accuracy": float(np.mean(y_pred_all[mask] == cls)),
            "n_samples": int(mask.sum()),
        }

    return {
        "method": "SVM (RBF)",
        "cv": "Leave-One-Subject-Out",
        "accuracy": float(accuracy),
        "n_subjects": len(set(subjects)),
        "n_samples": len(y_true_all),
        "per_class": per_class,
    }


def classify_rf(X: np.ndarray, y: np.ndarray, subjects: List[str]) -> Dict:
    """Random Forest classification with Leave-One-Subject-Out CV."""
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.model_selection import LeaveOneGroupOut

    scaler = StandardScaler()
    logo = LeaveOneGroupOut()
    y_pred_all = []
    y_true_all = []

    for train_idx, test_idx in logo.split(X, y, subjects):
        X_train = scaler.fit_transform(X[train_idx])
        X_test = scaler.transform(X[test_idx])
        rf = RandomForestClassifier(n_estimators=100, random_state=42)
        rf.fit(X_train, y[train_idx])
        y_pred_all.extend(rf.predict(X_test))
        y_true_all.extend(y[test_idx])

    y_pred_all = np.array(y_pred_all)
    y_true_all = np.array(y_true_all)
    accuracy = np.mean(y_pred_all == y_true_all)

    return {
        "method": "Random Forest (100 trees)",
        "cv": "Leave-One-Subject-Out",
        "accuracy": float(accuracy),
        "n_subjects": len(set(subjects)),
        "n_samples": len(y_true_all),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify SEED-IV emotions.")
    parser.add_argument("--input", required=True, help="Path to features CSV")
    parser.add_argument("--output", required=True, help="Output path for results")
    parser.add_argument("--method", choices=["svm", "rf", "both"], default="both",
                        help="Classification method")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    if not input_path.exists():
        print(f"Input file not found: {input_path}", file=sys.stderr)
        return 1

    X, y, subjects = load_features(input_path)
    print(f"Loaded {len(y)} samples, {len(set(y))} classes, {len(set(subjects))} subjects")

    results = []
    if args.method in ("svm", "both"):
        svm_result = classify_svm(X, y, subjects)
        results.append(svm_result)
        print(f"SVM accuracy: {svm_result['accuracy']:.4f}")

    if args.method in ("rf", "both"):
        rf_result = classify_rf(X, y, subjects)
        results.append(rf_result)
        print(f"RF accuracy: {rf_result['accuracy']:.4f}")

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        import json
        json.dump(results, f, indent=2, default=str)

    print(f"Results saved to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
