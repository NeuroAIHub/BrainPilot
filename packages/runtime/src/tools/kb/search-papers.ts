/**
 * Multi-criteria paper search over the local ``source/KB_source.json``
 * library written by ``scripts/extract_meta.py``.
 *
 *   - Filters: normalized title/phrase, exact author or journal, and year.
 *   - Ranking: whole-word keyword hits in metadata, plus full text only in
 *     full-paper mode. Keyword-only queries never return zero-hit papers.
 *   - Output: a structured status envelope. Full-paper results expose content
 *     and page availability without hiding missing or unreadable artifacts.
 *
 * Internal-only fields (``mmd_path``, ``extraction_status``) are stripped
 * from every returned record so they never leak to an agent.
 */
import { readFile } from "node:fs/promises";
import { resolveKbPaths } from "./paths.js";

export type SearchMode = "meta-data" | "full-paper";
export type PaperSearchStatus =
  | "ok"
  | "no_match"
  | "not_in_corpus"
  | "invalid_query"
  | "infrastructure_error";

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

export type TitleMatch = "exact" | "phrase";
export type FullTextStatus = "available" | "missing" | "unreadable";

export type MetaResult = PaperMetadata & {
  keyword_hits: number;
  title_match?: TitleMatch;
};

export interface FullPaperResult {
  metadata: MetaResult;
  mmd_content: string;
  full_text_status: FullTextStatus;
  segment_info: {
    segment: number;
    total_segments: number;
    total_chars: number;
    available: boolean;
    has_more: boolean;
  };
}

export interface PaperSearchResponse {
  status: PaperSearchStatus;
  results: Array<MetaResult | FullPaperResult>;
  corpus_size: number;
  matched_count: number;
  message?: string;
}

const SEGMENT_CHARS = 20_000;
const MAX_TOPK = 20;
const INTERNAL_FIELDS = new Set(["mmd_path", "extraction_status"]);

function invalidQuery(message: string): PaperSearchResponse {
  return {
    status: "invalid_query",
    results: [],
    corpus_size: 0,
    matched_count: 0,
    message,
  };
}

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

