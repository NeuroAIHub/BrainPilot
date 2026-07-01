/**
 * Pi-native SystemTool factories for the local knowledge base:
 *
 *   get_domain_knowledge_local
 *     RAG over the local vector store (bge-m3 + bge-reranker-v2-m3).
 *     Mirrors the legacy ``tools.py:get_domain_knowledge`` we shipped on the
 *     central MCP server, but everything is computed in-process: a sidecar
 *     Python child holds the model in memory and answers HTTP requests on
 *     loopback.
 *
 *   search_papers_local
 *     Multi-criteria search over ``source/KB_source.json``. Same surface as
 *     ``tools.py:search_papers``.
 *
 * Both tools return STRINGS. Errors are returned as ``"ERROR: ..."`` strings
 * (with the tool result also marked ``isError: true`` so Pi surfaces it as
 * a failed call) — never thrown. This matches the legacy contract and lets
 * agents react to a missing KB or an unreachable sidecar by simply reading
 * the result.
 */
import type { SystemTool } from "../../types.js";
import { retrieve, type RetrievalResult } from "./retrieve.js";
import {
  searchPapers,
  type FullPaperResult,
  type MetaResult,
  type SearchMode,
} from "./search-papers.js";
import { isKbReady, resolveKbPaths } from "./paths.js";

function ok(text: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text }] };
}

function fail(text: string): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return { ...ok(`ERROR: ${text}`), isError: true as const };
}

function formatResults(results: RetrievalResult[], reloadNote?: string): string {
  const blocks: string[] = [];
  if (reloadNote) blocks.push(reloadNote);
  results.forEach((r, i) => {
    const meta = r.metadata ?? {};
    const header: string[] = [`=== Knowledge #${i + 1} ===`];
    header.push(
      `rerank_score: ${r.rerank_score.toFixed(4)}  embed_score: ${r.embed_score.toFixed(4)}`,
    );
    if (meta.title) header.push(`title: ${meta.title}`);
    if (meta.authors && meta.authors.length) {
      const head = meta.authors.slice(0, 5).join(", ");
      const more = meta.authors.length > 5 ? ", ..." : "";
      header.push(`authors: ${head}${more}`);
    }
    if (meta.journal) header.push(`journal: ${meta.journal}`);
    const pub = meta.published_date;
    if (pub) header.push(`published_date: ${pub}`);
    if (
      meta.chunk_index !== undefined &&
      meta.char_start !== undefined &&
      meta.char_end !== undefined
    ) {
      header.push(`chunk: #${meta.chunk_index} (chars ${meta.char_start}-${meta.char_end})`);
    }
    blocks.push(header.join("\n") + "\n---\n" + r.text);
  });
  return blocks.length ? blocks.join("\n\n") : "no relevant info in KB";
}

/* ---------------------- get_domain_knowledge_local ------------------- */

export function createGetDomainKnowledgeLocalTool(): SystemTool {
  return {
    name: "get_domain_knowledge_local",
    description:
      "Retrieve authoritative passages from the LOCAL knowledge base built " +
      "by the BrainPilot KnowledgeBase pipeline (bge-m3 embeddings + " +
      "bge-reranker-v2-m3 rerank). Use this for substantive, citable scientific " +
      "content the user has indexed locally. Returns a multi-block string, one " +
      "block per result. The KB covers whatever domain(s) the user populated — " +
      "the contents depend on the PDFs they fed into source/pdf/. Returns " +
      "'no relevant info in KB' when nothing matches, and 'ERROR: ...' on " +
      "infrastructure failures — never throws.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Natural-language question. Phrase as a full sentence; the bge-m3 " +
            "embedder handles paraphrase and partial overlap well.",
        },
        topk: {
          type: "integer",
          description:
            "Number of top reranked passages to return (default 5, max 50).",
        },
        min_rerank_score: {
          type: "number",
          description:
            "Drop matches below this reranker score (default 0.5). If every " +
            "candidate falls below this threshold, returns 'no relevant info in KB'.",
        },
      },
      required: ["query"],
    },
    execute: async (params: Record<string, unknown>) => {
      try {
        if (typeof params.query !== "string" || !params.query.trim()) {
          return fail("query must be a non-empty string");
        }
        const topkRaw = params.topk ?? 5;
        const topk = typeof topkRaw === "number" ? topkRaw : Number(topkRaw);
        if (!Number.isInteger(topk) || topk < 1) {
          return fail(`topk must be a positive integer, got ${String(topkRaw)}`);
        }
        if (topk > 50) {
          return fail(`topk too large (${topk}); cap is 50`);
        }
        const minScoreRaw = params.min_rerank_score ?? 0.5;
        const minScore =
          typeof minScoreRaw === "number" ? minScoreRaw : Number(minScoreRaw);
        if (!Number.isFinite(minScore)) {
          return fail(`min_rerank_score must be a number, got ${String(minScoreRaw)}`);
        }

        if (!isKbReady()) {
          const kb = resolveKbPaths();
          return fail(
            `the local knowledge base is not built yet (${kb.embeddingsNpy} is missing). ` +
              "Run KnowledgeBase/scripts/build_kb.py — or use the web UI's 'Build Knowledge Base' button — first.",
          );
        }

        let results: RetrievalResult[];
        try {
          results = await retrieve(params.query.trim(), { topk });
        } catch (err) {
          return fail(`retrieval failed: ${(err as Error).message}`);
        }
        if (!results.length) return ok("no relevant info in KB");

        const kept = results.filter((r) => r.rerank_score >= minScore);
        if (!kept.length) {
          const best = Math.max(...results.map((r) => r.rerank_score));
          return ok(
            `no relevant info in KB (best rerank_score=${best.toFixed(4)} ` +
              `< min_rerank_score=${minScore.toFixed(4)})`,
          );
        }
        return ok(formatResults(kept));
      } catch (err) {
        return fail(`unexpected failure: ${(err as Error).message}`);
      }
    },
  };
}

