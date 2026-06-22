#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Generate /KinematicParameter in an existing .h5 file.

Reads:
  /2Dskeleton/BodyParts (n_bodyparts,)
  /2Dskeleton/data2D    (n_frames, n_bodyparts*3) -> [x, y, likelihood] per bodypart

Uses FPS from:
  1) /VideoInfo/fps if present and >0
  2) if missing/0 and --search-video is enabled: try to locate a same-stem video
     (e.g. rec-1-xxx.mp4/.avi/...) under common folders and read FPS from it.
  3) fallback to --fps-default

Optionally uses calibration from:
  /CalibrationInfo/px_mm_ratio_x, /CalibrationInfo/px_mm_ratio_y

Writes (in-place):
  /KinematicParameter/ParameterName (n_params,)
  /KinematicParameter/ParameterData (n_frames, n_params)

n_params = 4*n_bodyparts + 2
  (x_, y_, distance_, speed_) per bodypart + (frame_distance, frame_speed)

NOTE: This script edits the input file in-place.
"""

import argparse
import os
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, List, Optional

import numpy as np
import h5py


VIDEO_EXTENSIONS = [
    ".mp4",
    ".avi",
    ".mkv",
    ".mov",
    ".wmv",
    ".flv",
    ".mpeg",
    ".mpg",
]


def _decode(x):
    if isinstance(x, (bytes, np.bytes_)):
        return x.decode("utf-8", errors="ignore")
    return str(x)


def _as_bytes_array(str_list: List[str]):
    # store as fixed-width bytes in HDF5 for portability
    return np.array([s.encode("utf-8") for s in str_list], dtype="S")


def fps_from_video_opencv(video_path: Path) -> float:
    try:
        import cv2  # type: ignore
    except Exception as e:
        raise RuntimeError(
            "OpenCV (cv2) is not available. Install it in your conda env, e.g.\n"
            "  conda install -c conda-forge opencv\n"
            f"Original import error: {e}"
        )

    cap = cv2.VideoCapture(str(video_path))
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    cap.release()
    if not fps or fps <= 1e-6:
        raise RuntimeError(f"Cannot read FPS via OpenCV from: {video_path}")
    return fps


def _parse_rate(rate: str) -> Optional[float]:
    rate = (rate or "").strip()
    if not rate:
        return None
    if "/" in rate:
        a, b = rate.split("/", 1)
        try:
            a = float(a)
            b = float(b)
            if b != 0:
                return a / b
        except Exception:
            return None
    try:
        return float(rate)
    except Exception:
        return None


def fps_from_video_ffprobe(video_path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise RuntimeError(
            "ffprobe is not available on PATH. Install ffmpeg/ffprobe or use OpenCV.\n"
            "- On conda (recommended): conda install -c conda-forge ffmpeg\n"
            "- Or: conda install -c conda-forge opencv"
        )

    # Try avg_frame_rate first, then r_frame_rate
    cmd = [
        ffprobe,
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=avg_frame_rate,r_frame_rate",
        "-of",
        "default=nk=1:nw=1",
        str(video_path),
    ]
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, text=True).strip().splitlines()
    # output lines: avg_frame_rate, r_frame_rate (order not strictly guaranteed)
    rates = [_parse_rate(x) for x in out]
    rates = [x for x in rates if x and x > 1e-6]
    if not rates:
        raise RuntimeError(f"Cannot parse FPS from ffprobe output for: {video_path}\nOutput: {out}")
    # prefer a sensible fps
    return float(rates[0])


def fps_from_video(video_path: Path) -> float:
    """Try OpenCV first (if installed), otherwise ffprobe."""
    try:
        return fps_from_video_opencv(video_path)
    except Exception:
        # fall back to ffprobe
        return fps_from_video_ffprobe(video_path)


def _candidate_search_dirs(h5_path: Path, max_parent_levels: int = 2) -> List[Path]:
    """Generate likely directories for locating a same-stem video."""
    h5_dir = h5_path.parent
    subs = ["videos", "video", "Videos", "Video", "data", "Data"]

    dirs: List[Path] = []
    # current dir and common subdirs
    dirs.append(h5_dir)
    for s in subs:
        dirs.append(h5_dir / s)

    # parent dirs and their common subdirs
    cur = h5_dir
    for _ in range(max_parent_levels):
        cur = cur.parent
        dirs.append(cur)
        for s in subs:
            dirs.append(cur / s)

    # de-dup while preserving order
    seen = set()
    out = []
    for d in dirs:
        dp = d.resolve() if d.exists() else d
        key = str(dp)
        if key not in seen:
            seen.add(key)
            out.append(d)
    return out


def find_video_for_h5(
    h5_path: Path,
    exts: Iterable[str] = VIDEO_EXTENSIONS,
    max_parent_levels: int = 2,
) -> Optional[Path]:
    """Search for a same-stem video file near the h5 path."""
    stem = h5_path.stem
    exts = [e if e.startswith(".") else "." + e for e in exts]

    for d in _candidate_search_dirs(h5_path, max_parent_levels=max_parent_levels):
        if not d.exists() or not d.is_dir():
            continue
        # direct same-stem match
        for ext in exts:
            p = d / (stem + ext)
            if p.exists():
                return p
            # case-insensitive check (Windows naming via WSL can be odd)
            try:
                for cand in d.glob(stem + ".*"):
                    if cand.suffix.lower() == ext.lower() and cand.exists():
                        return cand
            except Exception:
                pass

    return None


def load_fps(
    h5,
    h5_path: Path,
    fps_default: float = 30.0,
    search_video: bool = True,
    video_path: Optional[Path] = None,
    max_parent_levels: int = 2,
) -> float:
    """Load fps from h5, or from a located video, or fallback."""
    fps = None
    if "VideoInfo" in h5 and "fps" in h5["VideoInfo"]:
        try:
            fps = float(h5["VideoInfo"]["fps"][()])
        except Exception:
            fps = None

    if fps is not None and fps > 1e-6:
        return float(fps)

    if search_video:
        vp = Path(video_path) if video_path else find_video_for_h5(h5_path, max_parent_levels=max_parent_levels)
        if vp is not None:
            return float(fps_from_video(vp))

        # if search_video enabled but not found, ask user by failing loudly
        raise RuntimeError(
            "FPS not found in H5 (/VideoInfo/fps missing or 0), and no same-stem video file was found.\n"
            "Searched: current folder, ./videos, ./data, and parent-level videos/data folders.\n"
            "Please provide the exact video path via --video, or disable video search and use --fps-default."
        )

    return float(fps_default)


def load_calibration(h5, ratio_default: float = 1.0):
    rx, ry = float(ratio_default), float(ratio_default)
    if "CalibrationInfo" in h5:
        ci = h5["CalibrationInfo"]
        if "px_mm_ratio_x" in ci:
            try:
                rx = float(ci["px_mm_ratio_x"][()])
            except Exception:
                pass
        if "px_mm_ratio_y" in ci:
            try:
                ry = float(ci["px_mm_ratio_y"][()])
            except Exception:
                pass
    if rx == 0:
        rx = float(ratio_default)
    if ry == 0:
        ry = float(ratio_default)
    return rx, ry


def compute_kinematic(bodyparts: List[str], data2d: np.ndarray, fps: float, rx: float, ry: float):
    """Compute per-frame kinematic features."""
    n_frames = int(data2d.shape[0])
    n_bp = int(len(bodyparts))

    if data2d.ndim != 2:
        raise ValueError(f"data2D must be 2D. Got shape={data2d.shape}")

    if data2d.shape[1] < n_bp * 3:
        raise ValueError(f"data2D second dim too small: got {data2d.shape}, need at least {n_bp*3}")

    cols = []
    names: List[str] = []

    # per-bodypart x,y,distance,speed
    for i, bp in enumerate(bodyparts):
        x = data2d[:, i * 3 + 0].astype(np.float64)
        y = data2d[:, i * 3 + 1].astype(np.float64)

        # px -> mm (divide by px/mm) -> cm (/10)
        x_cm = x / rx / 10.0
        y_cm = y / ry / 10.0

        pts = np.stack([x_cm, y_cm], axis=1)
        d = np.linalg.norm(np.diff(pts, axis=0), axis=1)  # frames-1
        d = np.pad(d, (0, 1), mode="constant", constant_values=0.0)  # to frames
        speed = d * fps

        names += [f"x_{bp}", f"y_{bp}", f"distance_{bp}", f"speed_{bp}"]
        cols += [x_cm, y_cm, d, speed]

    # frame_distance / frame_speed from mean point of all bodyparts
    xs = []
    ys = []
    for i in range(n_bp):
        xs.append(data2d[:, i * 3 + 0].astype(np.float64) / rx / 10.0)
        ys.append(data2d[:, i * 3 + 1].astype(np.float64) / ry / 10.0)
    mean_x = np.mean(np.stack(xs, axis=1), axis=1)
    mean_y = np.mean(np.stack(ys, axis=1), axis=1)
    mean_pts = np.stack([mean_x, mean_y], axis=1)

    frame_d = np.linalg.norm(np.diff(mean_pts, axis=0), axis=1)
    frame_d = np.insert(frame_d, 0, frame_d[0] if frame_d.size else 0.0)
    if frame_d.shape[0] < n_frames:
        frame_d = np.pad(frame_d, (0, n_frames - frame_d.shape[0]), mode="constant", constant_values=0.0)
    frame_speed = frame_d * fps

    names += ["frame_distance", "frame_speed"]
    cols += [frame_d, frame_speed]

    param_data = np.stack(cols, axis=1).astype(np.float32)
    return names, param_data


def write_kinematic(
    h5_path: Path,
    overwrite: bool,
    fps_default: float,
    ratio_default: float,
    search_video: bool,
    video_path: Optional[Path],
    max_parent_levels: int,
):
    h5_path = Path(h5_path)
    if not h5_path.exists():
        raise FileNotFoundError(h5_path)

    with h5py.File(str(h5_path), "r+") as h5:
        if "2Dskeleton" not in h5:
            raise KeyError("Missing group: /2Dskeleton")
        sk = h5["2Dskeleton"]
        if "BodyParts" not in sk or "data2D" not in sk:
            raise KeyError("Missing datasets: /2Dskeleton/BodyParts or /2Dskeleton/data2D")

        bodyparts = [_decode(x) for x in np.array(sk["BodyParts"][()])]
        data2d = np.array(sk["data2D"][()])

        fps = load_fps(
            h5,
            h5_path=h5_path,
            fps_default=fps_default,
            search_video=search_video,
            video_path=video_path,
            max_parent_levels=max_parent_levels,
        )
        rx, ry = load_calibration(h5, ratio_default=ratio_default)

        names, param_data = compute_kinematic(bodyparts, data2d, fps, rx, ry)

        if "KinematicParameter" in h5:
            if not overwrite:
                raise SystemExit("KinematicParameter already exists. Re-run with --overwrite to replace it.")
            del h5["KinematicParameter"]

        grp = h5.create_group("KinematicParameter")
        grp.create_dataset("ParameterName", data=_as_bytes_array(names))
        grp.create_dataset("ParameterData", data=param_data, compression="gzip", compression_opts=4)

        grp.attrs["generated_by"] = "generate_kinematic_parameter.py"
        grp.attrs["fps_used"] = float(fps)
        grp.attrs["px_mm_ratio_x_used"] = float(rx)
        grp.attrs["px_mm_ratio_y_used"] = float(ry)

    print(f"[OK] Wrote /KinematicParameter to: {h5_path}")
    print(f"     frames={param_data.shape[0]} params={param_data.shape[1]}")
    print(f"     fps={fps} rx={rx} ry={ry}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--h5", required=True, help="Path to .h5 file")
    ap.add_argument("--overwrite", action="store_true", help="Overwrite existing /KinematicParameter")

    ap.add_argument("--fps-default", type=float, default=30.0, help="Fallback fps when no fps and video search disabled")
    ap.add_argument("--ratio-default", type=float, default=1.0, help="Fallback px/mm ratio when missing")

    ap.add_argument(
        "--search-video",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="When H5 has no fps, try to locate same-stem video and read FPS (default: true)",
    )
    ap.add_argument("--video", default="", help="Explicit video path (overrides auto search when provided)")
    ap.add_argument(
        "--max-parent-levels",
        type=int,
        default=2,
        help="How many parent levels to search for videos/data folders (default: 2)",
    )

    args = ap.parse_args()

    video_path = Path(args.video) if str(args.video).strip() else None

    write_kinematic(
        h5_path=Path(args.h5),
        overwrite=bool(args.overwrite),
        fps_default=float(args.fps_default),
        ratio_default=float(args.ratio_default),
        search_video=bool(args.search_video),
        video_path=video_path,
        max_parent_levels=int(args.max_parent_levels),
    )


if __name__ == "__main__":
    main()
