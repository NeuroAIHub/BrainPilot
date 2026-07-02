"""
Local bge-m3 + bge-reranker-v2-m3 sidecar.

This is NOT a public web service — it is a single-user, loopback-only HTTP
process the BrainPilot runtime spawns lazily on first knowledge-base query
and tears down on shutdown. Models are loaded directly off the
``<KB_ROOT>/models/`` directory; the only "network" hop is to 127.0.0.1.

Endpoints:
    GET  /health   — liveness + load status
    POST /embed    — dense embedding (1024-dim)
    POST /rerank   — cross-encoder scores

Why a sidecar at all?
---------------------
bge-m3 and bge-reranker-v2-m3 are PyTorch models. Loading them takes 5–20 s
and 2.5 GB of RAM. Re-loading per query is unaffordable, and embedding
Python into the Node runtime is a non-starter. The sidecar pattern lets:
  - the runtime call a tiny REST surface (in-process Python via fetch)
  - the model live for the lifetime of the BrainPilot session
  - GPU users transparently benefit (CUDA / MPS auto-detected by Torch)
  - the same script work as a one-off CLI: ``python model_server.py --port 6101``

The runtime starts this with ``--port 0`` to pick a free port and reads
the chosen port from ``--port-file``; that's what avoids the
"a developer is already running bge on 6100" headache.
"""
from __future__ import annotations

import argparse
import logging
import os
import socket
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import torch
import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from _common import KbPaths, resolve_kb_root  # noqa: E402


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("kb-models")


DEFAULT_MAX_LENGTH = 8192

embedder = None
reranker = None
KB: KbPaths | None = None  # set by main(), used by the lifespan handler


def _pick_device() -> str:
    if torch.cuda.is_available():
        return "cuda:0"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


@asynccontextmanager
async def lifespan(app: FastAPI):
    global embedder, reranker
    assert KB is not None, "KB paths not initialised"
    device = _pick_device()
    use_fp16 = device != "cpu"  # fp16 on cpu is slow / unsupported on some ops

    logger.info("loading bge-m3 from %s (device=%s fp16=%s)",
                KB.embed_model, device, use_fp16)
    from FlagEmbedding import BGEM3FlagModel
    embedder = BGEM3FlagModel(
        str(KB.embed_model),
        use_fp16=use_fp16,
        device=device,
    )
    logger.info("bge-m3 loaded")

    # bge-reranker-v2-m3 is an XLM-Roberta cross-encoder. We load it via
    # transformers directly instead of FlagEmbedding.FlagReranker because
    # FlagEmbedding 1.4.0's compute_score() path calls
    # tokenizer.prepare_for_model() — a method the slow XLMRobertaTokenizer
    # dropped in transformers >= 5. Using AutoTokenizer(use_fast=True) +
    # AutoModelForSequenceClassification sidesteps that bug entirely and
    # gives us the same score semantics (sigmoid-normalised logits).
    logger.info("loading bge-reranker-v2-m3 from %s", KB.reranker_model)
    from transformers import AutoModelForSequenceClassification, AutoTokenizer
    reranker_tokenizer = AutoTokenizer.from_pretrained(
        str(KB.reranker_model), use_fast=True,
    )
    # transformers >= 5 renamed torch_dtype → dtype; use the new name.
    reranker_model = AutoModelForSequenceClassification.from_pretrained(
        str(KB.reranker_model),
        dtype=torch.float16 if use_fp16 else torch.float32,
    ).to(device).eval()
    reranker = {
        "tokenizer": reranker_tokenizer,
        "model": reranker_model,
        "device": device,
    }
    logger.info("bge-reranker-v2-m3 loaded")

    yield

    del embedder, reranker
    if device.startswith("cuda"):
        torch.cuda.empty_cache()


app = FastAPI(title="BrainPilot KB Models", lifespan=lifespan)


# ── request / response schemas ────────────────────────────────────────────

class EmbedRequest(BaseModel):
    texts: List[str]
    max_length: Optional[int] = DEFAULT_MAX_LENGTH


