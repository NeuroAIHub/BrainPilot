# EthoClaw Kinematic Parameter Generator Skill

This skill checks if .h5 files contain KinematicParameter data, and if not, generates it from the 2Dskeleton data using the generate_kinematic_parameter.py script.

Can process either a single .h5 file or multiple .h5 files in a directory.

## Process
1. Checks if /KinematicParameter exists in each .h5 file
2. If missing, determines FPS using available methods (H5 metadata, video file, or default)
3. Generates KinematicParameter data using the skeleton data
4. Saves the results back to each .h5 file

## Dependencies
- h5py
- numpy
- ffmpeg (for FPS detection from video)
- opencv-python (alternative for FPS detection)
- Custom pixel-to-mm calibration ratio (optional)

## Usage
Call this skill with the path to your .h5 file or directory containing .h5 files.