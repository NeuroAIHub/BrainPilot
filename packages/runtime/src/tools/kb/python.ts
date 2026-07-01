/**
 * Resolve the Python interpreter used for KnowledgeBase subprocess calls.
 *
 * Priority order:
 *   1. ``BP_KB_PYTHON``  — explicit override (env var, set by anyone who
 *      needs to point at a custom interpreter, e.g. a conda env outside
 *      the repo).
 *   2. ``<KB_ROOT>/.venv/bin/python``  /  ``<KB_ROOT>\.venv\Scripts\python.exe``
 *      — the venv created by ``scripts/setup_env.sh`` (or ``.bat``). This is
 *      the recommended setup and what the README walks the user through.
 *   3. ``PYTHON`` env var.
 *   4. ``python3`` (Unix) / ``python`` (Windows) on PATH.
 *
 * Both the orchestrator (backend-core/src/kb-builder.ts) and the bge model
 * sidecar (tools/kb/sidecar.ts) call this so the user only ever has to set
 * up one interpreter.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveKbPaths } from "./paths.js";

export function resolveKbPython(kbRootOverride?: string): string {
  // 1. explicit override
  const override = process.env.BP_KB_PYTHON?.trim();
  if (override) return override;

  // 2. KnowledgeBase/.venv created by setup_env.sh / .bat
  const kb = resolveKbPaths(kbRootOverride);
  const venvCandidates =
    process.platform === "win32"
      ? [join(kb.root, ".venv", "Scripts", "python.exe")]
      : [join(kb.root, ".venv", "bin", "python")];
  for (const p of venvCandidates) {
    if (existsSync(p)) return p;
  }

  // 3. generic PYTHON env var
  const pyEnv = process.env.PYTHON?.trim();
  if (pyEnv) return pyEnv;

  // 4. PATH fallback
  return process.platform === "win32" ? "python" : "python3";
}
