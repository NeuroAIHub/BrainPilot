# Motion — estimate_motion (dredge_ap + dredge_lfp)

Source in repo: `spikeinterface/src/spikeinterface/sortingcomponents/motion/dredge.py`
Parent index: [../INDEX.md](../INDEX.md)

---

#### `dredge_ap` — method_kwargs (forwarded to `dredge_ap()` function)

- `bin_um : float`, default `1.0`
- `bin_s : float`, default `1.0`
- `max_disp_um : float | None`, default `None` (auto `win_scale_um / 4`)
- `time_horizon_s : float`, default `1000.0`
- `mincorr : float`, default `0.1`
- `do_window_weights : bool`, default `True`
- `weights_threshold_low : float`, default `0.2`
- `weights_threshold_high : float`, default `0.2`
- `mincorr_percentile : float | None`, default `None`
- `mincorr_percentile_nneighbs : int | None`, default `None`
- `amp_scale_fn : callable | None`, default `None`
- `post_transform : callable`, default `np.log1p`
- `histogram_depth_smooth_um : float`, default `1`
- `histogram_time_smooth_s : float`, default `1`
- `avg_in_bin : bool`, default `False`
- `thomas_kw : dict | None`, default `None`
- `xcorr_kw : dict | None`, default `None`
- `device : str | torch.device | None`, default `None`
- `precomputed_D_C_maxdisp`, default `None`

Requires `torch`.

#### `dredge_lfp` — method_kwargs (forwarded to `dredge_online_lfp()`)

The `recording` argument is used as the LFP recording (peaks and
peak_locations are ignored).

- `chunk_len_s : float`, default `10.0`
- `max_disp_um : float`, default `500`
- `time_horizon_s : float | None`, default `None`
- `mincorr : float`, default `0.8`
- `mincorr_percentile : float | None`, default `None`
- `mincorr_percentile_nneighbs : int`, default `20`
- `soft : bool`, default `False`
- `thomas_kw : dict | None`, default `None`
- `xcorr_kw : dict | None`, default `None`
- `device : str | torch.device | None`, default `None`
- Note default `rigid=True` inside the function (overrides caller default).
