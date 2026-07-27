# @brainpilot/kb-scripts

**Content-only package.** Ships the BrainPilot KnowledgeBase Python pipeline
(setup / build / model-server scripts + `requirements.txt`) so that npm users
can build a local knowledge base without cloning the repo.

The `kb/` directory is populated by this package's `prepack` lifecycle hook
(`scripts/stage.mjs`) from the canonical `KnowledgeBase/` at the BrainPilot
repo root; it is deliberately absent from git. Every published tarball
includes `kb/scripts/`, `kb/server/`, `kb/requirements.txt`, `kb/README.md`
and `kb/.gitignore`.

## How it reaches the user

On the first `brainpilot up` (or backend startup in a container), the runtime
calls `materializeKb()` (`packages/runtime/src/materialize-kb.ts`) which
copies `kb/` into `~/.brainpilot/KnowledgeBase/`. That path is the shared
default that `findKbRoot()` / `detectKbRoot()` in the runtime and backend
both fall back to (issue #378 Part 3), so subsequent build orchestration
(`setup_env.py`, `setup_models.py`, `build_kb.py`) and the model sidecar
(`model_server.py`) find everything without any extra env plumbing.

`BP_KB_ROOT`, if set, still wins — the materialisation is a no-op then.

## Editing scripts

Edit `KnowledgeBase/*` at the repo root — this package is a mirror.
`npm pack --workspace=@brainpilot/kb-scripts` runs `prepack` to refresh
`kb/` deterministically before the tarball is written.
