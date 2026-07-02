"""
Stage 2 / 4 — extract bibliographic metadata for every OCRed paper.

For each entry in ``source/OCRed_pdf.json`` this asks an OpenAI-compatible
chat-completions endpoint to read the first ~8000 chars of the .mmd file and
return JSON metadata. Results are merged into ``source/KB_source.json`` using
the same schema as the v3 KBv3_source_all.json.

Schema (one record per paper):
    {
      "title":             str,
      "authors":           list[str],
      "journal":           str,
      "published_date":    str,     # ISO-8601 ideally; year-only is fine
      "abstract":          str,
      "pdf_url":           "",      # always empty for the local pipeline
      "mmd_path":          str,
      "extraction_status": "ok" | "fallback" | "empty_mmd"
    }

Resumable / idempotent:
  - records whose mmd_path is already present are skipped, UNLESS they are
    fallback rows (failed extraction), in which case they are retried.
  - ``--retry-only`` skips the normal pending pass; ``--no-retry-failed``
    skips the retry pass; ``--target SUBSTR`` forces re-extraction for any
    record whose mmd_path contains SUBSTR.

API config (priority order):
  1. CLI flags ``--api-key`` / ``--base-url`` / ``--model``
  2. Env vars  ``META_LLM_API_KEY`` / ``META_LLM_BASE_URL`` / ``META_LLM_MODEL``
  3. ``source/API_config.json``:
        {
          "meta_extract": {
            "BASE_URL": "https://api.example.com",
            "API_KEY":  "sk-...",
            "MODEL":    "deepseek-chat"
          }
        }
     The ``meta_extract`` block can be reused from the agent's own LLM
     config — both speak OpenAI completions, so the same key works.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# api.example.com (and most domestic LLM gateways) are reached directly.
for _v in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
           "http_proxy", "https_proxy", "all_proxy"):
    os.environ.pop(_v, None)

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


MAX_CHARS = 8000
REQUEST_TIMEOUT = 90
RETRY_ATTEMPTS = 5
DEFAULT_WORKERS = 8


# ── prompts ───────────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are a precise bibliographic metadata extractor. "
    "Given the first ~8000 characters of an academic document, "
    "extract its metadata and return ONLY a JSON object — no prose, no markdown fences. "
    "Use empty string \"\" for any field you cannot determine, and an empty list [] for missing authors. "
    "Do NOT invent information."
)

USER_TEMPLATE = """Extract the following fields from the document text below.

