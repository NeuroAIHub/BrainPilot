# EthoClaw Kinematic Parameter Generator Skill

This skill checks if .h5 files contain KinematicParameter data, and if not, generates it from the 2Dskeleton data using the generate_kinematic_parameter.py script.

Can process either a single .h5 file or multiple .h5 files in a directory.

## Description
This skill automates the process of generating kinematic parameters from 2D skeleton data stored in HDF5 files. It:
1. Checks if `/KinematicParameter` exists in the .h5 file(s)
2. If missing, determines FPS using available methods (H5 metadata, video file, or default)
3. Generates KinematicParameter data using the skeleton data
4. Saves the results back to the .h5 file(s)

## Prerequisites
- h5py
- numpy
- ffmpeg (for FPS detection from video)
- opencv-python (alternative for FPS detection)

## Usage
When you encounter .h5 files that need KinematicParameter data, activate this skill. It will automatically:
- Process a single .h5 file or all .h5 files in a directory
- Check for existing KinematicParameter data
- Check for 2Dskeleton data (required)
- Determine FPS from H5 metadata, associated video file, or use a default
- Generate the KinematicParameter dataset if it doesn't exist
- Save the results in-place to the .h5 file(s)

## Parameters
- `--h5-path`: Path to a single .h5 file to process
- `--directory`: Path to a directory containing .h5 files to process in batch
- `--fps-default`: Default FPS to use if not found in H5 or associated video (default: 30.0)
- `--ratio-default`: Default pixel-to-mm ratio to use for calibration (default: 1.0)

## How it Works
1. The skill first checks if `/KinematicParameter` exists in each HDF5 file
2. If not found, it checks for the required `/2Dskeleton` group with BodyParts and data2D datasets
3. It attempts to find FPS information in the H5 file under `/VideoInfo/fps`
4. If FPS isn't in the H5 file, it searches for an associated video file with the same stem
5. It uses ffmpeg or OpenCV to extract FPS from the video file
6. Finally, it runs the generate_kinematic_parameter.py script to create the KinematicParameter data