#!/usr/bin/env python3
"""
Batch process .h5 files to check for KinematicParameter and generate it if missing.
Also adds video information to VideoInfo if video is available.
If no .h5 files are found, processes .csv files and converts them to .h5 first.
"""

import argparse
import subprocess
import sys
from pathlib import Path
import h5py
import json
import os


def get_fps_from_video(video_path):
    """Extract FPS from video file using ffprobe."""
    import subprocess
    import json
    
    cmd = [
        'ffprobe',
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        str(video_path)
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        video_info = json.loads(result.stdout)
        
        # Find video stream
        for stream in video_info.get('streams', []):
            if stream.get('codec_type') == 'video':
                avg_frame_rate = stream.get('avg_frame_rate')
                if avg_frame_rate:
                    # avg_frame_rate is often in form "num/den" like "30/1"
                    if '/' in avg_frame_rate:
                        num, den = avg_frame_rate.split('/')
                        fps = float(num) / float(den) if float(den) != 0 else 30.0
                    else:
                        fps = float(avg_frame_rate)
                    return fps
        
        # Alternative: get from format if not in streams
        format_info = video_info.get('format', {})
        if 'avg_frame_rate' in format_info:
            avg_frame_rate = format_info['avg_frame_rate']
            if avg_frame_rate and avg_frame_rate != '0/0':
                if '/' in avg_frame_rate:
                    num, den = avg_frame_rate.split('/')
                    fps = float(num) / float(den) if float(den) != 0 else 30.0
                else:
                    fps = float(avg_frame_rate)
                return fps
    
    except Exception as e:
        print(f"  - Warning: Could not get FPS from video {video_path}: {e}")
        
        # Fallback to OpenCV
        try:
            import cv2
            cap = cv2.VideoCapture(str(video_path))
            fps = cap.get(cv2.CAP_PROP_FPS)
            cap.release()
            if fps and fps > 0:
                return fps
        except Exception as cv_e:
            print(f"  - Warning: OpenCV fallback also failed: {cv_e}")
    
    return 30.0  # Default FPS if all methods fail


def add_video_info_to_h5(h5_path, video_path, fps):
    """Add video information to the HDF5 file under /VideoInfo."""
    import subprocess
    import json
    
    # Get additional video info using ffprobe
    cmd = [
        'ffprobe',
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        str(video_path)
    ]
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        video_info = json.loads(result.stdout)
        
        # Extract video stream info
        video_stream = None
        for stream in video_info.get('streams', []):
            if stream.get('codec_type') == 'video':
                video_stream = stream
                break
        
        # Get format info
        format_info = video_info.get('format', {})
        
        # Add video info to HDF5
        with h5py.File(str(h5_path), 'a') as f:  # Open in append mode
            # Create or get VideoInfo group
            if 'VideoInfo' in f:
                vid_group = f['VideoInfo']
            else:
                vid_group = f.create_group('VideoInfo')
            
            # Add FPS
            if 'fps' in vid_group:
                del vid_group['fps']
            vid_group.create_dataset('fps', data=float(fps))
            
            # Add other video properties if available
            if video_stream:
                # Resolution
                width = video_stream.get('width')
                height = video_stream.get('height')
                
                if width:
                    if 'width' in vid_group:
                        del vid_group['width']
                    vid_group.create_dataset('width', data=int(width))
                
                if height:
                    if 'height' in vid_group:
                        del vid_group['height']
                    vid_group.create_dataset('height', data=int(height))
                
                # Codec
                codec_name = video_stream.get('codec_name')
                if codec_name:
                    if 'codec' in vid_group:
                        del vid_group['codec']
                    vid_group.create_dataset('codec', data=codec_name.encode('utf-8'))
                
                # Duration (from stream level)
                duration = video_stream.get('duration')
                if duration:
                    if 'duration' in vid_group:
                        del vid_group['duration']
                    vid_group.create_dataset('duration', data=float(duration))
                    
            # Add format-level info
            if format_info:
                # Duration (from format level)
                if 'duration' not in (video_stream or {}) and 'duration' in format_info:
                    duration = float(format_info['duration'])
                    if 'duration' in vid_group:
                        del vid_group['duration']
                    vid_group.create_dataset('duration', data=duration)
                
                # Bit rate
                bit_rate = format_info.get('bit_rate')
                if bit_rate:
                    if 'bit_rate' in vid_group:
                        del vid_group['bit_rate']
                    vid_group.create_dataset('bit_rate', data=int(bit_rate))
                
                # File size
                size = format_info.get('size')
                if size:
                    if 'size' in vid_group:
                        del vid_group['size']
                    vid_group.create_dataset('size', data=int(size))
    except Exception as e:
        print(f"  - Warning: Could not add detailed video info to {h5_path}: {e}")


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
    
    # Look in the current working directory
    for ext in video_extensions:
        video_path = Path.cwd() / (stem + ext)
        if video_path.exists():
            return video_path
    
    # Look in common subdirectories of the current directory
    for subdir in ['videos', 'video', 'Videos', 'Video', 'data', 'Data']:
        sub_dir = h5_dir / subdir
        if sub_dir.exists() and sub_dir.is_dir():
            for ext in video_extensions:
                video_path = sub_dir / (stem + ext)
                if video_path.exists():
                    return video_path
    
    # For typical project structures, look for related directories
    # E.g., if h5 is in 1_2Dskeleton, check for 0_videos
    parent_dir = h5_dir.parent
    if parent_dir.name.endswith('_2Dskeleton') or parent_dir.name.endswith('_2Dkeypoints'):
        # Try to find a sibling directory with videos
        project_dir = parent_dir.parent
        for sibling_dir in project_dir.iterdir():
            if sibling_dir.is_dir() and ('video' in sibling_dir.name.lower() or 
                                         '0_' in sibling_dir.name or 
                                         'raw' in sibling_dir.name.lower()):
                for ext in video_extensions:
                    video_path = sibling_dir / (stem + ext)
                    if video_path.exists():
                        return video_path
    
    # Try parent directory and its subdirectories
    for parent_level in range(1, 4):  # Go up to 3 levels
        cur_dir = h5_path
        for _ in range(parent_level):
            cur_dir = cur_dir.parent
            if cur_dir == cur_dir.parent:  # Reached root
                break
        else:
            # Check in this parent directory
            for ext in video_extensions:
                video_path = cur_dir / (stem + ext)
                if video_path.exists():
                    return video_path
            
            # Check subdirectories of this parent
            for subdir in cur_dir.iterdir():
                if subdir.is_dir():
                    for ext in video_extensions:
                        video_path = subdir / (stem + ext)
                        if video_path.exists():
                            return video_path
    
    return None


def csv_to_h5(csv_path, h5_output_path, fps=30.0):
    """
    Convert a CSV file containing 2D skeleton data to HDF5 format with 2Dskeleton group.
    
    Args:
        csv_path (str or Path): Path to the input CSV file
        h5_output_path (str or Path): Path for the output HDF5 file
        fps (float): Frames per second for the video
    """
    import pandas as pd
    import numpy as np
    import time
    import os

    # Read the CSV file
    df = pd.read_csv(csv_path)
    
    # Extract body parts from column names
    # Expected format: {bodypart}_x, {bodypart}_y, {bodypart}_confidence
    columns = df.columns.tolist()
    
    # Identify unique body parts
    body_parts = set()
    for col in columns:
        if '_' in col:
            bp = '_'.join(col.split('_')[:-1])  # Get everything before the last underscore
            if col.endswith(('_x', '_y', '_confidence')):
                body_parts.add(bp)
    
    body_parts = sorted(list(body_parts))  # Sort to ensure consistent order
    
    # Prepare the skeleton data array
    n_frames = len(df)
    n_body_parts = len(body_parts)
    
    # Create data in the format expected by the original script:
    # data2D should be (n_frames, n_bodyparts*3) -> [x, y, likelihood] per bodypart
    data2d = np.zeros((n_frames, n_body_parts * 3))  # x, y, confidence for each body part in flattened format
    
    # Map body parts to indices
    bp_to_idx = {bp: i for i, bp in enumerate(body_parts)}
    
    # Fill the skeleton data in the expected format
    for bp in body_parts:
        bp_idx = bp_to_idx[bp]
        x_col = f"{bp}_x"
        y_col = f"{bp}_y"
        conf_col = f"{bp}_confidence"
        
        if x_col in df.columns and y_col in df.columns and conf_col in df.columns:
            # Fill x, y, confidence in the flattened format
            data2d[:, bp_idx * 3 + 0] = df[x_col].values  # x coordinates
            data2d[:, bp_idx * 3 + 1] = df[y_col].values  # y coordinates
            data2d[:, bp_idx * 3 + 2] = df[conf_col].values  # confidence scores
    
    # Create HDF5 file with retry mechanism for WSL file locking issues
    max_retries = 5
    retry_delay = 2  # seconds
    
    for attempt in range(max_retries):
        try:
            # Ensure the output file doesn't exist to avoid locking issues
            if os.path.exists(h5_output_path):
                os.remove(h5_output_path)
                time.sleep(0.5)  # Brief pause after removal
            
            # Create HDF5 file
            with h5py.File(h5_output_path, 'w') as f:
                # Create 2Dskeleton group
                skel_group = f.create_group('2Dskeleton')
                
                # Store body parts as a dataset (expected by original script)
                skel_group.create_dataset('BodyParts', data=[bp.encode('utf-8') for bp in body_parts])
                
                # Store the skeleton data in the expected format (data2D)
                skel_group.create_dataset('data2D', data=data2d, compression='gzip')
                
                # Also store in the original format as backup (some files seem to use this)
                skeleton_data_backup = np.zeros((n_frames, n_body_parts, 3))  # x, y, confidence for each body part
                for bp in body_parts:
                    bp_idx = bp_to_idx[bp]
                    x_col = f"{bp}_x"
                    y_col = f"{bp}_y"
                    conf_col = f"{bp}_confidence"
                    
                    if x_col in df.columns and y_col in df.columns and conf_col in df.columns:
                        skeleton_data_backup[:, bp_idx, 0] = df[x_col].values  # x coordinates
                        skeleton_data_backup[:, bp_idx, 1] = df[y_col].values  # y coordinates
                        skeleton_data_backup[:, bp_idx, 2] = df[conf_col].values  # confidence scores
                
                skel_group.create_dataset('data', data=skeleton_data_backup, compression='gzip')
                
                # Store frame count and fps as attributes
                skel_group.attrs['frame_count'] = n_frames
                skel_group.attrs['fps'] = fps
                
                # Optionally add calibration info if available
                cal_group = f.create_group('CalibrationInfo')
                # Default to 1:1 pixel-to-mm ratio if not known
                cal_group.create_dataset('px_mm_ratio_x', data=1.0)
                cal_group.create_dataset('px_mm_ratio_y', data=1.0)
                
                print(f"  - Created HDF5 file from CSV: {h5_output_path}")
                print(f"    Body parts: {body_parts}")
                print(f"    Frames: {n_frames}")
                print(f"    FPS: {fps}")
            
            # Verification: Try to read the file back to confirm it was written correctly
            try:
                with h5py.File(h5_output_path, 'r') as f:
                    if '2Dskeleton' not in f or 'data2D' not in f['2Dskeleton']:
                        raise Exception("File created but missing expected structure")
                break  # Success, exit retry loop
            except Exception as verify_error:
                print(f"  - Verification failed, attempt {attempt + 1}: {verify_error}")
                if attempt == max_retries - 1:  # Last attempt
                    raise verify_error
                time.sleep(retry_delay)
                
        except Exception as e:
            print(f"  - Attempt {attempt + 1} failed: {e}")
            if attempt == max_retries - 1:  # Last attempt
                raise e
            time.sleep(retry_delay)


def run_generate_kinematic_parameter(h5_path, video_path=None, fps_default=30.0, ratio_default=1.0):
    """
    Run the generate_kinematic_parameter.py script on the .h5 file
    
    Args:
        h5_path (str or Path): Path to the .h5 file
        video_path (str or Path, optional): Path to associated video file
        fps_default (float): Default FPS to use if not found elsewhere
        ratio_default (float): Default pixel-to-mm ratio for calibration
    """
    import subprocess
    import os
    import time
    
    # Wait briefly before accessing the file to reduce locking conflicts
    time.sleep(1)
    
    # Get the path to the generate_kinematic_parameter.py script in the workspace
    script_path = Path(__file__).parent / "generate_kinematic_parameter.py"
    
    # If we have video info, we'll use the generate_kinematic_parameter script to add it,
    # since that script already handles both video info and kinematic parameter generation
    if video_path:
        fps = get_fps_from_video(video_path)
        # Use the actual FPS from video rather than default
        fps_for_gen = fps
    else:
        fps_for_gen = fps_default
    
    # Build the command
    cmd = [
        sys.executable,  # Use the same Python interpreter
        str(script_path),
        "--h5", str(h5_path),
        "--fps-default", str(fps_for_gen),
        "--ratio-default", str(ratio_default),
        "--overwrite"  # Allow overwriting if needed
    ]
    
    # Add video path if provided (this allows the script to potentially get more accurate FPS)
    # and enables video info extraction
    if video_path:
        cmd.extend(["--video", str(video_path)])
    else:
        # Disable video search if no video path provided
        cmd.append("--no-search-video")
    
    # Execute the command with retry mechanism
    max_retries = 3
    retry_delay = 2
    
    for attempt in range(max_retries):
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)  # 5 minute timeout
            
            if result.returncode != 0:
                raise RuntimeError(f"Failed to run generate_kinematic_parameter.py:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}")
            
            print(result.stdout)
            if result.stderr:
                print("STDERR:", result.stderr)
            
            # As a fallback, if VideoInfo wasn't added by the script but we have video info,
            # try to add it directly
            if video_path:
                # Wait before accessing file again
                time.sleep(1)
                
                # Check if VideoInfo was added by the script
                import h5py
                with h5py.File(str(h5_path), 'r') as f:
                    has_video_info = 'VideoInfo' in f and 'fps' in f['VideoInfo']
                
                if not has_video_info:
                    print("  - VideoInfo not found after processing, adding directly...")
                    fps = get_fps_from_video(video_path)
                    add_video_info_to_h5(h5_path, video_path, fps)
            
            break  # Success, exit retry loop
            
        except subprocess.TimeoutExpired:
            print(f"  - Command timed out on attempt {attempt + 1}, retrying...")
            if attempt == max_retries - 1:
                raise RuntimeError(f"Command timed out after {max_retries} attempts")
            time.sleep(retry_delay)
        except Exception as e:
            print(f"  - Attempt {attempt + 1} failed: {e}")
            if attempt == max_retries - 1:  # Last attempt
                raise e
            time.sleep(retry_delay)


