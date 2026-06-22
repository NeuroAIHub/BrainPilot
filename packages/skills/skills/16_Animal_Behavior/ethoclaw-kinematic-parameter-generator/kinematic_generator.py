#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Kinematic Parameter Generator Skill

This skill checks if a .h5 file contains KinematicParameter data, and if not, 
generates it from the 2Dskeleton data using the generate_kinematic_parameter.py logic.

If FPS is not available in the .h5 file, it attempts to read it from the associated video file
using either ffmpeg or OpenCV.
"""

import argparse
import os
import sys
from pathlib import Path
import h5py
import numpy as np


def check_kinematic_parameter_exists(h5_path):
    """
    Check if KinematicParameter exists in the .h5 file
    
    Args:
        h5_path (str or Path): Path to the .h5 file
        
    Returns:
        bool: True if KinematicParameter exists, False otherwise
    """
    h5_path = Path(h5_path)
    
    with h5py.File(str(h5_path), 'r') as h5_file:
        return 'KinematicParameter' in h5_file


def check_skeleton_data_exists(h5_path):
    """
    Check if 2Dskeleton data exists in the .h5 file
    
    Args:
        h5_path (str or Path): Path to the .h5 file
        
    Returns:
        bool: True if 2Dskeleton data exists, False otherwise
    """
    h5_path = Path(h5_path)
    
    with h5py.File(str(h5_path), 'r') as h5_file:
        return ('2Dskeleton' in h5_file and 
                'BodyParts' in h5_file['2Dskeleton'] and 
                'data2D' in h5_file['2Dskeleton'])


def get_fps_from_h5(h5_path):
    """
    Get FPS from the .h5 file if available
    
    Args:
        h5_path (str or Path): Path to the .h5 file
        
    Returns:
        float or None: FPS value if found and valid, None otherwise
    """
    h5_path = Path(h5_path)
    
    with h5py.File(str(h5_path), 'r') as h5_file:
        if 'VideoInfo' in h5_file and 'fps' in h5_file['VideoInfo']:
            try:
                fps = float(h5_file['VideoInfo']['fps'][()])
                if fps > 0:
                    return fps
            except Exception:
                pass
    return None


def find_associated_video(h5_path):
    """
    Find an associated video file with the same stem as the .h5 file
    
    Args:
        h5_path (str or Path): Path to the .h5 file
        
    Returns:
        Path or None: Path to the video file if found, None otherwise
    """
    h5_path = Path(h5_path)
    stem = h5_path.stem
    
    # Common video extensions
    video_extensions = ['.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.mpeg', '.mpg']
    
    # Look in the same directory as the .h5 file
    h5_dir = h5_path.parent
    
    for ext in video_extensions:
        video_path = h5_dir / (stem + ext)
        if video_path.exists():
            return video_path
            
    # If not found in the same directory, look in common subdirectories
    for subdir in ['videos', 'video', 'Videos', 'Video', 'data', 'Data']:
        sub_dir = h5_dir / subdir
        if sub_dir.exists() and sub_dir.is_dir():
            for ext in video_extensions:
                video_path = sub_dir / (stem + ext)
                if video_path.exists():
                    return video_path
    
    return None


def get_fps_from_video(video_path):
    """
    Get FPS from a video file using ffmpeg
    
    Args:
        video_path (str or Path): Path to the video file
        
    Returns:
        float: FPS value
    """
    import subprocess
    import shutil
    
    video_path = Path(video_path)
    
    # Check if ffprobe is available
    if shutil.which('ffprobe'):
        # Use ffprobe to get FPS
        cmd = [
            'ffprobe',
            '-v', 'error',
            '-select_streams', 'v:0',
            '-show_entries', 'stream=r_frame_rate',
            '-of', 'csv=p=0',
            str(video_path)
        ]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            fps_str = result.stdout.strip()
            
            # Handle fractional FPS (e.g., "30/1")
            if '/' in fps_str:
                num, den = fps_str.split('/')
                return float(num) / float(den)
            else:
                return float(fps_str)
        except subprocess.CalledProcessError:
            pass
    
    # Fallback to OpenCV if available
    try:
        import cv2
        cap = cv2.VideoCapture(str(video_path))
        fps = cap.get(cv2.CAP_PROP_FPS)
        cap.release()
        
        if fps and fps > 0:
            return float(fps)
    except ImportError:
        pass
    
    raise RuntimeError(f"Could not determine FPS from video: {video_path}. Neither ffprobe nor OpenCV worked.")


def run_generate_kinematic_parameter(h5_path, video_path=None, fps_default=30.0):
    """
    Run the generate_kinematic_parameter.py script on the .h5 file
    
    Args:
        h5_path (str or Path): Path to the .h5 file
        video_path (str or Path, optional): Path to associated video file
        fps_default (float): Default FPS to use if not found elsewhere
    """
    import subprocess
    import os
    
    # Get the path to the generate_kinematic_parameter.py script in the workspace
    script_path = Path(__file__).parent.parent / ".." / "generate_kinematic_parameter.py"
    
    # Build the command
    cmd = [
        sys.executable,  # Use the same Python interpreter
        str(script_path),
        "--h5", str(h5_path),
        "--fps-default", str(fps_default)
    ]
    
    # Add video path if provided
    if video_path:
        cmd.extend(["--video", str(video_path)])
    else:
        # Disable video search if no video path provided
        cmd.append("--no-search-video")
    
    # Execute the command
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        raise RuntimeError(f"Failed to run generate_kinematic_parameter.py:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}")
    
    print(result.stdout)
    if result.stderr:
        print("STDERR:", result.stderr)


def main():
    parser = argparse.ArgumentParser(description='Check and generate KinematicParameter data in .h5 files')
    parser.add_argument('--h5-path', required=True, help='Path to the .h5 file')
    parser.add_argument('--fps-default', type=float, default=30.0, help='Default FPS if not found in H5 or video')
    
    args = parser.parse_args()
    
    h5_path = Path(args.h5_path)
    
    if not h5_path.exists():
        raise FileNotFoundError(f"H5 file does not exist: {h5_path}")
    
    # Check if 2Dskeleton data exists
    if not check_skeleton_data_exists(h5_path):
        raise ValueError(f"No 2Dskeleton data found in {h5_path}")
    
    # Check if KinematicParameter already exists
    if check_kinematic_parameter_exists(h5_path):
        print(f"KinematicParameter already exists in {h5_path}")
        return
    
    print(f"KinematicParameter not found in {h5_path}, generating...")
    
    # Try to get FPS from H5 file
    fps = get_fps_from_h5(h5_path)
    
    if fps is not None:
        print(f"Using FPS from H5 file: {fps}")
        # Run the generation script with the FPS from H5
        run_generate_kinematic_parameter(h5_path, fps_default=fps)
    else:
        print("FPS not found in H5 file, looking for associated video...")
        
        # Find associated video file
        video_path = find_associated_video(h5_path)
        
        if video_path:
            print(f"Found associated video: {video_path}")
            try:
                fps = get_fps_from_video(video_path)
                print(f"Determined FPS from video: {fps}")
                # Run the generation script with the video
                run_generate_kinematic_parameter(h5_path, video_path=video_path)
            except RuntimeError as e:
                print(f"Could not get FPS from video: {e}")
                print(f"Using default FPS: {args.fps_default}")
                run_generate_kinematic_parameter(h5_path, fps_default=args.fps_default)
        else:
            print(f"No associated video found. Using default FPS: {args.fps_default}")
            run_generate_kinematic_parameter(h5_path, fps_default=args.fps_default)
    
    print(f"Processing completed for {h5_path}")


if __name__ == "__main__":
    main()