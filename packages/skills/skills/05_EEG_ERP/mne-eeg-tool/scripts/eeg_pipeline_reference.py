"""MNE-EEG Pipeline Reference - Core EEG processing functions.

Distilled from the NeuroClaw mne-eeg-tool SKILL.md.
Agent should consult this script instead of copying from SKILL.md directly.

Functions:
    load_eeg()                          - Load .set/.edf/.bdf/.fif + validation
    detect_and_interpolate_bad_channels() - Auto-detect + interpolate noisy channels
    preprocess_filtering()              - Resample + high-pass + notch + bandpass
    remove_artifacts()                  - ICA + AutoReject + EOG/ECG regression
    continuous_data_cleaning()          - Resting-state pipeline (no events)
    rereference_and_epoch()             - Average reference + epoching + baseline
    extract_frequency_bands()           - Split into delta/theta/alpha/beta/gamma
    extract_features()                  - Band power, CSP, Hjorth, sample entropy
    compute_connectivity()              - PLV, coherence, wPLI
    extract_erp_features()              - Peak amplitude, latency, AUC
    compute_alpha_asymmetry()           - Frontal alpha asymmetry (emotion studies)
    run_microstate_analysis()           - EEG microstates (resting-state)
    full_eeg_pipeline()                 - One-click end-to-end pipeline

Usage:
    python skills/mne-eeg-tool/scripts/eeg_pipeline_reference.py --input data.set
    python skills/mne-eeg-tool/scripts/eeg_pipeline_reference.py --input data.set --resting
"""

import argparse

import mne
import numpy as np
import pandas as pd
from mne.preprocessing import ICA, find_bad_channels, AutoReject
from mne.decoding import CSP
from mne_connectivity import spectral_connectivity_epochs
import pyentrp.entropy as entropy


def load_eeg(raw_path: str):
    """Load EEG data in any supported format + basic validation."""
    if raw_path.endswith('.set'):
        raw = mne.io.read_raw_eeglab(raw_path, preload=True)
    elif raw_path.endswith(('.edf', '.bdf')):
        raw = mne.io.read_raw_edf(raw_path, preload=True)
    elif raw_path.endswith('.fif'):
        raw = mne.io.read_raw_fif(raw_path, preload=True)
    else:
        raw = mne.io.read_raw(raw_path, preload=True)
    print(f"Loaded: {len(raw.ch_names)} channels, {raw.n_times} samples, SFREQ={raw.info['sfreq']} Hz")
    return raw


def detect_and_interpolate_bad_channels(raw: mne.io.Raw):
    """Explicit bad-channel detection + interpolation."""
    bads = find_bad_channels(raw, method='correlation', threshold=0.8)
    raw.info['bads'] = bads
    raw.interpolate_bads(reset_bads=True)
    print(f"Interpolated {len(bads)} bad channels")
    return raw


def preprocess_filtering(raw: mne.io.Raw, target_sfreq: int = 256):
    """Resample + full filtering pipeline."""
    raw = raw.copy().resample(target_sfreq)
    raw.filter(l_freq=0.5, h_freq=40, fir_design='firwin')
    raw.notch_filter(freqs=50, notch_widths=1)
    return raw


def remove_artifacts(raw: mne.io.Raw):
    """ICA + AutoReject + EOG/ECG regression (if channels exist)."""
    ica = ICA(n_components=20, random_state=42, method='fastica')
    ica.fit(raw)
    eog_inds, _ = ica.find_bads_eog(raw)
    muscle_inds, _ = ica.find_bads_muscle(raw)
    ica.exclude = eog_inds + muscle_inds
    raw_clean = ica.apply(raw.copy())

    ar = AutoReject()
    events = mne.make_fixed_length_events(raw_clean, duration=2.0)
    epochs = mne.Epochs(raw_clean, events, tmin=0, tmax=2.0, preload=True, reject_by_annotation=False)
    ar.fit(epochs)
    raw_clean = ar.transform(raw_clean)

    print("Artifact removal (ICA + AutoReject) completed")
    return raw_clean


def continuous_data_cleaning(raw: mne.io.Raw):
    """Resting-state continuous pipeline (no epoching)."""
    raw = preprocess_filtering(raw)
    raw = remove_artifacts(raw)
    raw = raw.set_eeg_reference('average')
    print("Continuous resting-state cleaning completed")
    return raw


def rereference_and_epoch(raw_clean: mne.io.Raw, events=None):
    """Re-reference + epoching + baseline correction."""
    raw_ref = raw_clean.copy().set_eeg_reference('average')
    if events is None:
        events = mne.find_events(raw_ref, stim_channel='STI 014')
    epochs = mne.Epochs(raw_ref, events, tmin=-0.2, tmax=0.8,
                        baseline=(None, 0), preload=True,
                        reject=dict(eeg=150e-6))
    epochs.save("eeg_output/epoched-epo.fif", overwrite=True)
    return epochs


