/**
 * skill_search — Pi-native custom tool for the second skill-loading path.
 *
 * BrainPilot loads skills via TWO physically separate, identically-formatted
 * directories:
 *
 *   <dataRoot>/bp_template/skills/         (always-on)
 *     Loaded by Pi's native skill pipeline through `additionalSkillPaths`. Each
 *     SKILL.md's name + description appears unconditionally in the agent's
 *     `<available_skills>` system block; bodies are read on demand via the
 *     built-in `read` tool or `/skill:<name>`. Cheap, but every entry costs
 *     prompt tokens, so it is reserved for high-frequency Meta-Skills.
 *
 *   <dataRoot>/bp_template/skills-router/  (router-only)
 *     Pi never sees this directory. Agents discover its contents only by
 *     calling THIS tool, which lazily scans, ranks, and returns matching
 *     skills. The router holds the long tail of domain skills without bloating
 *     every prompt.
 *
 * Both directories accept user-added skills with the same on-disk format
 * (`<category>/<skill_name>/SKILL.md` + optional `references/` / `scripts/`).
 *
 * Modes (preserved verbatim from the legacy `skills_tool_local` MCP server):
 *   - mode="query" + keywords      → top-K ranked metadata with match reasons
 *     `keywords` is a SINGLE comma-separated string, e.g. `"eeg, fmri,
 *     signal preprocessing"`. The single-string shape is enforced by the JSON
 *     schema; older array-shaped inputs are still tolerated at runtime by
 *     `normalizeKeywords` (via `String(array)` which serialises as `"a,b,c"`)
 *     so a schema-non-compliant model call degrades to correct behaviour
 *     instead of returning `total_matched: 0`.
 *   - mode="query" + skill_name    → full SKILL.md body
 *   - mode="browse" + relative_path → list a directory or read a file
 *
 * Errors are signalled by THROWING (Pi's `AgentToolResult` carries no isError;
 * see CLAUDE.md). The wrapping factory turns thrown errors into a tool-call
 * failure the model can react to.
 */
import { readFile, readdir, stat, access } from "node:fs/promises";
import { constants as FS } from "node:fs";
import { isAbsolute, join, resolve, sep, posix } from "node:path";
import { parse as parseYaml } from "yaml";
import type { SystemTool } from "../types.js";
import type { ToolDeps } from "./system-tools.js";

/* ------------------------------ types ----------------------------- */

export interface SkillRecord {
  name: string;
  description: string;
  domain?: string;
  aliases: string[];
  categories: string[];
  /** Category-relative paths where this skill name appears (multi-category dedupe). */
  relative_paths: string[];
}

export interface QueryResultEntry {
  name: string;
  description: string;
  relative_paths: string[];
  /** Legacy case-insensitive occurrence count within the description. */
  keyword_hits: number;
  /** Field-weighted relevance score used for ranking. */
  score: number;
  matched_fields: string[];
  matched_terms: string[];
}

export interface QueryResult {
  keywords: string[];
  total_matched: number;
  returned: number;
  results: QueryResultEntry[];
}

/* --------------------------- frontmatter -------------------------- */

interface SkillFrontmatter {
  description: string;
  domain?: string;
  aliases: string[];
}

/** Parse complete YAML frontmatter, including folded description scalars. */
function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)/);
  if (!match?.[1]) return { description: "", aliases: [] };
  try {
    const parsed = parseYaml(match[1]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { description: "", aliases: [] };
    }
    const fields = parsed as Record<string, unknown>;
    const description = typeof fields.description === "string" ? fields.description.trim() : "";
    const domain = typeof fields.domain === "string" && fields.domain.trim() ? fields.domain.trim() : undefined;
    const aliases = Array.isArray(fields.aliases)
      ? fields.aliases
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
      : [];
    return { description, ...(domain ? { domain } : {}), aliases };
  } catch {
    return { description: "", aliases: [] };
  }
}

/** Backward-compatible helper retained for downstream callers. */
export function parseFrontmatterDescription(content: string): string {
  return parseSkillFrontmatter(content).description;
}

/* --------------------------- fs helpers --------------------------- */

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, FS.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

/* --------------------------- collection --------------------------- */

/**
 * Scan a router base directory for all skills. Mirrors the legacy collector:
 * `<base>/<category>/<skill_name>/SKILL.md`. When the same skill_name appears
 * in multiple categories, descriptions are taken from the first occurrence and
 * subsequent paths are appended to `relative_paths`.
 */
