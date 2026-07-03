/**
 * On-disk inventory of the KB pipeline's four stages.
 *
 * Reads the four ledger files and returns aggregate counts + a consistency
 * check that spots common "half-done" states — new PDFs waiting for OCR,
 * metadata rows still in fallback, chunked papers not yet vectorised, etc.
 *
 * This is intentionally READ-ONLY and cheap: called from the UI as a
 * status panel, potentially every time the KB tab is opened. All heavy
 * files are handled by size (small → JSON.parse; large chunks.json → tail
 * regex so we get the total count without loading 1.5 GB into memory).
 */
import { existsSync, promises as fsp, readdirSync, statSync, createReadStream } from "node:fs";
import { join } from "node:path";
import { findKbRoot } from "./kb-builder.js";

/** Per-ledger snapshot of a build stage. `null` values distinguish "file
 *  absent (stage never ran)" from "0 (stage ran and produced nothing)". */
export interface KbInventory {
  kbRoot: string;
  /** Fresh PDFs discovered under source/pdf/. */
  pdfsOnDisk: number;
  /** Papers listed in source/OCRed_pdf.json. Never > pdfsOnDisk in a
   *  healthy run — but the pdf list can shrink (user deleted files) so
   *  the ledger can be higher in a stale KB. Warning shown for that too. */
  ocred: number | null;
  /** source/KB_source.json breakdown. `total` is the record count;
   *  ok/fallback/empty come from each record's extraction_status. */
  extracted: {
    total: number;
    ok: number;
    fallback: number;
    empty: number;
  } | null;
  /** chunks/chunks.json summary. distinctPapers/totalChars are omitted on
   *  huge files (see LARGE_CHUNK_JSON_BYTES) to avoid a multi-second read
   *  in the status endpoint. */
  chunks: {
    total: number;
    distinctPapers: number | null;
    totalChars: number | null;
    meanChars: number | null;
  } | null;
  /** vectorstore/meta.json — the vector store's own record of what got
   *  embedded. `count` = number of rows in embeddings.npy = should equal
   *  chunks.total once the vectorize stage catches up. */
  vectors: {
    count: number;
    dim: number;
    model: string;
    updatedAt: string | null;
  } | null;
  /** Detected pipeline-wide inconsistencies. `healthy` iff issues == []. */
  consistency: {
    healthy: boolean;
    issues: KbInventoryIssue[];
  };
  /** Epoch-ms of when this snapshot was taken. Used by the UI's "sampled
   *  X seconds ago" label. */
  sampledAt: number;
}

/**
 * A single detected inconsistency. `count` is the concrete gap so the UI
 * can render "5 pending" instead of a boolean; msg is a pre-i18n'd hint
 * (the browser will look up the translation via i18n key on the frontend
 * where possible — this string is a fallback for API consumers).
 */
export interface KbInventoryIssue {
  stage: "ocr" | "extract" | "chunk" | "vectorize";
  /** Machine-readable issue category. Frontend uses this to pick the i18n
   *  key; keep in sync with `settings.kb.inv.issue.*` in web/i18n. */
  kind: "missing" | "fallback" | "empty" | "unindexed" | "stale";
  count: number;
  msg: string;
}

// Files this small are just JSON.parse'd; over this we fall back to the
// tail-scan technique for chunks.json. 100 MB is generous — the biggest KB
// we've profiled (v3, 5k papers) fits well under that.
const SMALL_FILE_BYTES = 100 * 1024 * 1024;

// chunks.json for a moderate KB (~5k papers, 500k chunks) can be 1.5 GB.
// We refuse to parse anything over this — instead we tail-scan for the
// total_chunks field, and leave distinctPapers/totalChars null with the
// UI showing "—". The user can still see all four progress bars filled;
// they just don't get the fine-grained stats until they run a smaller KB.
const LARGE_CHUNK_JSON_BYTES = 200 * 1024 * 1024;

/** Read the last N bytes of a file. Used by the tail-scan chunk-count
 *  extractor. Streamed rather than allocating a huge buffer. */
