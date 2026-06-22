#!/usr/bin/env python3
"""
Velocity Heatmap Generator for Trajectory Velocity Heatmap Generate Skill

Generates 2D spatial velocity heatmaps from 2D/3D tracking data (.h5 or .csv).
Shows which spatial regions have the highest movement velocity.
Supports flexible data formats, auto-detection of body parts, and robust error handling.
"""

import argparse
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.ndimage import gaussian_filter
from matplotlib.collections import LineCollection


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate spatial velocity heatmaps from animal tracking data"
    )
    parser.add_argument(
        "input_path",
        type=str,
        help="Input file (.h5 or .csv) or directory"
    )
    parser.add_argument(
        "--body-part",
        type=str,
        default="auto",
        help="Body part to analyze (default: auto-detect)"
    )
    parser.add_argument(
        "--list-parts",
        action="store_true",
        help="List available body parts and exit"
    )
    parser.add_argument(
        "--confidence-threshold",
        type=float,
        default=0.6,
        help="Minimum confidence threshold (default: 0.6)"
    )
    parser.add_argument(
        "--fps",
        type=float,
        default=30.0,
        help="Video frame rate (default: 30)"
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=None,
        help="Output directory (default: auto)"
    )
    parser.add_argument(
        "--cmap",
        type=str,
        default="viridis",
        help="Matplotlib colormap (default: viridis)"
    )
    parser.add_argument(
        "--bins",
        type=int,
        default=50,
        help="Number of bins for 2D histogram (default: 50)"
    )
    parser.add_argument(
        "--sigma",
        type=float,
        default=2.0,
        help="Gaussian smoothing sigma (default: 2.0)"
    )
    parser.add_argument(
        "--arena-size",
        type=str,
        default=None,
        help="Arena size in pixels (format: width,height). Auto-detected if not specified."
    )
    parser.add_argument(
        "--outlier-threshold",
        type=float,
        default=10.0,
        help="Outlier IQR multiplier (0 to disable, default: 10)"
    )
    parser.add_argument(
        "--velocity-max",
        type=float,
        default=None,
        help="Maximum velocity for color scale (auto-detected if not specified)"
    )
    return parser.parse_args()


def detect_body_parts(df: pd.DataFrame) -> List[str]:
    """
    Auto-detect body parts from DataFrame columns.
    Supports various naming patterns.
    """
    body_parts = set()
    columns = [c.lower() for c in df.columns]
    
    # Pattern 1: {part}_x, {part}_y, {part}_confidence
    pattern1 = re.compile(r'^(.+)_(x|y|z|confidence|likelihood|score)$')
    
    # Pattern 2: x_{part}, y_{part}, confidence_{part}
    pattern2 = re.compile(r'^(x|y|z|confidence|likelihood|score)_(.+)$')
    
    for col in columns:
        # Pattern 1
        match = pattern1.match(col)
        if match:
            part = match.group(1)
            if part not in ['', 'x', 'y', 'z']:
                body_parts.add(part)
        
        # Pattern 2
        match = pattern2.match(col)
        if match:
            part = match.group(2)
            body_parts.add(part)
    
    # Additional check: look for pairs of x,y columns
    for col in columns:
        if col.endswith('_x') or col.endswith('x'):
            base = col[:-1] if col.endswith('x') else col[:-2]
            y_col = base + '_y' if col.endswith('_x') else base + 'y'
            if y_col in columns or (base + '_y') in columns:
                body_parts.add(base.rstrip('_'))
    
    return sorted(list(body_parts))


