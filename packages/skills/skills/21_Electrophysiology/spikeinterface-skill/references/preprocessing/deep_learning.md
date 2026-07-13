# Deep learning denoising
Source in repo: `spikeinterface/src/spikeinterface/preprocessing/deepinterpolation/`
Parent index: [INDEX.md](INDEX.md)
---

## Deep learning denoising

### deepinterpolate / DeepInterpolatedRecording

Wraps a trained DeepInterpolation model (Allen Institute). Requires `tensorflow` and
`deepinterpolation >= 0.2.0`.

```python
DeepInterpolatedRecording(
    recording,
    model_path: str,
    pre_frame: int = 30,
    post_frame: int = 30,
    pre_post_omission: int = 1,
    batch_size: int = 128,
    use_gpu: bool = True,
    predict_workers: int = 1,
    disable_tf_logger: bool = True,
    memory_gpu: int | None = None,
)
```

### train_deepinterpolation

```python
train_deepinterpolation(
    recordings: BaseRecording | list[BaseRecording],
    model_folder: str | Path,
    model_name: str,
    desired_shape: tuple[int, int],
    train_start_s: Optional[float] = None,
    train_end_s: Optional[float] = None,
    train_duration_s: Optional[float] = None,
    test_start_s: Optional[float] = None,
    test_end_s: Optional[float] = None,
    test_duration_s: Optional[float] = None,
    test_recordings: Optional[BaseRecording | list[BaseRecording]] = None,
    pre_frame: int = 30,
    post_frame: int = 30,
    pre_post_omission: int = 1,
    existing_model_path: Optional[str | Path] = None,
    verbose: bool = True,
    nb_gpus: int = 1,
    steps_per_epoch: int = 10,
    period_save: int = 100,
    apply_learning_decay: int = 0,
    nb_times_through_data: int = 1,
    learning_rate: float = 0.0001,
    loss: str = "mean_squared_error",
    nb_workers: int = -1,
    caching_validation: bool = False,
    run_uid: str = "si",
    network: Callable | None = None,
    use_gpu: bool = True,
    disable_tf_logger: bool = True,
    memory_gpu: Optional[int] = None,
)
# returns: model_path (Path)
```

`network=None` → uses `unet_single_ephys_1024`.
