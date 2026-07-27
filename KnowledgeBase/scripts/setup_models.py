"""
One-shot installer for the bge-m3 embedding model and the bge-reranker-v2-m3
cross-encoder.

The two models together weigh ~2.5 GB and ship from HuggingFace. They are
downloaded once into ``<KB_ROOT>/models/`` and from then on every retrieval
path loads them directly off disk — no remote requests, no API key, no
network dependency at query time.

Usage::

    python setup_models.py
    python setup_models.py --kb-root /path/to/KnowledgeBase
    python setup_models.py --hf-mirror https://hf-mirror.com   # for users in CN

What it downloads
-----------------
    models/bge-m3/                  (BAAI/bge-m3              — embedding, 1024 dim)
    models/bge-reranker-v2-m3/      (BAAI/bge-reranker-v2-m3  — cross-encoder)

Both downloads are resumable (HF Hub caches per-file). Re-running the script
is a no-op after a clean install.
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    KbPaths,
    add_json_arg,
    add_kb_root_arg,
    emit_event,
    emit_fatal,
    enable_json_mode,
    resolve_kb_root,
)


REPOS = [
    ("BAAI/bge-m3",              "bge-m3"),
    ("BAAI/bge-reranker-v2-m3",  "bge-reranker-v2-m3"),
]


# ------- fine-grained progress plumbing ------------------------------------
# huggingface_hub.snapshot_download drives ONE aggregated tqdm bar that
# ticks up whenever ANY file's chunk lands on disk. We hook into that bar
# by supplying our own tqdm-compatible class via `tqdm_class=...` and
# translate its per-chunk `update(n)` calls into throttled NDJSON events —
# the frontend already knows how to render `progress` events with
# `percent`, so this lights up the existing progress bar with byte-level
# granularity for free.
#
# Throttling: bar.update() gets called *per HTTP chunk* (10s of KB), which
# would drown the SSE stream and the browser log panel. We coalesce into
# one event every ~PROGRESS_INTERVAL_SEC or whenever the integer percent
# ticks over — whichever comes first. Also always emit at 0% and 100% for
# each file span so the UI never sits on a stale line.
PROGRESS_INTERVAL_SEC = 0.5
# EWMA smoothing constant for the download-speed indicator. Higher =
# smoother but laggier. 0.3 matches curl's rolling-window feel.
SPEED_EWMA_ALPHA = 0.3


def _fmt_bytes(n: float) -> str:
    """Render a byte count as e.g. '512 KB', '2.3 GB'. Not localized —
    hf-mirror / huggingface both speak SI-ish units, keeps parity with the
    tqdm bar the user is used to seeing in the CLI."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"


def _fmt_eta(seconds: float | None) -> str:
    if seconds is None or seconds != seconds or seconds < 0:  # NaN / neg
        return "?"
    if seconds > 24 * 3600:
        return ">24h"
    h, rem = divmod(int(seconds), 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}m"
    if m:
        return f"{m}m{s:02d}s"
    return f"{s}s"


