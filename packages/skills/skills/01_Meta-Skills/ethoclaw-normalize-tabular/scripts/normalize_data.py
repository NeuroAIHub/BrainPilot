#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import platform
import re
import sys
from pathlib import Path
from typing import Any

try:
    import pandas as pd
except ImportError:
    pd = None

try:
    import h5py
except ImportError:
    h5py = None


SCRIPT_VERSION = "1.1.0"

SUPPORTED_FORMATS = {
    ".csv": "csv",
    ".xlsx": "excel",
    ".xls": "excel",
    ".h5": "hdf5",
    ".hdf5": "hdf5",
}

NULL_MARKERS = {"", "na", "n/a", "null", "none", "nan"}
HDF5_LABEL_ATTRS = ("bodyparts", "keypoints", "points", "node_names", "labels")
HDF5_COLUMN_ATTRS = ("columns", "column_names", "feature_names", "fields")


def ensure_pandas() -> None:
    if pd is None:
        raise RuntimeError(
            "Missing dependency: pandas. Install with "
            "`python3 -m pip install pandas openpyxl pyarrow`."
        )


def ensure_h5py() -> None:
    if h5py is None:
        raise RuntimeError(
            "Missing dependency: h5py. Install with "
            "`python3 -m pip install h5py`."
        )


def has_module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def check_env() -> dict[str, Any]:
    modules = {
        "pandas": has_module("pandas"),
        "openpyxl": has_module("openpyxl"),
        "pyarrow": has_module("pyarrow"),
        "h5py": has_module("h5py"),
    }
    required_for_any = {"pandas": modules["pandas"]}
    ok = all(required_for_any.values())

    return {
        "ok": ok,
        "command": "check-env",
        "script_version": SCRIPT_VERSION,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "dependencies": modules,
        "format_support": {
            "csv": modules["pandas"],
            "excel": modules["pandas"] and modules["openpyxl"],
            "hdf5": modules["pandas"] and modules["h5py"],
            "parquet_output": modules["pandas"] and modules["pyarrow"],
        },
        "install_hint": "python3 -m pip install pandas openpyxl pyarrow h5py",
    }


def infer_source_format(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_FORMATS:
        raise ValueError(
            f"Unsupported file type: {suffix}. "
            f"Supported: {sorted(SUPPORTED_FORMATS.keys())}"
        )
    return SUPPORTED_FORMATS[suffix]


def snake_case(text: str) -> str:
    text = str(text).strip()
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
    text = re.sub(r"[\s./-]+", "_", text)
    text = re.sub(r"[^0-9a-zA-Z_]+", "", text)
    text = re.sub(r"_+", "_", text)
    text = text.strip("_").lower()
    return text or "col"


def sanitize_name_fragment(text: str) -> str:
    return snake_case(text.replace("/", "_").replace("\\", "_"))


def flatten_column_name(value: Any) -> str:
    if isinstance(value, tuple):
        parts = [str(part).strip() for part in value if str(part).strip()]
        return "_".join(parts) if parts else "col"
    return str(value)


def dedupe_names(names: list[str]) -> list[str]:
    seen: dict[str, int] = {}
    output: list[str] = []

    for name in names:
        count = seen.get(name, 0)
        seen[name] = count + 1
        output.append(name if count == 0 else f"{name}_{count + 1}")

    return output


def normalize_columns(columns: list[Any]) -> tuple[list[str], list[dict[str, str]]]:
    flattened = [flatten_column_name(col) for col in columns]
    normalized = [snake_case(col) for col in flattened]
    deduped = dedupe_names(normalized)

    mappings = [
        {"original": str(original), "normalized": final}
        for original, final in zip(flattened, deduped)
    ]
    return deduped, mappings


def to_jsonable(value: Any) -> Any:
    if pd is not None and value is pd.NA:
        return None

    if isinstance(value, Path):
        return str(value)

    if isinstance(value, bytes):
        return value.decode("utf-8", errors="ignore")

    if isinstance(value, (str, int, float, bool)) or value is None:
        return value

    if hasattr(value, "item") and not isinstance(value, (str, bytes, bytearray)):
        try:
            return to_jsonable(value.item())
        except Exception:
            pass

    if hasattr(value, "tolist"):
        try:
            return to_jsonable(value.tolist())
        except Exception:
            pass

    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [to_jsonable(v) for v in value]

    return str(value)


def normalize_string_or_null(value: Any) -> Any:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped.lower() in NULL_MARKERS:
            return pd.NA
        return stripped
    return value


def normalize_string_columns(df: "pd.DataFrame") -> "pd.DataFrame":
    output = df.copy()

    for column in output.columns:
        series = output[column]
        if pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series):
            output[column] = series.map(normalize_string_or_null)

    output = output.dropna(how="all")
    return output