def get_column_names(df: pd.DataFrame, body_part: str) -> Dict[str, str]:
    """
    Get actual column names for a body part (handles case variations).
    Returns dict with keys: x, y, confidence
    """
    columns = list(df.columns)
    columns_lower = [c.lower() for c in columns]
    result = {}
    
    # Try various patterns
    patterns = [
        (f"{body_part}_x", f"{body_part}_y", f"{body_part}_confidence"),
        (f"{body_part}_x", f"{body_part}_y", f"{body_part}_likelihood"),
        (f"{body_part}_x", f"{body_part}_y", f"{body_part}_score"),
        (f"x_{body_part}", f"y_{body_part}", f"confidence_{body_part}"),
        (f"x_{body_part}", f"y_{body_part}", f"likelihood_{body_part}"),
        (f"{body_part}x", f"{body_part}y", f"{body_part}confidence"),
        (f"{body_part}X", f"{body_part}Y", f"{body_part}Confidence"),
    ]
    
    for x_pat, y_pat, conf_pat in patterns:
        x_col = None
        y_col = None
        conf_col = None
        
        for i, col_lower in enumerate(columns_lower):
            if col_lower == x_pat.lower():
                x_col = columns[i]
            elif col_lower == y_pat.lower():
                y_col = columns[i]
            elif col_lower == conf_pat.lower():
                conf_col = columns[i]
        
        if x_col and y_col:
            result['x'] = x_col
            result['y'] = y_col
            result['confidence'] = conf_col
            return result
    
    # Fallback: search for any column containing body_part and x/y
    for i, col in enumerate(columns):
        col_lower = col.lower()
        if body_part.lower() in col_lower:
            if 'x' in col_lower and 'y' not in col_lower and 'z' not in col_lower:
                result['x'] = col
            elif 'y' in col_lower and 'x' not in col_lower and 'z' not in col_lower:
                result['y'] = col
            elif any(c in col_lower for c in ['confidence', 'likelihood', 'score']):
                result['confidence'] = col
    
    return result if 'x' in result and 'y' in result else {}


def load_h5_data(h5_path: Path) -> pd.DataFrame:
    """Load tracking data from HDF5 file with flexible structure detection."""
    import h5py
    
    with h5py.File(h5_path, 'r') as f:
        # Try different common structures
        structures = [
            ('/2Dskeleton/BodyParts', '/2Dskeleton/data2D'),
            ('/body_parts', '/coordinates'),
            ('/keypoints', '/data'),
            ('/bodyparts', '/positions'),
        ]
        
        body_parts = None
        data = None
        
        for parts_path, data_path in structures:
            if parts_path in f and data_path in f:
                body_parts = f[parts_path][:]
                data = f[data_path][:]
                break
        
        # If not found, try to auto-detect
        if body_parts is None:
            for key in f.keys():
                if isinstance(f[key], h5py.Group):
                    for subkey in f[key].keys():
                        if 'part' in subkey.lower() or 'bodypart' in subkey.lower():
                            parts_path = f"{key}/{subkey}"
                            if parts_path in f:
                                body_parts = f[parts_path][:]
                                for data_key in ['data2D', 'data', 'coordinates', 'positions']:
                                    data_path = f"{key}/{data_key}"
                                    if data_path in f:
                                        data = f[data_path][:]
                                        break
                                if data is not None:
                                    break
                if body_parts is not None:
                    break
        
        if body_parts is None or data is None:
            raise ValueError("Could not detect HDF5 structure. Expected body parts and coordinate datasets.")
        
        # Decode body parts if needed
        decoded_parts = []
        for part in body_parts:
            if isinstance(part, bytes):
                decoded_parts.append(part.decode('utf-8'))
            else:
                decoded_parts.append(str(part))
        
        # Build column names
        column_names = []
        for part in decoded_parts:
            column_names.extend([f"{part}_x", f"{part}_y", f"{part}_confidence"])
        
        # Ensure data shape matches
        expected_cols = len(decoded_parts) * 3
        if data.shape[1] != expected_cols:
            if data.shape[1] == len(decoded_parts) * 2:
                column_names = []
                for part in decoded_parts:
                    column_names.extend([f"{part}_x", f"{part}_y"])
            else:
                column_names = [f"col_{i}" for i in range(data.shape[1])]
        
        df = pd.DataFrame(data, columns=column_names)
    return df


def load_csv_data(csv_path: Path) -> pd.DataFrame:
    """Load tracking data from CSV file with flexible parsing."""
    try:
        df = pd.read_csv(csv_path)
    except Exception:
        try:
            df = pd.read_csv(csv_path, sep=';')
        except Exception:
            df = pd.read_csv(csv_path, sep='\t')
    
    df.columns = [str(c).strip() for c in df.columns]
    return df