export async function collectAllSkills(base: string): Promise<SkillRecord[]> {
  const byName = new Map<string, SkillRecord>();
  const categories = await listDirs(base);
  for (const category of categories) {
    const catPath = join(base, category);
    const skills = await listDirs(catPath);
    for (const skillName of skills) {
      const skillMd = join(catPath, skillName, "SKILL.md");
      if (!(await exists(skillMd))) continue;
      // Cross-platform (#5): the relative path leaves the runtime and is
      // shown both to the model (in `relative_paths`) and round-tripped back
      // through the `browse` mode. Standardize on POSIX `/` so the API
      // surface is identical on Windows and POSIX, the model never sees a
      // backslash it has to JSON-escape, and URL/query forms stay valid.
      const relPath = posix.join(category, skillName);
      const existing = byName.get(skillName);
      if (existing) {
        existing.relative_paths.push(relPath);
        if (!existing.categories.includes(category)) existing.categories.push(category);
        try {
          const metadata = parseSkillFrontmatter(await readFile(skillMd, "utf8"));
          existing.aliases = [...new Set([...existing.aliases, ...metadata.aliases])];
          if (!existing.domain && metadata.domain) existing.domain = metadata.domain;
        } catch {
          /* unreadable duplicate → retain the first occurrence metadata */
        }
        continue;
      }
      let metadata: SkillFrontmatter = { description: "", aliases: [] };
      try {
        metadata = parseSkillFrontmatter(await readFile(skillMd, "utf8"));
      } catch {
        /* unreadable SKILL.md → empty metadata */
      }
      byName.set(skillName, {
        name: skillName,
        description: metadata.description,
        ...(metadata.domain ? { domain: metadata.domain } : {}),
        aliases: metadata.aliases,
        categories: [category],
        relative_paths: [relPath],
      });
    }
  }
  return [...byName.values()];
}

/* --------------------------- ranking ------------------------------ */

export function countKeywordHits(text: string, keywords: string[]): number {
  const normalized = normalizeSearchText(text);
  let hits = 0;
  for (const kw of keywords) {
    const kl = normalizeSearchText(kw);
    if (!kl) continue;
    let pos = 0;
    while ((pos = normalized.indexOf(kl, pos)) !== -1) {
      hits++;
      pos += kl.length;
    }
  }
  return hits;
}

/** Normalize separators and Unicode variants while preserving domain syntax. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[-_/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface SkillScore {
  score: number;
  matchedFields: string[];
  matchedTerms: string[];
}

const FIELD_WEIGHTS = { name: 6, aliases: 5, domain: 3, categories: 3, description: 1 } as const;

/** Deterministic field-weighted ranking; each term scores once per field. */
export function scoreSkill(skill: SkillRecord, keywords: string[]): SkillScore {
  const fields: Array<[keyof typeof FIELD_WEIGHTS, string[]]> = [
    ["name", [skill.name]],
    ["aliases", skill.aliases],
    ["domain", skill.domain ? [skill.domain] : []],
    ["categories", skill.categories],
    ["description", [skill.description]],
  ];
  const matchedFields = new Set<string>();
  const matchedTerms = new Set<string>();
  let score = 0;
  for (const rawKeyword of keywords) {
    const keyword = normalizeSearchText(rawKeyword);
    if (!keyword) continue;
    for (const [field, values] of fields) {
      if (values.some((value) => normalizeSearchText(value).includes(keyword))) {
        score += FIELD_WEIGHTS[field];
        matchedFields.add(field);
        matchedTerms.add(rawKeyword);
      }
    }
  }
  if (keywords.length > 0 && matchedTerms.size === keywords.length) score += 3;
  return { score, matchedFields: [...matchedFields], matchedTerms: [...matchedTerms] };
}

/* --------------------------- search ------------------------------- */

export interface SkillSearchArgs {
  mode: "query" | "browse";
  /**
   * Comma-separated keyword string, e.g. `"eeg, fmri, signal preprocessing"`.
   * The JSON schema advertises this as a plain string; the runtime tolerates
   * an incoming `string[]` (which some models emit despite the schema) by
   * flattening it to `"a,b,c"` via `String(array)` before splitting, so the
   * search never silently returns zero matches.
   */
  keywords?: string | string[];
  topk?: number;
  skill_name?: string;
  relative_path?: string;
}