def preview_records(df: "pd.DataFrame", limit: int = 5) -> list[dict[str, Any]]:
    records = df.head(limit).to_dict(orient="records")
    return to_jsonable(records)


def classify_hdf5_shape(shape: list[int]) -> str:
    if len(shape) == 0:
        return "scalar"
    if len(shape) == 1:
        return "vector"
    if len(shape) == 2:
        return "matrix"
    if len(shape) == 3 and shape[-1] in (2, 3):
        return "pose_tensor"
    return "other"


def score_hdf5_candidate(dataset_summary: dict[str, Any]) -> tuple[int, int]:
    kind = dataset_summary.get("kind", "other")
    shape = dataset_summary.get("shape", [])
    size = 1
    for value in shape:
        size *= int(value)

    if kind == "matrix":
        return (40, size)
    if kind == "pose_tensor":
        return (35, size)
    if kind == "vector":
        return (20, size)
    if kind == "scalar":
        return (10, size)
    return (0, size)


def pick_recommended_sheet(sheet_summaries: list[dict[str, Any]]) -> str | None:
    candidates = [item for item in sheet_summaries if "rows" in item and "column_count" in item]
    if not candidates:
        return None

    discouraged = {"summary", "meta", "metadata", "readme", "info"}

    def score(item: dict[str, Any]) -> tuple[int, int]:
        name = snake_case(item["sheet"])
        penalty = 0 if name not in discouraged else -1
        area = int(item.get("rows", 0)) * max(int(item.get("column_count", 0)), 1)
        return (penalty, area)

    return max(candidates, key=score)["sheet"]


def decode_text_list(value: Any) -> list[str] | None:
    value = to_jsonable(value)
    if not isinstance(value, list):
        return None
    return [snake_case(str(item)) for item in value]


def get_hdf5_axis_labels(attrs: dict[str, Any], width: int) -> list[str] | None:
    for key in HDF5_LABEL_ATTRS:
        if key in attrs:
            labels = decode_text_list(attrs[key])
            if labels and len(labels) == width:
                return labels
    return None


def get_hdf5_column_names(attrs: dict[str, Any], width: int) -> list[str] | None:
    for key in HDF5_COLUMN_ATTRS:
        if key in attrs:
            labels = decode_text_list(attrs[key])
            if labels and len(labels) == width:
                return dedupe_names(labels)
    return None


def inspect_hdf5(path: Path) -> list[dict[str, Any]]:
    ensure_h5py()
    datasets: list[dict[str, Any]] = []

    with h5py.File(path, "r") as handle:

        def visitor(name: str, obj: Any) -> None:
            if isinstance(obj, h5py.Dataset):
                shape = list(obj.shape)
                datasets.append(
                    {
                        "path": name,
                        "shape": shape,
                        "ndim": len(shape),
                        "dtype": str(obj.dtype),
                        "kind": classify_hdf5_shape(shape),
                        "attr_keys": sorted(str(key) for key in obj.attrs.keys()),
                    }
                )

        handle.visititems(visitor)

    datasets.sort(key=lambda item: item["path"])
    return datasets


