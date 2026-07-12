# Susceptibility Distortion Correction (SDC) & Fieldmaps

Echo-planar imaging (EPI) suffers from spatial distortion caused by B0 field
inhomogeneity, most visible near air-tissue boundaries (orbitofrontal, temporal
lobes). fMRIPrep applies SDC automatically when it can identify a compatible
fieldmap, or on request (fieldmap-less SyN) when it cannot.

SDC in fMRIPrep is delegated to the **SDCFlows** package. Full theoretical
reference: https://www.nipreps.org/sdcflows/master/api/sdcflows.workflows.fit.fieldmap.html

## Table of Contents
1. [Supported fieldmap types](#supported-fieldmap-types)
2. [How fMRIPrep pairs a fieldmap to a BOLD run](#how-fmriprep-pairs-a-fieldmap-to-a-bold-run)
3. [Estimator selection order](#estimator-selection-order)
4. [Fieldmap-less SDC (SyN)](#fieldmap-less-sdc-syn)
5. [Relevant CLI flags](#relevant-cli-flags)
6. [BIDS fieldmap examples](#bids-fieldmap-examples)
7. [Troubleshooting](#troubleshooting)
8. [Outputs related to SDC](#outputs-related-to-sdc)

---

## Supported fieldmap types

| Type | BIDS `suffix` | Estimator | Notes |
|------|----------------|-----------|-------|
| **PEPOLAR** | `epi` (opposite phase-encoding EPI) | FSL `topup` | Preferred when available; robust, no phase-unwrapping issues |
| **Phase difference + magnitude** | `phasediff` + `magnitude1` (+ optional `magnitude2`) | FSL `prelude` → `fugue` | Requires `EchoTime1` and `EchoTime2` in JSON |
| **Two-phase + magnitude** | `phase1` + `phase2` + `magnitude1` + `magnitude2` | FSL `prelude` → `fugue` | Older Siemens variant |
| **Direct fieldmap** | `fieldmap` + `magnitude` | FSL `fugue` | User-supplied Hz fieldmap |
| **Fieldmap-less** | none — anatomical prior | ANTs SyN vs T1w | Enable with `--use-syn-sdc` or `--force syn-sdc` |

BIDS fieldmap spec:
https://bids-specification.readthedocs.io/en/stable/04-modality-specific-files/01-magnetic-resonance-imaging-data.html#types-of-fieldmaps

---

## How fMRIPrep pairs a fieldmap to a BOLD run

Two mechanisms — **SDCFlows prefers `B0FieldIdentifier` and IGNORES `IntendedFor` if present anywhere in the dataset.**

### 1. `B0FieldIdentifier` / `B0FieldSource` (preferred, BIDS ≥1.6)

Add to the fieldmap JSON:

```json
{
  "B0FieldIdentifier": "TOPUP_AP_PA"
}
```

Add to every BOLD JSON it applies to:

```json
{
  "B0FieldSource": "TOPUP_AP_PA"
}
```

Any string ID works — pick one per session/acquisition.

### 2. `IntendedFor` (legacy)

Add to the fieldmap JSON — a list of BIDS-relative paths to BOLD runs it corrects:

```json
{
  "IntendedFor": [
    "ses-01/func/sub-01_ses-01_task-rest_run-01_bold.nii.gz",
    "ses-01/func/sub-01_ses-01_task-task_run-01_bold.nii.gz"
  ]
}
```

Paths are relative to the subject folder. Use forward slashes.

⚠️ **Mixing is dangerous**: if ANY fieldmap in the dataset has
`B0FieldIdentifier`, `IntendedFor` is ignored EVERYWHERE. Choose one strategy
per dataset.

---

## Estimator selection order

When multiple compatible fieldmaps are present, SDCFlows picks by priority
(higher is preferred):

1. PEPOLAR (`epi` suffix pair, opposite `PhaseEncodingDirection`) — most robust.
2. Phase-difference (`phasediff` + `magnitude1`).
3. Two-phase (`phase1` + `phase2` + magnitudes).
4. Direct fieldmap (`fieldmap` + `magnitude`).

If none matches AND `--use-syn-sdc` / `--force syn-sdc` is set → SyN fallback.

---

## Fieldmap-less SDC (SyN)

Uses ANTs SyN to nonlinearly register the *distorted* BOLD reference to the
*undistorted* T1w, allowing displacements only in the phase-encoding
direction. Requires the T1w-space template (`MNI152NLin2009cAsym`) to be
available locally.

### `--use-syn-sdc [warn|error]`

Enable SyN **only when no other fieldmap is available**. If SyN cannot run
(e.g., missing PE direction metadata), the argument controls the fallback:

- `warn` — log a warning, skip SDC, continue.
- `error` (default when flag is used) — fail hard.

Example:

```bash
--use-syn-sdc error   # crash if SyN fails
--use-syn-sdc warn    # limp along without SDC
```

### `--force syn-sdc`

**In addition to** any fieldmap already present. Useful for method comparison
or robustness checks.

```bash
--force syn-sdc
```

Requirements for SyN to work:
- `PhaseEncodingDirection` must be present in the BOLD JSON (e.g. `"j-"`).
- The anatomical must be adequately preprocessed (fMRIPrep does this).

---

## Relevant CLI flags

| Flag | Effect |
|------|--------|
| `--ignore fieldmaps` | Skip SDC entirely. Only use to test if a fieldmap is the source of an issue. |
| `--use-syn-sdc [warn|error]` | Enable SyN fallback when no fieldmap present. |
| `--force syn-sdc` | Add SyN in addition to fieldmap-based SDC. |
| `--fmap-bspline` | Fit fieldmap as a B-Spline field (experimental). Improves SNR on noisy fieldmaps. |
| `--fmap-no-demean` | Do NOT subtract the within-mask median from the fieldmap (default is to demean). |
| `--ignore fmap-jacobian` | Don't apply Jacobian modulation of BOLD after SDC. |
| `--force fmap-jacobian` | Force Jacobian modulation (defaults are auto per fieldmap type). |
| `--fallback-total-readout-time` | Fallback TRT if metadata is missing. Number of seconds, or the string `"estimated"`. |

---

## BIDS fieldmap examples

### PEPOLAR (recommended for new acquisitions)

```
sub-01/
    ses-01/
        fmap/
            sub-01_ses-01_dir-AP_epi.nii.gz
            sub-01_ses-01_dir-AP_epi.json
            sub-01_ses-01_dir-PA_epi.nii.gz
            sub-01_ses-01_dir-PA_epi.json
```

`sub-01_ses-01_dir-AP_epi.json`:
```json
{
  "PhaseEncodingDirection": "j-",
  "TotalReadoutTime": 0.03,
  "B0FieldIdentifier": "TOPUP_PA_AP"
}
```

`sub-01_ses-01_dir-PA_epi.json`:
```json
{
  "PhaseEncodingDirection": "j",
  "TotalReadoutTime": 0.03,
  "B0FieldIdentifier": "TOPUP_PA_AP"
}
```

Then every BOLD JSON in that session:
```json
{
  "PhaseEncodingDirection": "j-",
  "TotalReadoutTime": 0.03,
  "B0FieldSource": "TOPUP_PA_AP",
  "TaskName": "rest",
  "RepetitionTime": 2.0
}
```

### Phase-difference

```
sub-01/
    ses-01/
        fmap/
            sub-01_ses-01_magnitude1.nii.gz
            sub-01_ses-01_magnitude2.nii.gz
            sub-01_ses-01_phasediff.nii.gz
            sub-01_ses-01_phasediff.json
```

`sub-01_ses-01_phasediff.json`:
```json
{
  "EchoTime1": 0.00492,
  "EchoTime2": 0.00738,
  "B0FieldIdentifier": "PHASE_DIFF"
}
```

### Direct fieldmap in Hz

```
sub-01/fmap/
    sub-01_fieldmap.nii.gz          # in Hz
    sub-01_fieldmap.json            # includes Units:"Hz"
    sub-01_magnitude.nii.gz
```

---

## Troubleshooting

### "SDCFlows could not compute a fieldmap"

Common causes:
- Missing `PhaseEncodingDirection` or `TotalReadoutTime` in BOLD or fieldmap
  JSON. Add them — they're required by BIDS and by SDCFlows.
- Both `B0FieldIdentifier` and `IntendedFor` are set inconsistently — pick
  one strategy.
- Phase-diff data is missing `EchoTime1`/`EchoTime2`.

### "IntendedFor works standalone but stops working after adding another fieldmap"

That other fieldmap almost certainly has a `B0FieldIdentifier` — SDCFlows
switches to the new-style mechanism the moment *any* B0 identifier is present.
Add `B0FieldIdentifier`/`B0FieldSource` everywhere, or remove them everywhere.

### "TOPUP fails / bad output"

- Confirm the two `dir-` EPIs are truly opposite (e.g., `AP` and `PA`).
- Confirm both have the same acquisition parameters (matrix, resolution, TR).
- Try `--fmap-bspline` if the field is noisy.

### "SyN-SDC unwarping looks wrong"

- Check `PhaseEncodingDirection` — is `j-` correct, or should it be `j`?
  Flipping causes exactly-wrong displacement.
- Check the SDC overlay in the visual report — it should look better, not
  worse, than the uncorrected image.

### "Fieldmap looks correct but BOLD is still distorted"

- Confirm the fieldmap is actually paired to the BOLD (report should show the
  fmap→BOLDref transform).
- Try `--ignore fieldmaps` to confirm it's a fmap issue vs. something else.

### `--ignore fieldmaps` — when to use

Only for diagnosis. Never publish results from a run that ignored a fieldmap
if a fieldmap was acquired — that's uncorrected geometric distortion.

---

## Outputs related to SDC

**Estimated fieldmap** (if computed):
- Stored in the working directory (not by default in derivatives).
- Add `--debug fieldmaps` to expose intermediate fieldmap files.

**BOLDref → fieldmap transform** (in `sub-XX/func/`):

```
# B0FieldIdentifier-based:
sub-<label>_[specifiers]_from-boldref_to-TOPUP_PA_AP_mode-image_xfm.txt

# IntendedFor-based (auto-generated ID):
sub-<label>_[specifiers]_from-boldref_to-auto00001_mode-image_xfm.txt
```

**Corrected BOLD reference** (part of `--level minimal`):

```
sub-<label>_[specifiers]_desc-hmc_boldref.nii.gz
sub-<label>_[specifiers]_desc-coreg_boldref.nii.gz    # after SDC + BBR
```

**Visual reportlet** — the SDC animation swipes before/after unwarping,
overlaid on the target anatomical. Inspect for every run.

---

## Reading the report's SDC panel

The per-run SDC panel shows:

- **Before/after animation** — the corrected BOLD reference should match
  anatomical structures better than the pre-corrected one, especially in
  the OFC / temporal lobes.
- **Fieldmap magnitude overlay** — verify the estimated field is smooth and
  bounded (typical: ±100 Hz peak).
- **Method identifier** — indicates which estimator ran (`TOPUP`, `PhaseDiff`,
  `SyN`, etc.). If you expected `TOPUP` but got `SyN`, your fieldmap wasn't
  paired correctly.
