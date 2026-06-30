#!/usr/bin/env bash
# Bootstrap a Python virtualenv for the KnowledgeBase pipeline.
#
# Creates  <KB_ROOT>/.venv   and installs requirements.txt into it. Both the
# `build_kb.py` orchestrator and the runtime's bge sidecar auto-detect this
# venv (look for `.venv/bin/python` next to KnowledgeBase/), so once this
# script finishes you never have to set BP_KB_PYTHON or activate anything by
# hand — the "Build Knowledge Base" button in the web UI Just Works.
#
# Usage:
#   bash KnowledgeBase/scripts/setup_env.sh
#   bash KnowledgeBase/scripts/setup_env.sh --python /opt/python3.11/bin/python3
#   bash KnowledgeBase/scripts/setup_env.sh --reinstall      # nuke and rebuild
#
# Requirements:
#   - Python ≥ 3.10 on PATH (or pass --python /full/path)
#   - ~5 GB free disk (PyTorch + FlagEmbedding wheels)
#
# Network notes:
#   - PyPI download is the only network step. If you need a mirror, export
#     PIP_INDEX_URL before running, e.g.:
#       export PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
#   - GPU users: install your preferred torch wheel FIRST, then re-run this
#     script — pip will see torch already satisfied and skip it.
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
KB_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
VENV_DIR="$KB_ROOT/.venv"
REQ_FILE="$KB_ROOT/requirements.txt"

PYTHON_BIN=""
REINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --python)   PYTHON_BIN="$2"; shift 2 ;;
    --reinstall) REINSTALL=1; shift ;;
    -h|--help)
      sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PYTHON_BIN" ]]; then
  # Prefer python3.12 > 3.11 > 3.10 > 3 > python — newer Python ships
  # faster torch wheels and fewer surprises.
  for cand in python3.12 python3.11 python3.10 python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
      PYTHON_BIN="$cand"
      break
    fi
  done
fi
if [[ -z "$PYTHON_BIN" ]]; then
  echo "ERROR: no python interpreter found on PATH. Pass --python /full/path" >&2
  exit 1
fi

PY_VERSION=$("$PYTHON_BIN" -c 'import sys; print("%d.%d" % sys.version_info[:2])')
echo "[setup_env] using $PYTHON_BIN  (Python $PY_VERSION)"

if [[ ! -f "$REQ_FILE" ]]; then
  echo "ERROR: $REQ_FILE not found — is the KnowledgeBase tree intact?" >&2
  exit 1
fi

if [[ $REINSTALL -eq 1 && -d "$VENV_DIR" ]]; then
  echo "[setup_env] --reinstall: removing $VENV_DIR"
  rm -rf "$VENV_DIR"
fi

if [[ ! -d "$VENV_DIR" ]]; then
  echo "[setup_env] creating venv at $VENV_DIR"
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

VENV_PY="$VENV_DIR/bin/python"
if [[ ! -x "$VENV_PY" ]]; then
  echo "ERROR: venv looks broken — $VENV_PY missing or not executable." >&2
  exit 1
fi

echo "[setup_env] upgrading pip / wheel"
"$VENV_PY" -m pip install --upgrade pip wheel >/dev/null

echo "[setup_env] installing requirements.txt (this can take several minutes the first time)"
"$VENV_PY" -m pip install -r "$REQ_FILE"

# Sanity check — every import the four pipeline stages need.
echo "[setup_env] verifying imports"
"$VENV_PY" - <<'PY'
import importlib
required = [
    "fitz",                  # OCR stage
    "openai",                # OCR + extract_meta
    "numpy",
    "requests",
    "fastapi",
    "uvicorn",
    "pydantic",
    "huggingface_hub",       # setup_models
    "FlagEmbedding",         # vectorize + sidecar
]
missing = []
for m in required:
    try:
        importlib.import_module(m)
    except ImportError as e:
        missing.append(f"  - {m}: {e}")
if missing:
    print("MISSING IMPORTS:")
    for m in missing:
        print(m)
    raise SystemExit(2)
print("OK — all pipeline dependencies importable.")
PY

echo
echo "[setup_env] done."
echo
echo "  Venv:    $VENV_DIR"
echo "  Python:  $VENV_PY"
echo
echo "BrainPilot's web 'Build Knowledge Base' button and the build_kb.py CLI"
echo "both auto-detect this venv. No extra env vars to set."
