/**
 * materialize-skills.ts — copy the bundled `@brainpilot/skills` content into a
 * data dir, splitting it across TWO physically separate skill libraries:
 *
 *   <dataRoot>/bp_template/skills/         (always-on, Pi-native)
 *     Loaded through Pi's `additionalSkillPaths`. Every SKILL.md's name +
 *     description appears in the agent's `<available_skills>` block. Reserved
 *     for high-frequency Meta-Skills so the prompt does not bloat.
 *
 *   <dataRoot>/bp_template/skills-router/  (router-only)
 *     Pi never sees this directory; it is reachable only via the `skill_search`
 *     custom tool. Holds the long tail of domain skills.
 *
 * Distribution rule (purely physical):
 *   - bundled `01_Meta-Skills/*` → always-on
 *   - everything else            → router
 *
 * Both libraries accept user-added skills with the SAME on-disk format
 * (`<category>/<skill_name>/SKILL.md` + optional `references/` / `scripts/`),
 * so the user can drop a directory into either side and it just works.
 *
 * Pipeline (three stages, see issues #139/#140):
 *   - package time: skills ship read-only inside `@brainpilot/skills`.
 *   - deploy time:  this fn copies them into the two destinations above.
 *   - runtime:      Pi loads from `bp_template/skills/` via additionalSkillPaths;
 *                   `skill_search` reads `bp_template/skills-router/`.
 *
 * Idempotent and edit-preserving: a file that already exists at either
 * destination is NEVER overwritten (so user edits and per-skill customisations
 * survive). Called from BOTH the CLI `scaffold` and the runtime server startup.
 * It lives in `@brainpilot/runtime` (not the CLI) because the dependency
 * direction is cli → runtime.
 */
import { createRequire } from "node:module";
import { mkdir, readdir, copyFile, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Source category whose contents go into the always-on library. Anything else
 * ends up in the router library. Kept as a constant so a test can pin the
 * distribution rule explicitly.
 */
export const ALWAYS_ON_CATEGORY = "01_Meta-Skills";

/** Result of a materialize run. */
export interface MaterializeSkillsResult {
  /** Absolute always-on destination dir (`<dataRoot>/bp_template/skills`). */
  dest: string;
  /** Absolute router destination dir (`<dataRoot>/bp_template/skills-router`). */
  routerDest: string;
  /** Absolute source dir (the bundled `@brainpilot/skills` skills/). */
  source: string | null;
  /** Files freshly copied into the always-on dir. */
  copied: number;
  /** Files skipped (already existed) in the always-on dir. */
  skipped: number;
  /** Files freshly copied into the router dir. */
  routerCopied: number;
  /** Files skipped (already existed) in the router dir. */
  routerSkipped: number;
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
 * Materialize the bundled skills, splitting by source category:
 * `01_Meta-Skills/*` → always-on dir, every other top-level category → router
 * dir. Skip-if-exists at the file level on BOTH destinations: existing files
 * are preserved, missing ones are filled in. Safe to call on every launch. A
 * no-op (all counts 0) when the package can't be resolved or the source is
 * empty/absent.
 */
export async function materializeSkills(dataRoot: string): Promise<MaterializeSkillsResult> {
  const dest = join(dataRoot, "bp_template", "skills");
  const routerDest = join(dataRoot, "bp_template", "skills-router");
  const source = resolveBundledSkillsDir();
  const alwaysOn = { copied: 0, skipped: 0 };
  const router = { copied: 0, skipped: 0 };

  // Always ensure both destination dirs exist so loaders / the router tool
  // have a stable path even when the source is missing or empty.
  await mkdir(dest, { recursive: true });
  await mkdir(routerDest, { recursive: true });

  if (source && (await exists(source))) {
    const topLevel = await readdir(source, { withFileTypes: true });
    for (const entry of topLevel) {
      if (!entry.isDirectory()) continue; // skip stray files at the source root
      const from = join(source, entry.name);
      if (entry.name === ALWAYS_ON_CATEGORY) {
        // Mount the meta-skills directory at the SAME relative path inside the
        // always-on library so a user-added meta-skill drops in identically.
        const to = join(dest, entry.name);
        await copyTreeSkipExisting(from, to, alwaysOn);
      } else {
        const to = join(routerDest, entry.name);
        await copyTreeSkipExisting(from, to, router);
      }
    }
  }

  return {
    dest,
    routerDest,
    source: source && (await exists(source)) ? source : null,
    copied: alwaysOn.copied,
    skipped: alwaysOn.skipped,
    routerCopied: router.copied,
    routerSkipped: router.skipped,
  };
}
