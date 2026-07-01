"""
Stage 1 / 4 — OCR every PDF under ``source/pdf/`` via the SiliconFlow
DeepSeek-OCR API.

Output layout (mirrors KB_v3):

    <KB_ROOT>/source/mmd/<pdf-stem>/<pdf-stem>.mmd      # cleaned markdown
    <KB_ROOT>/source/mmd/<pdf-stem>/<pdf-stem>_det.mmd  # raw with grounding tokens
    <KB_ROOT>/source/OCRed_pdf.json                     # ledger of finished PDFs

The ledger is what makes the run resumable: any PDF whose title (filename
without ``.pdf``) is already present is skipped on the next invocation.

Design notes
------------
The script is intentionally a near-1:1 port of
``/srv/DeepSeek-OCR-2/.../pdf_to_mmd_KBv3_sf.py`` so we inherit:
  - one API call per rendered page (DeepSeek-OCR only accepts 1 page at a time)
  - a shared, process-wide rate-limit gate so a single 429 immediately backs
    OFF every concurrent worker — bursting them was the root cause of the
    TPM-cap pileup we saw on 58-page books in the v3 run.
  - atomic writes so a SIGKILL mid-write never leaves a half-written .mmd.

The user supplies the SiliconFlow API key one of three ways (priority order):
  1. ``--api-key sk-...`` on the command line
  2. ``SILICONFLOW_API_KEY`` env var
  3. ``source/API_config.json``  (``{"siliconflow": {"API_KEY": "sk-..."}}``)
"""
from __future__ import annotations

import argparse
import base64
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Strip proxy env vars — api.siliconflow.cn is reached directly.
for _v in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
           "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(_v, None)

import fitz  # PyMuPDF
from openai import OpenAI

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


# ── API knobs ─────────────────────────────────────────────────────────────

BASE_URL = "https://api.siliconflow.cn/v1"
MODEL_ID = "deepseek-ai/DeepSeek-OCR"
PROMPT = "<image>\n<|grounding|>Convert the document to markdown."

RENDER_DPI = 144              # ≈ vLLM-pipeline parity
REQUEST_TIMEOUT = 180         # per-page HTTP timeout (s)
MAX_PAGE_RETRIES = 5          # non-429 transient errors per page
MAX_CONCURRENT_PAGES = 4      # default per-PDF concurrency
MAX_RATE_LIMIT_WAITS = 8      # 429 hits a page tolerates before giving up
RATE_LIMIT_PAUSE_S = 70       # all-worker pause after ANY 429 (TPM window ≈ 60s)


# ── Shared rate-limit gate ─────────────────────────────────────────────────
# When any worker hits a 429 it pushes the "open again" time into _UNTIL[0]
# and every worker checks this before each request. Cheap, in-process, good
# enough to flatten the request burst that triggers TPM caps.

_RATE_LIMIT_LOCK = threading.Lock()
_RATE_LIMIT_UNTIL = [0.0]


def _wait_for_rate_limit_window() -> None:
    while True:
        with _RATE_LIMIT_LOCK:
            until = _RATE_LIMIT_UNTIL[0]
        now = time.time()
        if now >= until:
            return
        time.sleep(min(until - now, 5))


def _trip_rate_limit(seconds: float) -> None:
    with _RATE_LIMIT_LOCK:
        new_until = time.time() + seconds
        if new_until > _RATE_LIMIT_UNTIL[0]:
            _RATE_LIMIT_UNTIL[0] = new_until


# ── filesystem helpers ────────────────────────────────────────────────────

def safe_dirname(name: str) -> str:
    """Sanitize a paper title for use as a directory name."""
    return re.sub(r'[/\\:*?"<>|]', "_", name)[:200]


def list_pdfs(pdf_dir: Path) -> list[dict]:
    items: list[dict] = []
    if not pdf_dir.exists():
        return items
    for fn in sorted(os.listdir(pdf_dir)):
        if not fn.lower().endswith(".pdf"):
            continue
        full = pdf_dir / fn
        if not full.is_file():
            continue
        items.append({"title": full.stem, "filename": fn, "pdf_path": str(full)})
    return items


def load_ocred_titles(path: Path) -> set[str]:
    data = load_json(path, default={"papers": []})
    return {p.get("title", "") for p in data.get("papers", [])}


def append_ocred(path: Path, entry: dict) -> None:
    data = load_json(path, default={"papers": []})
    data.setdefault("papers", []).append(entry)
    data["total_papers"] = len(data["papers"])
    save_json_atomic(path, data)


# ── OCR core ──────────────────────────────────────────────────────────────

