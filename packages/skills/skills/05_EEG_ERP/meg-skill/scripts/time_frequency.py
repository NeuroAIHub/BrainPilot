#!/usr/bin/env python3
"""Compute time-frequency representations from MEG/EEG epochs.

Uses MNE-Python for Morlet wavelet or multitaper spectral analysis.
Outputs power and inter-trial coherence (ITC) maps.
"""
import argparse
import sys
from pathlib import Path

try:
    import numpy as np
except ImportError:
    print("Error: numpy is required.", file=sys.stderr)
    sys.exit(1)

try:
    import mne
except ImportError:
    print("Error: mne is required. Install with: pip install mne", file=sys.stderr)
    sys.exit(1)


def compute_tfr_morlet(
    epochs: mne.Epochs,
    freqs: np.ndarray,
    n_cycles: float,
    baseline: tuple = None,
    return_itc: bool = True,
) -> tuple:
    """Compute time-frequency representation using Morlet wavelets.

    Args:
        epochs: MNE Epochs object.
        freqs: Array of frequencies of interest.
        n_cycles: Number of cycles in the Morlet wavelet.
        baseline: Tuple (tmin, tmax) for baseline correction.
        return_itc: Whether to compute inter-trial coherence.

    Returns:
        power: Average TFR power (EvokedArray).
        itc: Inter-trial coherence (EvokedArray) or None.
    """
    # Compute TFR for each epoch
    tfr = epochs.compute_tfr(
        method="morlet",
        freqs=freqs,
        n_cycles=n_cycles,
        return_itc=False,
        average=False,
    )

    # Average power across epochs
    power = tfr.copy().average()

    # Apply baseline correction
    if baseline is not None:
        power.apply_baseline(baseline=baseline)

    itc = None
    if return_itc:
        # ITC = |mean(exp(j * phase))| across epochs
        data = tfr.data  # (n_epochs, n_channels, n_freqs, n_times)
        itc_data = np.abs(np.mean(np.exp(1j * np.angle(data)), axis=0))
        itc = power.copy()
        itc.data = itc_data

    return power, itc


