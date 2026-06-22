# SuperAnimal & Model Zoo Reference

## Table of Contents
1. [SuperAnimal Overview](#superanimal-overview)
2. [Zero-Shot Inference](#zero-shot-inference)
3. [Fine-Tuning a SuperAnimal Model](#fine-tuning-a-superanimal-model)
4. [Available Models](#available-models)

## SuperAnimal Overview

SuperAnimal models are pretrained across diverse datasets and can perform pose estimation on new animals without any additional training data. They support:
- Top-view mice (various strains, fur colors)
- Quadrupeds (dogs, horses, sheep, pigs, cheetahs, etc.)
- Primate/human faces

## Zero-Shot Inference

Use `video_inference_superanimal` for out-of-the-box inference without any labeled data:

```python
import deeplabcut as dlc

# Single video inference
dlc.video_inference_superanimal(
    videos=["/path/to/video.mp4"],
    superanimal_name="superanimal_topviewmouse",
    model_name="hrnet_w32",
    detector_name="fasterrcnn_resnet50_fpn_v2",
    scale_list=[200, 300, 400],
    videotype=".mp4",
)
```

**Key parameters:**

| Parameter | Description |
|-----------|-------------|
| `videos` | List of video paths |
| `superanimal_name` | Which pretrained model to use |
| `model_name` | Pose model: `hrnet_w32`, `hrnet_w48` |
| `detector_name` | Detector: `fasterrcnn_resnet50_fpn_v2` |
| `scale_list` | Scales to try for detection; `[200, 300, 400]` is a good default. Larger animals → lower values (e.g. `[100, 200]`), smaller → higher (e.g. `[400, 600]`) |

## Fine-Tuning a SuperAnimal Model

When you have some labeled data, fine-tune for better accuracy:

```python
# Create a project from a SuperAnimal model
config_path = dlc.create_pretrained_project(
    path="my-superanimal-project",
    task="my_task",
    videos=["/path/to/video.mp4"],
    superanimal_name="superanimal_topviewmouse",
    model_name="hrnet_w32",
    detector_name="fasterrcnn_resnet50_fpn_v2",
    working_directory="/path/to/projects",
    copy_videos=False,
)

# Now use the standard pipeline:
# 1. extract_frames -> 2. label_frames -> 3. create_training_dataset -> 4. train_network
# The pretrained weights give a huge head start; often 5K-20K iterations suffice.
```

## Available Models

### Pose Models (`model_name`)

| Model | Description |
|-------|-------------|
| `hrnet_w32` | Default, good balance of speed/accuracy |
| `hrnet_w48` | Higher accuracy, more parameters |
| `resnet_50` | ResNet-50 backbone |
| `resnet_101` | ResNet-101 backbone |

### Detectors (`detector_name`)

| Detector | Description |
|----------|-------------|
| `fasterrcnn_resnet50_fpn_v2` | Default, good for multi-animal |
| `fasterrcnn_mobilenet_v3_large_fpn` | Lighter, faster |

### SuperAnimal Species

| `superanimal_name` | Species | Keypoints |
|---------------------|---------|-----------|
| `superanimal_topviewmouse` | Top-view mice | 21 (nose, ears, limbs, tail base) |
| `superanimal_quadruped` | Dogs, horses, sheep, pigs, etc. | 39 |
| `superanimal_face` | Primate/human faces | 54 |
| `superanimal_full` | Combined topview mouse + quadruped | Combined |

## Tips

- **Scale is critical**: If detections are poor, tune `scale_list`. Each value represents a different box size. Start with `[200, 300, 400]` and expand the range if needed.
- **GPU required**: SuperAnimal models require a GPU for practical use.
- **`create_pretrained_project` uses symbolic links**: the model weights are linked, not copied, so don't delete the original.
- **dlclibrary**: Models are downloaded via `dlclibrary` from HuggingFace on first use.
