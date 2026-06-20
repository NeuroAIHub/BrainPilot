/**
 * materialize-skills.ts — copy the bundled `@brainpilot/skills` content into a
 * data dir's `bp_template/skills/`, so Pi's native skill pipeline can load
 * user-editable skills from there.
 *
 * Pipeline (three stages, see issues #139/#140):
 *   - package time: skills ship read-only inside `@brainpilot/skills`.
 *   - deploy time:  this fn copies them into `<dataRoot>/bp_template/skills/`.
 *   - runtime:      Pi loads from `bp_template/skills/` via `additionalSkillPaths`.
 *
 * Idempotent and edit-preserving: a file that already exists at the destination
 * is NEVER overwritten (so user edits and per-skill customisations survive).
 *
 * Called from BOTH the CLI `scaffold` and the runtime server startup. It lives
 * in `@brainpilot/runtime` (not the CLI) because the dependency direction is
 * cli → runtime; putting it in the CLI would make runtime depend on the CLI.
 */
import { createRequire } from "node:module";
import { mkdir, readdir, copyFile, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { dirname, join } from "node:path";

/** Result of a materialize run. */
export interface MaterializeSkillsResult {
  /** Absolute destination dir (`<dataRoot>/bp_template/skills`). */
  dest: string;
  /** Absolute source dir (the bundled `@brainpilot/skills` skills/). */
  source: string | null;
  /** Number of files freshly copied (absent before). */
  copied: number;
  /** Number of files skipped because they already existed. */
  skipped: number;
}

/**
 * Locate the bundled `skills/` directory of the `@brainpilot/skills` package.
 * Resolves the package via `require.resolve` so it works under workspace
 * symlinks, flat npm `node_modules`, and the Docker image alike. Returns null
 * if the package can't be resolved (skills are a convenience, not a hard dep).
 */
export function resolveBundledSkillsDir(from: string = import.meta.url): string | null {
  try {
    const require = createRequire(from);
    // package.json is always at the package root; skills/ sits beside it.
    const pkgJson = require.resolve("@brainpilot/skills/package.json");
    return join(dirname(pkgJson), "skills");
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively copy `src` → `dst`, skipping any file that already exists at the
 * destination. Mutates `counters` so the caller can report copied/skipped.
 */
async function copyTreeSkipExisting(
  src: string,
  dst: string,
  counters: { copied: number; skipped: number },
): Promise<void> {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(src, entry.name);
    const to = join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyTreeSkipExisting(from, to, counters);
    } else if (entry.isFile()) {
      if (await exists(to)) {
        counters.skipped++;
        continue;
      }
      await copyFile(from, to);
      counters.copied++;
    }
    // symlinks / other types are intentionally ignored — skill content is
    // plain files and directories.
  }
}

/**
 * Materialize the bundled skills into `<dataRoot>/bp_template/skills/`.
 *
 * Skip-if-exists at the file level: existing files are preserved, missing ones
 * are filled in. Safe to call on every launch. A no-op (copied=0) when the
 * package can't be resolved or the source dir is empty/absent.
 */
export async function materializeSkills(dataRoot: string): Promise<MaterializeSkillsResult> {
  const dest = join(dataRoot, "bp_template", "skills");
  const source = resolveBundledSkillsDir();
  const counters = { copied: 0, skipped: 0 };

  if (source && (await exists(source))) {
    await copyTreeSkipExisting(source, dest, counters);
  } else {
    // Still ensure the destination dir exists so loaders have a stable path.
    await mkdir(dest, { recursive: true });
  }

  return { dest, source: source && (await exists(source)) ? source : null, ...counters };
}
