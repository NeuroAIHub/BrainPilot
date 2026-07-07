"""
Cross-platform bootstrap for the KnowledgeBase Python venv.

Identical effect to ``scripts/setup_env.sh`` / ``scripts/setup_env.bat``,
but written in pure stdlib Python so the BrainPilot backend can spawn it
on any OS — Windows users no longer need bash, Linux users no longer need
``.bat`` semantics.

What it does
------------
  1. Pick an interpreter (CLI arg → newest python3.x on PATH → ``sys.executable``).
  2. Create ``<KB_ROOT>/.venv`` via stdlib ``venv`` (idempotent unless
     ``--reinstall``).
  3. Run ``<venv>/bin/python -m pip install --upgrade pip wheel``.
  4. Run ``<venv>/bin/python -m pip install -r requirements.txt``.
  5. Import every dependency the pipeline needs to fail fast if a wheel
     refused to install (e.g. no compatible torch on this platform).

Progress is emitted as NDJSON events on stdout (stage="setup-env") so the
web UI's KB panel can render a live log identical to the build stream.

This script has zero third-party imports — it is meant to run on the
user's system Python *before* the venv exists.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import venv
from datetime import datetime, timezone
from pathlib import Path

# We intentionally do NOT ``import _common`` — that module is fine here
# (it's also stdlib-only), but keeping setup_env.py self-contained means a
# half-extracted KnowledgeBase tarball can still bootstrap.

_JSON = False


def _emit(event: str, msg: str, **extra) -> None:
    if _JSON:
        line = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "stage": "setup-env",
            "event": event,
            "msg": msg,
            **extra,
        }
        sys.stdout.write(json.dumps(line, ensure_ascii=False) + "\n")
    else:
        sys.stdout.write(f"[setup-env:{event}] {msg}\n")
    sys.stdout.flush()


REQUIRED_IMPORTS = [
    "fitz",                  # OCR (PyMuPDF)
    "openai",                # OCR + extract_meta
    "numpy",
    "requests",
    "fastapi",
    "uvicorn",
    "pydantic",
    "huggingface_hub",       # setup_models.py
    "FlagEmbedding",         # vectorize + sidecar
]


def _find_default_python() -> str:
    """Pick the newest python3.x available on PATH, falling back to whatever
    is running us. Returns an absolute path when possible — relative names
    can resolve differently inside venv child processes."""
    for cand in ("python3.12", "python3.11", "python3.10", "python3", "python"):
        which = shutil.which(cand)
        if which:
            return which
    return sys.executable


def _venv_python(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def _run_streaming(cmd: list[str], label: str, env: dict | None = None) -> int:
    """Run a subprocess, forwarding each stdout/stderr line as a setup-env
    event so the user can watch pip download progress in real time.

    ``env`` overrides the child's environment when non-None. Callers use this
    to inject PIP_INDEX_URL for a China mirror without leaking the URL into
    the argv or into a printed shell echo (some corporate mirrors carry
    tokens in the URL).

    Returns the process's exit code. We don't raise — the caller decides
    how to surface the failure.
    """
    _emit("info", f"$ {' '.join(cmd)}", subcommand=label)
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            text=True,
            env=env,
        )
    except FileNotFoundError as exc:
        _emit("error", f"failed to spawn {cmd[0]}: {exc}")
        return 127

    assert proc.stdout is not None
    for line in proc.stdout:
        line = line.rstrip()
        if not line:
            continue
        # pip emits progress bars with carriage returns that we'd otherwise
        # smear together; the rstrip above handles the trailing \r.
        _emit("log", line, subcommand=label)
    return proc.wait()


def _verify_imports(python: Path) -> bool:
    """Spawn the venv python and try to import every required module.
    Returns True iff every import succeeded."""
    snippet = (
        "import importlib, json, sys\n"
        f"required = {REQUIRED_IMPORTS!r}\n"
        "missing = []\n"
        "for m in required:\n"
        "    try: importlib.import_module(m)\n"
        "    except Exception as e: missing.append((m, repr(e)))\n"
        "print(json.dumps(missing))\n"
    )
    try:
        out = subprocess.check_output([str(python), "-c", snippet], text=True, timeout=120)
    except subprocess.CalledProcessError as exc:
        _emit("error", f"import probe crashed: {exc}")
        return False
    except subprocess.TimeoutExpired:
        _emit("error", "import probe timed out after 120s")
        return False
    try:
        missing = json.loads(out)
    except json.JSONDecodeError:
        _emit("error", f"import probe returned non-JSON: {out!r}")
        return False
    if missing:
        for name, err in missing:
            _emit("error", f"  missing: {name} ({err})")
        return False
    _emit("info", "all pipeline dependencies importable")
    return True


def main() -> int:
    global _JSON

    here = Path(__file__).resolve()
    default_kb_root = here.parent.parent

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--kb-root", default=str(default_kb_root),
                    help="KnowledgeBase root (defaults to the directory above this script).")
    ap.add_argument("--python", default=None,
                    help="Path to the Python interpreter that should CREATE "
                         "the venv. Defaults to the newest python3.x on PATH.")
    ap.add_argument("--reinstall", action="store_true",
                    help="Remove and recreate the venv from scratch.")
    ap.add_argument("--pip-index-url", default=None,
                    help="pip package index URL to use for BOTH pip installs "
                         "(pip/wheel upgrade and requirements.txt). Common "
                         "China mirrors: https://pypi.tuna.tsinghua.edu.cn/simple, "
                         "https://mirrors.aliyun.com/pypi/simple. When omitted "
                         "falls back to PIP_INDEX_URL env, then pypi.org.")
    ap.add_argument("--json", action="store_true",
                    help="Emit progress as NDJSON events (one per line).")
    args = ap.parse_args()

    _JSON = bool(args.json)

    kb_root = Path(args.kb_root).resolve()
    venv_dir = kb_root / ".venv"
    req_file = kb_root / "requirements.txt"

    _emit("info", f"kb_root={kb_root}", kb_root=str(kb_root))

    if not req_file.exists():
        _emit("error", f"requirements.txt not found at {req_file}")
        return 2

    bootstrap_python = args.python or _find_default_python()
    try:
        version_out = subprocess.check_output(
            [bootstrap_python, "-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"],
            text=True, timeout=10,
        ).strip()
    except Exception as exc:  # noqa: BLE001
        _emit("error", f"bootstrap python {bootstrap_python!r} is not usable: {exc}")
        return 1
    _emit("info", f"bootstrap python: {bootstrap_python} (Python {version_out})",
          python=bootstrap_python, python_version=version_out)
    major, minor, *_ = (int(p) for p in version_out.split("."))
    if (major, minor) < (3, 10):
        _emit("error", f"need Python ≥ 3.10, got {version_out}. "
                       f"Pass --python with a newer interpreter.")
        return 1

    if args.reinstall and venv_dir.exists():
        _emit("info", f"--reinstall: removing existing venv at {venv_dir}")
        shutil.rmtree(venv_dir)

    if venv_dir.exists():
        _emit("info", f"venv already at {venv_dir}; reusing it",
              venv=str(venv_dir))
    else:
        _emit("progress", f"creating venv at {venv_dir} (this can take a minute) ...",
              venv=str(venv_dir), percent=10)
        try:
            # with_pip=True wires up pip from ensurepip — same as `python -m venv`.
            venv.EnvBuilder(with_pip=True, upgrade_deps=False, clear=False).create(str(venv_dir))
        except Exception as exc:  # noqa: BLE001
            _emit("error", f"venv creation failed: {type(exc).__name__}: {exc}")
            return 1

    venv_py = _venv_python(venv_dir)
    if not venv_py.exists():
        _emit("error", f"venv looks broken: {venv_py} not found")
        return 1
    _emit("info", f"venv python: {venv_py}", venv_python=str(venv_py))

    # Resolve pip index URL BEFORE the first pip call so it applies to both
    # the pip/wheel self-upgrade and the requirements install. Priority:
    # --pip-index-url flag → PIP_INDEX_URL env → pip's own default (pypi.org).
    # We only override when we actually have a URL to hand pip — leaving env
    # untouched lets the caller's PIP_INDEX_URL sail through unmodified.
    pip_env: dict | None = None
    pip_index_url = args.pip_index_url or os.environ.get("PIP_INDEX_URL")
    if pip_index_url:
        pip_env = os.environ.copy()
        pip_env["PIP_INDEX_URL"] = pip_index_url
        # tuna / aliyun / ustc all serve via HTTPS so no --trusted-host, but
        # log the mirror so the operator can confirm which one they hit —
        # some corporate mirrors mask themselves as pypi.org URLs and this is
        # how you tell.
        _emit("info", f"using pip index: {pip_index_url}")

    _emit("progress", "upgrading pip + wheel ...", percent=20)
    rc = _run_streaming(
        [str(venv_py), "-m", "pip", "install", "--upgrade", "pip", "wheel"],
        label="upgrade-pip",
        env=pip_env,
    )
    if rc != 0:
        _emit("error", f"pip self-upgrade exited with code {rc}")
        return rc

    _emit("progress", f"installing dependencies from {req_file.name} "
                      "(this can take several minutes the first time) ...", percent=40)
    rc = _run_streaming(
        [str(venv_py), "-m", "pip", "install", "-r", str(req_file)],
        label="install-requirements",
        env=pip_env,
    )
    if rc != 0:
        _emit("error",
              f"pip install -r requirements.txt exited with code {rc}. "
              f"If you need a different torch wheel for your platform / CUDA "
              f"version, install it manually into {venv_py} first, then "
              f"re-run this setup.")
        return rc

    _emit("progress", "verifying imports ...", percent=90)
    if not _verify_imports(venv_py):
        _emit("error", "verification failed — some dependencies did not install correctly.")
        return 3

    _emit("done", f"venv ready at {venv_dir}",
          venv=str(venv_dir), python=str(venv_py), percent=100)
    return 0


if __name__ == "__main__":
    sys.exit(main())
