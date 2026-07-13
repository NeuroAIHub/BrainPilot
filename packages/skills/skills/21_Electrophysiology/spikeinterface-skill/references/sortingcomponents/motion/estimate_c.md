# Motion — estimate_motion (medicine)

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/motion/medicine.py`
Parent index: [../INDEX.md](../INDEX.md)

---

#### `medicine` — method_kwargs (from `MedicineRegistration.run`)

Requires the external `medicine` package.

- `bin_s : float`, default `1.0`
- `output_dir : Path | None`, default `None`
- `plot_figures : bool`, default `False`
- `motion_bound : float`, default `800`
- `time_kernel_width : float`, default `30`
- `activity_network_hidden_features : tuple`, default `(256, 256)`
- `amplitude_threshold_quantile : float`, default `0.0`
- `batch_size : int`, default `4096`
- `training_steps : int`, default `10_000`
- `initial_motion_noise : float`, default `0.1`
- `motion_noise_steps : int`, default `2000`
- `optimizer`, default `None` (falls back to `torch.optim.Adam`)
- `learning_rate : float`, default `0.0005`
- `epsilon : float`, default `1e-3`