def inspect_csv_stdlib(path: Path) -> dict[str, Any]:
    encodings = ("utf-8", "utf-8-sig", "gb18030", "latin1")
    last_error: Exception | None = None

    for encoding in encodings:
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                sample = handle.read(4096)
                handle.seek(0)
                try:
                    dialect = csv.Sniffer().sniff(sample)
                    delimiter = dialect.delimiter
                except Exception:
                    delimiter = ","

                reader = csv.reader(handle, delimiter=delimiter)
                header = next(reader)
                preview = []
                data_rows = 0
                for row in reader:
                    data_rows += 1
                    if len(preview) < 5:
                        preview.append(row)

            return {
                "path": str(path),
                "source_format": "csv",
                "rows": data_rows,
                "column_count": len(header),
                "columns": header,
                "preview": preview,
                "read_info": {"encoding": encoding, "delimiter": delimiter, "engine": "stdlib"},
                "convert_ready": True,
            }
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"Failed to read CSV: {path}") from last_error


def read_csv_file(path: Path) -> tuple["pd.DataFrame", dict[str, Any]]:
    ensure_pandas()
    last_error: Exception | None = None

    for encoding in ("utf-8", "utf-8-sig", "gb18030", "latin1"):
        try:
            frame = pd.read_csv(path, sep=None, engine="python", encoding=encoding)
            return frame, {"encoding": encoding}
        except Exception as exc:
            last_error = exc

    raise RuntimeError(f"Failed to read CSV: {path}") from last_error


def inspect_excel(path: Path) -> dict[str, Any]:
    ensure_pandas()
    workbook = pd.ExcelFile(path)

    sheet_summaries: list[dict[str, Any]] = []
    for sheet_name in workbook.sheet_names:
        try:
            sheet_df = pd.read_excel(path, sheet_name=sheet_name)
            columns = [flatten_column_name(col) for col in list(sheet_df.columns)]
            sheet_summaries.append(
                {
                    "sheet": sheet_name,
                    "rows": int(len(sheet_df)),
                    "column_count": int(len(columns)),
                    "columns": columns,
                    "preview": preview_records(sheet_df),
                }
            )
        except Exception as exc:
            sheet_summaries.append(
                {
                    "sheet": sheet_name,
                    "error": str(exc),
                }
            )

    recommended_sheet = None
    if len(workbook.sheet_names) == 1:
        recommended_sheet = workbook.sheet_names[0]
    else:
        recommended_sheet = pick_recommended_sheet(sheet_summaries)

    return {
        "path": str(path),
        "source_format": "excel",
        "sheet_count": len(workbook.sheet_names),
        "sheet_names": workbook.sheet_names,
        "sheets": sheet_summaries,
        "convert_ready": len(workbook.sheet_names) == 1,
        "needs_sheet": len(workbook.sheet_names) != 1,
        "recommended_sheet": recommended_sheet,
    }


def inspect_tabular_file(path: Path) -> dict[str, Any]:
    source_format = infer_source_format(path)

    if source_format == "csv":
        if pd is None:
            return inspect_csv_stdlib(path)

        frame, read_info = read_csv_file(path)
        columns = [flatten_column_name(col) for col in list(frame.columns)]
        return {
            "path": str(path),
            "source_format": "csv",
            "rows": int(len(frame)),
            "column_count": int(len(columns)),
            "columns": columns,
            "preview": preview_records(frame),
            "read_info": read_info,
            "convert_ready": True,
        }

    if source_format == "excel":
        return inspect_excel(path)

    datasets = inspect_hdf5(path)
    recommended_dataset = None
    if len(datasets) == 1:
        recommended_dataset = datasets[0]["path"]
    elif datasets:
        recommended_dataset = max(datasets, key=score_hdf5_candidate)["path"]

    return {
        "path": str(path),
        "source_format": "hdf5",
        "dataset_count": len(datasets),
        "datasets": datasets,
        "convert_ready": len(datasets) == 1,
        "needs_dataset": len(datasets) != 1,
        "recommended_dataset": recommended_dataset,
    }


