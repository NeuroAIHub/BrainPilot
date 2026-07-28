"""
Smoke tests for `_ReportingTqdm` — the tqdm-compatible shim inside
setup_models.py::_RepoProgressReporter.make_tqdm_class().

Runs with plain stdlib:
    python -m unittest KnowledgeBase/scripts/test_reporting_tqdm.py

The shim exists because huggingface_hub + tqdm expect specific methods on
the progress-bar class. When they were missing (issue #378), snapshot_download
either flooded stderr with AttributeError (call-time) or blew up mid-context
(exit-time — a worse regression the initial shim actually introduced with a
misnamed `_lock` attribute). These tests pin the shape of the contract so a
future edit can't silently reintroduce either failure.

Two dependencies (`tqdm`, `huggingface_hub`) are OPTIONAL — where a test needs
either, it is skipped when the import fails, so this file can run on a
freshly-checked-out repo without setup_env.sh first.
"""
from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path

# The scripts dir must be on sys.path so `_common` resolves; setup_models
# itself does the same insert at import time.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Ensure `_common.emit_event` doesn't try to open a JSON writer we don't
# have. The shim under test emits NDJSON to stdout on every state change
# — swallow it in tests so the unittest output stays readable.
import _common  # noqa: E402
_common.enable_json_mode()

from setup_models import _RepoProgressReporter  # noqa: E402


class _QuietTest(unittest.TestCase):
    """Base class that captures the NDJSON stdout the shim would emit — it
    is noise for unit-test output but real signal in production, so we
    redirect rather than mock it."""

    def setUp(self) -> None:
        self._stdout_capture = io.StringIO()
        self._stdout_ctx = redirect_stdout(self._stdout_capture)
        self._stdout_ctx.__enter__()

    def tearDown(self) -> None:
        self._stdout_ctx.__exit__(None, None, None)


def _make_shim():
    reporter = _RepoProgressReporter("test/x", 1, 1, "test", 0)
    Klass = reporter.make_tqdm_class()
    return reporter, Klass


class LockContractTests(_QuietTest):
    """The bug that caused this PR: ensure `_lock` (not `_tqdm_lock`) is the
    attribute name, so `tqdm.contrib.concurrent.ensure_lock` doesn't crash on
    `del cls._lock` at context exit."""

    def test_get_lock_lazy_creates_underscore_lock(self):
        _, K = _make_shim()
        # Prior to get_lock() the attribute may not exist on THIS subclass.
        lock = K.get_lock()
        self.assertIsNotNone(lock)
        self.assertIs(K._lock, lock)

    def test_set_lock_writes_underscore_lock(self):
        _, K = _make_shim()
        sentinel = object()
        K.set_lock(sentinel)
        self.assertIs(K._lock, sentinel)

    def test_ensure_lock_context_manager_exits_cleanly(self):
        """Full round-trip through tqdm's own ensure_lock helper. This is
        what snapshot_download's thread_map path does under the hood.
        Skipped if tqdm isn't installed (dev without KB venv)."""
        try:
            from tqdm.contrib.concurrent import ensure_lock
        except Exception as e:  # noqa: BLE001
            self.skipTest(f"tqdm not installed: {e}")

        _, K = _make_shim()
        # Simulate a class that has NEVER had a lock — this is the exit
        # path where the bug hit (`del cls._lock` on a missing attribute).
        if hasattr(K, "_lock"):
            del K._lock
        with ensure_lock(K) as lock:
            self.assertIsNotNone(lock)
        # After the context, `_lock` should be gone again (per tqdm semantics).
        self.assertFalse(hasattr(K, "_lock"))