def render_pages(pdf_path: Path, dpi: int = RENDER_DPI) -> list[bytes]:
    pngs: list[bytes] = []
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    doc = fitz.open(str(pdf_path))
    try:
        for page in doc:
            pix = page.get_pixmap(matrix=matrix, alpha=False)
            pngs.append(pix.tobytes("png"))
    finally:
        doc.close()
    return pngs


def png_to_data_uri(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def _is_rate_limit_error(exc: BaseException) -> bool:
    if type(exc).__name__ == "RateLimitError":
        return True
    msg = str(exc)
    return "429" in msg or "rate limit" in msg.lower() or "tpm limit" in msg.lower()


def ocr_one_page(client: OpenAI, page_idx: int, png_bytes: bytes) -> dict:
    data_uri = png_to_data_uri(png_bytes)
    last_err = ""
    transient = 0
    rate_hits = 0
    t0 = time.time()
    while True:
        _wait_for_rate_limit_window()
        try:
            resp = client.chat.completions.create(
                model=MODEL_ID,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image_url", "image_url": {"url": data_uri}},
                        {"type": "text", "text": PROMPT},
                    ],
                }],
                temperature=0,
                timeout=REQUEST_TIMEOUT,
            )
            return {
                "page": page_idx,
                "ok": True,
                "text": resp.choices[0].message.content or "",
                "elapsed_s": time.time() - t0,
                "transient_attempts": transient,
                "rate_limit_hits": rate_hits,
            }
        except Exception as exc:  # noqa: BLE001 — translated below
            last_err = f"{type(exc).__name__}: {exc}"
            if _is_rate_limit_error(exc):
                rate_hits += 1
                _trip_rate_limit(RATE_LIMIT_PAUSE_S)
                if rate_hits >= MAX_RATE_LIMIT_WAITS:
                    break
                continue
            transient += 1
            if transient >= MAX_PAGE_RETRIES:
                break
            time.sleep(min(2 ** (transient - 1), 16))
    return {
        "page": page_idx,
        "ok": False,
        "error": last_err,
        "elapsed_s": time.time() - t0,
        "transient_attempts": transient,
        "rate_limit_hits": rate_hits,
    }


# ── grounding-token cleanup ───────────────────────────────────────────────

_RE_REF = re.compile(r"<\|ref\|>.*?<\|/ref\|>\s*", flags=re.DOTALL)
_RE_DET = re.compile(r"<\|det\|>.*?<\|/det\|>\s*", flags=re.DOTALL)
_RE_EOS = re.compile(r"<｜end▁of▁sentence｜>")
_RE_BLANK = re.compile(r"\n{3,}")


def clean_page_text(raw: str) -> str:
    s = _RE_EOS.sub("", raw)
    s = _RE_REF.sub("", s)
    s = _RE_DET.sub("", s)
    s = _RE_BLANK.sub("\n\n", s)
    return s.strip()


# ── per-PDF driver ────────────────────────────────────────────────────────

def pdf_to_mmd(
    client: OpenAI,
    pdf_path: Path,
    output_dir: Path,
    concurrency: int,
    paper_label: str,
) -> tuple[bool, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = pdf_path.stem
    mmd_path = output_dir / f"{stem}.mmd"
    mmd_det_path = output_dir / f"{stem}_det.mmd"

    try:
        pages_png = render_pages(pdf_path)
    except Exception as exc:  # noqa: BLE001
        emit_event("ocr", "warn", f"{paper_label}: render failed",
                   error=f"{type(exc).__name__}: {exc}")
        return False, ""
    n_pages = len(pages_png)
    if n_pages == 0:
        emit_event("ocr", "warn", f"{paper_label}: 0 pages — skipped")
        return False, ""
    emit_event("ocr", "info", f"{paper_label}: rendered {n_pages} pages",
               pages=n_pages)

    t0 = time.time()
    results: dict[int, dict] = {}
    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = {ex.submit(ocr_one_page, client, i, png): i
                   for i, png in enumerate(pages_png)}
        for fut in as_completed(futures):
            r = fut.result()
            results[r["page"]] = r
    wall = time.time() - t0

    n_ok = sum(1 for r in results.values() if r["ok"])
    n_fail = n_pages - n_ok
    if n_fail > 0:
        failed_pages = sorted(p + 1 for p, r in results.items() if not r["ok"])
        sample = next(r for r in results.values() if not r["ok"])
        emit_event(
            "ocr", "warn",
            f"{paper_label}: {n_fail}/{n_pages} pages failed",
            failed_pages=failed_pages[:20],
            first_error=sample.get("error", "?"),
        )
        return False, ""

    # Stitch in page order with both raw and cleaned versions.
    det_parts: list[str] = []
    clean_parts: list[str] = []
    for i in range(n_pages):
        r = results[i]
        det_parts.append(r["text"] + f"\n<--- Page {i + 1} --->")
        clean_parts.append(clean_page_text(r["text"]) + f"\n\n<--- Page {i + 1} --->")
    det_text = "\n".join(det_parts)
    clean_text = "\n".join(clean_parts)

    # Atomic write so a SIGKILL mid-write never leaves a half-file.
    for path, content in [(mmd_det_path, det_text), (mmd_path, clean_text)]:
        tmp = str(path) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, path)

    emit_event(
        "ocr", "info",
        f"{paper_label}: ok ({n_pages} pages in {wall:.1f}s)",
        wall_s=round(wall, 1),
    )
    return True, str(mmd_path)