def read_excel_file(path: Path, sheet: str | None) -> tuple["pd.DataFrame", dict[str, Any]]:
    ensure_pandas()
    workbook = pd.ExcelFile(path)

    if sheet is None:
        if len(workbook.sheet_names) != 1:
            raise ValueError(
                f"Excel has multiple sheets. Pass --sheet. "
                f"Available: {workbook.sheet_names}"
            )
        sheet = workbook.sheet_names[0]

    frame = pd.read_excel(path, sheet_name=sheet)
    return frame, {
        "sheet": sheet,
        "available_sheets": workbook.sheet_names,
    }


def hdf5_dataset_to_frame(data: Any, attrs: dict[str, Any]) -> tuple["pd.DataFrame", dict[str, Any]]:
    ensure_pandas()

    if getattr(data.dtype, "names", None):
        frame = pd.DataFrame.from_records(data)
        return frame, {"layout": "structured_array"}

    if data.ndim == 0:
        return pd.DataFrame({"value": [to_jsonable(data)]}), {"layout": "scalar"}

    if data.ndim == 1:
        return pd.DataFrame({"value": data}), {"layout": "vector"}

    if data.ndim == 2:
        width = int(data.shape[1])
        columns = get_hdf5_column_names(attrs, width)
        if columns is None:
            columns = [f"col_{index}" for index in range(width)]
        frame = pd.DataFrame(data, columns=columns)
        return frame, {"layout": "matrix"}

    if data.ndim == 3 and data.shape[-1] in (2, 3):
        point_count = int(data.shape[1])
        labels = get_hdf5_axis_labels(attrs, point_count)
        if labels is None:
            labels = [f"point_{index}" for index in range(point_count)]

        parts: list[pd.DataFrame] = []
        for point_index, bodypart in enumerate(labels):
            part = pd.DataFrame(
                {
                    "frame": range(int(data.shape[0])),
                    "bodypart": bodypart,
                    "x": data[:, point_index, 0],
                    "y": data[:, point_index, 1],
                    "confidence": data[:, point_index, 2] if data.shape[-1] == 3 else pd.NA,
                }
            )
            parts.append(part)

        return pd.concat(parts, ignore_index=True), {
            "layout": "pose_long_from_h5",
            "bodyparts": labels,
        }

    raise ValueError(f"Unsupported HDF5 dataset shape: {list(data.shape)}")


def read_hdf5_file(path: Path, dataset: str | None) -> tuple["pd.DataFrame", dict[str, Any]]:
    ensure_h5py()
    datasets = inspect_hdf5(path)

    if not datasets:
        raise ValueError(f"No datasets found in HDF5 file: {path}")

    if dataset is None:
        if len(datasets) != 1:
            available = [item["path"] for item in datasets]
            raise ValueError(
                f"HDF5 has multiple datasets. Pass --dataset. Available: {available}"
            )
        dataset = datasets[0]["path"]

    with h5py.File(path, "r") as handle:
        ds = handle[dataset]
        attrs = {snake_case(str(key)): to_jsonable(value) for key, value in ds.attrs.items()}
        frame, layout_info = hdf5_dataset_to_frame(ds[()], attrs)

    info = {
        "dataset": dataset,
        "available_datasets": datasets,
        "attrs": attrs,
        **layout_info,
    }
    return frame, info


def load_source(
    path: Path,
    sheet: str | None,
    dataset: str | None,
) -> tuple["pd.DataFrame", dict[str, Any], str]:
    source_format = infer_source_format(path)

    if source_format == "csv":
        frame, info = read_csv_file(path)
        return frame, info, source_format

    if source_format == "excel":
        frame, info = read_excel_file(path, sheet)
        return frame, info, source_format

    frame, info = read_hdf5_file(path, dataset)
    return frame, info, source_format


def detect_pose_columns(columns: list[str]) -> tuple[dict[str, dict[str, str]], list[str]]:
    pattern = re.compile(r"^(?P<bodypart>.+)_(?P<field>x|y|confidence|likelihood|score)$")
    pose_fields: dict[str, dict[str, str]] = {}
    non_pose_columns: list[str] = []

    for column in columns:
        match = pattern.match(column)
        if not match:
            non_pose_columns.append(column)
            continue

        bodypart = match.group("bodypart")
        field = match.group("field")
        canonical_field = "confidence" if field in ("confidence", "likelihood", "score") else field
        pose_fields.setdefault(bodypart, {})[canonical_field] = column

    pose_fields = {
        bodypart: fields
        for bodypart, fields in pose_fields.items()
        if "x" in fields and "y" in fields
    }
    return pose_fields, non_pose_columns


