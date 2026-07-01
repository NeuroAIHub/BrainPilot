"""
Shared helpers used by every KnowledgeBase pipeline script.

The pipeline is designed to run two ways:

  1. From the shell, for the operator / developer — produces human-readable
     stdout (status lines, percentages).
  2. From the BrainPilot backend, via spawn() — same scripts, called with
     ``--json``. Every progress milestone is then emitted as a single-line
     NDJSON event to stdout so the backend can pipe it straight to the
     frontend via SSE.

NDJSON event schema (one JSON object per line, terminated with ``\n``):
    {
      "ts":      ISO-8601 UTC timestamp,
      "stage":   "ocr" | "extract" | "chunk" | "vectorize" | "build",
      "event":   "info" | "progress" | "warn" | "error" | "done",
      "msg":     short human-readable message,
      ...stage-specific fields: "done" / "total" / "percent" / "rate" / ...
    }

Anything written *outside* an emit_event() call is plain text. The backend
parses each line and falls back to a generic "log" event if JSON parse
fails, so adding ad-hoc prints during development is safe.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


# ---------------------------------------------------------------------------
# Root resolution
# ---------------------------------------------------------------------------

def _default_kb_root() -> Path:
    """The KnowledgeBase directory that contains this script."""
    return Path(__file__).resolve().parent.parent


def resolve_kb_root(cli_value: str | None = None) -> Path:
    """Resolve the KnowledgeBase root in priority order:

      1. ``--kb-root`` CLI flag (cli_value)
      2. ``KB_ROOT`` env var
      3. The directory two levels up from this file
         (works for the bundled scripts/ layout)
    """
    if cli_value:
        return Path(cli_value).resolve()
    env = os.environ.get("KB_ROOT")
    if env:
        return Path(env).resolve()
    return _default_kb_root()


def add_kb_root_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--kb-root",
        default=None,
        help=(
            "Absolute path to the KnowledgeBase directory. "
            "Defaults to the parent of this script, or $KB_ROOT."
        ),
    )


# ---------------------------------------------------------------------------
# Standard sub-paths derived from KB_ROOT
# ---------------------------------------------------------------------------

class KbPaths:
    """Bundle of every absolute path the pipeline cares about.

    Constructing this is cheap; mkdir() materializes the directories the
    pipeline assumes exist.
    """

    def __init__(self, root: Path):
        self.root = root
        self.source = root / "source"
        self.pdf_dir = self.source / "pdf"
        self.mmd_dir = self.source / "mmd"
        self.ocred_json = self.source / "OCRed_pdf.json"
        self.kb_source_json = self.source / "KB_source.json"
        self.api_config = self.source / "API_config.json"
        self.chunks_dir = root / "chunks"
        self.chunks_json = self.chunks_dir / "chunks.json"
        self.vectorstore_dir = root / "vectorstore"
        self.embeddings_npy = self.vectorstore_dir / "embeddings.npy"
        self.chunks_jsonl = self.vectorstore_dir / "chunks.jsonl"
        self.index_json = self.vectorstore_dir / "index.json"
        self.meta_json = self.vectorstore_dir / "meta.json"
        self.models_dir = root / "models"
        self.embed_model = self.models_dir / "bge-m3"
        self.reranker_model = self.models_dir / "bge-reranker-v2-m3"

    def mkdir(self) -> None:
        for d in (
            self.source,
            self.pdf_dir,
            self.mmd_dir,
            self.chunks_dir,
            self.vectorstore_dir,
            self.models_dir,
        ):
            d.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# NDJSON progress events
# ---------------------------------------------------------------------------

_JSON_MODE = False  # toggled by enable_json_mode()


def enable_json_mode(enabled: bool = True) -> None:
    """Switch the process into NDJSON-event mode (one event per line on stdout)."""
    global _JSON_MODE
    _JSON_MODE = bool(enabled)


def add_json_arg(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit progress as one NDJSON event per line on stdout.",
    )


def emit_event(stage: str, event: str, msg: str = "", **fields: Any) -> None:
    """Print one structured progress event.

    In JSON mode: emit a single NDJSON line on stdout (the backend reads stdout
    line-by-line). In plain mode: emit a short human-readable line so the
    operator sees what's happening when running from a shell.
    """
    if _JSON_MODE:
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "stage": stage,
            "event": event,
            "msg": msg,
            **fields,
        }
        sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return

    prefix = f"[{stage}:{event}]"
    extras = ""
    if fields:
        extras = " " + " ".join(f"{k}={v}" for k, v in fields.items())
    line = f"{prefix} {msg}{extras}".rstrip()
    print(line, flush=True)


def emit_fatal(stage: str, msg: str, exc: BaseException | None = None) -> None:
    """Emit a final error event and exit non-zero so the spawning backend
    can mark the build as failed."""
    detail = msg
    if exc is not None:
        detail = f"{msg}: {type(exc).__name__}: {exc}"
    emit_event(stage, "error", detail)
    sys.exit(1)


# ---------------------------------------------------------------------------
# JSON file IO with atomic write
# ---------------------------------------------------------------------------

def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)
