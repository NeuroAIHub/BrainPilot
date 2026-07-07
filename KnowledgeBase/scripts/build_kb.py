"""
One-command pipeline runner: OCR → metadata → chunk → vectorize.

Each stage is a separate script in this directory; this file just wires
them together so an operator can rebuild the entire knowledge base from
the shell with:

    python build_kb.py

The same orchestration is also done in TypeScript inside the runtime
(``KnowledgeBase/scripts/orchestrator.ts``), which is what powers the
"Build Knowledge Base" button in the web UI. The two stay in sync because
both call the SAME per-stage scripts via subprocess.

Skipping stages
---------------
Useful when re-running just one piece after a failure or a manual edit:

    python build_kb.py --skip-ocr               # mmd already current
    python build_kb.py --skip-ocr --skip-extract  # only re-chunk + re-embed
    python build_kb.py --only chunk vectorize   # equivalent

API keys
--------
This script does NOT itself read API keys. The OCR and extract sub-scripts
each read their own keys from CLI flag → env var → API_config.json,
in that order. See ocr_pdfs.py and extract_meta.py for the full rules.
The build script forwards these OCR knobs to ocr_pdfs.py:
``--ocr-preset``, ``--ocr-base-url``, ``--ocr-model``, ``--ocr-prompt``,
``--ocr-api-key``, ``--ocr-concurrency``, ``--ocr-limit``. And
``--meta-api-key`` / ``--meta-base-url`` / ``--meta-model`` to
extract_meta.py.
"""
from __future__ import annotations

import argparse
import os
import subprocess
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


STAGES = ["ocr", "extract", "chunk", "vectorize"]
SCRIPT_DIR = Path(__file__).resolve().parent


def _model_ready(model_dir: Path) -> bool:
    """A model dir is 'ready' only when config.json AND a weight file exist.
    (config.json alone is not enough: HF snapshot_download pulls small files
    first, so a Ctrl-C mid-download can leave config.json behind while the
    multi-GB weights are still missing.)"""
    if not (model_dir / "config.json").exists():
        return False
    return any(
        (model_dir / name).exists()
        for name in ("model.safetensors", "pytorch_model.bin")
    )


def _ensure_models(kb_root: Path, py: str, args: argparse.Namespace) -> None:
    """Auto-download bge-m3 + bge-reranker-v2-m3 if missing (or partial)."""
    kb = KbPaths(kb_root)
    embed_ok = _model_ready(kb.embed_model)
    reranker_ok = _model_ready(kb.reranker_model)
    if embed_ok and reranker_ok:
        return
    missing = []
    if not embed_ok:
        missing.append("bge-m3")
    if not reranker_ok:
        missing.append("bge-reranker-v2-m3")
    emit_event("build", "info",
               f"model weights missing or incomplete ({', '.join(missing)}), downloading automatically…",
               stage_started="setup_models")
    cmd = [py, str(SCRIPT_DIR / "setup_models.py"), "--kb-root", str(kb_root)]
    if args.json:
        cmd.append("--json")
    if args.hf_mirror:
        cmd += ["--hf-mirror", args.hf_mirror]
    try:
        proc = subprocess.run(cmd, check=False)
    except FileNotFoundError as exc:
        emit_fatal("build", "could not launch setup_models.py", exc)
    if proc.returncode != 0:
        emit_fatal("build",
                   f"model download failed (exit code {proc.returncode})")
    emit_event("build", "info", "<- setup_models ok",
               stage_finished="setup_models")


def _resolve_python(kb_root: Path) -> str:
    """Pick the interpreter to use for spawning the four stages.

    Priority (matches the TS sidecar / kb-builder logic):
      1. ``BP_KB_PYTHON``  — set by the backend when it spawns build_kb.py
         so every stage shares one interpreter.
      2. ``<KB_ROOT>/.venv/bin/python``  — venv created by setup_env.sh.
         When the user runs ``python KnowledgeBase/scripts/build_kb.py``
         from their system shell, this hop into the venv is what makes the
         pipeline work without prior ``source .venv/bin/activate``.
      3. ``sys.executable`` — whatever started us, last resort.
    """
    override = os.environ.get("BP_KB_PYTHON", "").strip()
    if override:
        return override
    if os.name == "nt":
        venv = kb_root / ".venv" / "Scripts" / "python.exe"
    else:
        venv = kb_root / ".venv" / "bin" / "python"
    if venv.exists():
        return str(venv)
    return sys.executable