class _RepoProgressReporter:
    """Bridge from the snapshot_download aggregated tqdm bar → NDJSON
    progress events.

    One reporter is created per repo. It exposes a nested ``TqdmClass``
    that snapshot_download instantiates — every call to
    ``TqdmClass(total=..., initial=..., desc=...)`` extends the reporter's
    running totals, every ``update(n)`` bumps the byte counter, and every
    call is throttled through :meth:`_maybe_emit`.

    We can't share a single TqdmClass instance across repos because HF
    creates *one* aggregate bar per snapshot_download call and any
    per-file inner bar. Instead, we build the reporter per repo and give
    it a fresh factory each time.
    """

    def __init__(self, repo_id: str, repo_ordinal: int, repo_total: int,
                 sub: str, done_repos: int):
        self.repo_id = repo_id
        self.sub = sub
        self.repo_ordinal = repo_ordinal      # 1-indexed for humans
        self.repo_total = repo_total
        self.done_repos = done_repos          # repos fully done BEFORE this one
        # Running byte totals across all tqdm bars this snapshot_download
        # decided to spawn (aggregate + optional per-file bars).
        self.total_bytes: int = 0
        self.done_bytes: int = 0
        # Speed tracking (EWMA over ~1s windows).
        self._last_emit_ts: float = time.monotonic()
        self._last_emit_bytes: int = 0
        self._speed_bps: float = 0.0
        self._last_percent: int = -1
        self._current_file: str = ""

    # ---- called from _emit_progress or on file transitions ----------
    def _maybe_emit(self, force: bool = False) -> None:
        now = time.monotonic()
        elapsed = now - self._last_emit_ts
        pct = 0
        if self.total_bytes > 0:
            pct = int(self.done_bytes * 100 / self.total_bytes)
        percent_ticked = pct != self._last_percent
        # Only rate-limit chunk-driven ticks; force=True (start/end/finish
        # of a file) always fires so the UI never looks stalled.
        if not force and elapsed < PROGRESS_INTERVAL_SEC and not percent_ticked:
            return

        # EWMA speed. Guard elapsed>0 — the very first call has elapsed=0
        # because we set _last_emit_ts in __init__.
        delta_bytes = self.done_bytes - self._last_emit_bytes
        if elapsed > 0.01:
            instant = delta_bytes / elapsed
            self._speed_bps = (
                instant if self._last_emit_bytes == 0
                else SPEED_EWMA_ALPHA * instant + (1 - SPEED_EWMA_ALPHA) * self._speed_bps
            )
        eta = None
        if self._speed_bps > 0 and self.total_bytes > 0:
            eta = max(0.0, (self.total_bytes - self.done_bytes) / self._speed_bps)

        self._last_emit_ts = now
        self._last_emit_bytes = self.done_bytes
        self._last_percent = pct

        # Global percent (across all repos): each repo contributes an
        # equal slice of the whole "download bge weights" task. Within a
        # repo we scale its byte percent into that slice.
        repo_slice = 100.0 / self.repo_total
        global_pct = int(self.done_repos * repo_slice + pct * repo_slice / 100)
        global_pct = max(0, min(100, global_pct))

        # Compose a one-line human summary. The frontend shows this as
        # the progress row's `msg`; the numeric fields also flow through
        # so a future UI can render a real bytes-based bar.
        parts = [
            f"{self.sub} ({self.repo_ordinal}/{self.repo_total})",
            f"{_fmt_bytes(self.done_bytes)}/{_fmt_bytes(self.total_bytes) if self.total_bytes else '?'}",
            f"{pct}%",
        ]
        if self._speed_bps > 0:
            parts.append(f"{_fmt_bytes(self._speed_bps)}/s")
        if eta is not None:
            parts.append(f"ETA {_fmt_eta(eta)}")
        if self._current_file:
            parts.append(f"→ {self._current_file}")
        msg = "  ".join(parts)

        # Emit a `progress` event so the panel's setup-models bar advances.
        # We deliberately keep the well-known keys (`percent`, `done`,
        # `total`) at the byte level so the existing frontend deriver
        # picks up the new granularity without any UI change; the extra
        # numeric fields are additive for future consumers.
        emit_event(
            "setup-models", "progress", msg,
            percent=global_pct,
            done=self.done_bytes,
            total=self.total_bytes,
            repo=self.repo_id,
            repo_percent=pct,
            speed_bps=int(self._speed_bps),
            eta_sec=int(eta) if eta is not None else None,
            current_file=self._current_file or None,
        )

    # ---- tqdm-compatible factory ------------------------------------
    def make_tqdm_class(self) -> type:
        """Return a class object snapshot_download can instantiate as a
        tqdm. We can't just hand back a plain instance because HF spawns
        multiple bars (aggregate + optionally one per file)."""
        reporter = self

        class _ReportingTqdm:
            # tqdm-compatibility surface (issue #378 part 2). Newer tqdm
            # (>=4.68) and huggingface_hub (>=1.24) call methods on the
            # bar object that a plain class doesn't have — get_lock /
            # set_lock (via tqdm.contrib.concurrent.ensure_lock when
            # snapshot_download uses thread_map), set_postfix_str /
            # format_dict (via huggingface_hub._xet_progress_reporting),
            # plus clear/display for good measure. Without these, HF's
            # progress callback throws AttributeError on every chunk,
            # flooding stderr and stalling the UI progress bar. Downloads
            # still complete because the errors are non-fatal in the
            # callback, but the noise is user-visible. We shim the
            # methods here so callers get the interface they expect,
            # while keeping the NDJSON emit path (not stderr) as the
            # progress channel.
            _tqdm_lock = threading.RLock()

            # Some HF paths peek at .disable before doing anything else.
            # An explicit False keeps the shim active.
            disable = False

            # Signature is deliberately liberal — huggingface_hub /
            # tqdm.contrib.concurrent pass a wide range of kwargs.
            def __init__(self, *args, **kwargs):
                total = kwargs.get("total")
                initial = kwargs.get("initial", 0) or 0
                desc = kwargs.get("desc", "") or ""
                # Sub-bars (per-file) declare their own total and initial;
                # add both to the reporter so the aggregate stays honest.
                if isinstance(total, (int, float)) and total > 0:
                    reporter.total_bytes += int(total)
                if isinstance(initial, (int, float)) and initial > 0:
                    reporter.done_bytes += int(initial)
                # `desc` looks like "(…): filename" — snip the filename.
                if ":" in desc:
                    reporter._current_file = desc.split(":", 1)[1].strip()
                # Force a fresh emit at file transitions so the UI moves
                # even before the next chunk lands (helpful when a file
                # is being HEAD'd and no bytes flow for a few seconds).
                reporter._maybe_emit(force=True)

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc_value, traceback):
                # Files complete → nudge the aggregator so the very last
                # bytes of a file always translate into a visible tick.
                reporter._maybe_emit(force=True)
                return False

            def update(self, n: int | float | None = 1) -> None:
                if n:
                    # tqdm allows negative n (e.g. HF rewinds resume_size
                    # when a request errors); clamp negatives so the
                    # aggregate never goes backwards past what we've
                    # already reported as downloaded.
                    delta = int(n)
                    reporter.done_bytes = max(0, reporter.done_bytes + delta)
                reporter._maybe_emit()

            def refresh(self) -> None:
                reporter._maybe_emit(force=True)

            def set_description(self, desc: str | None = None,
                                refresh: bool = True) -> None:
                if desc and ":" in desc:
                    reporter._current_file = desc.split(":", 1)[1].strip()
                if refresh:
                    reporter._maybe_emit(force=True)

            def close(self) -> None:
                pass

            # ---- tqdm compatibility shims (#378 part 2) --------------
            @classmethod
            def get_lock(cls):
                # tqdm.contrib.concurrent.ensure_lock calls this as a
                # classmethod when snapshot_download uses thread_map.
                # A process-wide RLock is sufficient — the bar objects
                # are all bookkeeping into the same reporter.
                return cls._tqdm_lock

            @classmethod
            def set_lock(cls, lock) -> None:
                cls._tqdm_lock = lock

            def set_postfix_str(self, s: str = "",
                                refresh: bool = True) -> None:
                # huggingface_hub._set_aggregate_rate_postfix stitches an
                # aggregate rate line onto the outer bar via this call.
                # Surface it into `_current_file` so it flows through the
                # normal throttled emit path (and shows up in the UI).
                if s and (not reporter._current_file
                          or s not in reporter._current_file):
                    reporter._current_file = s
                if refresh:
                    reporter._maybe_emit(force=True)

            @property
            def format_dict(self):
                # Same caller reads .format_dict to format its postfix.
                # We provide the minimum keys tqdm's internal callers
                # consume; unknown keys are ignored.
                elapsed = max(
                    0.0, time.monotonic() - reporter._last_emit_ts + 0.001
                )
                return {
                    "n": reporter.done_bytes,
                    "total": reporter.total_bytes,
                    "elapsed": elapsed,
                    "rate": reporter._speed_bps or None,
                    "unit": "B",
                    "unit_scale": True,
                    "prefix": "",
                }

            def clear(self, nolock: bool = False) -> None:
                # tqdm.clear() would wipe an ANSI bar; we don't own an
                # ANSI channel, so just force-refresh the NDJSON emit so
                # the UI keeps ticking.
                reporter._maybe_emit(force=True)

            def display(self, msg: str | None = None,
                        pos: int | None = None) -> None:
                # Same idea as clear(): never touch stderr; just nudge
                # the throttled emitter.
                reporter._maybe_emit(force=True)

            def reset(self, total: int | float | None = None) -> None:
                if total is not None:
                    reporter.total_bytes = max(reporter.total_bytes, int(total))

            # Some HF versions read the parent bar's .total to size the
            # inner bars; give them a plausible answer.
            @property
            def total(self):
                return reporter.total_bytes

            @total.setter
            def total(self, v):
                if isinstance(v, (int, float)) and v > 0:
                    reporter.total_bytes = max(reporter.total_bytes, int(v))

            @property
            def n(self):
                return reporter.done_bytes

            @n.setter
            def n(self, v):
                if isinstance(v, (int, float)):
                    reporter.done_bytes = max(0, int(v))

        return _ReportingTqdm


