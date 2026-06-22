from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC


def run_svm(features_path: Path, labels_path: Path, output_dir: Path, target: str, cv: int) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    features = pd.read_csv(features_path)
    labels = pd.read_csv(labels_path)
    y = labels[target]

    if "subject_id" in labels.columns and "subject_id" in features.columns:
        merged = features.merge(labels[["subject_id", target]], on="subject_id", how="inner")
        y = merged[target]
        x = merged.drop(columns=[target])
        if "subject_id" in x.columns:
            x = x.drop(columns=["subject_id"])
    else:
        x = features

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("svm", SVC(kernel="linear", probability=True, random_state=0)),
    ])
    splitter = StratifiedKFold(n_splits=cv, shuffle=True, random_state=0)
    predicted = cross_val_predict(pipeline, x, y, cv=splitter, method="predict")
    probabilities = cross_val_predict(pipeline, x, y, cv=splitter, method="predict_proba")

    metrics = {"accuracy": accuracy_score(y, predicted)}
    if probabilities.shape[1] == 2:
        metrics["auc"] = roc_auc_score(y, probabilities[:, 1])

    pd.DataFrame({"y_true": y, "y_pred": predicted}).to_csv(output_dir / "predictions.csv", index=False)
    pd.DataFrame([metrics]).to_csv(output_dir / "metrics.csv", index=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Reference Nilearn/scikit-learn snippet for SVM disease classification.")
    parser.add_argument("--features", type=Path, required=True, help="CSV feature table.")
    parser.add_argument("--labels", type=Path, required=True, help="CSV label table.")
    parser.add_argument("--target", type=str, required=True, help="Target column in label table.")
    parser.add_argument("--cv", type=int, default=5, help="Number of CV folds.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory for classifier outputs.")
    args = parser.parse_args()

    run_svm(args.features, args.labels, args.output_dir, args.target, args.cv)
    print(f"Saved SVM outputs to: {args.output_dir}")


if __name__ == "__main__":
    main()