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


def download_one(repo_id: str, local_dir: Path) -> None:
    from huggingface_hub import snapshot_download

    local_dir.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=repo_id,
        local_dir=str(local_dir),
        # Skip the optional onnx / openvino / pytorch-msgpack / tflite weights;
        # FlagEmbedding only needs the safetensors / pytorch_model + tokenizer.
        # If FlagEmbedding ever asks for one of these we can drop the filter.
        ignore_patterns=[
            "*.onnx", "*.onnx_data", "onnx/*",
            "openvino/*",
            "tf_model.*", "*.tflite",
            "*.msgpack",
        ],
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_kb_root_arg(ap)
    add_json_arg(ap)
    ap.add_argument("--hf-mirror", default=None,
                    help="Override HF endpoint (e.g. https://hf-mirror.com).")
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

    try:
        n = len(REPOS)
        emit_event("setup-models", "progress", "starting model download",
                   percent=0, done=0, total=n)
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
                emit_event("setup-models", "info", f"{sub}: already present, skipping",
                           done=i + 1, total=n, percent=int((i + 1) * 100 / n))
                continue
            if target.exists() and not has_weights:
                emit_event("setup-models", "info",
                           f"{sub}: partial download detected, resuming…")
            # Emit a "progress" *before* the download so the progress bar
            # jumps to the correct start position; the actual HF tqdm bytes
            # come through as `log` events under the log panel.
            emit_event(
                "setup-models", "progress",
                f"downloading {repo_id} ({i + 1}/{n}) → {target.name}",
                done=i, total=n, percent=int(i * 100 / n),
            )
            download_one(repo_id, target)
            emit_event("setup-models", "progress",
                       f"{sub}: download complete",
                       done=i + 1, total=n, percent=int((i + 1) * 100 / n))
        emit_event("setup-models", "progress", "all models ready",
                   percent=100, done=n, total=n)
        emit_event("setup-models", "done", "models ready",
                   models_dir=str(kb.models_dir))
    except Exception as exc:  # noqa: BLE001
        emit_fatal("setup-models", "model download failed", exc)


if __name__ == "__main__":
    main()