/**
 * Normalise the `keywords` parameter to `string[]`.
 *
 * Contract with the model is a SINGLE comma-separated string (e.g.
 * `"EEG, preprocessing, ICA"`). We split on `,`, trim each entry, drop empties.
 *
 * Defensive fallback: if a model ignores the schema and passes an array
 * (`["EEG", "ICA"]` or worse `["EEG, ICA"]`), we don't want the previous
 * silent-zero-match failure mode. We route arrays through `String(arr)` —
 * `Array.prototype.toString` joins with commas — so every historical calling
 * convention lands in the same comma-split path. Result: identical to the
 * user typing the same tokens as a string, regardless of whether the model
 * shipped a string or an array.
 */
export function normalizeKeywords(raw: string | string[] | undefined): string[] {
  if (raw === undefined || raw === null) return [];
  const asString = typeof raw === "string" ? raw : String(raw);
  const seen = new Set<string>();
  return asString.split(",").map((s) => s.trim()).filter((value) => {
    const key = normalizeSearchText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** JSON-stringify with 2-space indent; the model parses these as text. */
function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/**
 * Pure search/browse implementation. Throws on any error path so the wrapping
 * Pi tool surfaces a real failure (matching the runtime's tool-error contract).
 */
export async function searchSkills(base: string, args: SkillSearchArgs): Promise<string> {
  if (!(await exists(base))) {
    throw new Error(`skills router base does not exist: ${base}`);
  }
  const baseAbs = resolve(base);
  const mode = args.mode;
  if (mode !== "query" && mode !== "browse") {
    throw new Error(`unknown mode '${mode}' (expected 'query' or 'browse')`);
  }

  /* ----------------------------- QUERY ----------------------------- */
  if (mode === "query") {
    // Sub-mode B: direct skill lookup by name (returns full SKILL.md).
    const name =
      typeof args.skill_name === "string" ? args.skill_name.trim() : "";
    if (name !== "") {
      // Claude/Codex/Pi plugins commonly refer to a skill as
      // `plugin-name:skill-name`, while Agent Skills themselves expose the
      // portable `name` from SKILL.md. Try the exact safe name first, then the
      // namespace-free suffix used by BrainPilot's marketplace projection.
      const names = [...new Set([name, name.split(":").at(-1) ?? ""])]
        .filter((candidate) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(candidate));
      if (names.length === 0) throw new Error(`invalid skill name '${name}'`);
      const cats = await listDirs(baseAbs);
      for (const skillName of names) {
        for (const cat of cats) {
          const candidate = join(baseAbs, cat, skillName, "SKILL.md");
          if (await exists(candidate)) {
            return await readFile(candidate, "utf8");
          }
        }
      }
      throw new Error(
        `skill '${name}' not found in router; use mode='query' with keywords=[...] to discover available skills`,
      );
    }

    // Sub-mode A: keyword search.
    const kws = normalizeKeywords(args.keywords);
    if (kws.length === 0) {
      throw new Error(
        "in query mode you must pass either 'keywords' (comma-separated string, e.g. \"eeg, fmri, signal preprocessing\") or 'skill_name' (exact name)",
      );
    }
    const skills = await collectAllSkills(baseAbs);
    const topk = typeof args.topk === "number" && args.topk > 0 ? Math.floor(args.topk) : 5;
    const scored = skills
      .map((skill) => ({ skill, ...scoreSkill(skill, kws) }))
      .filter(({ score }) => score > 0);
    scored.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
    const top = scored.slice(0, topk);
    const result: QueryResult = {
      keywords: kws,
      total_matched: scored.length,
      returned: top.length,
      results: top.map(({ skill, score, matchedFields, matchedTerms }) => ({
        name: skill.name,
        description: skill.description,
        relative_paths: skill.relative_paths,
        keyword_hits: countKeywordHits(skill.description, kws),
        score,
        matched_fields: matchedFields,
        matched_terms: matchedTerms,
      })),
    };
    return jsonText(result);
  }

  /* ----------------------------- BROWSE ---------------------------- */
  if (args.relative_path === undefined || args.relative_path === null) {
    throw new Error(
      "browse mode requires 'relative_path' — pass '' or '.' to list top-level categories",
    );
  }
  const rel = String(args.relative_path).trim();
  let target: string;
  if (rel === "" || rel === ".") {
    target = baseAbs;
  } else {
    // Reject any absolute path or one containing a `..` segment before resolve.
    // Cross-platform (#2): the previous guard hardcoded POSIX `/`, so a
    // Windows absolute path slipped past to the second-line containment
    // guard with a less specific error. The check below recognizes:
    //   - POSIX absolute paths (`/foo`)             — `isAbsolute` + `startsWith("/")`
    //   - Windows absolute paths native to the host — `isAbsolute` (only true on Win)
    //   - Windows-shaped paths inspected on POSIX   — `^[A-Za-z]:[\\/]` regex
    //     (POSIX `isAbsolute("C:\\foo")` is false, so we have to match the
    //     drive prefix explicitly to keep the guard host-platform-agnostic)
    //   - Leading-backslash form                    — `startsWith("\\")`
    // and the `..`-segment check the comment already promised but the code
    // never actually did (across both separators).
    if (
      isAbsolute(rel) ||
      rel.startsWith("/") ||
      rel.startsWith("\\") ||
      /^[A-Za-z]:[\\/]/.test(rel) ||
      rel.split(/[\\/]/).some((seg) => seg === "..")
    ) {
      throw new Error("path traversal outside skills directory is not allowed");
    }
    target = resolve(join(baseAbs, rel));
  }
  if (target !== baseAbs && !target.startsWith(baseAbs + sep)) {
    throw new Error("path traversal outside skills directory is not allowed");
  }
  if (!(await exists(target))) {
    throw new Error(`path does not exist: '${args.relative_path}'`);
  }
  const st = await stat(target);
  if (st.isDirectory()) {
    const dirents = await readdir(target, { withFileTypes: true });
    const children = dirents
      .map((d) => ({
        name: d.name,
        type: d.isDirectory() ? "directory" : "file",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // Cross-platform (#5): emit POSIX-style separators in the response so
    // the model and frontend never see OS-native backslashes.
    const displayPath =
      target === baseAbs
        ? "."
        : target.slice(baseAbs.length + 1).split(sep).join("/");
    return jsonText({ path: displayPath, type: "directory", children });
  }
  if (st.isFile()) {
    return await readFile(target, "utf8");
  }
  throw new Error(`path is neither a file nor a directory: '${args.relative_path}'`);
}

/* --------------------------- tool factory ------------------------- */

/**
 * Build the Pi-native `skill_search` SystemTool bound to the router base dir.
 * Per CLAUDE.md, errors are signalled by throwing — the wrapping factory turns
 * a thrown error into a Pi tool failure the model can react to.
 */
export function createSkillSearchTool(deps: ToolDeps): SystemTool {
  return {
    name: "skill_search",
    description:
      "Search and load skills from the router skill library — a domain-specific " +
      "catalog NOT included in <available_skills>. Use this whenever the skill " +
      "you need is not visible in <available_skills>. Modes: 'query' with " +
      "keywords (top-K ranked metadata), 'query' with skill_name (full SKILL.md), " +
      "or 'browse' with relative_path (list directory or read a file). For " +
      "non-English tasks, query with concise English technical terms and standard abbreviations.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["query", "browse"],
          description: "'query' to search/load skills; 'browse' to list/read paths",
        },
        keywords: {
          type: "string",
          description:
            "(query mode) comma-separated technical terms matched against skill " +
            "names, aliases, domains, categories, and descriptions — e.g. " +
            "\"eeg, fmri, signal preprocessing\". For non-English tasks, use " +
            "concise English terms and standard abbreviations. Do NOT wrap in " +
            "an array or JSON-encode it; splitting on ',' happens server-side.",
        },
        topk: {
          type: "integer",
          description: "(query mode, keywords) max results to return; default 5",
        },
        skill_name: {
          type: "string",
          description:
            "(query mode) exact skill name; returns the full SKILL.md body when set",
        },
        relative_path: {
          type: "string",
          description:
            "(browse mode) router-relative path; '' or '.' lists top-level categories",
        },
      },
      required: ["mode"],
    },
    execute: async (params: Record<string, unknown>) => {
      const text = await searchSkills(
        deps.routerSkillsDir,
        params as unknown as SkillSearchArgs,
      );
      return { content: [{ type: "text", text }] };
    },
  };
}