def load_tracking_data(input_path: Path) -> pd.DataFrame:
    """Load tracking data from either .h5 or .csv file."""
    suffix = input_path.suffix.lower()
    
    if suffix == '.h5' or suffix == '.hdf5':
        return load_h5_data(input_path)
    elif suffix == '.csv' or suffix == '.txt':
        return load_csv_data(input_path)
    else:
        raise ValueError(f"Unsupported file format: {suffix}")


def clean_data(df: pd.DataFrame, x_col: str, y_col: str, conf_col: Optional[str] = None, outlier_threshold: float = 10.0) -> Tuple[pd.Series, pd.Series, pd.Series]:
    """
    Clean data by handling missing values, outliers, and invalid coordinates.
    """
    x = pd.to_numeric(df[x_col], errors='coerce').copy()
    y = pd.to_numeric(df[y_col], errors='coerce').copy()
    
    # Handle confidence
    if conf_col and conf_col in df.columns:
        confidence = pd.to_numeric(df[conf_col], errors='coerce').fillna(0)
    else:
        confidence = pd.Series(np.ones(len(df)))
    
    # Replace inf with nan
    x = x.replace([np.inf, -np.inf], np.nan)
    y = y.replace([np.inf, -np.inf], np.nan)
    
    # Detect and mark extreme outliers
    if outlier_threshold > 0:
        for coord in [x, y]:
            valid = coord.dropna()
            if len(valid) > 10:
                q1 = valid.quantile(0.25)
                q3 = valid.quantile(0.75)
                iqr = q3 - q1
                lower = q1 - outlier_threshold * iqr
                upper = q3 + outlier_threshold * iqr
                coord[(coord < lower) | (coord > upper)] = np.nan
    
    return x, y, confidence


def calculate_velocity(x: pd.Series, y: pd.Series, fps: float) -> pd.Series:
    """
    Calculate instantaneous velocity from position data.
    """
    # Calculate differences
    dx = x.diff()
    dy = y.diff()
    dt = 1.0 / fps
    
    # Calculate velocity (pixels per second)
    velocity = np.sqrt(dx**2 + dy**2) / dt
    
    return velocity


