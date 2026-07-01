/**
 * Multi-criteria paper search over the local ``source/KB_source.json``
 * library written by ``scripts/extract_meta.py``.
 *
 * Mirrors `tools.py:search_papers` (the function that powers the v3 KB on
 * the legacy MCP server):
 *
 *   - Filters: title (exact), authors (any-overlap exact), journal (exact),
 *     published_year (year prefix). Each filter is OPTIONAL.
 *   - Ranking: count whole-word keyword matches against title + abstract,
 *     and optionally the full .mmd body in full-paper mode. Ties break by
 *     publication date desc.
 *   - Output: "meta-data" returns metadata + keyword_hits. "full-paper"
 *     additionally returns a `mmd_content` segment + `segment_info` so
 *     long papers can be paged through.
 *
 * Internal-only fields (``mmd_path``, ``extraction_status``) are stripped
 * from every returned record so they never leak to an agent.
 */
import { readFile } from "node:fs/promises";
import { resolveKbPaths } from "./paths.js";

export type SearchMode = "meta-data" | "full-paper";

export interface SearchArgs {
  title?: string;
  authors?: string[] | string;
  journal?: string;
  published_year?: number;
  keywords?: string[] | string;
  topk?: number;
  mode?: SearchMode;
  segment?: number;
  /** Override KB root (otherwise via env / default). */
  kbRoot?: string;
}

export interface PaperMetadata {
  title?: string;
  authors?: string[];
  journal?: string;
  published_date?: string;
  abstract?: string;
  pdf_url?: string;
  /** Server-internal path; stripped from every returned record. */
  mmd_path?: string;
  extraction_status?: string;
}

interface RawPaper extends PaperMetadata {
  [key: string]: unknown;
}

export type MetaResult = PaperMetadata & { keyword_hits: number };

export interface FullPaperResult {
  metadata: MetaResult;
  mmd_content: string;
  segment_info: {
    segment: number;
    total_segments: number;
    total_chars: number;
    has_more: boolean;
  };
}

const SEGMENT_CHARS = 20_000;
const INTERNAL_FIELDS = new Set(["mmd_path", "extraction_status"]);

function stripInternal<T extends Record<string, unknown>>(d: T): Omit<T, "mmd_path" | "extraction_status"> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!INTERNAL_FIELDS.has(k)) out[k] = v;
  }
  return out as Omit<T, "mmd_path" | "extraction_status">;
}

function normalizeStrList(value: string[] | string | undefined): string[] | null {
  if (value === undefined || value === null) return null;
  let items: string[];
  if (typeof value === "string") {
    items = value.split(",").map((s) => s.trim());
  } else {
    items = value.map((s) => String(s).trim());
  }
  items = items.filter(Boolean);
  return items.length ? items : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countKeywordHits(text: string, patterns: RegExp[]): number {
  if (!text) return 0;
  let n = 0;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) n += m.length;
  }
  return n;
}