/** Normalize presentation differences while preserving semantic symbols such as `+`. */
export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/\p{P}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTitlePhrase(title: string, phrase: string): boolean {
  return title === phrase
    || title.startsWith(`${phrase} `)
    || title.endsWith(` ${phrase}`)
    || title.includes(` ${phrase} `);
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

interface FullTextRead {
  content: string;
  status: FullTextStatus;
}

async function readMmd(path: string | undefined): Promise<FullTextRead> {
  if (!path) return { content: "", status: "missing" };
  try {
    return { content: await readFile(path, "utf8"), status: "available" };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return { content: "", status: code === "ENOENT" ? "missing" : "unreadable" };
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
): Promise<PaperSearchResponse> {
  const mode: SearchMode = args.mode ?? "meta-data";
  if (mode !== "meta-data" && mode !== "full-paper") {
    return invalidQuery(`mode must be 'meta-data' or 'full-paper', got '${mode}'`);
  }
  const topk = args.topk ?? 5;
  if (!Number.isInteger(topk) || topk < 1 || topk > MAX_TOPK) {
    return invalidQuery(`topk must be an integer between 1 and ${MAX_TOPK}`);
  }
  const segment = args.segment ?? 1;
  if (!Number.isInteger(segment) || segment < 1) {
    return invalidQuery("segment must be a positive integer");
  }

  const authors = normalizeStrList(args.authors);
  const keywords = normalizeStrList(args.keywords);
  const titleQuery = typeof args.title === "string" ? normalizeTitle(args.title) : null;
  const journal = typeof args.journal === "string" ? args.journal.trim() : undefined;
  const validYear = args.published_year === undefined || (
    Number.isInteger(args.published_year)
    && args.published_year >= 1000
    && args.published_year <= 9999
  );
  if (!validYear) return invalidQuery("published_year must be a four-digit integer");
  if (args.title !== undefined && !titleQuery) return invalidQuery("title must be non-empty");
  if (args.journal !== undefined && !journal) return invalidQuery("journal must be non-empty");
  if (args.authors !== undefined && !authors) return invalidQuery("authors must be non-empty");
  if (args.keywords !== undefined && !keywords) return invalidQuery("keywords must be non-empty");
  if (!titleQuery && !authors && !journal && args.published_year === undefined && !keywords) {
    return invalidQuery("provide at least one title, author, journal, year, or keyword criterion");
  }
  const hasStructuralFilter = Boolean(
    titleQuery || authors || journal || args.published_year !== undefined,
  );

  const kb = resolveKbPaths(args.kbRoot);
  const papers = await loadSource(kb.kbSourceJson);
  if (papers.length === 0) {
    return {
      status: "not_in_corpus",
      results: [],
      corpus_size: 0,
      matched_count: 0,
      message: "the local paper corpus is empty",
    };
  }

  // Filter
  const filtered: Array<{ paper: RawPaper; titleMatch?: TitleMatch }> = [];
  let titleMatchesInCorpus = 0;
  for (const paper of papers) {
    if (typeof paper !== "object" || paper === null) continue;
    let titleMatch: TitleMatch | undefined;
    if (titleQuery) {
      const candidate = normalizeTitle(typeof paper.title === "string" ? paper.title : "");
      if (candidate === titleQuery) titleMatch = "exact";
      else if (hasTitlePhrase(candidate, titleQuery)) titleMatch = "phrase";
      else continue;
      titleMatchesInCorpus++;
    }
    if (authors !== null) {
      const pa = Array.isArray(paper.authors) ? paper.authors : [];
      if (!authors.some((a) => pa.includes(a))) continue;
    }
    if (journal !== undefined && paper.journal !== journal) continue;
    if (args.published_year !== undefined) {
      const pd = typeof paper.published_date === "string" ? paper.published_date : "";
      if (!pd.startsWith(String(args.published_year))) continue;
    }
    filtered.push({ paper, ...(titleMatch ? { titleMatch } : {}) });
  }
  if (titleQuery && titleMatchesInCorpus === 0) {
    return {
      status: "not_in_corpus",
      results: [],
      corpus_size: papers.length,
      matched_count: 0,
      message: "no paper in the local corpus has the requested title or title phrase",
    };
  }

  // Rank
  let ranked: Array<{
    paper: RawPaper;
    hits: number;
    fullText?: FullTextRead;
    titleMatch?: TitleMatch;
  }> = [];
  if (keywords) {
    const patterns: RegExp[] = [];
    for (const kw of keywords) {
      try {
        patterns.push(new RegExp(`\\b${escapeRegex(kw)}\\b`, "gi"));
      } catch {
        /* skip un-compilable */
      }
    }
    for (const candidate of filtered) {
      const p = candidate.paper;
      const fullText = mode === "full-paper" ? await readMmd(p.mmd_path) : undefined;
      const blob = `${p.title ?? ""} ${p.abstract ?? ""} ${fullText?.content ?? ""}`;
      const hits = countKeywordHits(blob, patterns);
      if (hits === 0 && !hasStructuralFilter) continue;
      ranked.push({
        paper: p,
        hits,
        ...(fullText ? { fullText } : {}),
        ...(candidate.titleMatch ? { titleMatch: candidate.titleMatch } : {}),
      });
    }
  } else {
    ranked = filtered.map(({ paper, titleMatch }) => ({
      paper,
      hits: 0,
      ...(titleMatch ? { titleMatch } : {}),
    }));
  }
  ranked.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    const titleRank = (match?: TitleMatch) => match === "exact" ? 2 : match === "phrase" ? 1 : 0;
    if (titleRank(b.titleMatch) !== titleRank(a.titleMatch)) {
      return titleRank(b.titleMatch) - titleRank(a.titleMatch);
    }
    const yearA = Number((a.paper.published_date ?? "").slice(0, 4)) || 0;
    const yearB = Number((b.paper.published_date ?? "").slice(0, 4)) || 0;
    return yearB - yearA;
  });
  if (ranked.length === 0) {
    return {
      status: "no_match",
      results: [],
      corpus_size: papers.length,
      matched_count: 0,
      message: "no paper matches the requested criteria",
    };
  }
  const top = ranked.slice(0, topk);

  if (mode === "meta-data") {
    const results = top.map(({ paper, hits, titleMatch }) => ({
      ...stripInternal(paper),
      keyword_hits: hits,
      ...(titleMatch ? { title_match: titleMatch } : {}),
    })) as MetaResult[];
    return {
      status: "ok",
      results,
      corpus_size: papers.length,
      matched_count: ranked.length,
    };
  }

  // full-paper
  const out: FullPaperResult[] = [];
  for (const { paper, hits, fullText: rankedFullText, titleMatch } of top) {
    const fullText = rankedFullText ?? await readMmd(paper.mmd_path);
    const content = fullText.content;
    const totalChars = content.length;
    const totalSegments = fullText.status === "available"
      ? Math.max(1, Math.ceil(totalChars / SEGMENT_CHARS))
      : 0;
    const available = fullText.status === "available" && segment <= totalSegments;
    const start = (segment - 1) * SEGMENT_CHARS;
    const end = Math.min(start + SEGMENT_CHARS, totalChars);
    out.push({
      metadata: {
        ...stripInternal(paper),
        keyword_hits: hits,
        ...(titleMatch ? { title_match: titleMatch } : {}),
      },
      mmd_content: available ? content.slice(start, end) : "",
      full_text_status: fullText.status,
      segment_info: {
        segment,
        total_segments: totalSegments,
        total_chars: totalChars,
        available,
        has_more: available && segment < totalSegments,
      },
    });
  }
  return {
    status: "ok",
    results: out,
    corpus_size: papers.length,
    matched_count: ranked.length,
  };
}
