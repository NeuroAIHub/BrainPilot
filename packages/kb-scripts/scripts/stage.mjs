#!/usr/bin/env node
/**
 * stage.mjs — populate `packages/kb-scripts/kb/` from `<repo>/KnowledgeBase/`.
 *
 * Runs as the pkg's `prepack` lifecycle hook: `npm pack`, `npm publish`, and
 * a `npm install` of the packed tarball all trigger it. Idempotent — the
 * destination is wiped first so a stale entry from a previous pack can't
 * survive.
 *
 * Only the shippable subset is copied: scripts, the model_server sidecar,
 * requirements.txt and README.md. User-data / artefact dirs (`models/`,
 * `source/`, `chunks/`, `vectorstore/`, `.venv/`) and Python bytecode caches
 * (`__pycache__/`, `*.pyc`) are excluded — they add MB and are OS-specific.
 * `.gitignore` is intentionally NOT staged: npm strips dotfiles at pkg root
 * from published tarballs, and the file is purely cosmetic in the
 * materialised `~/.brainpilot/KnowledgeBase/` (which isn't a git repo).
 *
 * See issue #378 (Part 1) for context.
 */
import { rm, mkdir, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const repo = resolve(pkg, "..", "..");
const src = join(repo, "KnowledgeBase");
const dst = join(pkg, "kb");

if (!existsSync(src)) {
  console.error(
    `[kb-scripts:stage] source ${src} missing — run this from a full BrainPilot checkout.`,
  );
  process.exit(1);
}

await rm(dst, { recursive: true, force: true });
await mkdir(dst, { recursive: true });

/** Filter out python bytecode caches on the fly during recursive copy. */
function keep(path) {
  if (/[\\/]__pycache__(?:[\\/]|$)/.test(path)) return false;
  if (path.endsWith(".pyc")) return false;
  return true;
}

for (const entry of ["scripts", "server", "requirements.txt", "README.md"]) {
  const from = join(src, entry);
  const to = join(dst, entry);
  if (!existsSync(from)) continue; // README.md etc. are optional
  await cp(from, to, { recursive: true, filter: keep });
}

// Post-condition: the tarball is worthless without the entry script. A
// filter regression that dropped `scripts/build_kb.py` would otherwise
// ship an empty-shell package and land users right back on #378. Fail
// the pack loudly here so it never reaches the registry.
const canary = join(dst, "scripts", "build_kb.py");
if (!existsSync(canary)) {
  console.error(
    `[kb-scripts:stage] post-condition failed — ${canary} is missing after staging. ` +
      "Refusing to produce an empty kb-scripts tarball.",
  );
  process.exit(2);
}

console.log(`[kb-scripts:stage] staged ${dst} from ${src}`);