def process_single_file(h5_path, fps_default=30.0, ratio_default=1.0):
    """
    Process a single .h5 file to check for KinematicParameter and generate if missing.
    
    Args:
        h5_path (str or Path): Path to the .h5 file
        fps_default (float): Default FPS to use if not found elsewhere
        ratio_default (float): Default pixel-to-mm ratio for calibration
        
    Returns:
        bool: True if successful, False otherwise
    """
    h5_path = Path(h5_path)
    
    print(f"Processing file: {h5_path}")
    
    try:
        # Check if KinematicParameter already exists
        with h5py.File(h5_path, 'r') as f:
            has_kinematic_param = 'KinematicParameter' in f
            has_2dskeleton = '2Dskeleton' in f
            has_video_info = 'VideoInfo' in f
        
        if has_kinematic_param:
            print(f"  - KinematicParameter already exists in {h5_path}")
            return True
        
        if not has_2dskeleton:
            print(f"  - ERROR: No 2Dskeleton data found in {h5_path}")
            return False
        
        # Look for associated video to get FPS
        video_path = find_associated_video(h5_path)
        if video_path:
            print(f"  - Found associated video: {video_path}")
            fps = get_fps_from_video(video_path)
            print(f"  - Determined FPS from video: {fps}")
        else:
            print(f"  - No associated video found. Using default FPS: {fps_default}")
            fps = fps_default
        
        # Run the generate_kinematic_parameter script with ratio parameter
        run_generate_kinematic_parameter(h5_path, video_path, fps_default, ratio_default)
        
        print(f"  - Processing completed for {h5_path}")
        return True
        
    except Exception as e:
        print(f"  - ERROR processing {h5_path}: {e}")
        import traceback
        traceback.print_exc()
        return False


