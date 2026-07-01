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

    if args.hf_mirror:
        os.environ["HF_ENDPOINT"] = args.hf_mirror
        emit_event("setup", "info", f"using HF mirror: {args.hf_mirror}")

    try:
        for repo_id, sub in REPOS:
            target = kb.models_dir / sub
            if (target / "config.json").exists():
                emit_event("setup", "info", f"{sub}: already present, skipping")
                continue
            emit_event("setup", "info", f"downloading {repo_id} -> {target}")
            download_one(repo_id, target)
            emit_event("setup", "info", f"{sub}: download complete")
        emit_event("setup", "done", "models ready", models_dir=str(kb.models_dir))
    except Exception as exc:  # noqa: BLE001
        emit_fatal("setup", "model download failed", exc)


if __name__ == "__main__":
    main()
