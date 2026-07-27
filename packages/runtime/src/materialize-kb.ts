/**
 * materialize-kb.ts — copy the bundled `@brainpilot/kb-scripts` content into
 * the user-level KnowledgeBase directory (`~/.brainpilot/KnowledgeBase`), so
 * `setup_env.py`, `setup_models.py`, `build_kb.py` and `model_server.py`
 * are findable by both backend-core (build orchestration) and runtime
 * (sidecar) without the user cloning the repo. See issue #378 Part 1.
 *
 * Lifecycle (mirrors {@link ./materialize-skills.ts}):
 *   - package time: scripts ship read-only inside `@brainpilot/kb-scripts/kb/`
 *                   (populated by that pkg's `prepack` hook from repo-root
 *                   KnowledgeBase/).
 *   - deploy time:  this fn copies them into `~/.brainpilot/KnowledgeBase/`.
 *   - runtime:      Part 3's unified fallback (findKbRoot / detectKbRoot)
 *                   picks up the materialised copy when BP_KB_ROOT is unset
 *                   and no git-checkout sibling exists.
 *
 * Skip conditions (any triggers a no-op with a `reason`):
 *   - `BP_KB_ROOT` is set — user opted-in to a specific location.
 *   - The walk-up locates a repo-root `KnowledgeBase/scripts/build_kb.py`
 *     (dev machine — sibling wins under both resolvers, so populating the
 *     user home would be a confusing duplicate).
 *   - `BP_SKIP_KB_COPY=1` — test hook, symmetric with BP_SKIP_SKILL_COPY.
 *
 * Skip-if-exists at the FILE level (identical to materializeSkills) so user
 * edits to any staged script survive re-launches.
 */
import { createRequire } from "node:module";
import { mkdir, readdir, copyFile, access } from "node:fs/promises";
import { constants as FS, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type MaterializeKbSkipReason =
  | "env-override"
  | "sibling-kb"
  | "no-source"
  | "skip-env";

export interface MaterializeKbResult {
  /** Where scripts would land (`~/.brainpilot/KnowledgeBase`). */
  dest: string;
  /** Absolute path we copied from, or `null` when skipped before resolving. */
  source: string | null;
  /** Files freshly copied this run. */
  copied: number;
  /** Files skipped (already existed). */
  skipped: number;
  /** Present iff we did NOT copy. Absent on a real copy run. */
  reason?: MaterializeKbSkipReason;
}

export interface MaterializeKbOptions {
  /** Overrides `process.env` — test hook. */
  env?: NodeJS.ProcessEnv;
  /** Overrides `homedir()` — test hook. */
  homeDir?: string;
  /**
   * Force the source path (bypass resolution). Used by tests that want to
   * exercise the copy path with a synthesised layout. Must contain
   * `scripts/build_kb.py` under it.
   */
  sourceOverride?: string;
}

/**
 * Locate the bundled `kb/` directory of `@brainpilot/kb-scripts`.
 *
 * Two-phase, in order:
 *   1. `require.resolve` — the published/installed layout: `kb/` sits next
 *      to `package.json` (workspace symlink, flat node_modules, and Docker
 *      image all resolve identically). We only accept it if `kb/scripts/
 *      build_kb.py` is present — during workspace dev the pkg is linked but
 *      `kb/` is absent (only staged at `npm pack` time).
 *   2. Repo-root walk — from this module, walk up to find a sibling
 *      `KnowledgeBase/`. This is the monorepo dev path.
 *
 * Returns null when neither succeeds.
 */
export function resolveBundledKbDir(from: string = import.meta.url): string | null {
  // Phase 1 — published/installed.
  try {
    const require = createRequire(from);
    const pkgJson = require.resolve("@brainpilot/kb-scripts/package.json");
    const kbDir = join(dirname(pkgJson), "kb");
    if (existsSync(join(kbDir, "scripts", "build_kb.py"))) return kbDir;
  } catch {
    /* fall through to phase 2 */
  }
  // Phase 2 — monorepo dev.
  let dir = dirname(fileURLToPath(from));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "KnowledgeBase");
    if (existsSync(join(candidate, "scripts", "build_kb.py"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Standard user-level KB dir. Matches Part 3's unified fallback. */
export function defaultUserKbDir(homeDir: string = homedir()): string {
  return join(homeDir, ".brainpilot", "KnowledgeBase");
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
 * Recursively copy `src` → `dst`, skipping any file that already exists at
 * the destination. Mutates `counters` so the caller can report copied/
 * skipped. Python bytecode caches and `.pyc` files are elided — they'd only
 * add OS-specific noise to the user-owned tree.
 */
async function copyTreeSkipExisting(
  src: string,
  dst: string,
  counters: { copied: number; skipped: number },
): Promise<void> {
  await mkdir(dst, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
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
    // symlinks / other types are intentionally ignored — scripts are plain
    // files and directories.
  }
}

/**
 * Distinguish "packaged" from "sibling KB": only when we resolved to the
 * @brainpilot/kb-scripts install location should we actually populate the
 * user home. If we walked up and found the repo-root KnowledgeBase/,
 * the fallback resolver will prefer that sibling anyway — creating a
 * duplicate at ~/.brainpilot/KnowledgeBase would silently mask it and
 * confuse future edits.
 */
function isPackagedSource(source: string): boolean {
  const nm = join("node_modules", "@brainpilot", "kb-scripts");
  const pkgSuffix = join("kb-scripts", "kb");
  return source.includes(nm) || source.endsWith(pkgSuffix);
}

/**
 * Materialise the bundled KB scripts into `~/.brainpilot/KnowledgeBase/`
 * when (and only when) it's the effective KB root. Returns counts + a
 * reason if skipped. Safe to call on every launch — skip-if-exists at file
 * level. Best-effort: callers should catch and log; failures should never
 * block server startup or scaffold.
 */
export async function materializeKb(
  options: MaterializeKbOptions = {},
): Promise<MaterializeKbResult> {
  const env = options.env ?? process.env;
  const dest = defaultUserKbDir(options.homeDir ?? homedir());

  if (env.BP_SKIP_KB_COPY === "1" || env.BP_SKIP_KB_COPY === "true") {
    return { dest, source: null, copied: 0, skipped: 0, reason: "skip-env" };
  }
  if (env.BP_KB_ROOT?.trim()) {
    return { dest, source: null, copied: 0, skipped: 0, reason: "env-override" };
  }

  const source = options.sourceOverride ?? resolveBundledKbDir();
  if (!source) {
    return { dest, source: null, copied: 0, skipped: 0, reason: "no-source" };
  }
  if (!isPackagedSource(source)) {
    return { dest, source, copied: 0, skipped: 0, reason: "sibling-kb" };
  }

  await mkdir(dest, { recursive: true });
  const counters = { copied: 0, skipped: 0 };
  await copyTreeSkipExisting(source, dest, counters);
  return { dest, source, ...counters };
}
