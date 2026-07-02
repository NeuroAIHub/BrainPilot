/**
 * In-process load of the vector store written by ``scripts/vectorize.py``.
 *
 * The store is three small files:
 *   embeddings.npy  — float32 (N, 1024), L2-normalised rows
 *   chunks.jsonl    — one chunk per line, same row order as embeddings
 *   meta.json       — {count, dim, model, updated_at, normalized}
 *
 * The matrix and the chunk list are cached for the lifetime of the process
 * and reloaded transparently when ``meta.json`` reports a different count
 * (i.e. the build pipeline appended new chunks since the last query).
 *
 * NPY parsing: we only support the exact file shape ``vectorize.py`` writes
 * (float32, C-order, 2D). Anything else throws — the user re-ran some
 * other tool against the store and we'd rather fail loud than mis-cast.
 */
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolveKbPaths, type KbPaths } from "./paths.js";

export interface ChunkMetadata {
  title?: string;
  authors?: string[];
  journal?: string;
  published_date?: string;
  abstract?: string;
  pdf_url?: string;
  mmd_path?: string;
  chunk_index?: number;
  char_start?: number;
  char_end?: number;
}

export interface ChunkRecord {
  chunk_id: string;
  text: string;
  metadata: ChunkMetadata;
}

interface CacheEntry {
  embeddings: Float32Array; // flat row-major (count * dim)
  chunks: ChunkRecord[];
  count: number;
  dim: number;
  metaCount: number; // value read from meta.json — used for freshness checks
  metaUpdatedAt: string | null; // meta.json.updated_at — used for metadata-only refreshes
}

let CACHE: { paths: KbPaths; entry: CacheEntry } | null = null;

/**
 * Read meta.json to learn the on-disk row count without loading the matrix.
 * Returns null if meta.json is missing/unparseable — caller treats as cold.
 */