def compute_tfr_multitaper(
    epochs: mne.Epochs,
    freqs: np.ndarray,
    bandwidth: float,
    baseline: tuple = None,
) -> "mne.time_frequency.AverageTFR":
    """Compute time-frequency representation using multitaper method.

    Args:
        epochs: MNE Epochs object.
        freqs: Array of frequencies of interest.
        bandwidth: Frequency bandwidth of the multitaper windows.
        baseline: Tuple (tmin, tmax) for baseline correction.

    Returns:
        power: Average TFR power.
    """
    tfr = epochs.compute_tfr(
        method="multitaper",
        freqs=freqs,
        bandwidth=bandwidth,
        return_itc=False,
        average=False,
    )

    power = tfr.copy().average()

    if baseline is not None:
        power.apply_baseline(baseline=baseline)

    return power


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute time-frequency representations from MEG/EEG epochs."
    )
    parser.add_argument("--epochs", required=True, help="Path to epochs .fif file")
    parser.add_argument("--output", required=True, help="Output directory for TFR results")
    parser.add_argument("--method", default="morlet", choices=["morlet", "multitaper"],
                        help="TFR method (default: morlet)")
    parser.add_argument("--freq-min", type=float, default=1.0, help="Minimum frequency in Hz (default: 1)")
    parser.add_argument("--freq-max", type=float, default=100.0, help="Maximum frequency in Hz (default: 100)")
    parser.add_argument("--freq-steps", type=int, default=40, help="Number of frequency steps (default: 40)")
    parser.add_argument("--n-cycles", type=float, default=7.0, help="Number of Morlet wavelet cycles (default: 7)")
    parser.add_argument("--bandwidth", type=float, default=4.0, help="Multitaper bandwidth in Hz (default: 4)")
    parser.add_argument("--baseline", nargs=2, type=float, metavar=("TMIN", "TMAX"),
                        help="Baseline correction window in seconds (e.g., -0.2 0.0)")
    parser.add_argument("--channels", help="Comma-separated channel names to include (default: all MEG channels)")
    parser.add_argument("--picks", default="meg", help="Channel types to include: meg, eeg, mag, grad (default: meg)")
    parser.add_argument("--no-itc", action="store_true", help="Skip ITC computation")
    parser.add_argument("--format", default="nifti", choices=["nifti", "numpy", "fif"],
                        help="Output format (default: nifti)")
    args = parser.parse_args()

    epochs_path = Path(args.epochs).resolve()
    if not epochs_path.exists():
        print(f"Epochs file not found: {epochs_path}", file=sys.stderr)
        return 1

    # Load epochs
    print(f"Loading epochs: {epochs_path}")
    epochs = mne.read_epochs(str(epochs_path), preload=True)
    print(f"  {len(epochs)} epochs, {len(epochs.ch_names)} channels, {epochs.info['sfreq']} Hz")

    # Select channels
    if args.channels:
        ch_names = [c.strip() for c in args.channels.split(",")]
        epochs.pick(ch_names)
        print(f"  Selected channels: {ch_names}")
    else:
        epochs.pick(args.picks)

    # Build frequency array
    freqs = np.linspace(args.freq_min, args.freq_max, args.freq_steps)
    print(f"  Frequencies: {freqs[0]:.1f} - {freqs[-1]:.1f} Hz ({len(freqs)} steps)")

    # Parse baseline
    baseline = None
    if args.baseline:
        baseline = (args.baseline[0], args.baseline[1])
        print(f"  Baseline: [{baseline[0]}, {baseline[1]}] s")

    # Compute TFR
    output_dir = Path(args.output).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"\nComputing TFR ({args.method})...")
    if args.method == "morlet":
        power, itc = compute_tfr_morlet(
            epochs, freqs, n_cycles=args.n_cycles, baseline=baseline, return_itc=not args.no_itc,
        )
    else:
        power = compute_tfr_multitaper(
            epochs, freqs, bandwidth=args.bandwidth, baseline=baseline,
        )
        itc = None

    # Save results
    power_path = output_dir / "tfr_power"
    if args.format == "fif":
        power.save(str(power_path.with_suffix(".fif")), overwrite=True)
        print(f"  Power saved: {power_path.with_suffix('.fif')}")
    elif args.format == "numpy":
        np.save(str(power_path.with_suffix(".npy")), power.data)
        print(f"  Power saved: {power_path.with_suffix('.npy')} (shape: {power.data.shape})")
    else:
        # Save as NIfTI (convert 4D data: channels x freqs x times)
        try:
            import nibabel as nib
            data = power.data  # (n_channels, n_freqs, n_times)
            # Create a 4D NIfTI with singleton spatial dimensions
            nii_data = data.reshape(1, 1, data.shape[0], data.shape[1] * data.shape[2]) if data.ndim == 3 else data
            affine = np.eye(4)
            img = nib.Nifti1Image(nii_data, affine)
            nii_path = power_path.with_suffix(".nii.gz")
            nib.save(img, str(nii_path))
            print(f"  Power saved: {nii_path} (shape: {data.shape})")
        except ImportError:
            # Fallback to numpy
            np.save(str(power_path.with_suffix(".npy")), power.data)
            print(f"  Power saved (numpy fallback): {power_path.with_suffix('.npy')}")

    if itc is not None:
        itc_path = output_dir / "tfr_itc"
        if args.format == "fif":
            itc.save(str(itc_path.with_suffix(".fif")), overwrite=True)
        elif args.format == "numpy":
            np.save(str(itc_path.with_suffix(".npy")), itc.data)
        else:
            try:
                import nibabel as nib
                data = itc.data
                nii_data = data.reshape(1, 1, data.shape[0], data.shape[1] * data.shape[2]) if data.ndim == 3 else data
                img = nib.Nifti1Image(nii_data, np.eye(4))
                nib.save(img, str(itc_path.with_suffix(".nii.gz")))
            except ImportError:
                np.save(str(itc_path.with_suffix(".npy")), itc.data)
        print(f"  ITC saved: {itc_path}")

    # Print summary
    print(f"\nTFR Summary:")
    print(f"  Method: {args.method}")
    print(f"  Frequency range: {freqs[0]:.1f} - {freqs[-1]:.1f} Hz")
    print(f"  Time range: {power.times[0]:.3f} - {power.times[-1]:.3f} s")
    print(f"  Channels: {power.data.shape[0]}")
    print(f"  Power range: [{power.data.min():.2e}, {power.data.max():.2e}]")

    return 0


if __name__ == "__main__":
    sys.exit(main())
