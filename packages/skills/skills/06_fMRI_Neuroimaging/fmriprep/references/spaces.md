# Output Spaces & TemplateFlow

`--output-spaces` controls where fMRIPrep resamples anatomical + BOLD
derivatives. It accepts a **space-separated list** of tokens. Each token is:

```
<SPACE>[:cohort-<label>][:res-<idx>][:den-<idx>][:...]
```

## Table of Contents
1. [Default behavior](#default-behavior)
2. [Standard spaces (TemplateFlow)](#standard-spaces-templateflow)
3. [Modifiers: `res-`, `cohort-`, `den-`, `atlas-`](#modifiers-res--cohort--den--atlas-)
4. [Nonstandard spaces (`T1w`, `anat`, `fsnative`, `func`, ...)](#nonstandard-spaces-t1w-anat-fsnative-func-)
5. [Surface spaces](#surface-spaces)
6. [Custom templates](#custom-templates)
7. [Implicit spaces required by other flags](#implicit-spaces-required-by-other-flags)
8. [Pre-fetching templates (offline / HPC)](#pre-fetching-templates-offline--hpc)
9. [Common recipes](#common-recipes)

---

## Default behavior

If `--output-spaces` is omitted:

```
--output-spaces MNI152NLin2009cAsym:res-native
```

- `MNI152NLin2009cAsym` = MNI non-linear 2009c asymmetric — fMRIPrep's
  internal reference.
- `res-native` = keep the original BOLD grid rather than resample to a
  template resolution.

The bare invocation `--output-spaces` (no tokens) is meaningful: it disables
BOLD resampling entirely. Only anatomical + transforms are written.

Whatever you list, fMRIPrep also keeps at least the *internal* reference
(`MNI152NLin2009cAsym`) even if it's not in the list — but that reference is
NOT saved to derivatives unless you include it.

---

## Standard spaces (TemplateFlow)

Bundled with the container (or fetched on demand). Common IDs:

| Space | Description | Notes |
|-------|-------------|-------|
| `MNI152NLin2009cAsym` | MNI152 non-linear 2009c asymmetric — **fMRIPrep default** | Res 1 = 1 mm, res 2 = 2 mm |
| `MNI152NLin6Asym` | FSL's MNI152 non-linear 6-generation asymmetric | Required for CIFTI output |
| `MNI152NLin6Sym` | Symmetric version | Rare |
| `MNI152Lin` | Linear MNI152 (SPM) | Legacy |
| `OASIS30ANTs` | ANTs' Oxford Aging Study 30 | Skull-strip default |
| `NKI` | Enhanced Nathan Kline Institute template | |
| `PNC` | Philadelphia Neurodevelopmental Cohort | |
| `MNIPediatricAsym` | Pediatric MNI, multi-cohort by age | Use `cohort-N` (see below) |
| `MNIInfant` | Infant template, multi-cohort | Use `cohort-N` |
| `UNCInfant` | UNC infant | Use `cohort-N` |
| `fsLR` | HCP-style fsLR mesh (32k or 164k) | Surface only |
| `fsaverage` | FreeSurfer average | Surface only (default den-10k = fsaverage5) |
| `fsaverage5` | 10k mesh (legacy alias for `fsaverage:den-10k`) | Surface |
| `fsaverage6` | 41k mesh (legacy alias for `fsaverage:den-41k`) | Surface |

Full template catalog: https://www.templateflow.org

Wrapper's built-in whitelist (`TF_TEMPLATES` in `wrapper/src/fmriprep_docker/__main__.py`):
`MNI152Lin`, `MNI152NLin2009cAsym`, `MNI152NLin6Asym`, `MNI152NLin6Sym`,
`MNIInfant`, `MNIPediatricAsym`, `NKI`, `OASIS30ANTs`, `PNC`, `UNCInfant`,
`fsLR`, `fsaverage`, `fsaverage5`, `fsaverage6`.

Anything outside this list is treated as a custom template by the wrapper — it
must live in `$TEMPLATEFLOW_HOME` or be pointed to as a filesystem path (which
the wrapper bind-mounts).

---

## Modifiers: `res-`, `cohort-`, `den-`, `atlas-`

Colon-separated modifiers control which template variant / resolution is used
for that entry. Modifiers may be combinatorial (multiple `res-`, multiple `cohort-`).

### `res-<idx>`

**Resolution INDEX in TemplateFlow — NOT millimeters.** Look up what each
index means in the template's `template_description.json`.

Common:
- `MNI152NLin2009cAsym:res-1` → 1 mm
- `MNI152NLin2009cAsym:res-2` → 2 mm
- `MNI152NLin6Asym:res-2` → 2 mm
- `MNI152NLin6Asym:res-3` → **0.5 mm** (not 3 mm!) — always verify

Aliases:
- `res-native` — keep the original BOLD grid (no template resampling).
- `res-*` combined with another (e.g. `MNIPediatricAsym:res-native:res-1`) generates BOTH.

### `cohort-<label>`

Used by multi-cohort templates (pediatric, infant). Example:

```
--output-spaces MNIPediatricAsym:cohort-2:res-1
```

`cohort-2` for MNIPediatricAsym = prepuberty phase (4.5–8.5 y). See the
template description JSON at
https://github.com/templateflow/tpl-MNIPediatricAsym.

Combinatorial: `MNIPediatricAsym:cohort-1:cohort-2:res-native:res-1` →
4 variants (2 cohorts × 2 resolutions).

### `den-<idx>` (surfaces only)

Surface density. Common:

- `fsaverage:den-10k` = fsaverage5 (10,242 vertices/hemi)
- `fsaverage:den-41k` = fsaverage6 (40,962 vertices/hemi)
- `fsaverage:den-164k` = full fsaverage (163,842 vertices/hemi)
- `fsLR:den-32k` = HCP 32k mesh (default for CIFTI 91k output)
- `fsLR:den-164k` = HCP 164k mesh

Prefer the `den-` form over the legacy `fsaverageN` names.

### `atlas-<label>` and others

Some template variants come with an atlas modifier (e.g., HCP atlas). Rarely
needed by end users.

---

## Nonstandard spaces (`T1w`, `anat`, `fsnative`, `func`, ...)

Non-template outputs; **modifiers are NOT allowed** on these:

| Token | Meaning | Output surface/volume? |
|-------|---------|-----------------------|
| `T1w` / `anat` | Subject's native anatomical (T1w) reference | Volume |
| `fsnative` | FreeSurfer's subject-specific cortical mesh | Surface |
| `func` / `bold` / `run` / `boldref` / `sbref` | Original BOLD grid, after STC/HMC/SDC | Volume (**experimental** — expected to change) |

`T1w` and `anat` are aliases in current versions. `func` and friends are for
downstream tools that want the corrected native-BOLD-grid data.

---

## Surface spaces

- **`fsnative`** — subject's original cortical mesh (varies per subject).
- **`fsaverage[:den-10k|41k|164k]`** — FreeSurfer's standard template.
- **`fsLR[:den-32k|164k]`** — HCP-style mesh with aligned L/R hemispheres.

CIFTI output requires `fsLR:den-32k` (91k) or `fsLR:den-91k`-equivalent (170k)
internally; it's added automatically when `--cifti-output` is set.

---

## Custom templates

### Via TemplateFlow home

Put a directory named `tpl-<Name>/` under `$TEMPLATEFLOW_HOME`:

```
$TEMPLATEFLOW_HOME/
    tpl-MyCustom/
        template_description.json
        tpl-MyCustom_res-1_T1w.nii.gz
        tpl-MyCustom_res-1_desc-brain_mask.nii.gz
        tpl-MyCustom_res-2_T1w.nii.gz
        tpl-MyCustom_res-2_desc-brain_mask.nii.gz
```

Then reference it in `--output-spaces MyCustom:res-1`.

Minimum required files:
- `template_description.json` (identifies the template)
- `tpl-<Name>_res-<idx>_T1w.nii.gz` (one per resolution)
- `tpl-<Name>_res-<idx>_desc-brain_mask.nii.gz` (one per resolution)

Full guide: https://www.templateflow.org/python-client/tutorials.html

### Via filesystem path (wrapper only)

```bash
fmriprep-docker /data /out participant \
    --output-spaces /home/me/tpl-MyCustom:res-1 \
    -w /work
```

The wrapper bind-mounts `/home/me/tpl-MyCustom` into
`/home/fmriprep/.cache/templateflow/tpl-MyCustom` inside the container and
strips the `tpl-` prefix when passing the flag on.

**Restriction**: custom template folders must be prefixed `tpl-` for the
wrapper to accept them.

---

## Implicit spaces required by other flags

Even if you don't list them, fMRIPrep will add these internally when needed:

| Flag | Implicit space |
|------|----------------|
| Always | `MNI152NLin2009cAsym` (skull-strip fallback + reference frame) |
| No `--skull-strip-template` override | `OASIS30ANTs` |
| `--cifti-output` | `MNI152NLin6Asym` (for the CIFTI subcortical grid) |
| `--use-syn-sdc` / `--force syn-sdc` | `MNI152NLin2009cAsym` (SyN prior) |

Templates added implicitly are **not** saved to derivatives — you have to list
them in `--output-spaces` to get outputs.

---

## Pre-fetching templates (offline / HPC)

Compute nodes are often offline. TemplateFlow downloads templates on demand,
so pre-populate the cache from a login node:

```bash
# One-time on a network-connected host
export TEMPLATEFLOW_HOME=$HOME/.cache/templateflow
python -m pip install --user templateflow

python <<'EOF'
from templateflow.api import get
for tpl in [
    "MNI152NLin2009cAsym",
    "MNI152NLin6Asym",
    "OASIS30ANTs",
    "MNIPediatricAsym",
    "MNIInfant",
    "fsaverage",
    "fsLR",
]:
    get(tpl)
EOF
```

Or use the helper script bundled in the fMRIPrep repo:

```bash
wget https://raw.githubusercontent.com/nipreps/fmriprep/master/scripts/fetch_templates.py
python fetch_templates.py --tf-dir /shared/templateflow
```

`fetch_templates.py` pulls:
- `MNI152NLin2009cAsym` (T1w, T2w, brain mask, carpet dseg, fMRIPrep boldref, brain probseg — res 1 and 2)
- `MNI152NLin6Asym` (T1w, brain mask, HCP atlas dseg — res 1 and 2)
- `OASIS30ANTs` (T1w, WM/BS/brain probseg, brain mask, BrainCerebellumExtraction mask)
- `fsaverage` (164k sphere, midthickness, sulc)
- `fsLR` (32k density — sphere, midthickness, dparc, etc.)

Then bind-mount into the container:

```bash
# Docker
-v $HOME/.cache/templateflow:/home/fmriprep/.cache/templateflow

# Apptainer
-B $HOME/.cache/templateflow:/opt/templateflow --env TEMPLATEFLOW_HOME=/opt/templateflow
```

---

## Common recipes

### Only MNI, ready for group analysis in SPM/FSL

```
--output-spaces MNI152NLin2009cAsym:res-2
```

### Volumetric MNI + native anat for QC

```
--output-spaces MNI152NLin2009cAsym:res-2 anat
```

### Both MNI152NLin2009c (default) AND MNI152NLin6 (FSL/HCP compatible)

```
--output-spaces MNI152NLin2009cAsym:res-2 MNI152NLin6Asym:res-2
```

### HCP-style: surface + CIFTI

```
--output-spaces MNI152NLin6Asym:res-2 fsLR fsaverage:den-10k
--cifti-output 91k
```

### Multi-resolution for method comparisons

```
--output-spaces \
    MNI152NLin2009cAsym:res-1 MNI152NLin2009cAsym:res-2 MNI152NLin2009cAsym:res-native
```

### Pediatric study, multiple cohorts

```
--output-spaces MNIPediatricAsym:cohort-1:res-1 MNIPediatricAsym:cohort-2:res-1
```

### Infant study

```
--output-spaces MNIInfant:cohort-1:res-2 UNCInfant:cohort-1:res-2
```

### Surface-only (skip volumetric BOLD)

```
--output-spaces fsaverage:den-10k fsnative
```

### Absolutely no BOLD resampling (transforms and reports only)

```
--output-spaces
```

(pass the flag with no arguments — only anatomical outputs and transforms are saved)

### Custom template alongside standard

```
--output-spaces MNI152NLin2009cAsym:res-2 MyLabTemplate:res-1
```

(with `MyLabTemplate` prepared under `$TEMPLATEFLOW_HOME/tpl-MyLabTemplate/`)