def process_csv_to_h5_and_then_kinematics(csv_path, fps_default=30.0, ratio_default=1.0):
    """
    Convert a CSV file to HDF5 and then process it for kinematic parameters.
    
    Args:
        csv_path (str or Path): Path to the CSV file
        fps_default (float): Default FPS to use
        ratio_default (float): Default pixel-to-mm ratio for calibration
        
    Returns:
        bool: True if successful, False otherwise
    """
    csv_path = Path(csv_path)
    h5_path = csv_path.with_suffix('.h5')
    
    print(f"Converting CSV to HDF5: {csv_path} -> {h5_path}")
    
    try:
        # Convert CSV to HDF5
        csv_to_h5(csv_path, h5_path, fps_default)
        
        # Wait briefly to allow file system to settle before accessing the new file
        import time
        time.sleep(2)
        
        # Now process the newly created HDF5 file with ratio parameter
        success = process_single_file(h5_path, fps_default, ratio_default)
        
        return success
    except Exception as e:
        print(f"  - ERROR converting {csv_path} to HDF5: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description="Batch process .h5 files to check for KinematicParameter and generate if missing. If no .h5 files found, processes .csv files and converts them to .h5 first.")
    parser.add_argument("--h5-path", type=str, help="Single .h5 file path to process")
    parser.add_argument("--csv-path", type=str, help="Single .csv file path to convert and process")
    parser.add_argument("--directory", type=str, help="Directory containing .h5 or .csv files to process")
    parser.add_argument("--fps-default", type=float, default=30.0, help="Default FPS to use if not found elsewhere")
    parser.add_argument("--ratio-default", type=float, default=1.0, help="Default pixel-to-mm ratio for calibration (default: 1.0)")
    
    args = parser.parse_args()
    
    if args.h5_path:
        # Process single .h5 file
        success = process_single_file(args.h5_path, args.fps_default, args.ratio_default)
        if not success:
            sys.exit(1)
    elif args.csv_path:
        # Process single .csv file
        success = process_csv_to_h5_and_then_kinematics(args.csv_path, args.fps_default, args.ratio_default)
        if not success:
            sys.exit(1)
    elif args.directory:
        # Process directory - first check for .h5 files, then .csv files if no .h5 found
        directory = Path(args.directory)
        if not directory.exists():
            print(f"Error: Directory {directory} does not exist")
            sys.exit(1)
        
        # Find all .h5 files in the directory
        h5_files = list(directory.rglob('*.h5'))  # Use rglob for recursive search
        print(f"Found {len(h5_files)} .h5 files to process")
        
        # If no .h5 files found, look for .csv files
        if len(h5_files) == 0:
            csv_files = list(directory.rglob('*.csv'))  # Look for CSV files
            print(f"No .h5 files found, found {len(csv_files)} .csv files to convert and process")
            
            if len(csv_files) == 0:
                print("No .h5 or .csv files found in the specified directory")
                sys.exit(1)
            
            # Process each CSV file
            successful = 0
            failed = 0
            for i, csv_file in enumerate(csv_files):
                print(f"\nProcessing CSV file {i+1}/{len(csv_files)}: {csv_file.name}")
                success = process_csv_to_h5_and_then_kinematics(csv_file, args.fps_default, args.ratio_default)
                if success:
                    successful += 1
                else:
                    failed += 1
                
                # Add delay between files to reduce file locking conflicts in WSL
                if i < len(csv_files) - 1:  # Don't sleep after the last file
                    import time
                    print(f"Waiting 3 seconds before processing next file...")
                    time.sleep(3)
            
            print(f"\nCSV conversion and processing complete!")
            print(f"Successful: {successful}")
            print(f"Failed: {failed}")
            print(f"Total: {len(csv_files)}")
            
            if failed > 0:
                print(f"Note: {failed} files failed due to WSL file locking issues. Consider re-running failed files individually.")
                # Don't exit with error code if some files succeeded, as partial success is still valuable
                if successful == 0:
                    sys.exit(1)
        else:
            # Process each .h5 file
            successful = 0
            failed = 0
            for i, h5_file in enumerate(h5_files):
                print(f"\nProcessing HDF5 file {i+1}/{len(h5_files)}: {h5_file.name}")
                success = process_single_file(h5_file, args.fps_default, args.ratio_default)
                if success:
                    successful += 1
                else:
                    failed += 1
                
                # Add delay between files to reduce file locking conflicts in WSL
                if i < len(h5_files) - 1:  # Don't sleep after the last file
                    import time
                    print(f"Waiting 2 seconds before processing next file...")
                    time.sleep(2)
            
            print(f"\nProcessing complete!")
            print(f"Successful: {successful}")
            print(f"Failed: {failed}")
            print(f"Total: {len(h5_files)}")
            
            if failed > 0:
                print(f"Note: {failed} files failed due to WSL file locking issues. Consider re-running failed files individually.")
                # Don't exit with error code if some files succeeded, as partial success is still valuable
                if successful == 0:
                    sys.exit(1)
    else:
        print("Error: Either --h5-path, --csv-path or --directory must be specified")
        sys.exit(1)


if __name__ == "__main__":
    main()