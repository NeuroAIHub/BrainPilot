/**
 * Two-stage retrieval against the local vector store:
 *   1. Embed the query (bge-m3 via the sidecar).
 *   2. Cosine-similarity top-(topk * candidate_multiplier) against the matrix.
 *   3. Rerank candidates with bge-reranker-v2-m3 (sidecar).
 *   4. Return the topk best with text + metadata.
 *
 * The math is straightforward — rows of the matrix are already L2-normalised
 * by vectorize.py, so cosine collapses to a dot product. We do an exact
 * top-K via partial selection so the whole thing stays simple.
 */
import { ensureSidecar } from "./sidecar.js";
import { getStore, type ChunkMetadata } from "./store.js";

export interface RetrievalResult {
  chunk_id: string;
  text: string;
  metadata: ChunkMetadata;
  embed_score: number;
  embed_rank: number;
  rerank_score: number;
  rerank_rank: number;
}

const EMB_MAX_LENGTH = 512;
const RERANK_MAX_LENGTH = 1024;
const HTTP_TIMEOUT_MS = 60_000;

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!r.ok) {
      throw new Error(`HTTP ${r.status} ${r.statusText} from ${url}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function embedQuery(url: string, query: string): Promise<Float32Array> {
  const resp = await postJson<{ embeddings: number[][] }>(`${url}/embed`, {
    texts: [query],
    max_length: EMB_MAX_LENGTH,
  });
  const v = resp.embeddings[0];
  if (!v || v.length === 0) throw new Error("embed: empty response");
  // Defensive renormalisation — bge-m3 ships normalised, but the network hop
  // and float casts can wobble a touch.
  const arr = new Float32Array(v.length);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    arr[i] = v[i]!;
    s += v[i]! * v[i]!;
  }
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < arr.length; i++) arr[i] = (arr[i] ?? 0) / n;
  return arr;
}

async function rerank(
  url: string,
  query: string,
  documents: string[],
): Promise<Array<{ index: number; score: number }>> {
  const resp = await postJson<{ results: Array<{ index: number; score: number }> }>(
    `${url}/rerank`,
    { query, documents, max_length: RERANK_MAX_LENGTH },
  );
  return resp.results;
}

/**
 * Exact top-K rows of the embeddings matrix by inner product against q.
 * The matrix is laid out row-major as a flat Float32Array of length count*dim.
 */
function topKRows(
  embeddings: Float32Array,
  count: number,
  dim: number,
  q: Float32Array,
  k: number,
): Array<{ index: number; score: number }> {
  if (q.length !== dim) throw new Error(`dim mismatch: q=${q.length} store=${dim}`);
  const target = Math.min(k, count);
  // Maintain a heap of size `target` keyed by score. For N up to ~200k this
  // is fast enough to skip a real heap library — sort once at the end.
  const scores = new Float32Array(count);
  for (let r = 0; r < count; r++) {
    const off = r * dim;
    let s = 0;
    for (let d = 0; d < dim; d++) s += embeddings[off + d]! * q[d]!;
    scores[r] = s;
  }
  // Argpartial sort: find the K highest scores. For typical N≈200k, dim≈1024
  // the dot products dominate (~200M flops) and the sort is a rounding error.
  const idx = new Array<number>(count);
  for (let i = 0; i < count; i++) idx[i] = i;
  idx.sort((a, b) => scores[b]! - scores[a]!);
  return idx.slice(0, target).map((i) => ({ index: i, score: scores[i]! }));
}

export interface RetrieveOptions {
  topk?: number;
  candidateMultiplier?: number;
  /** Skip the reranker (faster, lower-quality fallback). */
  skipRerank?: boolean;
  /** Override KB root (otherwise resolved via env / default). */
  kbRoot?: string;
}

export async function retrieve(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievalResult[]> {
  const topk = Math.max(1, Math.floor(opts.topk ?? 5));
  const multiplier = Math.max(1, Math.floor(opts.candidateMultiplier ?? 10));

  const store = await getStore(opts.kbRoot);
  const url = await ensureSidecar(opts.kbRoot);

  // Stage 1: embedding pass over the full matrix.
  const qvec = await embedQuery(url, query);
  const nCandidates = Math.min(Math.max(topk, topk * multiplier), store.count);
  const candIdx = topKRows(store.embeddings, store.count, store.dim, qvec, nCandidates);

  const candidates: RetrievalResult[] = candIdx.map((r, i) => {
    const c = store.chunks[r.index]!;
    return {
      chunk_id: c.chunk_id,
      text: c.text,
      metadata: c.metadata,
      embed_score: r.score,
      embed_rank: i + 1,
      rerank_score: r.score,   // overwritten below
      rerank_rank: i + 1,      // overwritten below
    };
  });

  if (opts.skipRerank || candidates.length <= topk) {
    return candidates.slice(0, topk);
  }

  // Stage 2: rerank.
  const reranked = await rerank(url, query, candidates.map((c) => c.text));
  const out: RetrievalResult[] = [];
  reranked.slice(0, topk).forEach((r, i) => {
    const base = candidates[r.index];
    if (!base) return;
    out.push({ ...base, rerank_score: r.score, rerank_rank: i + 1 });
  });
  return out;
}