def stage_command(stage: str, args: argparse.Namespace, kb_root: Path, py: str) -> list[str]:
    """Build the argv for one stage."""
    base = [py, str(SCRIPT_DIR / f"{_script_name(stage)}.py"),
            "--kb-root", str(kb_root)]
    if args.json:
        base.append("--json")
    if stage == "ocr":
        # Provider-config knobs (all optional; ocr_pdfs.py merges CLI /
        # env / API_config.json / preset defaults itself).
        if args.ocr_preset:
            base += ["--preset", args.ocr_preset]
        if args.ocr_base_url:
            base += ["--base-url", args.ocr_base_url]
        if args.ocr_model:
            base += ["--model", args.ocr_model]
        if args.ocr_prompt:
            base += ["--prompt", args.ocr_prompt]
        if args.ocr_api_key:
            base += ["--api-key", args.ocr_api_key]
        if args.ocr_concurrency is not None:
            base += ["--concurrency", str(args.ocr_concurrency)]
        if args.ocr_limit is not None:
            base += ["--limit", str(args.ocr_limit)]
    elif stage == "extract":
        if args.meta_api_key:
            base += ["--api-key", args.meta_api_key]
        if args.meta_base_url:
            base += ["--base-url", args.meta_base_url]
        if args.meta_model:
            base += ["--model", args.meta_model]
    elif stage == "vectorize":
        if args.vec_server_url:
            base += ["--server-url", args.vec_server_url]
    return base


def _script_name(stage: str) -> str:
    return {
        "ocr": "ocr_pdfs",
        "extract": "extract_meta",
        "chunk": "chunk",
        "vectorize": "vectorize",
    }[stage]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    add_kb_root_arg(ap)
    add_json_arg(ap)
    ap.add_argument("--skip-ocr", action="store_true")
    ap.add_argument("--skip-extract", action="store_true")
    ap.add_argument("--skip-chunk", action="store_true")
    ap.add_argument("--skip-vectorize", action="store_true")
    ap.add_argument("--only", nargs="+", choices=STAGES,
                    help="Run only these stages (overrides --skip-*).")
    # forwarded knobs — see ocr_pdfs.py --help for the full semantics; all
    # are optional and merge with env / API_config.json inside that stage.
    ap.add_argument("--ocr-preset", default=None,
                    help="OCR provider preset (siliconflow, openai, anthropic, "
                         "mistral, zhipu, qwen, custom).")
    ap.add_argument("--ocr-base-url", default=None)
    ap.add_argument("--ocr-model", default=None)
    ap.add_argument("--ocr-prompt", default=None)
    ap.add_argument("--ocr-api-key", default=None)
    ap.add_argument("--ocr-concurrency", type=int, default=None)
    ap.add_argument("--ocr-limit", type=int, default=None)
    ap.add_argument("--meta-api-key", default=None)
    ap.add_argument("--meta-base-url", default=None)
    ap.add_argument("--meta-model", default=None)
    ap.add_argument("--vec-server-url", default=None,
                    help="Pass-through to vectorize.py; if set, batches go to "
                         "an already-running model_server.py.")
    ap.add_argument("--hf-mirror", default=None,
                    help="HuggingFace mirror URL for auto model download "
                         "(e.g. https://hf-mirror.com for users in CN).")
    args = ap.parse_args()

    enable_json_mode(args.json)
    kb_root = resolve_kb_root(args.kb_root)
    py = _resolve_python(kb_root)

    if args.only:
        stages = list(args.only)
    else:
        stages = [s for s in STAGES if not getattr(args, f"skip_{s}", False)]

    emit_event("build", "info", f"pipeline stages: {stages} | python={py}", stages=stages, python=py)

    for stage in stages:
        # vectorize needs bge-m3 + reranker weights on disk; auto-download
        # them the first time (skipped when --vec-server-url is set, since
        # then a remote model_server owns the weights).
        if stage == "vectorize" and not args.vec_server_url:
            _ensure_models(kb_root, py, args)
        cmd = stage_command(stage, args, kb_root, py)
        emit_event("build", "info", f"-> {stage}", stage_started=stage)
        try:
            proc = subprocess.run(cmd, check=False)
        except FileNotFoundError as exc:
            emit_fatal("build", f"could not launch {stage}", exc)
        if proc.returncode != 0:
            emit_fatal("build",
                       f"stage {stage} exited with code {proc.returncode}")
        emit_event("build", "info", f"<- {stage} ok", stage_finished=stage)

    emit_event("build", "done", "pipeline finished", stages=stages)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        emit_event("build", "error", "interrupted by user")
        sys.exit(130)