Return ONE JSON object with EXACTLY these keys:
- "title": string (the full title of the paper / book / chapter)
- "authors": list of strings (each author's full name, in original order)
- "journal": string (the publishing venue: journal name, conference, book publisher, etc.)
- "published_date": string (ISO-8601 if possible, e.g. "2023-04-15T00:00:00Z"; year-only "2023" is fine)
- "abstract": string (the abstract / summary; if absent, leave "")

Document text:
\"\"\"
{snippet}
\"\"\"
"""


# ── API config ────────────────────────────────────────────────────────────

def resolve_api(
    cli_key: str | None,
    cli_base: str | None,
    cli_model: str | None,
    kb: KbPaths,
) -> tuple[str, str, str]:
    key = cli_key or os.environ.get("META_LLM_API_KEY")
    base = cli_base or os.environ.get("META_LLM_BASE_URL")
    model = cli_model or os.environ.get("META_LLM_MODEL")
    if not (key and base and model):
        cfg = load_json(kb.api_config, default={}) or {}
        block = cfg.get("meta_extract") or cfg.get("model") or {}
        key = key or block.get("API_KEY")
        base = base or block.get("BASE_URL")
        model = model or block.get("MODEL")
    if not key:
        emit_fatal("extract",
                   "no API key — pass --api-key, set META_LLM_API_KEY, "
                   "or add source/API_config.json {meta_extract: {API_KEY: ...}}")
    if not base:
        emit_fatal("extract",
                   "no base URL — pass --base-url, set META_LLM_BASE_URL, "
                   "or add source/API_config.json {meta_extract: {BASE_URL: ...}}")
    if not model:
        emit_fatal("extract",
                   "no model — pass --model, set META_LLM_MODEL, "
                   "or add source/API_config.json {meta_extract: {MODEL: ...}}")
    base = base.rstrip("/")
    if not base.endswith("/v1"):
        base = base + "/v1"
    return base, key, model


# ── parsing & normalisation ───────────────────────────────────────────────

def parse_model_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()
    lb = text.find("{")
    rb = text.rfind("}")
    if lb == -1 or rb == -1 or rb <= lb:
        raise ValueError("no JSON object in response")
    return json.loads(text[lb:rb + 1])


def normalize(d: dict, fallback_title: str, mmd_path: str, status: str = "ok") -> dict:
    """Coerce the model output into the canonical schema."""

    def s(x):
        return x if isinstance(x, str) else ("" if x is None else str(x))

    authors = d.get("authors", [])
    if isinstance(authors, str):
        authors = [a.strip() for a in authors.replace(";", ",").split(",") if a.strip()]
    elif not isinstance(authors, list):
        authors = []
    authors = [s(a) for a in authors]

    return {
        "title": s(d.get("title")) or fallback_title,
        "authors": authors,
        "journal": s(d.get("journal")),
        "published_date": s(d.get("published_date")),
        "abstract": s(d.get("abstract")),
        "pdf_url": "",
        "mmd_path": mmd_path,
        "extraction_status": status,
    }


def is_fallback_record(rec: dict) -> bool:
    status = rec.get("extraction_status")
    if status == "fallback":
        return True
    if status in ("ok", "empty_mmd"):
        return False
    # Legacy heuristic for records that predate extraction_status.
    if (
        not rec.get("authors")
        and not (rec.get("journal", "") or "").strip()
        and not (rec.get("published_date", "") or "").strip()
        and not (rec.get("abstract", "") or "").strip()
    ):
        return True
    return False


# ── per-record worker ─────────────────────────────────────────────────────

# Process-wide flag: set once we see a provider reject `temperature`, so
# every subsequent call in the batch skips the param.
_TEMPERATURE_UNSUPPORTED = False


def _mark_temperature_unsupported() -> None:
    global _TEMPERATURE_UNSUPPORTED
    _TEMPERATURE_UNSUPPORTED = True


def _is_temperature_unsupported_error(err_msg: str) -> bool:
    """True if the provider's 4xx complains specifically about `temperature`.
    Matches both the AWS Bedrock wording ('temperature is deprecated for this
    model') and OpenAI-style ('unsupported_parameter … temperature')."""
    m = err_msg.lower()
    return "temperature" in m and (
        "deprecated" in m
        or "unsupported" in m
        or "not supported" in m
        or "invalid" in m
    )


def read_snippet(mmd_path: str) -> str:
    try:
        with open(mmd_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read(MAX_CHARS)
    except Exception:
        return ""


def extract_one(client: OpenAI, model: str, entry: dict) -> tuple[bool, dict, str]:
    mmd_path = entry.get("mmd_path", "")
    fallback_title = entry.get("title", "")
    if not mmd_path or not os.path.exists(mmd_path):
        return False, {}, f"mmd missing: {mmd_path}"

    snippet = read_snippet(mmd_path)
    if not snippet.strip():
        return True, normalize({"title": fallback_title}, fallback_title, mmd_path,
                               status="empty_mmd"), "empty mmd"

    prompt = USER_TEMPLATE.format(snippet=snippet)
    last_err = ""
    for attempt in range(RETRY_ATTEMPTS):
        try:
            kwargs = {
                "model": model,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                "timeout": REQUEST_TIMEOUT,
                "response_format": {"type": "json_object"},
            }
            # Some providers (e.g. Bedrock-hosted models) reject `temperature`
            # outright. `_TEMPERATURE_UNSUPPORTED` starts False and flips to
            # True the first time we see that error, so subsequent calls skip
            # the parameter entirely instead of burning retries on 400s.
            if not _TEMPERATURE_UNSUPPORTED:
                kwargs["temperature"] = 0
            resp = client.chat.completions.create(**kwargs)
            raw = resp.choices[0].message.content or ""
            data = parse_model_json(raw)
            return True, normalize(data, fallback_title, mmd_path, status="ok"), "ok"
        except Exception as exc:  # noqa: BLE001
            last_err = str(exc)
            # Detect providers that reject `temperature` and disable it
            # process-wide, then immediately retry this same paper without
            # counting it as a real attempt.
            if _is_temperature_unsupported_error(last_err) and not _TEMPERATURE_UNSUPPORTED:
                _mark_temperature_unsupported()
                emit_event("extract", "warn",
                           "provider rejected temperature=0; retrying without it "
                           "for the rest of this run")
                continue
            if attempt == RETRY_ATTEMPTS - 1:
                # Surface the real API error so the operator can see WHY every
                # paper is falling back, not just that it did. Without this
                # the run silently succeeds with 14 empty rows.
                emit_event("extract", "warn",
                           f"fallback for {os.path.basename(mmd_path)}: {last_err[:280]}")
                return True, normalize({"title": fallback_title}, fallback_title, mmd_path,
                                       status="fallback"), f"fallback: {last_err}"
            time.sleep(min(2 ** attempt, 16))
    return False, {}, "unreachable"


# ── batch driver ──────────────────────────────────────────────────────────

def process_batch(
    client: OpenAI,
    model: str,
    pending: list[dict],
    out: dict,
    out_path: Path,
    workers: int,
    in_place_indices: dict[str, int] | None = None,
) -> tuple[int, int, int]:
    """Process pending entries, mutating `out` and persisting periodically.

    Returns (n_ok, n_fallback, n_empty).
    """
    n = len(pending)
    if n == 0:
        return 0, 0, 0

    processed = 0
    n_ok = n_fallback = n_empty = 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futures = {ex.submit(extract_one, client, model, e): e for e in pending}
        for fut in as_completed(futures):
            ok, rec, msg = fut.result()
            processed += 1
            if not ok:
                emit_event("extract", "warn", f"skip: {msg}",
                           done=processed, total=n)
                continue
            status = rec.get("extraction_status", "ok")
            if status == "ok":
                n_ok += 1
            elif status == "fallback":
                n_fallback += 1
            elif status == "empty_mmd":
                n_empty += 1
            if in_place_indices is not None and rec["mmd_path"] in in_place_indices:
                out["papers"][in_place_indices[rec["mmd_path"]]] = rec
            else:
                out["papers"].append(rec)
            if processed % 10 == 0 or processed == n:
                out["total_papers"] = len(out["papers"])
                save_json_atomic(out_path, out)
            emit_event(
                "extract", "progress",
                f"{processed}/{n}: {rec.get('title', '')[:70]}",
                done=processed, total=n,
                percent=round(processed * 100 / n, 1),
                ok=n_ok, fallback=n_fallback, empty=n_empty,
            )
    out["total_papers"] = len(out["papers"])
    save_json_atomic(out_path, out)
    return n_ok, n_fallback, n_empty


def find_fallback_indices(out: dict) -> dict[str, int]:
    return {
        p["mmd_path"]: i
        for i, p in enumerate(out["papers"])
        if is_fallback_record(p)
    }


def find_target_indices(out: dict, substrs: list[str]) -> dict[str, int]:
    if not substrs:
        return {}
    return {
        p["mmd_path"]: i
        for i, p in enumerate(out["papers"])
        if any(s in p.get("mmd_path", "") for s in substrs)
    }


# ── main ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_kb_root_arg(ap)
    add_json_arg(ap)
    ap.add_argument("--api-key", default=None)
    ap.add_argument("--base-url", default=None,
                    help="OpenAI-compatible base URL (auto-appends /v1).")
    ap.add_argument("--model", default=None)
    ap.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    ap.add_argument("--no-retry-failed", action="store_true",
                    help="Skip the auto-retry of previously-failed records.")
    ap.add_argument("--retry-only", action="store_true",
                    help="Only retry fallback records; skip the pending pass.")
    ap.add_argument("--target", action="append", default=[],
                    help="Force re-extraction of records whose mmd_path "
                         "contains this substring (repeatable).")
    args = ap.parse_args()

    enable_json_mode(args.json)
    kb = KbPaths(resolve_kb_root(args.kb_root))
    kb.mkdir()

    base, key, model = resolve_api(args.api_key, args.base_url, args.model, kb)
    client = OpenAI(api_key=key, base_url=base)

    ocred = load_json(kb.ocred_json, default={"papers": []}).get("papers", [])
    out = load_json(kb.kb_source_json, default={"papers": []})
    out.setdefault("papers", [])

    n_ok = n_fallback = n_empty = 0

    # ── Phase 0: --target re-extraction ────────────────────────────────
    if args.target:
        emit_event("extract", "info",
                   f"--target pass: substrings={args.target}")
        existing_idx = find_target_indices(out, args.target)
        ocred_by_path = {e.get("mmd_path", ""): e for e in ocred}
        target_entries: list[dict] = []
        seen = set()
        for path, _ in existing_idx.items():
            target_entries.append(ocred_by_path.get(path, {"mmd_path": path, "title": ""}))
            seen.add(path)
        for path, entry in ocred_by_path.items():
            if path in seen:
                continue
            if any(s in path for s in args.target):
                target_entries.append(entry)
                seen.add(path)
        if target_entries:
            emit_event("extract", "info",
                       f"target: re-extracting {len(target_entries)} record(s)")
            a, b, c = process_batch(client, model, target_entries, out,
                                    kb.kb_source_json, args.workers,
                                    in_place_indices=existing_idx)
            n_ok += a; n_fallback += b; n_empty += c

    # ── Phase 1: retry old fallback records ────────────────────────────
    if not args.no_retry_failed:
        fallback_idx = find_fallback_indices(out)
        if args.target:
            already = {
                p["mmd_path"]
                for i, p in enumerate(out["papers"])
                if i in set(find_target_indices(out, args.target).values())
            }
            fallback_idx = {p: i for p, i in fallback_idx.items() if p not in already}
        if fallback_idx:
            emit_event("extract", "info",
                       f"retry pass: {len(fallback_idx)} fallback record(s)")
            ocred_by_path = {e.get("mmd_path", ""): e for e in ocred}
            retry_entries: list[dict] = []
            for path in fallback_idx:
                if path in ocred_by_path:
                    retry_entries.append(ocred_by_path[path])
                else:
                    retry_entries.append({"mmd_path": path,
                                           "title": out["papers"][fallback_idx[path]].get("title", "")})
            a, b, c = process_batch(client, model, retry_entries, out,
                                    kb.kb_source_json, args.workers,
                                    in_place_indices=fallback_idx)
            n_ok += a; n_fallback += b; n_empty += c
        else:
            emit_event("extract", "info", "no fallback records to retry")

    # ── Phase 2: normal pending pass ───────────────────────────────────
    if not args.retry_only:
        done_paths = {p.get("mmd_path", "") for p in out["papers"]}
        pending = [e for e in ocred if e.get("mmd_path", "") not in done_paths]
        emit_event("extract", "info",
                   f"OCRed total: {len(ocred)} | done: {len(done_paths)} | pending: {len(pending)}",
                   total_ocred=len(ocred), done=len(done_paths), pending=len(pending))
        if pending:
            a, b, c = process_batch(client, model, pending, out,
                                    kb.kb_source_json, args.workers)
            n_ok += a; n_fallback += b; n_empty += c

    # ── Phase 3: auto-retry stubborn fallbacks ─────────────────────────
    # After the normal pass, count how many records still failed. Auto-retry
    # up to MAX_AUTO_RETRIES times; give up early if a retry pass makes no
    # progress (fallback count unchanged) — that means the failure is
    # deterministic (bad key / unsupported param / broken mmd) and hammering
    # the API more won't help.
    MAX_AUTO_RETRIES = 3
    if not args.no_retry_failed:
        prev_count = len(find_fallback_indices(out))
        for attempt in range(1, MAX_AUTO_RETRIES + 1):
            if prev_count == 0:
                break
            emit_event(
                "extract", "info",
                f"auto-retry {attempt}/{MAX_AUTO_RETRIES}: "
                f"{prev_count} fallback record(s) remain",
                attempt=attempt, remaining=prev_count,
            )
            fallback_idx = find_fallback_indices(out)
            ocred_by_path = {e.get("mmd_path", ""): e for e in ocred}
            retry_entries = [
                ocred_by_path.get(path, {"mmd_path": path,
                                         "title": out["papers"][fallback_idx[path]].get("title", "")})
                for path in fallback_idx
            ]
            a, b, c = process_batch(client, model, retry_entries, out,
                                    kb.kb_source_json, args.workers,
                                    in_place_indices=fallback_idx)
            n_ok += a; n_fallback += b; n_empty += c
            new_count = len(find_fallback_indices(out))
            if new_count >= prev_count:
                emit_event(
                    "extract", "warn",
                    f"auto-retry {attempt}: no progress "
                    f"({new_count} still fallback); stopping early",
                    attempt=attempt, remaining=new_count,
                )
                break
            prev_count = new_count
        remaining = len(find_fallback_indices(out))
        if remaining > 0:
            emit_event(
                "extract", "warn",
                f"there are still {remaining} fallback(s) after "
                f"{MAX_AUTO_RETRIES} retries",
                remaining=remaining, max_retries=MAX_AUTO_RETRIES,
            )

    emit_event(
        "extract", "done",
        f"saved {len(out['papers'])} record(s) -> {kb.kb_source_json.name}",
        records=len(out["papers"]), ok=n_ok, fallback=n_fallback, empty=n_empty,
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        emit_event("extract", "error", "interrupted by user")
        sys.exit(130)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        emit_fatal("extract", "unexpected failure", exc)
