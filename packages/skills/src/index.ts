/**
 * @brainpilot/skills — bundled Agent Skills content package.
 *
 * This package is pure CONTENT: the `skills/` directory holds the built-in
 * neuroscience / cognitive-science / writing skills as `SKILL.md` files (with
 * YAML frontmatter `name` / `description`), laid out as `<category>/<skill>/SKILL.md`.
 *
 * Skills are NOT served through a custom tool or MCP server anymore. They are
 * loaded through Pi's NATIVE skill pipeline (`DefaultResourceLoader`'s
 * `additionalSkillPaths`), which already implements progressive disclosure
 * (skill name+description in the system prompt, body read on demand). At deploy
 * time the runtime/CLI materialize these files into `<dataDir>/bp_template/skills/`
 * (user-editable), and Pi loads from there.
 *
 * The only thing this module exports is the absolute path to the bundled
 * `skills/` directory, so the runtime/CLI can locate it for materialization via
 * `require.resolve("@brainpilot/skills")` regardless of install layout
 * (workspace symlink, flat npm node_modules, or Docker image).
 */
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the bundled skills/ directory. Lives at the package root,
 * one level above the compiled `dist/` (or `src/`) dir.
 */
export const BUNDLED_SKILLS_DIR = resolve(join(__dirname, "..", "skills"));