# ── top-level driver ──────────────────────────────────────────────────────

def resolve_api_key(cli: str | None, kb: KbPaths) -> str:
    if cli:
        return cli
    env = os.environ.get("SILICONFLOW_API_KEY")
    if env:
        return env
    cfg = load_json(kb.api_config, default={}) or {}
    sf = cfg.get("siliconflow") or cfg.get("ocr") or {}
    return (sf.get("API_KEY") or sf.get("api_key") or "").strip()


def run_pipeline(
    kb: KbPaths,
    api_key: str,
    concurrency: int,
    limit: int | None,
) -> None:
    kb.mkdir()
    client = OpenAI(api_key=api_key, base_url=BASE_URL)

    papers = list_pdfs(kb.pdf_dir)
    done = load_ocred_titles(kb.ocred_json)
    pending = [p for p in papers if p["title"] not in done]
    emit_event(
        "ocr", "info",
        f"PDFs found: {len(papers)} | already OCRed: {len(done)} | pending: {len(pending)}",
        total=len(papers), done=len(done), pending=len(pending),
    )
    if limit is not None:
        pending = pending[:limit]
        emit_event("ocr", "info", f"limited to first {limit} pending",
                   pending=len(pending))

    if not pending:
        emit_event("ocr", "done", "nothing to OCR", processed=0, ok=0, fail=0)
        return

    n_ok = n_fail = 0
    n_total = len(pending)
    for idx, paper in enumerate(pending, 1):
        title = paper["title"]
        pdf_path = Path(paper["pdf_path"])
        if not pdf_path.exists():
            emit_event("ocr", "warn", f"missing PDF: {pdf_path}")
            n_fail += 1
            continue
        out_dir = kb.mmd_dir / safe_dirname(title)
        label = f"[{idx}/{n_total}] {title}"
        ok, mmd_path = pdf_to_mmd(client, pdf_path, out_dir, concurrency, label)
        if ok:
            append_ocred(kb.ocred_json, {
                "title": title,
                "filename": paper["filename"],
                "mmd_path": mmd_path,
            })
            n_ok += 1
        else:
            n_fail += 1
        emit_event(
            "ocr", "progress", f"{idx}/{n_total} done",
            done=idx, total=n_total, ok=n_ok, fail=n_fail,
            percent=round(idx * 100 / n_total, 1),
        )

    emit_event(
        "ocr", "done", f"finished: ok={n_ok} fail={n_fail}",
        processed=n_ok + n_fail, ok=n_ok, fail=n_fail,
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_kb_root_arg(ap)
    add_json_arg(ap)
    ap.add_argument("--api-key", default=None,
                    help="SiliconFlow API key (overrides env / API_config.json).")
    ap.add_argument("--limit", type=int, default=None,
                    help="Process at most N pending PDFs (default: all).")
    ap.add_argument("--concurrency", type=int, default=MAX_CONCURRENT_PAGES,
                    help=f"Concurrent page requests per PDF (default {MAX_CONCURRENT_PAGES}).")
    args = ap.parse_args()

    enable_json_mode(args.json)
    kb = KbPaths(resolve_kb_root(args.kb_root))
    api_key = resolve_api_key(args.api_key, kb)
    if not api_key:
        emit_fatal(
            "ocr",
            "no SiliconFlow API key found. "
            "Pass --api-key, set SILICONFLOW_API_KEY, "
            "or write source/API_config.json with siliconflow.API_KEY",
        )

    try:
        run_pipeline(kb, api_key, args.concurrency, args.limit)
    except KeyboardInterrupt:
        emit_event("ocr", "error", "interrupted by user")
        sys.exit(130)
    except Exception as exc:  # noqa: BLE001
        emit_fatal("ocr", "unexpected failure", exc)


if __name__ == "__main__":
    main()