async function tailBytes(path: string, n: number): Promise<Buffer> {
  const size = statSync(path).size;
  const start = Math.max(0, size - n);
  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(path, { start, end: size - 1 });
    stream.on("data", (c) => chunks.push(typeof c === "string" ? Buffer.from(c) : c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** Regex-extract the top-level `"total_chunks": N` value from a stringified
 *  chunks.json tail. Returns null if not found (unusual — chunks.json always
 *  writes it, but a partial write from a killed process might not have it). */
function scanTotalChunks(text: string): number | null {
  const m = text.match(/"total_chunks"\s*:\s*(\d+)/);
  if (!m || !m[1]) return null;
  return parseInt(m[1], 10);
}

/**
 * Full stats scan of chunks.json for KBs small enough to parse in-memory.
 * Falls back to null fields on OOM-scale files.
 */
async function readChunksStats(path: string): Promise<KbInventory["chunks"]> {
  if (!existsSync(path)) return null;
  const size = statSync(path).size;

  // Big-file path: tail-scan for total_chunks only.
  if (size > LARGE_CHUNK_JSON_BYTES) {
    const buf = await tailBytes(path, 8 * 1024);
    const total = scanTotalChunks(buf.toString("utf8"));
    if (total == null) return null;
    return { total, distinctPapers: null, totalChars: null, meanChars: null };
  }

  // Small-file path: full parse for the deeper stats.
  const raw = await fsp.readFile(path, "utf8");
  try {
    const parsed = JSON.parse(raw) as {
      chunks?: Array<{ text?: string; metadata?: { mmd_path?: string; title?: string } }>;
      total_chunks?: number;
    };
    const chunks = parsed.chunks ?? [];
    const total = parsed.total_chunks ?? chunks.length;
    const papers = new Set<string>();
    let totalChars = 0;
    for (const c of chunks) {
      totalChars += c.text?.length ?? 0;
      const key = c.metadata?.mmd_path ?? c.metadata?.title ?? "";
      if (key) papers.add(key);
    }
    return {
      total,
      distinctPapers: papers.size,
      totalChars,
      meanChars: chunks.length ? Math.round(totalChars / chunks.length) : 0,
    };
  } catch {
    // Corrupt JSON — return just the tail-scan count so the UI still
    // shows something rather than silently zeroing.
    const buf = await tailBytes(path, 8 * 1024);
    const total = scanTotalChunks(buf.toString("utf8"));
    return total == null ? null : { total, distinctPapers: null, totalChars: null, meanChars: null };
  }
}

/** Count PDF files in source/pdf/. Silently returns 0 if the directory
 *  doesn't exist yet (a fresh checkout). */
function countPdfs(pdfDir: string): number {
  try {
    if (!statSync(pdfDir).isDirectory()) return 0;
    return readdirSync(pdfDir).filter((n) => n.toLowerCase().endsWith(".pdf")).length;
  } catch {
    return 0;
  }
}

/** Read OCRed_pdf.json → paper count. */
async function readOcredCount(path: string): Promise<number | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = await fsp.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as { papers?: unknown[]; total_papers?: number };
    if (typeof parsed.total_papers === "number") return parsed.total_papers;
    return Array.isArray(parsed.papers) ? parsed.papers.length : 0;
  } catch {
    return null;
  }
}

/** Read KB_source.json → per-status counts. */
async function readExtractedStats(path: string): Promise<KbInventory["extracted"]> {
  if (!existsSync(path)) return null;
  if (statSync(path).size > SMALL_FILE_BYTES) {
    // Absurdly large metadata file — we can't afford to parse it in a
    // status endpoint. Return null and let the UI show "large — skipped".
    return null;
  }
  try {
    const raw = await fsp.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      papers?: Array<{ extraction_status?: string }>;
      total_papers?: number;
    };
    const papers = parsed.papers ?? [];
    let ok = 0, fallback = 0, empty = 0;
    for (const p of papers) {
      switch (p.extraction_status) {
        case "ok": ok++; break;
        case "fallback": fallback++; break;
        case "empty_mmd": empty++; break;
        default: break; // unknown status counted only in `total`
      }
    }
    return {
      total: parsed.total_papers ?? papers.length,
      ok, fallback, empty,
    };
  } catch {
    return null;
  }
}