def calculate_velocity_heatmap(
    x: np.ndarray,
    y: np.ndarray,
    velocity: np.ndarray,
    confidence: np.ndarray,
    confidence_threshold: float,
    bins: int,
    sigma: float,
    arena_size: Optional[Tuple[int, int]] = None
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Calculate 2D spatial velocity heatmap.
    Shows which spatial regions have the highest movement velocity.
    """
    # Create valid mask
    valid_mask = (~np.isnan(x)) & (~np.isnan(y)) & (~np.isnan(velocity)) & (confidence >= confidence_threshold)
    x_valid = x[valid_mask]
    y_valid = y[valid_mask]
    velocity_valid = velocity[valid_mask]
    
    if len(x_valid) < 10:
        raise ValueError("Insufficient valid data points for heatmap generation")
    
    # Determine range
    if arena_size is not None:
        x_range = (0, arena_size[0])
        y_range = (0, arena_size[1])
    else:
        x_padding = (x_valid.max() - x_valid.min()) * 0.05
        y_padding = (y_valid.max() - y_valid.min()) * 0.05
        x_range = (x_valid.min() - x_padding, x_valid.max() + x_padding)
        y_range = (y_valid.min() - y_padding, y_valid.max() + y_padding)
    
    # Create 2D histogram weighted by velocity
    # Using np.histogram2d with weights to get sum of velocities per bin
    heatmap_sum, xedges, yedges = np.histogram2d(
        x_valid, y_valid,
        bins=bins,
        range=[x_range, y_range],
        weights=velocity_valid
    )
    
    # Create count histogram to get average velocity per bin
    heatmap_count, _, _ = np.histogram2d(
        x_valid, y_valid,
        bins=bins,
        range=[x_range, y_range]
    )
    
    # Calculate average velocity (avoid division by zero)
    with np.errstate(divide='ignore', invalid='ignore'):
        heatmap = np.divide(heatmap_sum, heatmap_count)
        heatmap = np.nan_to_num(heatmap, nan=0.0)
    
    # Apply Gaussian smoothing
    if sigma > 0:
        heatmap = gaussian_filter(heatmap, sigma=sigma)
    
    return heatmap, xedges, yedges


def generate_velocity_heatmap_figure(
    heatmap: np.ndarray,
    xedges: np.ndarray,
    yedges: np.ndarray,
    x: np.ndarray,
    y: np.ndarray,
    velocity: np.ndarray,
    confidence: np.ndarray,
    confidence_threshold: float,
    title: str,
    cmap: str,
    body_part: str,
    velocity_max: Optional[float] = None
) -> plt.Figure:
    """Generate spatial velocity heatmap visualization."""
    
    fig, axes = plt.subplots(1, 2, figsize=(16, 7))
    
    extent = [xedges[0], xedges[-1], yedges[0], yedges[-1]]
    
    # Determine color scale
    if velocity_max is None:
        if np.any(heatmap > 0):
            # Use 99th percentile to avoid outliers skewing the color scale
            vmax = np.percentile(heatmap[heatmap > 0], 99)
        else:
            vmax = 1.0
    else:
        vmax = velocity_max
    vmax = max(vmax, 0.1)
    
    # Left panel: Velocity heatmap only
    ax1 = axes[0]
    
    im1 = ax1.imshow(
        heatmap.T,
        origin='lower',
        extent=extent,
        cmap=cmap,
        aspect='auto',
        vmin=0,
        vmax=vmax
    )
    ax1.set_xlabel('X Position (pixels)')
    ax1.set_ylabel('Y Position (pixels)')
    ax1.set_title(f'{title}\nSpatial Velocity Heatmap ({body_part})')
    
    cbar1 = plt.colorbar(im1, ax=ax1)
    cbar1.set_label('Average Velocity (pixels/sec)')
    
    # Right panel: Velocity heatmap with trajectory overlay
    ax2 = axes[1]
    
    im2 = ax2.imshow(
        heatmap.T,
        origin='lower',
        extent=extent,
        cmap=cmap,
        aspect='auto',
        alpha=0.7,
        vmin=0,
        vmax=vmax
    )
    
    # Overlay trajectory line colored by velocity
    valid_mask = (~np.isnan(x)) & (~np.isnan(y)) & (~np.isnan(velocity)) & (confidence >= confidence_threshold)
    x_valid = x[valid_mask]
    y_valid = y[valid_mask]
    velocity_valid = velocity[valid_mask]
    
    # Downsample for visualization if too many points
    if len(x_valid) > 5000:
        step = len(x_valid) // 5000
        indices = np.arange(0, len(x_valid), step)
        x_plot = x_valid[indices]
        y_plot = y_valid[indices]
        velocity_plot = velocity_valid[indices]
    else:
        x_plot = x_valid
        y_plot = y_valid
        velocity_plot = velocity_valid
    
    # Plot trajectory with velocity-based coloring
    if len(x_plot) > 1:
        points = np.array([x_plot, y_plot]).T.reshape(-1, 1, 2)
        segments = np.concatenate([points[:-1], points[1:]], axis=1)
        
        # Normalize velocity for coloring
        vel_norm = np.clip(velocity_plot[:-1] / vmax, 0, 1)
        lc = LineCollection(segments, cmap=cmap, alpha=0.6)
        lc.set_array(vel_norm)
        lc.set_linewidth(1)
        ax2.add_collection(lc)
    
    ax2.set_xlim(extent[0], extent[1])
    ax2.set_ylim(extent[2], extent[3])
    ax2.set_xlabel('X Position (pixels)')
    ax2.set_ylabel('Y Position (pixels)')
    ax2.set_title(f'{title}\nVelocity Heatmap + Trajectory ({body_part})')
    
    cbar2 = plt.colorbar(im2, ax=ax2)
    cbar2.set_label('Average Velocity (pixels/sec)')
    
    plt.tight_layout()
    return fig


def detect_group(filename: str) -> str:
    """Detect group from filename."""
    parts = filename.replace('.h5', '').replace('.csv', '').replace('.hdf5', '').split('_')
    return parts[0] if parts else "unknown"


def parse_arena_size(arena_size_str: Optional[str]) -> Optional[Tuple[int, int]]:
    """Parse arena size string into (width, height) tuple."""
    if arena_size_str is None:
        return None
    try:
        width, height = map(int, arena_size_str.split(','))
        return (width, height)
    except ValueError:
        print(f"Warning: Invalid arena size format: {arena_size_str}. Using auto-detection.")
        return None


def get_output_dir(input_path: Path, custom_output_dir: Optional[str] = None) -> Path:
    """Determine output directory."""
    if custom_output_dir:
        return Path(custom_output_dir)
    
    if input_path.is_dir():
        data_dir = input_path
    else:
        data_dir = input_path.parent
    
    if data_dir.name == "1_2Dskeleton":
        project_root = data_dir.parent
        results_dir = project_root / "2_results" / "heatmap_velocity"
    else:
        results_dir = data_dir / "results" / "heatmap_velocity"
    
    return results_dir


def process_single_file(
    input_file: Path,
    body_part: str,
    confidence_threshold: float,
    fps: float,
    output_dir: Path,
    cmap: str,
    bins: int,
    sigma: float,
    arena_size: Optional[Tuple[int, int]],
    outlier_threshold: float,
    velocity_max: Optional[float],
    list_only: bool = False
) -> Optional[List[str]]:
    """Process a single tracking file."""
    
    print(f"Processing: {input_file.name}")
    
    # Load data
    try:
        df = load_tracking_data(input_file)
    except Exception as e:
        print(f"  Error loading file: {e}")
        return None
    
    print(f"  Loaded {len(df)} frames, {len(df.columns)} columns")
    
    # Detect body parts
    available_parts = detect_body_parts(df)
    
    if list_only:
        return available_parts
    
    if not available_parts:
        print(f"  Error: No body parts detected in columns: {list(df.columns)}")
        return None
    
    print(f"  Detected body parts: {', '.join(available_parts)}")
    
    # Select body part
    if body_part == "auto":
        preferred = ['center', 'body', 'back', 'midpoint', 'nose', 'head']
        selected = None
        for pref in preferred:
            matches = [p for p in available_parts if pref in p.lower()]
            if matches:
                selected = matches[0]
                break
        if not selected:
            selected = available_parts[0]
        body_part = selected
        print(f"  Auto-selected body part: {body_part}")
    else:
        matches = [p for p in available_parts if p.lower() == body_part.lower()]
        if not matches:
            print(f"  Warning: Body part '{body_part}' not found. Using: {available_parts[0]}")
            body_part = available_parts[0]
        else:
            body_part = matches[0]
    
    # Get column names
    col_names = get_column_names(df, body_part)
    if not col_names or 'x' not in col_names or 'y' not in col_names:
        print(f"  Error: Could not find coordinate columns for '{body_part}'")
        print(f"  Available columns: {list(df.columns)}")
        return None
    
    print(f"  Using columns: x='{col_names['x']}', y='{col_names['y']}'", end="")
    if 'confidence' in col_names:
        print(f", confidence='{col_names['confidence']}'")
    else:
        print(" (no confidence column)")
    
    # Clean data
    x, y, confidence = clean_data(df, col_names['x'], col_names['y'], col_names.get('confidence'), outlier_threshold)
    
    valid_count = (~x.isna() & ~y.isna() & (confidence >= confidence_threshold)).sum()
    print(f"  Valid frames: {valid_count}/{len(df)} ({100*valid_count/len(df):.1f}%)")
    
    if valid_count < 10:
        print(f"  Skipping: insufficient valid data")
        return None
    
    # Calculate velocity
    velocity = calculate_velocity(x, y, fps)
    
    # Calculate velocity heatmap
    try:
        heatmap, xedges, yedges = calculate_velocity_heatmap(
            x.values, y.values, velocity.values, confidence.values,
            confidence_threshold, bins, sigma, arena_size
        )
    except ValueError as e:
        print(f"  Error: {e}")
        return None
    except Exception as e:
        print(f"  Error calculating heatmap: {e}")
        return None
    
    # Generate visualization
    group = detect_group(input_file.stem)
    title = f"{input_file.stem} ({group})"
    
    try:
        fig = generate_velocity_heatmap_figure(
            heatmap, xedges, yedges, x.values, y.values, velocity.values, confidence.values,
            confidence_threshold, title, cmap, body_part, velocity_max
        )
    except Exception as e:
        print(f"  Error generating plot: {e}")
        return None
    
    # Save output
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / f"{input_file.stem}_velocity.png"
    
    try:
        fig.savefig(output_file, dpi=150, bbox_inches='tight')
        plt.close(fig)
        print(f"  Saved: {output_file}")
    except Exception as e:
        print(f"  Error saving file: {e}")
        plt.close(fig)
        return None
    
    # Statistics
    valid_velocity = velocity[(~x.isna()) & (~y.isna()) & (confidence >= confidence_threshold)]
    if len(valid_velocity) > 0 and not valid_velocity.isna().all():
        print(f"  Velocity stats: mean={valid_velocity.mean():.2f}, "
              f"median={valid_velocity.median():.2f}, "
              f"max={valid_velocity.max():.2f} pixels/sec")
        
        # Find hotspot (region with highest average velocity)
        if np.any(heatmap > 0):
            max_idx = np.unravel_index(np.argmax(heatmap), heatmap.shape)
            hotspot_x = xedges[max_idx[0]] + (xedges[1] - xedges[0]) / 2
            hotspot_y = yedges[max_idx[1]] + (yedges[1] - yedges[0]) / 2
            print(f"  Velocity hotspot: ({hotspot_x:.1f}, {hotspot_y:.1f}) "
                  f"with avg velocity {heatmap[max_idx]:.2f} pixels/sec")
    
    return available_parts


def calculate_file_heatmap(
    input_file: Path,
    body_part: str,
    confidence_threshold: float,
    fps: float,
    bins: int,
    sigma: float,
    arena_size: Optional[Tuple[int, int]],
    outlier_threshold: float
) -> Tuple[Optional[np.ndarray], Optional[np.ndarray], Optional[np.ndarray], Optional[str]]:
    """Calculate velocity heatmap for a single file without generating visualization.
    Returns (heatmap, xedges, yedges, selected_body_part) or (None, None, None, None) on error.
    """
    try:
        df = load_tracking_data(input_file)
    except Exception as e:
        print(f"  Error loading file: {e}")
        return None, None, None, None
    
    # Detect body parts
    available_parts = detect_body_parts(df)
    if not available_parts:
        return None, None, None, None
    
    # Select body part
    if body_part == "auto":
        preferred = ['center', 'body', 'back', 'midpoint', 'nose', 'head']
        selected = None
        for pref in preferred:
            matches = [p for p in available_parts if pref in p.lower()]
            if matches:
                selected = matches[0]
                break
        if not selected:
            selected = available_parts[0]
        selected_body_part = selected
    else:
        matches = [p for p in available_parts if p.lower() == body_part.lower()]
        if not matches:
            selected_body_part = available_parts[0]
        else:
            selected_body_part = matches[0]
    
    # Get column names
    col_names = get_column_names(df, selected_body_part)
    if not col_names or 'x' not in col_names or 'y' not in col_names:
        return None, None, None, None
    
    # Clean data
    x, y, confidence = clean_data(df, col_names['x'], col_names['y'], 
                                  col_names.get('confidence'), outlier_threshold)
    
    valid_count = (~x.isna() & ~y.isna() & (confidence >= confidence_threshold)).sum()
    if valid_count < 10:
        return None, None, None, None
    
    # Calculate velocity and heatmap
    try:
        velocity = calculate_velocity(x, y, fps)
        heatmap, xedges, yedges = calculate_velocity_heatmap(
            x.values, y.values, velocity.values, confidence.values,
            confidence_threshold, bins, sigma, arena_size
        )
        return heatmap, xedges, yedges, selected_body_part
    except Exception as e:
        return None, None, None, None


def main():
    args = parse_args()
    input_path = Path(args.input_path)
    
    if not input_path.exists():
        print(f"Error: Input path does not exist: {input_path}")
        sys.exit(1)
    
    arena_size = parse_arena_size(args.arena_size)
    output_dir = get_output_dir(input_path, args.output_dir)
    print(f"Output directory: {output_dir}")
    
    if input_path.is_file():
        if input_path.suffix.lower() not in ['.h5', '.hdf5', '.csv', '.txt']:
            print(f"Error: Unsupported file format: {input_path.suffix}")
            sys.exit(1)
        
        result = process_single_file(
            input_path, args.body_part, args.confidence_threshold,
            args.fps, output_dir, args.cmap, args.bins, args.sigma,
            arena_size, args.outlier_threshold, args.velocity_max, args.list_parts
        )
        
        if args.list_parts and result:
            print(f"\nAvailable body parts: {', '.join(result)}")
    
    elif input_path.is_dir():
        files = sorted(input_path.glob("*.h5")) + sorted(input_path.glob("*.csv")) + sorted(input_path.glob("*.hdf5"))
        
        if not files:
            print(f"No .h5 or .csv files found in: {input_path}")
            sys.exit(1)
        
        print(f"Found {len(files)} files to process")
        print("-" * 50)
        
        # First pass: calculate all heatmaps and find global max for unified colorbar
        print("\n[Pass 1/2] Calculating velocity heatmaps to determine unified colorbar range...")
        all_heatmaps = []
        global_max = 0.0
        
        for i, file_path in enumerate(files, 1):
            print(f"  [{i}/{len(files)}] {file_path.name}")
            heatmap, xedges, yedges, selected_body_part = calculate_file_heatmap(
                file_path, args.body_part, args.confidence_threshold, args.fps,
                args.bins, args.sigma, arena_size, args.outlier_threshold
            )
            if heatmap is not None:
                all_heatmaps.append((file_path, heatmap, xedges, yedges, selected_body_part))
                if np.any(heatmap > 0):
                    file_max = np.percentile(heatmap[heatmap > 0], 99)
                    global_max = max(global_max, file_max)
        
        if not all_heatmaps:
            print("No valid heatmaps could be calculated.")
            sys.exit(1)
        
        global_max = max(global_max, 0.1)
        print(f"\nUnified colorbar range: 0 to {global_max:.4f}")
        print("-" * 50)
        
        # Second pass: generate visualizations with unified colorbar
        print("\n[Pass 2/2] Generating visualizations with unified colorbar...")
        
        for i, (file_path, heatmap, xedges, yedges, selected_body_part) in enumerate(all_heatmaps, 1):
            print(f"\n[{i}/{len(all_heatmaps)}] {file_path.name}")
            
            # Reload data for visualization
            try:
                df = load_tracking_data(file_path)
                col_names = get_column_names(df, selected_body_part)
                if not col_names:
                    continue
                x, y, confidence = clean_data(df, col_names['x'], col_names['y'],
                                              col_names.get('confidence'), args.outlier_threshold)
                
                velocity = calculate_velocity(x, y, args.fps)
                
                group = detect_group(file_path.stem)
                title = f"{file_path.stem} ({group})"
                
                fig = generate_velocity_heatmap_figure(
                    heatmap, xedges, yedges, x.values, y.values, velocity.values, confidence.values,
                    args.confidence_threshold, title, args.cmap, selected_body_part, global_max
                )
                
                output_dir.mkdir(parents=True, exist_ok=True)
                output_file = output_dir / f"{file_path.stem}_velocity.png"
                fig.savefig(output_file, dpi=150, bbox_inches='tight')
                plt.close(fig)
                print(f"  Saved: {output_file}")
                
            except Exception as e:
                print(f"  Error: {e}")
                continue
        
        print("\n" + "=" * 50)
        print(f"All done! Results saved to: {output_dir}")


if __name__ == "__main__":
    main()
