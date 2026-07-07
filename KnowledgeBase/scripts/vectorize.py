"""
Stage 4 / 4 — embed every chunk with bge-m3 and persist into a flat,
incremental vector store.

Output layout (``<KB_ROOT>/vectorstore/``):
    embeddings.npy   — float32 (N, 1024), L2-normalised rows
    chunks.jsonl     — one chunk per line, same order as embeddings.npy
    index.json       — {chunk_id -> row index}
    meta.json        — {dim, model, count, updated_at, normalized}

Incremental: rerunning embeds only chunk_ids not yet in ``index.json`` and
appends them. The in-memory matrix is rewritten atomically.

Model loading
-------------
By default this script loads bge-m3 **directly in-process** off
``<KB_ROOT>/models/bge-m3`` — no sidecar required. That matches the
"models live in the repo, deploy locally, not over the network" design.
If a sidecar is already running you can point at it with
``--server-url http://127.0.0.1:6100`` and the script will POST batches
to ``/embed`` instead.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

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


EMB_DIM = 1024
EMB_MAX_LENGTH = 1024     # tokens; chunks are ≤1500 chars (~400 EN tokens)
DEFAULT_BATCH = 16
DEFAULT_WORKERS_HTTP = 4
# Big-KB backstop: on stores with hundreds of thousands of chunks we don't
# want to emit thousands of progress events, so we still cap at one per
# PRINT_EVERY-embedded-chunks milestone. But we ALSO emit whenever more
# than PROGRESS_MIN_INTERVAL_SEC has passed since the last event, so small
# stores (a few dozen batches total, like a fresh install with 2 PDFs)
# don't sit on a stale "workers=4 batch=16 …" line while CPU inference
# grinds through each batch. See run_pipeline() for the emit gate.
PRINT_EVERY = 500
PROGRESS_MIN_INTERVAL_SEC = 0.5


# ── store IO ──────────────────────────────────────────────────────────────

def load_index(kb: KbPaths) -> dict:
    if not kb.index_json.exists():
        return {}
    with open(kb.index_json) as f:
        return json.load(f)


def save_index(kb: KbPaths, idx: dict) -> None:
    tmp = str(kb.index_json) + ".tmp"
    with open(tmp, "w") as f:
        json.dump(idx, f)
    os.replace(tmp, kb.index_json)


def save_meta(kb: KbPaths, count: int) -> None:
    meta = {
        "dim": EMB_DIM,
        "model": "BAAI/bge-m3",
        "count": count,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "normalized": True,
    }
    with open(kb.meta_json, "w") as f:
        json.dump(meta, f, indent=2)


def load_embeddings(kb: KbPaths) -> np.ndarray:
    if not kb.embeddings_npy.exists():
        return np.zeros((0, EMB_DIM), dtype=np.float32)
    return np.load(kb.embeddings_npy)


def write_embeddings(kb: KbPaths, matrix: np.ndarray) -> None:
    tmp = str(kb.embeddings_npy)[:-4] + ".tmp.npy"
    np.save(tmp, matrix.astype(np.float32))
    os.replace(tmp, kb.embeddings_npy)


def append_chunks_jsonl(kb: KbPaths, records: list[dict]) -> None:
    with open(kb.chunks_jsonl, "a", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


# ── encoder backends ──────────────────────────────────────────────────────

class InProcessEncoder:
    """Loads bge-m3 once with FlagEmbedding and encodes batches directly."""

    def __init__(self, kb: KbPaths):
        import torch
        from FlagEmbedding import BGEM3FlagModel

        if torch.cuda.is_available():
            device = "cuda:0"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
        emit_event("vectorize", "info",
                   f"loading bge-m3 from {kb.embed_model} (device={device})")
        self.model = BGEM3FlagModel(
            str(kb.embed_model),
            use_fp16=(device != "cpu"),
            device=device,
        )

    def encode(self, texts: list[str]) -> np.ndarray:
        out = self.model.encode(
            texts,
            batch_size=min(32, len(texts)),
            max_length=EMB_MAX_LENGTH,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=False,
        )
        vecs = np.asarray(out["dense_vecs"], dtype=np.float32)
        n = np.linalg.norm(vecs, axis=1, keepdims=True)
        n[n == 0] = 1.0
        return vecs / n


class HttpEncoder:
    """POST batches to a running model_server.py."""

    def __init__(self, url: str):
        import requests
        self.url = url.rstrip("/") + "/embed"
        self._requests = requests

    def encode(self, texts: list[str]) -> np.ndarray:
        for attempt in range(4):
            try:
                r = self._requests.post(
                    self.url,
                    json={"texts": texts, "max_length": EMB_MAX_LENGTH},
                    timeout=180,
                )
                r.raise_for_status()
                vecs = np.asarray(r.json()["embeddings"], dtype=np.float32)
                n = np.linalg.norm(vecs, axis=1, keepdims=True)
                n[n == 0] = 1.0
                return vecs / n
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2 ** attempt)
        raise RuntimeError("unreachable")


# ── main pipeline ─────────────────────────────────────────────────────────

def run_pipeline(
    kb: KbPaths,
    encoder,
    batch_size: int,
    workers: int,
) -> None:
    kb.mkdir()

    if not kb.chunks_json.exists():
        emit_fatal("vectorize",
                   f"chunks store missing: {kb.chunks_json} "
                   "(run chunk.py first)")
    emit_event("vectorize", "info", f"loading chunks from {kb.chunks_json}")
    with open(kb.chunks_json) as f:
        all_chunks = json.load(f).get("chunks", [])
    emit_event("vectorize", "info", f"chunks in source: {len(all_chunks)}",
               source_chunks=len(all_chunks))

    index = load_index(kb)
    emit_event("vectorize", "info", f"already embedded: {len(index)}",
               already=len(index))

    pending = [c for c in all_chunks if c["chunk_id"] not in index]
    emit_event("vectorize", "info", f"pending: {len(pending)}",
               pending=len(pending))
    if not pending:
        save_meta(kb, len(index))
        emit_event("vectorize", "done", "nothing to embed",
                   total=len(index))
        return

    existing_emb = load_embeddings(kb)
    batches = [pending[i:i + batch_size] for i in range(0, len(pending), batch_size)]
    emit_event(
        "vectorize", "info",
        f"workers={workers} batch={batch_size} total batches={len(batches)}",
    )

    results: dict[int, tuple[np.ndarray, list[dict]]] = {}
    t0 = time.time()
    done = 0
    fail = 0
    next_print = PRINT_EVERY
    last_emit_ts = t0

    # Kick off a 0% progress event so the panel bar leaves "pending grey"
    # even before the first batch lands. Without this, on a slow first
    # batch (CPU inference of a 16-chunk batch can take 30s+) the row
    # stays at 0% and looks stuck.
    emit_event(
        "vectorize", "progress",
        f"0/{len(pending)}  starting…",
        done=0, total=len(pending), percent=0,
        batches_done=0, batches_total=len(batches), fail=0,
    )

    # Workers don't help when the encoder runs in-process (Python's GIL
    # serialises them under the hood); keep it at 1 for InProcessEncoder.
    in_process = isinstance(encoder, InProcessEncoder)
    effective_workers = 1 if in_process else max(1, workers)

    batches_done = 0
    with ThreadPoolExecutor(max_workers=effective_workers) as ex:
        futures = {
            ex.submit(encoder.encode, [c["text"] for c in batch]): bi
            for bi, batch in enumerate(batches)
        }
        for fut in as_completed(futures):
            bi = futures[fut]
            batch = batches[bi]
            try:
                vecs = fut.result()
            except Exception as exc:  # noqa: BLE001
                fail += len(batch)
                batches_done += 1
                emit_event("vectorize", "warn",
                           f"batch {bi} failed: {type(exc).__name__}: {exc}")
                continue
            results[bi] = (vecs, batch)
            done += len(batch)
            batches_done += 1
            # Emit a progress event on ANY of:
            #   - crossed the next PRINT_EVERY milestone (big-KB throttle);
            #   - been quiet longer than PROGRESS_MIN_INTERVAL_SEC (keeps
            #     small-KB bars moving);
            #   - the final batch just landed (always fire terminal 100%).
            now = time.time()
            terminal = (batches_done == len(batches))
            if (done >= next_print
                    or now - last_emit_ts >= PROGRESS_MIN_INTERVAL_SEC
                    or terminal):
                elapsed = now - t0
                rate = done / elapsed if elapsed else 0
                remaining = max(0, len(pending) - done - fail)
                eta = (remaining / rate / 60) if rate else float("inf")
                emit_event(
                    "vectorize", "progress",
                    f"{done}/{len(pending)}  batch {batches_done}/{len(batches)}  "
                    f"rate={rate:.1f}/s ETA={eta:.1f}m fail={fail}",
                    done=done, total=len(pending),
                    percent=round(done * 100 / len(pending), 1),
                    batches_done=batches_done, batches_total=len(batches),
                    rate=round(rate, 1), eta_min=round(eta, 1), fail=fail,
                )
                next_print = done + PRINT_EVERY
                last_emit_ts = now

    emit_event("vectorize", "info",
               f"embed phase done in {time.time() - t0:.1f}s; stitching ...")

    new_emb_rows: list[np.ndarray] = []
    new_records: list[dict] = []
    for bi in sorted(results.keys()):
        vecs, batch = results[bi]
        new_emb_rows.append(vecs)
        new_records.extend(batch)

    if not new_emb_rows:
        emit_fatal("vectorize", "no embeddings produced (all batches failed)")

    new_matrix = np.vstack(new_emb_rows)
    combined = (np.vstack([existing_emb, new_matrix])
                if existing_emb.size else new_matrix)
    write_embeddings(kb, combined)
    append_chunks_jsonl(kb, new_records)

    base = existing_emb.shape[0]
    for offset, rec in enumerate(new_records):
        index[rec["chunk_id"]] = base + offset
    save_index(kb, index)
    save_meta(kb, combined.shape[0])

    emit_event(
        "vectorize", "done",
        f"store now has {combined.shape[0]} vectors ({len(new_records)} new, {fail} failed)",
        total=int(combined.shape[0]), new=len(new_records), fail=fail,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_kb_root_arg(ap)
    add_json_arg(ap)
    ap.add_argument("--batch", type=int, default=DEFAULT_BATCH)
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS_HTTP,
                    help="HTTP workers (ignored when running in-process).")
    ap.add_argument("--server-url", default=None,
                    help="If set (e.g. http://127.0.0.1:6100), POST batches to "
                         "a running model_server.py instead of loading the "
                         "model in-process.")
    args = ap.parse_args()

    enable_json_mode(args.json)
    kb = KbPaths(resolve_kb_root(args.kb_root))

    try:
        if args.server_url:
            encoder = HttpEncoder(args.server_url)
        else:
            if not kb.embed_model.exists():
                emit_fatal(
                    "vectorize",
                    f"bge-m3 weights not found at {kb.embed_model}; "
                    "run scripts/setup_models.py first or pass --server-url.",
                )
            encoder = InProcessEncoder(kb)
        run_pipeline(kb, encoder, args.batch, args.workers)
    except KeyboardInterrupt:
        emit_event("vectorize", "error", "interrupted by user")
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        emit_fatal("vectorize", "unexpected failure", exc)


if __name__ == "__main__":
    main()
