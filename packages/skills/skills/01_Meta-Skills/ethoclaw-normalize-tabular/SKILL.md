---
name: ethoclaw-normalize-tabular
description: Check environment, inspect, and normalize local CSV, Excel, and HDF5 files into analysis-ready tabular outputs.
metadata: { "openclaw": { "emoji": "🧾", "requires": { "bins": ["python3"] } } }
---

# Normalize Tabular

Use this skill when the user wants to inspect, clean, standardize, or convert local `.csv`, `.xlsx`, `.xls`, `.h5`, or `.hdf5` files into a more analysis-friendly tabular format.

Prefer deterministic local conversion through the bundled script instead of doing large manual transformations in-model.

## Bundled Tool

This skill expects the following helper script to exist:

- `scripts/normalize_data.py`

The script supports three commands:

- `check-env`
- `inspect`
- `convert`

Examples:

```bash
python3 "{baseDir}/scripts/normalize_data.py" check-env
python3 "{baseDir}/scripts/normalize_data.py" inspect "/path/to/data.csv"
python3 "{baseDir}/scripts/normalize_data.py" convert "/path/to/data.csv" --out "/path/to/out"
python3 "{baseDir}/scripts/normalize_data.py" convert "/path/to/data.xlsx" --sheet "Sheet1" --out "/path/to/out"
python3 "{baseDir}/scripts/normalize_data.py" convert "/path/to/data.h5" --dataset "pose" --out "/path/to/out"
```

## Default Workflow

Follow this sequence unless the user explicitly wants only an environment check.

### 1. Check Environment First

Run:

```bash
python3 "{baseDir}/scripts/normalize_data.py" check-env
```

If required Python packages are missing, stop before conversion and explain the missing dependencies and install hint.

### 2. Validate The Input Path

Confirm the referenced local file exists.

### 3. Inspect First

Run:

```bash
python3 "{baseDir}/scripts/normalize_data.py" inspect "<input>"
```

Summarize the result for the user:

- detected source format
- rows and columns for CSV and Excel when available
- sheet names for Excel
- dataset names and shapes for HDF5

### 4. Decide Whether Conversion Is Safe

Convert immediately only when the source is unambiguous.

Unambiguous means:

- CSV: directly convertible
- Excel: only one sheet, or the user explicitly named the sheet
- HDF5: only one usable dataset, or the user explicitly named the dataset

### 5. Convert

When safe, run:

```bash
python3 "{baseDir}/scripts/normalize_data.py" convert "<input>" --out "<out_dir>"
```

If needed, include:

```bash
--sheet "<sheet_name>"
--dataset "<dataset_name>"
```

### 6. Report The Result

Always return:

- environment status
- what was detected
- what was converted
- output file paths
- notable layout or schema details
- warnings, fallbacks, or unsupported structures

## Ambiguity Rules

Do not guess silently when structure is ambiguous.

### Excel

If the workbook has multiple sheets:

- do not silently pick one
- list available sheets
- recommend the most likely rectangular data sheet if there is a clear candidate
- ask one focused follow-up only if needed

### HDF5

If the file has multiple datasets:

- do not silently pick one
- list available datasets and shapes
- recommend the most likely tabular or pose dataset if there is a clear candidate
- ask one focused follow-up only if needed

## HDF5 Rules

Never assume all HDF5 files are plain tables.

Possible structures include:

- 1D vectors
- 2D tables
- structured arrays
- pose tensors such as `(frame, point, 2)` or `(frame, point, 3)`
- higher-dimensional non-tabular arrays

Rules:

- only convert automatically when the script supports the detected structure safely
- never silently flatten unsupported higher-dimensional arrays
- report unsupported structures clearly

## Output Contract

Prefer this output package:

```text
<out_dir>/
  normalized/
    <name>.parquet
  schemas/
    <name>.schema.json
  reports/
    <name>.report.json
```

If parquet writing fails, a CSV fallback is acceptable.

## Dependencies

Typical Python packages:

```bash
python3 -m pip install pandas openpyxl pyarrow h5py
```

## OpenClaw Compatibility Notes

- Keep this skill self-contained
- Prefer the bundled script over ad hoc in-model table rewriting
- Keep YAML frontmatter minimal for compatibility
- If `{baseDir}` is not expanded by your runtime, replace it with the absolute path to this skill folder