def extract_frequency_bands(raw: mne.io.Raw, output_dir: str = "eeg_output"):
    """Extract classic bands and save power."""
    bands = {'delta': (0.5, 4), 'theta': (4, 8), 'alpha': (8, 13),
             'beta': (13, 30), 'gamma': (30, 40)}
    power_dict = {}
    for name, (l, h) in bands.items():
        band_raw = raw.copy().filter(l_freq=l, h_freq=h)
        psd, freqs = mne.time_frequency.psd_array_welch(
            band_raw.get_data(), sfreq=band_raw.info['sfreq'],
            fmin=l, fmax=h, n_fft=1024)
        power = np.mean(psd, axis=1)
        power_dict[name] = power
        band_raw.save(f"{output_dir}/band_{name}.fif", overwrite=True)
    df_power = pd.DataFrame(power_dict, index=raw.ch_names)
    df_power.to_csv(f"{output_dir}/band_power.csv")
    return df_power


def compute_connectivity(epochs: mne.Epochs, output_dir: str = "eeg_output"):
    """Functional connectivity (PLV, coherence, wPLI)."""
    conn = spectral_connectivity_epochs(
        epochs, method=['plv', 'coh', 'wpli'], mode='multitaper',
        sfreq=epochs.info['sfreq'], fmin=8, fmax=13, faverage=True)
    np.savez(f"{output_dir}/connectivity.npz", plv=conn[0], coh=conn[1], wpli=conn[2])
    print("Connectivity matrices saved")
    return conn


def extract_erp_features(epochs: mne.Epochs, output_dir: str = "eeg_output"):
    """ERP peak amplitude, latency, AUC."""
    evokeds = epochs.average()
    peaks = {}
    for ch in evokeds.ch_names:
        data = evokeds.get_data(picks=ch).squeeze()
        peak_idx = np.argmax(np.abs(data))
        peaks[ch] = {
            'peak_amp': data[peak_idx],
            'peak_latency': evokeds.times[peak_idx],
            'auc': np.trapz(np.abs(data))
        }
    df_erp = pd.DataFrame(peaks).T
    df_erp.to_csv(f"{output_dir}/erp_features.csv")
    return df_erp


def compute_alpha_asymmetry(raw: mne.io.Raw, output_dir: str = "eeg_output"):
    """Frontal alpha asymmetry (F4-F3)."""
    raw_alpha = raw.copy().filter(8, 13)
    epochs = mne.make_fixed_length_epochs(raw_alpha, duration=2.0, preload=True)
    left = epochs.get_data(picks=['F3']).mean(axis=2)
    right = epochs.get_data(picks=['F4']).mean(axis=2)
    asymmetry = (left - right) / (left + right)
    np.save(f"{output_dir}/alpha_asymmetry.npy", asymmetry)
    print("Frontal alpha asymmetry computed")
    return asymmetry


def run_microstate_analysis(raw: mne.io.Raw, output_dir: str = "eeg_output"):
    """EEG microstate analysis (resting-state)."""
    from mne_microstates import Microstates
    ms = Microstates(n_states=4)
    ms.fit(raw)
    ms.save(f"{output_dir}/microstates.fif")
    print("Microstate analysis completed (4 states)")
    return ms


def extract_features(epochs: mne.Epochs, output_dir: str = "eeg_output"):
    """Core + advanced features: band power, CSP, Hjorth, sample entropy."""
    psds, freqs = mne.time_frequency.psd_array_multitaper(
        epochs.get_data(), sfreq=epochs.info['sfreq'])
    band_power = np.mean(psds[:, :, (freqs >= 8) & (freqs <= 13)], axis=2)

    csp = CSP(n_components=4)
    csp_features = csp.fit_transform(epochs.get_data(), epochs.events[:, -1])

    hjorth = []
    sample_entropy = []
    for trial in epochs.get_data():
        mobility = np.std(np.diff(trial, axis=1), axis=1) / np.std(trial, axis=1)
        hjorth.append(mobility)
        sample_entropy.append([entropy.sample_entropy(ch, 2, 0.2)[0] for ch in trial])

    features = {
        'band_power': band_power,
        'csp': csp_features,
        'hjorth': np.array(hjorth),
        'sample_entropy': np.array(sample_entropy)
    }
    np.savez(f"{output_dir}/features.npz", **features)
    return features


def full_eeg_pipeline(raw_path: str, is_resting_state: bool = False, output_dir: str = "eeg_output"):
    """One-click full EEG pipeline (supports resting-state flag)."""
    from pathlib import Path
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    raw = load_eeg(raw_path)
    raw = detect_and_interpolate_bad_channels(raw)

    if is_resting_state:
        raw_clean = continuous_data_cleaning(raw)
        compute_connectivity(mne.make_fixed_length_epochs(raw_clean, duration=2.0, preload=True), output_dir)
        run_microstate_analysis(raw_clean, output_dir)
        compute_alpha_asymmetry(raw_clean, output_dir)
    else:
        raw_clean = remove_artifacts(preprocess_filtering(raw))
        epochs = rereference_and_epoch(raw_clean)
        extract_features(epochs, output_dir)
        extract_erp_features(epochs, output_dir)

    extract_frequency_bands(raw_clean, output_dir)
    print(f"Full EEG Pipeline completed! Outputs in: {output_dir}/")
    return "Pipeline finished"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MNE-EEG Pipeline Reference")
    parser.add_argument("--input", required=True, help="Path to EEG file (.set/.edf/.bdf/.fif)")
    parser.add_argument("--resting", action="store_true", help="Use resting-state pipeline")
    parser.add_argument("--output-dir", default="eeg_output", help="Output directory")
    args = parser.parse_args()
    full_eeg_pipeline(args.input, is_resting_state=args.resting, output_dir=args.output_dir)
