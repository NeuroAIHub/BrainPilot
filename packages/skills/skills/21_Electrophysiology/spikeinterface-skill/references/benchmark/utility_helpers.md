# Utility helpers

Source in repo: `spikeinterface/src/spikeinterface/benchmark/benchmark_tools.py`
Parent index: [INDEX.md](INDEX.md)
---

## Utility helpers

Defined in `spikeinterface/benchmark/benchmark_tools.py`.

```python
def sigmoid(x, x0, k, b):
    """
    Sigmoid centered at x0, slope k, baseline b:
        y = 1 / (1 + exp(-k * (x - x0))) + b
    Runtime warnings from `np.exp` are silenced.
    """

def fit_sigmoid(xdata, ydata, p0=None):
    """
    Fit a sigmoid to (xdata, ydata) using `scipy.optimize.curve_fit`.
    Returns the optimal (x0, k, b) tuple.
    """
```

These are used internally by `plot_performances_vs_snr(..., with_sigmoid_fit=True)` and by `PeakDetectionStudy.plot_template_similarities`.