/* --------------------------- search_papers_local --------------------- */

export function createSearchPapersLocalTool(): SystemTool {
  return {
    name: "search_papers_local",
    description:
      "Multi-criteria search over the LOCAL paper library (source/KB_source.json " +
      "produced by KnowledgeBase/scripts/extract_meta.py). Filter by exact title, " +
      "author overlap, exact journal, or publication year; rank by keyword hit " +
      "count against title+abstract (+full mmd content in full-paper mode). " +
      "mode='meta-data' returns metadata only; mode='full-paper' returns metadata " +
      "+ a paged segment of the full text. Internal fields (mmd_path, " +
      "extraction_status) are stripped. ⚠️ All filters are EXACT-MATCH and " +
      "papers with empty year/journal/authors will silently miss the filter — " +
      "lean on keyword ranking when unsure.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Exact title to match (case-sensitive)." },
        authors: {
          oneOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
          ],
          description:
            "Author names: any-overlap exact-string match. Accepts a list " +
            "or a comma-separated string.",
        },
        journal: { type: "string", description: "Exact journal/venue name." },
        published_year: { type: "integer", description: "Four-digit year." },
        keywords: {
          oneOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
          ],
          description:
            "Whole-word keyword matching for ranking (case-insensitive). " +
            "Accepts a list or comma-separated string.",
        },
        topk: { type: "integer", description: "Max results (default 5)." },
        mode: {
          type: "string",
          enum: ["meta-data", "full-paper"],
          description:
            "'meta-data' → metadata + keyword_hits; 'full-paper' → metadata + " +
            "a segment of the full .mmd content.",
        },
        segment: {
          type: "integer",
          description:
            "(full-paper mode) 1-indexed segment number; each segment is ~20000 chars. " +
            "Check segment_info.has_more to page through.",
        },
      },
    },
    execute: async (params: Record<string, unknown>) => {
      try {
        const mode = (params.mode as SearchMode | undefined) ?? "meta-data";
        if (mode !== "meta-data" && mode !== "full-paper") {
          return fail(`mode must be 'meta-data' or 'full-paper', got '${String(mode)}'`);
        }
        const results = (await searchPapers({
          title: typeof params.title === "string" ? params.title : undefined,
          authors: params.authors as string | string[] | undefined,
          journal: typeof params.journal === "string" ? params.journal : undefined,
          published_year:
            typeof params.published_year === "number" ? params.published_year : undefined,
          keywords: params.keywords as string | string[] | undefined,
          topk: typeof params.topk === "number" ? params.topk : undefined,
          mode,
          segment: typeof params.segment === "number" ? params.segment : undefined,
        })) as MetaResult[] | FullPaperResult[];
        // The legacy Python tool returns str(list[dict]); we serialize as
        // JSON instead — it's the same shape but cleaner for the model.
        return ok(JSON.stringify(results, null, 2));
      } catch (err) {
        return fail(`search_papers_local failed: ${(err as Error).message}`);
      }
    },
  };
}