class EmbedResponse(BaseModel):
    embeddings: List[List[float]]
    dim: int


class RerankRequest(BaseModel):
    query: str
    documents: List[str]
    max_length: Optional[int] = DEFAULT_MAX_LENGTH


class RerankResult(BaseModel):
    index: int
    score: float
    text: str


class RerankResponse(BaseModel):
    results: List[RerankResult]


# ── endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "embedder_loaded": embedder is not None,
        "reranker_loaded": reranker is not None,
        "device": _pick_device(),
        "gpu": (torch.cuda.get_device_name(0)
                if torch.cuda.is_available() else None),
    }


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    assert embedder is not None, "embedder not loaded yet"
    result = embedder.encode(
        req.texts,
        batch_size=32,
        max_length=req.max_length,
        return_dense=True,
        return_sparse=False,
        return_colbert_vecs=False,
    )
    vecs = result["dense_vecs"]
    embeddings = vecs.tolist() if hasattr(vecs, "tolist") else [v.tolist() for v in vecs]
    return EmbedResponse(embeddings=embeddings, dim=len(embeddings[0]) if embeddings else 1024)


@app.post("/rerank", response_model=RerankResponse)
async def rerank(req: RerankRequest):
    assert reranker is not None, "reranker not loaded yet"
    tokenizer = reranker["tokenizer"]
    model = reranker["model"]
    device = reranker["device"]
    pairs = [[req.query, doc] for doc in req.documents]
    with torch.no_grad():
        inputs = tokenizer(
            pairs,
            padding=True,
            truncation=True,
            max_length=req.max_length or DEFAULT_MAX_LENGTH,
            return_tensors="pt",
        ).to(device)
        # bge-reranker outputs a single logit per pair; sigmoid to [0, 1]
        # matches FlagReranker(..., normalize=True) semantics.
        logits = model(**inputs, return_dict=True).logits.view(-1)
        scores = torch.sigmoid(logits).cpu().tolist()
    ranked = sorted(
        [RerankResult(index=i, score=float(s), text=req.documents[i])
         for i, s in enumerate(scores)],
        key=lambda r: r.score,
        reverse=True,
    )
    return RerankResponse(results=ranked)


# ── boot ──────────────────────────────────────────────────────────────────

def _pick_free_port() -> int:
    """Bind to port 0, read the OS-assigned port, release it.

    There's a tiny TOCTOU race against another process — practically a
    non-issue on a single-user developer machine, and uvicorn re-binds in
    the same process anyway.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--kb-root", default=None,
                    help="KnowledgeBase root; default $KB_ROOT or auto-detect.")
    ap.add_argument("--host", default="127.0.0.1",
                    help="Bind host (default 127.0.0.1 — loopback only).")
    ap.add_argument("--port", type=int, default=6100,
                    help="Bind port (default 6100). Use 0 to auto-pick.")
    ap.add_argument("--port-file", default=None,
                    help="Write the chosen port to this file once known. "
                         "Required when --port 0 is used in spawn mode.")
    args = ap.parse_args()

    global KB
    KB = KbPaths(resolve_kb_root(args.kb_root))
    if not KB.embed_model.exists() or not KB.reranker_model.exists():
        sys.stderr.write(
            f"ERROR: model files not found under {KB.models_dir}\n"
            f"       run scripts/setup_models.py first to download them.\n"
        )
        sys.exit(2)

    port = args.port if args.port != 0 else _pick_free_port()
    if args.port_file:
        Path(args.port_file).parent.mkdir(parents=True, exist_ok=True)
        Path(args.port_file).write_text(str(port), encoding="utf-8")

    # Ban TF32 surprises on Ampere; bge-m3 ships fp16 weights already.
    os.environ.setdefault("PYTORCH_NO_CUDA_MEMORY_CACHING_NUMA_HINT", "1")

    logger.info("starting model server on http://%s:%d", args.host, port)
    uvicorn.run(app, host=args.host, port=port, log_level="info")


if __name__ == "__main__":
    main()