class PostfixTests(_QuietTest):
    """`set_postfix_str` MUST NOT overwrite `_current_file` — HF passes an
    aggregate-rate string here, and clobbering the per-file label makes the
    UI oscillate between filename and rate."""

    def test_set_postfix_str_does_not_mutate_current_file(self):
        reporter, K = _make_shim()
        inst = K(total=100, initial=0, desc="test: real_file.bin")
        # __init__ populates _current_file from the desc.
        self.assertEqual(reporter._current_file, "real_file.bin")

        inst.set_postfix_str("12.3MB/s")
        # _current_file preserved; postfix routed separately.
        self.assertEqual(reporter._current_file, "real_file.bin")
        self.assertEqual(reporter._postfix, "12.3MB/s")


class FormatDictTests(_QuietTest):
    """`format_dict` is unpacked as **kwargs into tqdm.format_meter; a
    missing key TypeErrors. We must expose the full set of tqdm.std keys."""

    # Keys tqdm's own format_meter accepts (tqdm/std.py::format_dict), plus
    # a few callers-outside-tqdm read (`elapsed`, `rate`, `unit`, `unit_scale`).
    REQUIRED_KEYS = frozenset({
        "n", "total", "elapsed", "rate",
        "prefix", "postfix",
        "unit", "unit_scale", "unit_divisor",
        "ncols", "nrows",
        "initial", "colour", "ascii", "bar_format",
        "dynamic_ncols", "smoothing",
        "miniters", "mininterval", "maxinterval",
    })

    def test_all_expected_keys_present(self):
        _, K = _make_shim()
        inst = K(total=100, initial=0, desc="test: file.bin")
        fd = inst.format_dict
        missing = self.REQUIRED_KEYS - set(fd.keys())
        self.assertFalse(
            missing, f"format_dict missing keys: {sorted(missing)}",
        )

    def test_elapsed_measured_from_start_not_last_emit(self):
        """The bug fixed alongside B1: `elapsed` used to reset to zero on
        every emit tick, making downstream rate computations nonsensical."""
        import time
        reporter, K = _make_shim()
        inst = K(total=1000, initial=0, desc="")
        time.sleep(0.05)
        inst.update(10)  # this bumps _last_emit_ts as a side-effect
        time.sleep(0.05)
        fd = inst.format_dict
        # Must be at least 0.1s cumulative since __init__, NOT since the
        # last _maybe_emit call (~0.05s).
        self.assertGreaterEqual(fd["elapsed"], 0.09,
                                f"elapsed={fd['elapsed']} looks reset per-emit")

    def test_rate_is_none_when_no_speed(self):
        """tqdm's own format_dict returns None (not 0) for unknown rates —
        callers use `if rate is None:` guards."""
        _, K = _make_shim()
        inst = K(total=100, initial=0, desc="")
        fd = inst.format_dict
        # No update() → no speed sample → rate should be None, not 0.
        self.assertIsNone(fd["rate"])


class ClearDisplayTests(_QuietTest):
    """`clear` / `display` are called on every refresh by tqdm. They MUST
    NOT force-emit — that resets `_last_emit_ts` without updating the EWMA,
    freezing the speed indicator."""

    def test_clear_and_display_are_no_ops(self):
        reporter, K = _make_shim()
        inst = K(total=100, initial=0, desc="")
        before_ts = reporter._last_emit_ts
        inst.clear()
        inst.display("anything")
        # _last_emit_ts must not have moved.
        self.assertEqual(reporter._last_emit_ts, before_ts)


class UpdateAndTotalTests(_QuietTest):
    """Sanity — original behaviour still works: byte-level accounting and
    negative-clamp on rewinds."""

    def test_update_accumulates(self):
        reporter, K = _make_shim()
        inst = K(total=100, initial=0, desc="")
        inst.update(30)
        inst.update(20)
        self.assertEqual(reporter.done_bytes, 50)

    def test_update_negative_clamps_to_zero(self):
        reporter, K = _make_shim()
        inst = K(total=100, initial=0, desc="")
        inst.update(-999)
        self.assertGreaterEqual(reporter.done_bytes, 0)


if __name__ == "__main__":
    unittest.main()