def wide_pose_to_long(df: "pd.DataFrame") -> tuple["pd.DataFrame", dict[str, Any]]:
    pose_fields, non_pose_columns = detect_pose_columns(list(df.columns))
    if not pose_fields:
        return df, {"layout": "table"}

    working = df.copy()
    if "frame" not in working.columns:
        working.insert(0, "frame", range(len(working)))

    meta_columns = [column for column in non_pose_columns if column != "frame"]
    meta_columns = ["frame", *meta_columns]

    long_parts: list[pd.DataFrame] = []
    for bodypart, fields in sorted(pose_fields.items()):
        part = working[meta_columns].copy()
        part["bodypart"] = bodypart
        part["x"] = working[fields["x"]]
        part["y"] = working[fields["y"]]
        part["confidence"] = working[fields["confidence"]] if "confidence" in fields else pd.NA
        long_parts.append(part)

    output = pd.concat(long_parts, ignore_index=True)
    return output, {
        "layout": "pose_long",
        "bodyparts": sorted(pose_fields.keys()),
    }


def unique_column_name(existing: set[str], preferred: str) -> str:
    if preferred not in existing:
        return preferred

    index = 2
    while f"{preferred}_{index}" in existing:
        index += 1
    return f"{preferred}_{index}"


def add_provenance_columns(
    df: "pd.DataFrame",
    path: Path,
    source_format: str,
) -> tuple["pd.DataFrame", dict[str, str]]:
    output = df.copy()
    existing = set(output.columns)
    provenance_map: dict[str, str] = {}

    values = {
        "source_file": path.name,
        "source_stem": sanitize_name_fragment(path.stem),
        "source_format": source_format,
        "source_parent": path.parent.name,
    }

    if path.parent.parent != path.parent:
        values["source_group"] = path.parent.parent.name

    for logical_name, value in values.items():
        actual_name = unique_column_name(existing, logical_name)
        output[actual_name] = value
        existing.add(actual_name)
        provenance_map[logical_name] = actual_name

    return output, provenance_map


def build_schema(df: "pd.DataFrame") -> dict[str, Any]:
    return {
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": [
            {
                "name": str(column),
                "dtype": str(df[column].dtype),
                "null_count": int(df[column].isna().sum()),
                "non_null_count": int(df[column].notna().sum()),
            }
            for column in df.columns
        ],
    }