def download_one(repo_id: str, local_dir: Path, token: str | None = None,
                 reporter: _RepoProgressReporter | None = None) -> None:
    from huggingface_hub import snapshot_download

    local_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo_id,
        local_dir=str(local_dir),
        # An authenticated HF token typically gets ~5× the anonymous
        # download rate (their per-IP throttling is quite aggressive for
        # multi-GB files). Passing None keeps the anonymous path so users
        # without an account still work.
        token=token,
        # Feed our aggregating tqdm shim so every downloaded byte becomes
        # a throttled progress event on stdout — enables the fine-grained
        # bar in the KB panel. When reporter is None (e.g. re-runs during
        # dev without going through main()) HF falls back to its default
        # tqdm which prints to stderr, which is also fine.
        tqdm_class=reporter.make_tqdm_class() if reporter is not None else None,
        # Skip the optional onnx / openvino / pytorch-msgpack / tflite weights;
        # FlagEmbedding only needs the safetensors / pytorch_model + tokenizer.
        # If FlagEmbedding ever asks for one of these we can drop the filter.
        #
        # Also skip README asset directories (imgs/) and macOS resource-fork
        # metadata (.DS_Store). Some HF mirrors (e.g. hf-mirror.com) return
        # 403 Forbidden on the .DS_Store entries that upstream shipped by
        # accident, and snapshot_download is all-or-nothing — one 403 in a
        # non-essential file aborts the whole 2 GB pull. These files are
        # irrelevant to model loading, so filtering them out is safe.
        ignore_patterns=[
            "*.onnx", "*.onnx_data", "onnx/*",
            "openvino/*",
            "tf_model.*", "*.tflite",
            "*.msgpack",
            "imgs/*", "**/imgs/*",
            "*.DS_Store", "**/.DS_Store",
        ],
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_kb_root_arg(ap)
    add_json_arg(ap)
    ap.add_argument("--hf-mirror", default=None,
                    help="Override HF endpoint (e.g. https://hf-mirror.com).")
    ap.add_argument("--hf-token", default=None,
                    help="HuggingFace access token. When omitted, falls back "
                         "to the HF_TOKEN / HUGGING_FACE_HUB_TOKEN env vars, "
                         "then to anonymous downloads. Authenticated pulls "
                         "typically get much higher throughput on the ~2.5 GB "
                         "bge weights.")
    args = ap.parse_args()

    enable_json_mode(args.json)
    kb = KbPaths(resolve_kb_root(args.kb_root))
    kb.mkdir()

    # Stage name is "setup-models" (not just "setup") so the frontend's
    # KnowledgeBase panel can route these events to their own progress row
    # separate from the venv "setup-env" row — the two setups run in
    # parallel when triggered from the one-click "Set up" button.
    if args.hf_mirror:
        os.environ["HF_ENDPOINT"] = args.hf_mirror
        emit_event("setup-models", "info", f"using HF mirror: {args.hf_mirror}")

    # Resolve the token BEFORE the first HTTP call. huggingface_hub also picks
    # up HF_TOKEN transparently, but doing it here lets us log "using token
    # (…abcd)" so an operator watching the panel knows they hit the auth path
    # and not the anonymous one — plus this way `--hf-token` beats the env
    # (explicit > implicit), which matches how every other CLI flag in the
    # pipeline resolves credentials.
    hf_token = args.hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    if hf_token:
        # Never emit the token itself into the event stream — the panel logs
        # are shown to the operator and echoed to disk in `~/brainpilot/logs/`.
        tail = hf_token[-4:] if len(hf_token) >= 4 else "****"
        emit_event("setup-models", "info", f"using HF token (…{tail})")

    try:
        n = len(REPOS)
        emit_event("setup-models", "progress", "starting model download",
                   percent=0, done=0, total=n)
        # Count how many repos are considered done at the START of each
        # iteration — a skipped repo increments this so the next repo's
        # global-percent math still adds up to 100 at the end.
        completed_repos = 0
        for i, (repo_id, sub) in enumerate(REPOS):
            target = kb.models_dir / sub
            # A completed download must have BOTH the config AND at least one
            # weight file. Using config.json alone is unsafe: HF pulls small
            # files first, so a Ctrl-C mid-download leaves config.json on disk
            # while the multi-GB weights are missing — the next run would then
            # skip and vectorize would OSError on load. When either check
            # fails we re-run snapshot_download, which resumes any partial
            # files via HF Hub's on-disk cache.
            has_weights = any(
                (target / name).exists()
                for name in ("model.safetensors", "pytorch_model.bin")
            )
            if (target / "config.json").exists() and has_weights:
                completed_repos += 1
                emit_event("setup-models", "info", f"{sub}: already present, skipping",
                           done=completed_repos, total=n,
                           percent=int(completed_repos * 100 / n))
                continue
            if target.exists() and not has_weights:
                emit_event("setup-models", "info",
                           f"{sub}: partial download detected, resuming…")
            # Emit a "progress" *before* the download so the progress bar
            # jumps to the correct start position — the fine-grained
            # byte-level events from the reporter take over from here.
            emit_event(
                "setup-models", "progress",
                f"downloading {repo_id} ({i + 1}/{n}) → {target.name}",
                done=completed_repos, total=n,
                percent=int(completed_repos * 100 / n),
                repo=repo_id,
            )
            reporter = _RepoProgressReporter(
                repo_id=repo_id, repo_ordinal=i + 1, repo_total=n,
                sub=sub, done_repos=completed_repos,
            )
            download_one(repo_id, target, token=hf_token, reporter=reporter)
            completed_repos += 1
            emit_event("setup-models", "progress",
                       f"{sub}: download complete "
                       f"({_fmt_bytes(reporter.done_bytes)})",
                       done=completed_repos, total=n,
                       percent=int(completed_repos * 100 / n),
                       repo=repo_id,
                       bytes_downloaded=reporter.done_bytes)
        emit_event("setup-models", "progress", "all models ready",
                   percent=100, done=n, total=n)
        emit_event("setup-models", "done", "models ready",
                   models_dir=str(kb.models_dir))
    except Exception as exc:  # noqa: BLE001
        emit_fatal("setup-models", "model download failed", exc)


if __name__ == "__main__":
    main()
