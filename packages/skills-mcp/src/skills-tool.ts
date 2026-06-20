/**
 * Core skills_tool implementation — query and browse modes for progressive
 * disclosure of local skills stored under the bundled `skills/` directory.
 *
 * Ported from skills_tool.py; semantics are identical. The tool is exposed
 * as an MCP tool named `skills_tool_local` by the stdio server in index.ts.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrontmatterDescription } from "./frontmatter.js";

/* ------------------------------------------------------------------ */
/*  Resolve BASE_PATH to the bundled skills/ directory                 */
/* ------------------------------------------------------------------ */

const __dirname = new URL(".", import.meta.url).pathname;
// Skills dir lives at the package root, one level above src/ (or dist/).
const BASE_PATH = resolve(join(__dirname, "..", "skills"));

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SkillRecord {
  name: string;
  description: string;
  relative_paths: string[];
}

export interface QueryResult {
  keywords: string[];
  total_matched: number;
  returned: number;
  results: Array<{
    name: string;
    description: string;
    relative_paths: string[];
    keyword_hits: number;
  }>;
}

export interface SkillsToolArgs {
  mode: "query" | "browse";
  keywords?: string[];
  topk?: number;
  skill_name?: string;
  relative_path?: string;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function collectAllSkills(): SkillRecord[] {
  const byName = new Map<string, SkillRecord>();

  const categories = readdirSync(BASE_PATH, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  for (const category of categories) {
    const catPath = join(BASE_PATH, category);
    const skills = readdirSync(catPath, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    for (const skillName of skills) {
      const skillMd = join(catPath, skillName, "SKILL.md");
      if (!existsSync(skillMd)) continue;

      const relPath = join(category, skillName);

      if (!byName.has(skillName)) {
        const content = readFileSync(skillMd, "utf8");
        const description = parseFrontmatterDescription(content);
        byName.set(skillName, {
          name: skillName,
          description,
          relative_paths: [relPath],
        });
      } else {
        byName.get(skillName)!.relative_paths.push(relPath);
      }
    }
  }

  return [...byName.values()];
}

function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const kw of keywords) {
    const kl = kw.toLowerCase();
    let pos = 0;
    while ((pos = lower.indexOf(kl, pos)) !== -1) {
      hits++;
      pos += kl.length;
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/*  Public execute function                                            */
/* ------------------------------------------------------------------ */

export async function skillsToolExecute(
  args: SkillsToolArgs,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const { mode } = args;

  // Guard: BASE_PATH must exist
  if (!existsSync(BASE_PATH)) {
    return text(`ERROR: Base path does not exist: ${BASE_PATH}`);
  }

  /* ---------------------------------------------------------------- */
  /*  QUERY MODE                                                       */
  /* ---------------------------------------------------------------- */
  if (mode === "query") {
    // Sub-mode B: direct skill lookup by name
    if (args.skill_name !== undefined && args.skill_name !== null) {
      let foundPath: string | null = null;
      const categories = readdirSync(BASE_PATH, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();

      for (const cat of categories) {
        const candidate = join(BASE_PATH, cat, args.skill_name, "SKILL.md");
        if (existsSync(candidate)) {
          foundPath = candidate;
          break;
        }
      }

      if (!foundPath) {
        return text(
          `ERROR: Skill '${args.skill_name}' not found under ${BASE_PATH}. ` +
            "Use mode='query' with keywords=[...] to discover available skills.",
        );
      }

      try {
        const content = readFileSync(foundPath, "utf8");
        return text(content);
      } catch (err) {
        return text(`ERROR: Could not read SKILL.md for '${args.skill_name}': ${err}`);
      }
    }

    // Sub-mode A: keyword search
    if (!args.keywords || args.keywords.length === 0) {
      return text(
        "ERROR: In query mode you must provide either 'keywords' (list of " +
          "strings) or 'skill_name' (exact skill name).",
      );
    }

    let allSkills: SkillRecord[];
    try {
      allSkills = collectAllSkills();
    } catch (err) {
      return text(`ERROR: Failed to scan skills directory: ${err}`);
    }

    const topk = typeof args.topk === "number" && args.topk > 0 ? args.topk : 5;
    const scored: Array<{ skill: SkillRecord; hits: number }> = [];

    for (const skill of allSkills) {
      const hits = countKeywordHits(skill.description, args.keywords);
      scored.push({ skill, hits });
    }

    // Sort descending by hit count, then alphabetically by name
    scored.sort((a, b) => b.hits - a.hits || a.skill.name.localeCompare(b.skill.name));
    const top = scored.slice(0, topk);

    const results = top.map(({ skill, hits }) => ({
      name: skill.name,
      description: skill.description,
      relative_paths: skill.relative_paths,
      keyword_hits: hits,
    }));

    const totalMatched = scored.filter((s) => s.hits > 0).length;

    return text(
      JSON.stringify(
        {
          keywords: args.keywords,
          total_matched: totalMatched,
          returned: results.length,
          results,
        },
        null,
        2,
      ),
    );
  }

  /* ---------------------------------------------------------------- */
  /*  BROWSE MODE                                                      */
  /* ---------------------------------------------------------------- */
  if (mode === "browse") {
    if (args.relative_path === undefined || args.relative_path === null) {
      return text(
        "ERROR: browse mode requires the 'relative_path' parameter. " +
          "Pass '' or '.' to list the top-level category folders.",
      );
    }

    const rel = args.relative_path.trim();
    let target: string;

    if (rel === "" || rel === ".") {
      target = resolve(BASE_PATH);
    } else {
      target = resolve(join(BASE_PATH, rel));
    }

    // Security: prevent path traversal outside BASE_PATH
    const baseResolved = resolve(BASE_PATH);
    if (!target.startsWith(baseResolved + "/") && target !== baseResolved) {
      return text("ERROR: Path traversal outside skills directory is not allowed.");
    }

    if (!existsSync(target)) {
      return text(`ERROR: Path does not exist: '${args.relative_path}'`);
    }

    // Directory: list children
    if (statSync(target).isDirectory()) {
      const children = readdirSync(target, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child) => ({
          name: child.name,
          type: child.isDirectory() ? "directory" : "file",
        }));

      const displayPath =
        target !== baseResolved
          ? target.slice(baseResolved.length + 1) // relative to BASE_PATH without leading slash
          : ".";

      return text(
        JSON.stringify(
          { path: displayPath, type: "directory", children },
          null,
          2,
        ),
      );
    }

    // File: return full content
    if (statSync(target).isFile()) {
      try {
        const content = readFileSync(target, "utf8");
        return text(content);
      } catch (err) {
        return text(`ERROR: Could not read file '${args.relative_path}': ${err}`);
      }
    }

    return text(
      `ERROR: Path exists but is neither a file nor a directory: '${args.relative_path}'`,
    );
  }

  /* ---------------------------------------------------------------- */
  /*  Unknown mode                                                     */
  /* ---------------------------------------------------------------- */
  return text(`ERROR: Unknown mode '${mode}'. Valid values are 'query' and 'browse'.`);
}

function text(t: string): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: t }] };
}