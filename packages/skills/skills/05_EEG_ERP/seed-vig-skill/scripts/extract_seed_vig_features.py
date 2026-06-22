#!/usr/bin/env python3
"""Extract features from SEED-VIG EEG data for vigilance detection.

Supports band power, Differential Entropy (DE), and connectivity features.
"""
import argparse
import csv
import sys
from pathlib import Path
from typing import Dict, List

import numpy as np


def compute_band_power(data: np.ndarray, sfreq: float = 200.0) -> np.ndarray:
    """Compute band power features.

    Bands: delta (1-4), theta (4-8), alpha (8-14), beta (14-31), gamma (31-50).
    """
    from scipy.signal import butter, filtfilt

    bands = {
        "delta": (1, 4),
        "theta": (4, 8),
        "alpha": (8, 14),
        "beta": (14, 31),
        "gamma": (31, 50),
    }

    n_channels = data.shape[0] if data.ndim > 1 else 1
    features = np.zeros((n_channels, len(bands)))

    for j, (band_name, (low, high)) in enumerate(bands.items()):
        nyq = sfreq / 2.0
        b, a = butter(4, [low / nyq, high / nyq], btype="band")
        if data.ndim > 1:
            for ch in range(n_channels):
                filtered = filtfilt(b, a, data[ch])
                features[ch, j] = np.log(np.var(filtered) + 1e-10)
        else:
            filtered = filtfilt(b, a, data)
            features[0, j] = np.log(np.var(filtered) + 1e-10)

    return features


def compute_vigilance_ratio(data: np.ndarray, sfreq: float = 200.0) -> np.ndarray:
    """Compute vigilance-related spectral ratios.

    Common ratios: theta/alpha, (theta+alpha)/beta, theta/beta.
    """
    from scipy.signal import butter, filtfilt

    def band_var(signal, low, high):
        nyq = sfreq / 2.0
        b, a = butter(4, [low / nyq, high / nyq], btype="band")
        filtered = filtfilt(b, a, signal)
        return np.var(filtered)

    n_channels = data.shape[0] if data.ndim > 1 else 1
    ratios = np.zeros((n_channels, 3))

    for ch in range(n_channels if data.ndim > 1 else 1):
        signal = data[ch] if data.ndim > 1 else data
        theta = band_var(signal, 4, 8)
        alpha = band_var(signal, 8, 14)
        beta = band_var(signal, 14, 31)

        ratios[ch, 0] = theta / (alpha + 1e-10)  # theta/alpha
        ratios[ch, 1] = (theta + alpha) / (beta + 1e-10)  # (theta+alpha)/beta
        ratios[ch, 2] = theta / (beta + 1e-10)  # theta/beta

    return ratios


def load_eeg_file(path: Path) -> tuple:
    """Load EEG data from various formats."""
    suffix = path.suffix.lower()

    if suffix == ".mat":
        import scipy.io as sio
        mat = sio.loadmat(str(path))
        for key in mat:
            if not key.startswith("_") and isinstance(mat[key], np.ndarray) and mat[key].ndim >= 2:
                return mat[key], 200.0
        raise ValueError(f"No EEG data found in {path}")

    elif suffix in (".edf", ".bdf"):
        import mne
        raw = mne.io.read_raw_edf(str(path), preload=True, verbose=False)
        return raw.get_data(), raw.info["sfreq"]

    elif suffix == ".set":
        import mne
        raw = mne.io.read_raw_eeglab(str(path), preload=True, verbose=False)
        return raw.get_data(), raw.info["sfreq"]

    elif suffix == ".vhdr":
        import mne
        raw = mne.io.read_raw_brainvision(str(path), preload=True, verbose=False)
        return raw.get_data(), raw.info["sfreq"]

    else:
        raise ValueError(f"Unsupported EEG format: {suffix}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract SEED-VIG EEG features.")
    parser.add_argument("--input", required=True, help="Path to SEED-VIG BIDS directory")
    parser.add_argument("--output", required=True, help="Output directory for features")
    parser.add_argument("--feature-type", choices=["bandpower", "ratio", "both"], default="both")
    parser.add_argument("--subject", help="Process specific subject only")
    parser.add_argument("--epoch-duration", type=float, default=4.0,
                        help="Epoch duration in seconds (default: 4.0)")
    args = parser.parse_args()

    input_dir = Path(args.input).resolve()
    if not input_dir.exists():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.subject:
        subjects = [args.subject]
    else:
        subjects = sorted([d.name for d in input_dir.glob("sub-*") if d.is_dir()])

    band_names = ["delta", "theta", "alpha", "beta", "gamma"]
    ratio_names = ["theta_alpha", "theta_alpha_beta", "theta_beta"]
    all_results = []

    for subj in subjects:
        subj_dir = input_dir / subj
        eeg_files = list(subj_dir.rglob("*.edf")) + list(subj_dir.rglob("*.set")) + \
                    list(subj_dir.rglob("*.vhdr")) + list(subj_dir.rglob("*.mat"))

        for eeg_file in eeg_files:
            try:
                data, sfreq = load_eeg_file(eeg_file)
                epoch_samples = int(args.epoch_duration * sfreq)
                n_epochs = data.shape[-1] // epoch_samples if data.ndim > 1 else len(data) // epoch_samples

                for epoch_idx in range(n_epochs):
                    start = epoch_idx * epoch_samples
                    end = start + epoch_samples
                    epoch_data = data[..., start:end] if data.ndim > 1 else data[start:end]

                    if args.feature_type in ("bandpower", "both"):
                        bp = compute_band_power(epoch_data, sfreq)
                        row = {"subject": subj, "file": eeg_file.name, "epoch": epoch_idx, "feature": "bandpower"}
                        for ch_idx in range(bp.shape[0]):
                            for band_idx, band in enumerate(band_names):
                                row[f"ch{ch_idx}_{band}"] = f"{bp[ch_idx, band_idx]:.6f}"
                        all_results.append(row)

                    if args.feature_type in ("ratio", "both"):
                        ratios = compute_vigilance_ratio(epoch_data, sfreq)
                        row = {"subject": subj, "file": eeg_file.name, "epoch": epoch_idx, "feature": "ratio"}
                        for ch_idx in range(ratios.shape[0]):
                            for ratio_idx, ratio_name in enumerate(ratio_names):
                                row[f"ch{ch_idx}_{ratio_name}"] = f"{ratios[ch_idx, ratio_idx]:.6f}"
                        all_results.append(row)

            except Exception as e:
                print(f"[WARN] Failed to process {eeg_file}: {e}", file=sys.stderr)

    if not all_results:
        print("[ERROR] No features extracted.", file=sys.stderr)
        return 1

    output_path = output_dir / f"seed_vig_features_{args.feature_type}.csv"
    fieldnames = list(all_results[0].keys())
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_results)

    print(f"Features: {len(all_results)} epochs, {len(fieldnames)} columns -> {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