/** Read vectorstore/meta.json. */
async function readVectorMeta(path: string): Promise<KbInventory["vectors"]> {
  if (!existsSync(path)) return null;
  try {
    const raw = await fsp.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as {
      count?: number;
      dim?: number;
      model?: string;
      updated_at?: string;
    };
    return {
      count: parsed.count ?? 0,
      dim: parsed.dim ?? 0,
      model: parsed.model ?? "",
      updatedAt: parsed.updated_at ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Cross-stage consistency check. Every rule maps to a KbInventoryIssue the
 * frontend renders with a coloured badge; healthy = no issues found.
 *
 * The rules are ORDERED by pipeline position — an earlier-stage issue
 * masks later ones ("no OCR yet" makes "chunks missing" tautologically
 * true; the UI would just repeat the same information twice). We suppress
 * downstream issues when an upstream stage is incomplete.
 */
function detectIssues(inv: KbInventory): KbInventoryIssue[] {
  const issues: KbInventoryIssue[] = [];

  // Upstream: pdfsOnDisk vs OCRed.
  if (inv.ocred != null && inv.ocred < inv.pdfsOnDisk) {
    const gap = inv.pdfsOnDisk - inv.ocred;
    issues.push({
      stage: "ocr",
      kind: "missing",
      count: gap,
      msg: `${gap} PDF(s) not yet OCRed`,
    });
    // Don't cascade — the OCR-pending count already tells you the whole
    // downstream will need to catch up. Adding "extract missing" etc.
    // would just noise the panel.
    return issues;
  }

  // OCR ledger has entries but no KB_source.json yet.
  if (inv.ocred != null && inv.ocred > 0 && inv.extracted == null) {
    issues.push({
      stage: "extract",
      kind: "missing",
      count: inv.ocred,
      msg: `${inv.ocred} OCRed paper(s) waiting for metadata extract`,
    });
    return issues;
  }

  if (inv.extracted && inv.ocred != null) {
    // Rows exist but count lags OCR ledger.
    const gap = inv.ocred - inv.extracted.total;
    if (gap > 0) {
      issues.push({
        stage: "extract",
        kind: "missing",
        count: gap,
        msg: `${gap} OCRed paper(s) not yet in KB_source.json`,
      });
    }
    if (inv.extracted.fallback > 0) {
      issues.push({
        stage: "extract",
        kind: "fallback",
        count: inv.extracted.fallback,
        msg: `${inv.extracted.fallback} record(s) still in fallback state`,
      });
    }
    if (inv.extracted.empty > 0) {
      issues.push({
        stage: "extract",
        kind: "empty",
        count: inv.extracted.empty,
        msg: `${inv.extracted.empty} paper(s) with empty mmd`,
      });
    }
  }

  // Chunks vs extracted records.
  if (inv.extracted && inv.chunks && inv.chunks.distinctPapers != null) {
    // "ok" is the strictest denominator — fallback rows sometimes still
    // produce chunks (they have SOMETHING extracted), so the gap-count
    // uses total not ok. That way we don't flag "chunks missing" when the
    // real problem is fallback (already surfaced above).
    const shouldChunk = inv.extracted.total;
    const gap = shouldChunk - inv.chunks.distinctPapers;
    if (gap > 0) {
      issues.push({
        stage: "chunk",
        kind: "missing",
        count: gap,
        msg: `${gap} paper(s) not yet chunked`,
      });
    }
  }

  // Vectors vs chunks.
  if (inv.chunks && inv.vectors) {
    const gap = inv.chunks.total - inv.vectors.count;
    if (gap > 0) {
      issues.push({
        stage: "vectorize",
        kind: "unindexed",
        count: gap,
        msg: `${gap} chunk(s) chunked but not yet vectorised`,
      });
    }
  } else if (inv.chunks && inv.chunks.total > 0 && !inv.vectors) {
    issues.push({
      stage: "vectorize",
      kind: "unindexed",
      count: inv.chunks.total,
      msg: `${inv.chunks.total} chunk(s) chunked but vectorstore not built yet`,
    });
  }

  return issues;
}

/**
 * Compute the full on-disk inventory. Cheap enough to call on every panel
 * open — the largest cost is the chunks.json scan, capped by size.
 */
export async function computeKbInventory(kbRoot?: string): Promise<KbInventory> {
  const root = kbRoot ?? findKbRoot();

  const pdfsOnDisk = countPdfs(join(root, "source", "pdf"));
  const [ocred, extracted, chunks, vectors] = await Promise.all([
    readOcredCount(join(root, "source", "OCRed_pdf.json")),
    readExtractedStats(join(root, "source", "KB_source.json")),
    readChunksStats(join(root, "chunks", "chunks.json")),
    readVectorMeta(join(root, "vectorstore", "meta.json")),
  ]);

  const partial: KbInventory = {
    kbRoot: root,
    pdfsOnDisk,
    ocred,
    extracted,
    chunks,
    vectors,
    consistency: { healthy: true, issues: [] },
    sampledAt: Date.now(),
  };
  const issues = detectIssues(partial);
  partial.consistency = { healthy: issues.length === 0, issues };
  return partial;
}
