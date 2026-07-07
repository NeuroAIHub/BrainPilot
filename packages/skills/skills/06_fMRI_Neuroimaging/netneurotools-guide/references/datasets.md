# netneurotools.datasets API Reference

## Table of Contents
- [Constants and Types](#constants-and-types)
- [Template Fetchers](#template-fetchers)
- [Atlas Fetchers](#atlas-fetchers)
- [Project Data Fetchers](#project-data-fetchers)
- [Utilities](#utilities)

---

## Constants and Types

```python
SURFACE = namedtuple("Surface", ("L", "R"))
```
Namedtuple pairing left (`L`) and right (`R`) hemisphere file paths. Used throughout the module.

```python
FREESURFER_IGNORE = ["unknown", "corpuscallosum", "Background+FreeSurfer_Defined_Medial_Wall"]
```
FreeSurfer label names typically excluded from analyses.

**Data directory resolution:** all fetchers check `data_dir` param, then `NNT_DATA` env var, then `~/nnt-data`.

---

## Template Fetchers

### fetch_fsaverage
```python
fetch_fsaverage(version="fsaverage", use_local=False, force=False, data_dir=None, verbose=1)
```
- `version`: `"fsaverage"` | `"fsaverage3"` | `"fsaverage4"` | `"fsaverage5"` | `"fsaverage6"`
- `use_local` (bool): use local FreeSurfer data instead of downloading
- `force` (bool): overwrite existing. `data_dir` (str|None): data path. `verbose` (int): verbosity.
- **Returns:** `Bunch` with keys `"orig"`, `"white"`, `"smoothwm"`, `"pial"`, `"inflated"`, `"sphere"`. Values are `SURFACE(L, R)` namedtuples with FreeSurfer-format surface filepaths.

### fetch_fsaverage_curated
```python
fetch_fsaverage_curated(version="fsaverage", force=False, data_dir=None, verbose=1)
```
- `version`: `"fsaverage"` | `"fsaverage4"` | `"fsaverage5"` | `"fsaverage6"` (no fsaverage3)
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"white"`, `"pial"`, `"inflated"`, `"sphere"`, `"medial"`, `"sulc"`, `"vaavg"`. Values are `SURFACE(L, R)` namedtuples with GIFTI filepaths. Sourced from neuromaps.

### fetch_hcp_standards
```python
fetch_hcp_standards(force=False, data_dir=None, verbose=1)
```
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `pathlib.Path` to the `standard_mesh_atlases` directory (spherical templates and vertex-area maps at 32k, 59k, 164k densities for FreeSurfer-to-fsLR conversion).

### fetch_fslr_curated
```python
fetch_fslr_curated(version="fslr32k", force=False, data_dir=None, verbose=1)
```
- `version`: `"fslr4k"` | `"fslr8k"` | `"fslr32k"` | `"fslr164k"`
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"midthickness"`, `"inflated"`, `"veryinflated"`, `"sphere"`, `"medial"`, `"sulc"`, `"vaavg"`. Values are `SURFACE(L, R)` GIFTI filepaths. `"veryinflated"` is absent for `"fslr4k"` and `"fslr8k"`.

### fetch_civet
```python
fetch_civet(density="41k", version="v1", force=False, data_dir=None, verbose=1)
```
- `density`: `"41k"` | `"164k"` (`"164k"` only exists for version `"v2"`)
- `version`: `"v1"` | `"v2"`. Default: `"v1"`.
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"mid"`, `"white"`. Values are `SURFACE(L, R)` namedtuples with OBJ filepaths. For `"v1"`, mid and white are identical.
- **Raises:** `ValueError` if `version="v1"` with `density="164k"`.

### fetch_civet_curated
```python
fetch_civet_curated(version="civet41k", force=False, data_dir=None, verbose=1)
```
- `version`: `"civet41k"` | `"civet164k"`
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"white"`, `"midthickness"`, `"inflated"`, `"veryinflated"`, `"sphere"`, `"medial"`, `"sulc"`, `"vaavg"`. Values are `SURFACE(L, R)` GIFTI filepaths.

### fetch_conte69
```python
fetch_conte69(force=False, data_dir=None, verbose=1)
```
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"midthickness"`, `"inflated"`, `"vinflated"`, `"info"`. First three are `SURFACE(L, R)` GIFTI filepaths. `"info"` is a dict from `template_description.json`. Conte69 is a population-average template in fsLR32k space.

### fetch_yerkes19
```python
fetch_yerkes19(force=False, data_dir=None, verbose=1)
```
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"midthickness"`, `"inflated"`, `"vinflated"`. Values are `SURFACE(L, R)` GIFTI filepaths. Yerkes19 is a macaque surface template in fsLR32k space.

---

## Atlas Fetchers

### fetch_aparc
```python
fetch_aparc(version="fsaverage", use_local=False, force=False, data_dir=None, verbose=1)
```
- `version`: `"fsaverage"` | `"fsaverage3"` | `"fsaverage4"` | `"fsaverage5"` | `"fsaverage6"`
- `use_local` (bool): use local FreeSurfer files instead of downloading.
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `SURFACE(L, R)` namedtuple with filepaths to Desikan-Killiany `.annot` annotation files.

### fetch_cammoun2012
```python
fetch_cammoun2012(version="MNI152NLin2009aSym", force=False, data_dir=None, verbose=1)
```
- `version`: `"gcs"` | `"fsaverage"` | `"fsaverage5"` | `"fsaverage6"` | `"fslr32k"` | `"MNI152NLin2009aSym"`
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"scale033"`, `"scale060"`, `"scale125"`, `"scale250"`, `"scale500"`. Value types vary by version:
  - `"MNI152NLin2009aSym"`: filepaths to `.nii.gz` files; also includes `"info"` key (CSV path)
  - `"fsaverage"`, `"fsaverage5"`, `"fsaverage6"`: `SURFACE(L, R)` with `.annot` files
  - `"fslr32k"`: `SURFACE(L, R)` with `.label.gii` files
  - `"gcs"`: lists of L/R `.gcs` filepaths; `"scale500"` has 6 files (3 sub-parcellations)

### fetch_schaefer2018
```python
fetch_schaefer2018(version="fsaverage", force=False, data_dir=None, verbose=1)
```
- `version`: `"fsaverage"` | `"fsaverage5"` | `"fsaverage6"` | `"fslr32k"`
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with 20 keys of format `"{n}Parcels{m}Networks"` (n: 100-1000 step 100, m: 7 or 17). For fsaverage versions: `SURFACE(L, R)` with `.annot` files. For `"fslr32k"`: filepaths to `.dlabel.nii` files.

### fetch_mmpall
```python
fetch_mmpall(version="fslr32k", force=False, data_dir=None, verbose=1)
```
- `version`: only `"fslr32k"` currently available.
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `SURFACE(L, R)` namedtuple with filepaths to Glasser MMPAll `.label.gii` files.

### fetch_pauli2018
```python
fetch_pauli2018(force=False, data_dir=None, verbose=1)
```
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"probabilistic"`, `"deterministic"`, `"info"`. First two are filepaths to `.nii.gz` subcortical atlas files (MNI152NLin2009cAsym space). `"info"` is a CSV filepath.

### fetch_voneconomo
```python
fetch_voneconomo(force=False, data_dir=None, verbose=1)
```
- `force` (bool), `data_dir` (str|None), `verbose` (int): standard download params.
- **Returns:** `Bunch` with keys `"gcs"`, `"ctab"`, `"info"`. `"gcs"` and `"ctab"` are `SURFACE(L, R)` with `.gcs` and `.ctab` filepaths. `"info"` is a CSV filepath.

### fetch_tian2020msa
```python
fetch_tian2020msa()
```
Stub -- not yet implemented. Returns `None`.

---

## Project Data Fetchers

All project data fetchers below share these parameters unless noted:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `force` | bool | `False` | Overwrite existing dataset |
| `data_dir` | str or None | `None` | Data directory path |
| `verbose` | int | `1` | Download verbosity |

### fetch_vazquez_rodriguez2019
```python
fetch_vazquez_rodriguez2019(force=False, data_dir=None, verbose=1)
```
**Returns:** `Bunch` with keys `"rsquared"` and `"gradient"`, each a 1-D numpy array from Vazquez-Rodriguez et al., 2019 (PNAS).

### fetch_mirchi2018
```python
fetch_mirchi2018(force=False, data_dir=None, verbose=1)
```
**Returns:** Tuple `(X, Y)`. `X`: `(73, 198135)` ndarray of functional connections (lower triangle of correlation matrices from MyConnectome rsfMRI). `Y`: `(73, 13)` structured ndarray with PANAS subscales: `"negative"`, `"positive"`, `"fear"`, `"hostility"`, `"guilt"`, `"sadness"`, `"joviality"`, `"self-assurance"`, `"attentiveness"`, `"shyness"`, `"fatigue"`, `"serenity"`, `"surprise"`.

### fetch_hansen_manynetworks
```python
fetch_hansen_manynetworks(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Hansen et al., 2023 (PLOS Biology) multimodal connectivity blueprints.

### fetch_hansen_receptors
```python
fetch_hansen_receptors(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Hansen et al., 2022 (Nature Neuroscience) neurotransmitter receptor mapping.

### fetch_hansen_genescognition
```python
fetch_hansen_genescognition(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Hansen et al., 2021 (Nature Human Behaviour) gene transcription and neurocognition.

### fetch_hansen_brainstemfc
```python
fetch_hansen_brainstemfc(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Hansen et al., 2024 (Nature Neuroscience) brainstem-cortical architecture.

### fetch_shafiei_megfmrimapping
```python
fetch_shafiei_megfmrimapping(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Shafiei et al., 2022 (PLOS Biology) MEG/fMRI mapping.

### fetch_shafiei_megdynamics
```python
fetch_shafiei_megdynamics(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Shafiei et al., 2023 (Nature Communications) neurophysiological cortical signatures.

### fetch_suarez_mami
```python
fetch_suarez_mami(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Suarez et al., 2022 (eLife) connectomics-based mammalian taxonomy.

### fetch_bazinet_assortativity
```python
fetch_bazinet_assortativity(force=False, data_dir=None, verbose=1)
```
**Returns:** `pathlib.Path` to downloaded dataset directory. Bazinet et al., 2023 (Nature Communications) assortative mixing in connectomes.

### fetch_famous_gmat
```python
fetch_famous_gmat(dataset, force=False, data_dir=None, verbose=1)
```
- `dataset` (str, **required**): one of `"celegans"`, `"drosophila"`, `"human_func_scale033"`, `"human_func_scale060"`, `"human_func_scale125"`, `"human_func_scale250"`, `"human_func_scale500"`, `"human_struct_scale033"`, `"human_struct_scale060"`, `"human_struct_scale125"`, `"human_struct_scale250"`, `"human_struct_scale500"`, `"macaque_markov"`, `"macaque_modha"`, `"mouse"`, `"rat"`
- **Returns:** `Bunch` with at minimum keys `"conn"`, `"labels"`, `"ref"` (connectivity matrix, region labels, reference string). Optional keys: `"dist"` (Euclidean distances), `"coords"` (xyz coordinates), `"acronyms"` (region acronyms), `"networks"` (network affiliations). Values are numpy arrays loaded from CSVs.

### fetch_neurosynth
```python
fetch_neurosynth()
```
Stub -- not yet implemented. Returns `None`.

---

## Utilities

### _get_freesurfer_subjid
```python
_get_freesurfer_subjid(subject_id, subjects_dir=None)
```
- `subject_id` (str): FreeSurfer subject ID (e.g., `"fsaverage"`, `"fsaverage5"`).
- `subjects_dir` (str|None): path to FreeSurfer subjects directory. Falls back to `$SUBJECTS_DIR` env var, then cwd.
- **Returns:** Tuple `(subject_id, subjects_dir)` -- the str ID and a `pathlib.Path`.
- If `subject_id` is an fsaverage variant not found locally, automatically calls `fetch_fsaverage()` to download it.
- **Raises:** `ValueError` if subject is not an fsaverage variant and cannot be found.
