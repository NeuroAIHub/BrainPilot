"""
Stage 3 / 4 — split every .mmd referenced in ``KB_source.json`` into
overlapping ~1500-char chunks.

Output: ``<KB_ROOT>/chunks/chunks.json``
    {"chunks": [{chunk_id, text, metadata}, ...], "total_chunks": N}

Each chunk's metadata copies the paper-level fields (title, authors,
journal, published_date, abstract, pdf_url) plus ``chunk_index``,
``char_start``, ``char_end``, ``mmd_path``. ``extraction_status`` is
intentionally NOT carried over — it is an internal diagnostic, not a
retrieval-time signal.

Incremental by default — only previously-unchunked mmd_paths are processed.
``--rebuild`` forces a full re-chunk.

Reference-list chunks (the back-matter of academic papers) are dropped
heuristically because they hurt retrieval signal without adding content.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    KbPaths,
    add_json_arg,
    add_kb_root_arg,
    emit_event,
    emit_fatal,
    enable_json_mode,
    load_json,
    resolve_kb_root,
    save_json_atomic,
)


CHUNK_SIZE = 1500
CHUNK_OVERLAP = 200
MIN_BACKUP_RATIO = 0.5

BREAK_PATTERNS = [
    "\n\n",
    "\n",
    "。 ", "。", "！", "？",
    ". ", "! ", "? ",
    "；", "; ",
    "，", ", ",
    " ",
]


def _smart_chunk_end(text: str, start: int, hard_end: int) -> int:
    if hard_end >= len(text):
        return len(text)
    window = text[start:hard_end]
    min_keep = int(len(window) * MIN_BACKUP_RATIO)
    for pat in BREAK_PATTERNS:
        idx = window.rfind(pat)
        if idx >= min_keep:
            return start + idx + len(pat)
    return hard_end


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP):
    text = text.strip()
    n = len(text)
    if n == 0:
        return
    if n <= size:
        yield 0, n, text
        return
    i = 0
    while i < n:
        hard_end = min(i + size, n)
        end = _smart_chunk_end(text, i, hard_end)
        chunk = text[i:end].strip()
        if chunk:
            yield i, end, chunk
        if end >= n:
            return
        next_i = max(end - overlap, i + 1)
        if next_i <= i:
            next_i = i + 1
        i = next_i


def chunk_id_for(mmd_path: str, idx: int) -> str:
    return hashlib.sha1(f"{mmd_path}:{idx}".encode("utf-8")).hexdigest()[:16]


# ── reference-list detector ───────────────────────────────────────────────
# Heuristic: 2+ of these signals → drop the chunk.

_RE_YEAR = re.compile(r"\b(?:19|20)\d{2}\b")
_RE_INITIALS = re.compile(r"\b[A-Z]\.\s*[A-Z]?\.?")
_RE_AUTHOR_LIST = re.compile(r"\b[A-Z][a-z]+,\s*[A-Z]\.")
_RE_PAGE_TAIL = re.compile(r"(?:pp?\.\s*\d+(?:[-–]\d+)?|\d+[-–]\d+)\.?\s*$")


def is_reference_chunk(text: str) -> bool:
    if not text:
        return False
    n_chars = len(text)
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return False

    year_hits = len(_RE_YEAR.findall(text))
    init_hits = len(_RE_INITIALS.findall(text))
    author_hits = len(_RE_AUTHOR_LIST.findall(text))

    years_per_1k = year_hits * 1000 / n_chars
    authors_per_1k = author_hits * 1000 / n_chars
    short_dotted = sum(
        1 for l in lines if len(l) < 300 and _RE_PAGE_TAIL.search(l)
    )
    short_dotted_ratio = short_dotted / max(len(lines), 1)

    strong = 0
    if years_per_1k >= 4:
        strong += 1
    if authors_per_1k >= 3:
        strong += 1
    if short_dotted_ratio >= 0.4 and len(lines) >= 3:
        strong += 1
    if init_hits >= 6 and init_hits * 100 / n_chars >= 0.4:
        strong += 1
    return strong >= 2


def chunk_one_paper(paper: dict) -> list[dict]:
    mmd_path = paper.get("mmd_path", "")
    if not mmd_path or not os.path.exists(mmd_path):
        return []
    try:
        with open(mmd_path, "r", encoding="utf-8", errors="replace") as f:
            text = f.read()
    except Exception:
        return []

    paper_meta = {
        "title": paper.get("title", ""),
        "authors": paper.get("authors", []),
        "journal": paper.get("journal", ""),
        "published_date": paper.get("published_date", ""),
        "abstract": paper.get("abstract", ""),
        "pdf_url": paper.get("pdf_url", ""),
        "mmd_path": mmd_path,
    }

    out: list[dict] = []
    kept_idx = 0
    for s, e, chunk in chunk_text(text):
        if is_reference_chunk(chunk):
            continue
        out.append({
            "chunk_id": chunk_id_for(mmd_path, kept_idx),
            "text": chunk,
            "metadata": {
                **paper_meta,
                "chunk_index": kept_idx,
                "char_start": s,
                "char_end": e,
            },
        })
        kept_idx += 1
    return out


# ── metadata refresh (in-place backfill from KB_source.json) ──────────────

# Paper-level fields we copy from KB_source.json into every chunk's metadata.
# The chunk-level fields (mmd_path/chunk_index/char_start/char_end) live in
# the same dict but are never touched here.
PAPER_META_FIELDS = ("title", "authors", "journal", "published_date",
                     "abstract", "pdf_url")


def _paper_meta_by_path(papers: list[dict]) -> dict[str, dict]:
    """Index papers by mmd_path so we can look up latest metadata per chunk."""
    idx: dict[str, dict] = {}
    for p in papers:
        path = p.get("mmd_path", "")
        if not path:
            continue
        idx[path] = {
            k: p.get(k, [] if k == "authors" else "") for k in PAPER_META_FIELDS
        }
    return idx


def _refresh_chunk_metadata(chunks: list[dict], papers: list[dict]) -> int:
    """Copy paper-level fields from ``KB_source.json`` into every chunk's
    metadata dict, in place. Returns the number of chunks whose metadata
    actually changed — used to decide whether to rewrite chunks.jsonl.

    Rationale: extract_meta.py is often re-run to fix fallback rows (bad
    API key, provider-specific parameter errors, etc.). Without this step
    the operator would have to re-chunk AND re-embed just to propagate
    fresh titles/authors to the agent — an ~20× cost multiplier over
    just re-writing metadata."""
    lookup = _paper_meta_by_path(papers)
    n_changed = 0
    for c in chunks:
        meta = c.get("metadata", {})
        src = lookup.get(meta.get("mmd_path", ""))
        if not src:
            continue
        changed_here = False
        for k in PAPER_META_FIELDS:
            if meta.get(k) != src[k]:
                meta[k] = src[k]
                changed_here = True
        if changed_here:
            n_changed += 1
    return n_changed


def _sync_chunks_jsonl(kb: KbPaths, chunks: list[dict]) -> tuple[bool, str]:
    """Rewrite ``vectorstore/chunks.jsonl`` with updated metadata, preserving
    line order (which MUST equal ``embeddings.npy`` row order — that
    ordering is defined by each chunk_id's position in
    ``vectorstore/index.json``).

    Returns ``(ok, reason)``: ``ok=True`` on successful rewrite;
    ``ok=False`` with a reason string when the vector store isn't built
    yet, or has drifted from chunks.json (missing chunk_ids) — in the
    drift case the caller should surface it as a warning so the operator
    knows to re-run vectorize."""
    if not kb.chunks_jsonl.exists() or not kb.index_json.exists():
        return False, "vectorstore not built yet"
    index = load_json(kb.index_json, default={})
    if not index:
        return False, "vectorstore index is empty"
    by_id = {c["chunk_id"]: c for c in chunks}
    rows: list[dict | None] = [None] * len(index)
    for chunk_id, row in index.items():
        if chunk_id in by_id and 0 <= row < len(rows):
            rows[row] = by_id[chunk_id]
    missing = sum(1 for r in rows if r is None)
    if missing:
        return False, (f"{missing} row(s) in vectorstore/index.json have no "
                       f"matching chunk in chunks.json — re-run vectorize")
    tmp = kb.chunks_jsonl.with_suffix(".jsonl.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    tmp.replace(kb.chunks_jsonl)

    # Bump meta.json's updated_at so the runtime's in-memory store cache
    # invalidates and re-reads chunks.jsonl on the next retrieval call. The
    # row count itself is unchanged (this is a metadata-only rewrite), so
    # without this bump the cache would happily serve the stale chunks and
    # the agent would keep seeing empty authors/journal until BrainPilot
    # restarts. Best-effort: on-disk data is already consistent whether
    # this succeeds or not.
    try:
        from datetime import datetime, timezone
        meta = load_json(kb.meta_json, default={})
        if meta:
            meta["updated_at"] = datetime.now(timezone.utc).isoformat(
                timespec="seconds")
            save_json_atomic(kb.meta_json, meta)
    except Exception:  # noqa: BLE001
        pass

    return True, ""


# ── driver ────────────────────────────────────────────────────────────────

def load_existing_chunks(chunks_json: Path) -> list[dict]:
    if not chunks_json.exists():
        return []
    return load_json(chunks_json, default={"chunks": []}).get("chunks", [])


def run_pipeline(kb: KbPaths, rebuild: bool, workers: int) -> None:
    kb.mkdir()
    src = load_json(kb.kb_source_json, default={"papers": []})
    papers = src.get("papers", [])
    emit_event("chunk", "info", f"source papers: {len(papers)}", papers=len(papers))

    if rebuild:
        existing_chunks: list[dict] = []
        chunked_paths: set[str] = set()
        emit_event("chunk", "info", "mode=REBUILD (ignoring existing chunks.json)")
    else:
        existing_chunks = load_existing_chunks(kb.chunks_json)
        chunked_paths = {c["metadata"].get("mmd_path", "") for c in existing_chunks}
        emit_event(
            "chunk", "info",
            f"mode=INCREMENTAL (existing {len(existing_chunks)} chunks from {len(chunked_paths)} papers)",
            existing_chunks=len(existing_chunks), existing_papers=len(chunked_paths),
        )

    pending = [p for p in papers if p.get("mmd_path", "") not in chunked_paths]
    emit_event("chunk", "info", f"pending papers to chunk: {len(pending)}",
               pending=len(pending))

    # Chunk any new papers (may be empty when we're only refreshing metadata).
    new_chunks: list[dict] = []
    if pending:
        workers = max(1, workers)
        done = 0
        n_total = len(pending)
        with ProcessPoolExecutor(max_workers=workers) as ex:
            futures = {ex.submit(chunk_one_paper, p): p for p in pending}
            for fut in as_completed(futures):
                chunks = fut.result()
                new_chunks.extend(chunks)
                done += 1
                if done % 50 == 0 or done == n_total:
                    emit_event(
                        "chunk", "progress",
                        f"{done}/{n_total} papers | {len(new_chunks)} new chunks",
                        done=done, total=n_total,
                        new_chunks=len(new_chunks),
                        percent=round(done * 100 / n_total, 1),
                    )

    all_chunks = existing_chunks + new_chunks
    all_chunks.sort(key=lambda c: (c["metadata"]["mmd_path"],
                                   c["metadata"]["chunk_index"]))

    # Always refresh chunk-level metadata from KB_source.json before writing.
    # This lets an operator re-run extract_meta to fix bad rows (e.g. all
    # fallback because the provider rejected `temperature`) and pick up the
    # new title/authors/journal by just re-running chunk — no re-embedding
    # needed. The chunks.jsonl sync below propagates the update to the
    # file that the agent runtime actually reads at query time.
    n_updated = _refresh_chunk_metadata(all_chunks, papers)
    if n_updated:
        emit_event("chunk", "info",
                   f"refreshed metadata on {n_updated} chunk(s) from KB_source.json",
                   updated=n_updated)

    save_json_atomic(kb.chunks_json,
                     {"chunks": all_chunks, "total_chunks": len(all_chunks)})

    # Sync updated metadata to the vector store's chunks.jsonl so the
    # runtime sees fresh titles/authors without a re-embed. Skipped
    # silently when vectorize hasn't been run yet.
    if n_updated:
        ok, reason = _sync_chunks_jsonl(kb, all_chunks)
        if ok:
            emit_event("chunk", "info",
                       "synced updated metadata to vectorstore/chunks.jsonl",
                       synced=True)
        elif reason and reason != "vectorstore not built yet":
            emit_event("chunk", "warn",
                       f"could not sync chunks.jsonl: {reason}",
                       synced=False)

    if not pending:
        emit_event(
            "chunk", "done",
            f"nothing new to chunk ({len(all_chunks)} total; "
            f"metadata refreshed on {n_updated} chunk(s))",
            total_chunks=len(all_chunks), refreshed=n_updated,
        )
    else:
        emit_event(
            "chunk", "done",
            f"added {len(new_chunks)} chunks; store now {len(all_chunks)} "
            f"(metadata refreshed on {n_updated} chunk(s))",
            added=len(new_chunks), total_chunks=len(all_chunks),
            refreshed=n_updated,
        )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_kb_root_arg(ap)
    add_json_arg(ap)
    ap.add_argument("--rebuild", action="store_true",
                    help="Force re-chunking of every paper.")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 4) - 2))
    args = ap.parse_args()

    enable_json_mode(args.json)
    kb = KbPaths(resolve_kb_root(args.kb_root))
    try:
        run_pipeline(kb, args.rebuild, args.workers)
    except KeyboardInterrupt:
        emit_event("chunk", "error", "interrupted by user")
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        emit_fatal("chunk", "unexpected failure", exc)


if __name__ == "__main__":
    main()
