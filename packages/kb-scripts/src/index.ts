/**
 * @brainpilot/kb-scripts — bundled KnowledgeBase Python scripts.
 *
 * This package is pure CONTENT: the `kb/` directory (present in the published
 * tarball, absent from git) holds the shippable subset of the repo-root
 * `KnowledgeBase/` tree — `scripts/`, `server/`, `requirements.txt`,
 * `README.md`, `.gitignore`. It is populated deterministically by the
 * package's `prepack` lifecycle hook (`scripts/stage.mjs`), which mirrors
 * from `<repo>/KnowledgeBase/` at `npm pack` / `npm publish` time.
 *
 * The runtime materialises this content into `~/.brainpilot/KnowledgeBase/`
 * on first launch (`packages/runtime/src/materialize-kb.ts`), so that
 * `findKbRoot` / `detectKbRoot` (§378 Part 3) find it via their unified
 * fallback and the "Set up Python environment" / "Set up Models" buttons in
 * the web UI work out-of-the-box for npm-installed users.
 *
 * The only thing this module exports is the absolute path to the bundled
 * `kb/` directory, so the runtime can locate it via
 * `require.resolve("@brainpilot/kb-scripts/package.json")` regardless of
 * install layout (workspace symlink, flat npm node_modules, Docker image).
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the bundled `kb/` directory. Lives at the package root,
 * one level above the compiled `dist/` (or `src/`) dir. Present in every
 * published tarball; absent when running from a fresh git checkout that has
 * not been packed — dev must fall back to walking up to the repo root (see
 * `resolveBundledKbDir` in the runtime).
 */
export const BUNDLED_KB_DIR = resolve(join(__dirname, "..", "kb"));