async function readMmd(path: string | undefined): Promise<string> {
  if (!path) return "";
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

let SOURCE_CACHE: { path: string; mtimeMs: number; papers: RawPaper[] } | null = null;

async function loadSource(kbSourceJson: string): Promise<RawPaper[]> {
  // Cheap freshness check via mtime — extract_meta.py writes atomically, so
  // a changed mtime always reflects a new generation we should pick up.
  const { stat } = await import("node:fs/promises");
  let mtimeMs = 0;
  try {
    mtimeMs = (await stat(kbSourceJson)).mtimeMs;
  } catch {
    /* file may not exist yet — surface a clean error below */
  }
  if (SOURCE_CACHE && SOURCE_CACHE.path === kbSourceJson && SOURCE_CACHE.mtimeMs === mtimeMs) {
    return SOURCE_CACHE.papers;
  }
  let raw: string;
  try {
    raw = await readFile(kbSourceJson, "utf8");
  } catch (err) {
    throw new Error(`KB_source.json not found at ${kbSourceJson}: ${(err as Error).message}`);
  }
  const data = JSON.parse(raw) as { papers?: RawPaper[] };
  const papers = Array.isArray(data.papers) ? data.papers : [];
  SOURCE_CACHE = { path: kbSourceJson, mtimeMs, papers };
  return papers;
}

export async function searchPapers(
  args: SearchArgs,
): Promise<MetaResult[] | FullPaperResult[]> {
  const mode: SearchMode = args.mode ?? "meta-data";
  if (mode !== "meta-data" && mode !== "full-paper") {
    throw new Error(`mode must be 'meta-data' or 'full-paper', got '${mode}'`);
  }
  const topk = Math.max(1, Math.floor(args.topk ?? 5));
  const segment = Math.max(1, Math.floor(args.segment ?? 1));

  const authors = normalizeStrList(args.authors);
  const keywords = normalizeStrList(args.keywords);

  const kb = resolveKbPaths(args.kbRoot);
  const papers = await loadSource(kb.kbSourceJson);

  // Filter
  const filtered: RawPaper[] = [];
  for (const paper of papers) {
    if (typeof paper !== "object" || paper === null) continue;
    if (args.title !== undefined && paper.title !== args.title) continue;
    if (authors !== null) {
      const pa = Array.isArray(paper.authors) ? paper.authors : [];
      if (!authors.some((a) => pa.includes(a))) continue;
    }
    if (args.journal !== undefined && paper.journal !== args.journal) continue;
    if (args.published_year !== undefined) {
      const pd = typeof paper.published_date === "string" ? paper.published_date : "";
      if (!pd.startsWith(String(args.published_year))) continue;
    }
    filtered.push(paper);
  }

  // Rank
  let ranked: Array<{ paper: RawPaper; hits: number; mmd: string }> = [];
  if (keywords) {
    const patterns: RegExp[] = [];
    for (const kw of keywords) {
      try {
        patterns.push(new RegExp(`\\b${escapeRegex(kw)}\\b`, "gi"));
      } catch {
        /* skip un-compilable */
      }
    }
    for (const p of filtered) {
      const mmd = await readMmd(p.mmd_path);
      const blob = `${p.title ?? ""} ${p.abstract ?? ""} ${mmd}`;
      const hits = countKeywordHits(blob, patterns);
      ranked.push({ paper: p, hits, mmd });
    }
    ranked.sort((a, b) => {
      if (b.hits !== a.hits) return b.hits - a.hits;
      const yearA = Number((a.paper.published_date ?? "").slice(0, 4)) || 0;
      const yearB = Number((b.paper.published_date ?? "").slice(0, 4)) || 0;
      return yearB - yearA;
    });
  } else {
    ranked = filtered.map((p) => ({ paper: p, hits: 0, mmd: "" }));
  }
  const top = ranked.slice(0, topk);

  if (mode === "meta-data") {
    return top.map(({ paper, hits }) => ({
      ...stripInternal(paper),
      keyword_hits: hits,
    })) as MetaResult[];
  }

  // full-paper
  const out: FullPaperResult[] = [];
  for (const { paper, hits, mmd } of top) {
    const content = mmd || (await readMmd(paper.mmd_path));
    const totalChars = content.length;
    const totalSegments = totalChars > 0
      ? Math.ceil(totalChars / SEGMENT_CHARS)
      : 1;
    const seg = Math.max(1, Math.min(segment, totalSegments));
    const start = (seg - 1) * SEGMENT_CHARS;
    const end = Math.min(start + SEGMENT_CHARS, totalChars);
    out.push({
      metadata: { ...stripInternal(paper), keyword_hits: hits },
      mmd_content: content.slice(start, end),
      segment_info: {
        segment: seg,
        total_segments: totalSegments,
        total_chars: totalChars,
        has_more: seg < totalSegments,
      },
    });
  }
  return out;
}