async function readMetaCount(kb: KbPaths): Promise<number | null> {
  try {
    const raw = await readFile(kb.metaJson, "utf8");
    const v = JSON.parse(raw)?.count;
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Read count + updated_at from meta.json in one pass. The updated_at field
 * lets us invalidate the cache after a metadata-only refresh (e.g. chunk.py
 * re-syncing chunks.jsonl with fresh titles/authors from a re-run of
 * extract_meta.py) without needing the row count to change.
 */
async function readMetaSnapshot(kb: KbPaths): Promise<{
  count: number | null;
  updatedAt: string | null;
}> {
  try {
    const raw = await readFile(kb.metaJson, "utf8");
    const j = JSON.parse(raw);
    return {
      count: typeof j?.count === "number" ? j.count : null,
      updatedAt: typeof j?.updated_at === "string" ? j.updated_at : null,
    };
  } catch {
    return { count: null, updatedAt: null };
  }
}

/**
 * Minimal numpy .npy v1.0/v2.0 reader for the exact shape vectorize.py writes.
 * Format: '\x93NUMPY' magic, 1-byte major, 1-byte minor, header-length
 * (uint16 in v1, uint32 in v2), header dict text, then row-major data.
 */
function parseNpyFloat32(buf: Buffer): { data: Float32Array; rows: number; cols: number } {
  if (buf.length < 10) throw new Error(".npy: file too small");
  if (buf[0] !== 0x93 ||
      buf.slice(1, 6).toString("ascii") !== "NUMPY") {
    throw new Error(".npy: bad magic");
  }
  const major = buf[1 + 5] ?? 0;
  let headerLen: number;
  let headerStart: number;
  if (major === 1) {
    headerLen = buf.readUInt16LE(8);
    headerStart = 10;
  } else if (major === 2 || major === 3) {
    headerLen = buf.readUInt32LE(8);
    headerStart = 12;
  } else {
    throw new Error(`.npy: unsupported major version ${major}`);
  }
  const header = buf.slice(headerStart, headerStart + headerLen).toString("ascii");
  // Header is a Python dict literal. Pull just the bits we need with regex —
  // bringing in a Python literal parser for this would be overkill.
  const descrMatch = header.match(/'descr':\s*'([^']+)'/);
  const fortranMatch = header.match(/'fortran_order':\s*(True|False)/);
  const shapeMatch = header.match(/'shape':\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/);
  if (!descrMatch || !fortranMatch || !shapeMatch) {
    throw new Error(`.npy: cannot parse header: ${header}`);
  }
  const descr = descrMatch[1]!;
  if (descr !== "<f4" && descr !== "|f4" && descr !== "=f4") {
    throw new Error(`.npy: only float32 (<f4) supported, got ${descr}`);
  }
  if (fortranMatch[1] === "True") {
    throw new Error(".npy: fortran-order not supported");
  }
  const rows = Number(shapeMatch[1]);
  const cols = Number(shapeMatch[2]);
  const dataStart = headerStart + headerLen;
  const expectedBytes = rows * cols * 4;
  if (buf.length - dataStart < expectedBytes) {
    throw new Error(`.npy: short data (need ${expectedBytes} bytes, have ${buf.length - dataStart})`);
  }
  // Float32Array view on the underlying ArrayBuffer (no copy).
  const data = new Float32Array(
    buf.buffer,
    buf.byteOffset + dataStart,
    rows * cols,
  );
  return { data, rows, cols };
}

async function readChunksJsonl(path: string, expected: number): Promise<ChunkRecord[]> {
  const raw = await readFile(path, "utf8");
  const records: ChunkRecord[] = [];
  // Split on \n, drop trailing empty line. Each line is one chunk.
  for (const line of raw.split("\n")) {
    if (!line) continue;
    records.push(JSON.parse(line) as ChunkRecord);
  }
  if (records.length !== expected) {
    throw new Error(
      `vector store mismatch: embeddings=${expected} chunks.jsonl=${records.length}`,
    );
  }
  return records;
}

async function loadFresh(kb: KbPaths): Promise<CacheEntry> {
  if (!existsSync(kb.embeddingsNpy) || !existsSync(kb.chunksJsonl)) {
    throw new Error(
      `vector store not found in ${kb.vectorstoreDir} — ` +
        `run the build pipeline (scripts/build_kb.py) first.`,
    );
  }
  const buf = await readFile(kb.embeddingsNpy);
  const { data, rows, cols } = parseNpyFloat32(buf);
  const chunks = await readChunksJsonl(kb.chunksJsonl, rows);
  const { count, updatedAt } = await readMetaSnapshot(kb);
  return {
    embeddings: data,
    chunks,
    count: rows,
    dim: cols,
    metaCount: count ?? rows,
    metaUpdatedAt: updatedAt,
  };
}

/**
 * Load (or return the cached) vector store. If meta.json on disk reports a
 * different row count than the cached entry, transparently reload — that's
 * how a freshly-vectorized batch becomes visible to a running runtime
 * without restart.
 */
export async function getStore(rootOverride?: string): Promise<CacheEntry & { paths: KbPaths }> {
  const kb = resolveKbPaths(rootOverride);
  if (CACHE && CACHE.paths.root === kb.root) {
    // Cache freshness: both row count AND updated_at must match. The
    // updated_at check catches metadata-only rewrites (chunk.py re-syncing
    // chunks.jsonl after extract_meta fixed fallback rows) where count
    // stays constant but chunk metadata changed. A missing field on disk
    // (null) is treated as "no signal" — we fall back to the other check
    // rather than always invalidating.
    const { count: diskCount, updatedAt: diskUpdatedAt } = await readMetaSnapshot(kb);
    const staleCount = diskCount !== null && diskCount !== CACHE.entry.metaCount;
    const staleUpdatedAt =
      diskUpdatedAt !== null && diskUpdatedAt !== CACHE.entry.metaUpdatedAt;
    if (!staleCount && !staleUpdatedAt) {
      return { ...CACHE.entry, paths: kb };
    }
    // stale — fall through to a fresh load
  }
  const entry = await loadFresh(kb);
  CACHE = { paths: kb, entry };
  return { ...entry, paths: kb };
}

/** Best-effort sanity probe used by health endpoints / UI. */
export async function storeHealth(rootOverride?: string): Promise<{
  ready: boolean;
  count: number;
  reason?: string;
  updatedAt?: string;
}> {
  const kb = resolveKbPaths(rootOverride);
  if (!existsSync(kb.embeddingsNpy) || !existsSync(kb.chunksJsonl)) {
    return { ready: false, count: 0, reason: "vector store not built yet" };
  }
  try {
    const meta = JSON.parse(await readFile(kb.metaJson, "utf8"));
    return {
      ready: typeof meta.count === "number" && meta.count > 0,
      count: meta.count ?? 0,
      updatedAt: meta.updated_at,
    };
  } catch {
    // meta.json missing but embeddings/chunks exist — still considered ready,
    // just without the freshness metadata.
    const st = await stat(kb.embeddingsNpy);
    return { ready: true, count: 0, updatedAt: st.mtime.toISOString() };
  }
}

/** Drop the in-process cache (mainly for tests). */
export function clearStoreCache(): void {
  CACHE = null;
}