def write_outputs(
    df: "pd.DataFrame",
    out_dir: Path,
    stem: str,
    report: dict[str, Any],
    output_format: str,
) -> dict[str, str]:
    normalized_dir = out_dir / "normalized"
    schemas_dir = out_dir / "schemas"
    reports_dir = out_dir / "reports"

    normalized_dir.mkdir(parents=True, exist_ok=True)
    schemas_dir.mkdir(parents=True, exist_ok=True)
    reports_dir.mkdir(parents=True, exist_ok=True)

    schema_path = schemas_dir / f"{stem}.schema.json"
    report_path = reports_dir / f"{stem}.report.json"

    actual_format = output_format
    data_path: Path

    if output_format == "csv":
        data_path = normalized_dir / f"{stem}.csv"
        df.to_csv(data_path, index=False)
    else:
        try:
            data_path = normalized_dir / f"{stem}.parquet"
            df.to_parquet(data_path, index=False)
            actual_format = "parquet"
        except Exception as exc:
            if output_format == "parquet":
                raise
            report["parquet_fallback"] = str(exc)
            data_path = normalized_dir / f"{stem}.csv"
            df.to_csv(data_path, index=False)
            actual_format = "csv"

    report["output_format"] = actual_format

    schema_path.write_text(
        json.dumps(build_schema(df), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return {
        "data": str(data_path),
        "schema": str(schema_path),
        "report": str(report_path),
    }


def inspect_source(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(path)
    result = inspect_tabular_file(path)
    result["ok"] = True
    result["script_version"] = SCRIPT_VERSION
    result["env"] = check_env()
    return result


def convert_source(
    path: Path,
    out_dir: Path,
    sheet: str | None,
    dataset: str | None,
    output_format: str,
    pose_long: bool,
) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(path)

    env = check_env()
    if not env["ok"]:
        raise RuntimeError(
            "Environment check failed. Install dependencies first: "
            f"{env['install_hint']}"
        )

    source_frame, read_info, source_format = load_source(path, sheet, dataset)

    source_rows = int(len(source_frame))
    source_columns = [flatten_column_name(col) for col in list(source_frame.columns)]

    normalized = source_frame.copy()
    normalized = normalize_string_columns(normalized)

    normalized_columns, column_mappings = normalize_columns(list(normalized.columns))
    normalized.columns = normalized_columns

    if pose_long:
        normalized, layout_info = wide_pose_to_long(normalized)
    else:
        layout_info = {"layout": "table", "pose_long": False}

    normalized = normalized.convert_dtypes()

    normalized, provenance_map = add_provenance_columns(normalized, path, source_format)

    stem_parts = [sanitize_name_fragment(path.stem)]
    if sheet:
        stem_parts.append(sanitize_name_fragment(sheet))
    if dataset:
        stem_parts.append(sanitize_name_fragment(dataset))
    output_stem = "_".join(stem_parts)

    report = {
        "input": str(path),
        "source_format": source_format,
        "source_rows": source_rows,
        "source_column_count": len(source_columns),
        "source_columns": source_columns,
        "column_mappings": column_mappings,
        "read_info": read_info,
        "layout_info": layout_info,
        "provenance_columns": provenance_map,
        "output_rows": int(len(normalized)),
        "output_column_count": int(len(normalized.columns)),
        "script_version": SCRIPT_VERSION,
        "env": env,
    }

    outputs = write_outputs(normalized, out_dir, output_stem, report, output_format)

    return {
        "ok": True,
        "script_version": SCRIPT_VERSION,
        "input": str(path),
        "source_format": source_format,
        "rows": int(len(normalized)),
        "column_count": int(len(normalized.columns)),
        "columns": list(normalized.columns),
        "layout_info": layout_info,
        "env": env,
        "outputs": outputs,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Check environment, inspect, and normalize local CSV, Excel, and HDF5 files."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("check-env", help="Check Python and dependency availability.")

    inspect_parser = subparsers.add_parser("inspect", help="Inspect a local data file.")
    inspect_parser.add_argument("input", help="Path to a local csv/xlsx/h5 file.")

    convert_parser = subparsers.add_parser("convert", help="Convert a local data file.")
    convert_parser.add_argument("input", help="Path to a local csv/xlsx/h5 file.")
    convert_parser.add_argument("--out", default="out", help="Output directory. Default: out")
    convert_parser.add_argument(
        "--sheet",
        default=None,
        help="Excel sheet name when the workbook has multiple sheets.",
    )
    convert_parser.add_argument(
        "--dataset",
        default=None,
        help="HDF5 dataset path when the file has multiple datasets.",
    )
    convert_parser.add_argument(
        "--format",
        choices=("auto", "parquet", "csv"),
        default="auto",
        help="Output data format. Default: auto",
    )
    convert_parser.add_argument(
        "--no-pose-long",
        action="store_true",
        help="Disable automatic wide-pose to long-form conversion.",
    )

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "check-env":
            result = check_env()
        elif args.command == "inspect":
            result = inspect_source(Path(args.input))
        else:
            result = convert_source(
                path=Path(args.input),
                out_dir=Path(args.out),
                sheet=args.sheet,
                dataset=args.dataset,
                output_format=args.format,
                pose_long=not args.no_pose_long,
            )

        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    except Exception as exc:
        error = {
            "ok": False,
            "command": args.command,
            "error": str(exc),
            "script_version": SCRIPT_VERSION,
        }
        print(json.dumps(error, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
