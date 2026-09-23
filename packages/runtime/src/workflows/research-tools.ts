import type { WorkflowToolRequest, WorkflowToolResult } from "@brainpilot/plugin-sdk/workflow";
import type { SystemTool, SystemToolResult } from "../types.js";

const MAX_RESULTS = 8;
const MAX_URLS = 3;
const MAX_PAYLOAD_CHARS = 512_000;
const MAX_CONTENT_CHARS = 12_000;
const REQUEST_TIMEOUT_MS = 45_000;
const MAX_PENDING = 32;
const PAPER_TOOL_NAMES = new Set([
  "search_papers_local",
  "mcp__neuro_sci_papersearch__search_papers",
  "mcp__preset-neuro_sci_papersearch__search_papers",
]);

export interface WorkflowResearchPaper {
  title: string;
  authors: string[];
  year?: number;
  publicationDate?: string;
  abstract?: string;
  venue?: string;
  url?: string;
  doi?: string;
  source: "brainpilot-library";
}
/**
 * One observation about one backend — a response, an availability gap or a failure —
 * reported whether or not it produced text. A record does not assert that a request was
 * actually sent for it, so records are not a count of backend calls or billable units.
 * Every field states what the backend actually returned: a title is only present when the
 * backend's own metadata carried one, and character counts are JavaScript string lengths.
 * The host ledger assigns the stable source identifiers later.
 */
export interface WorkflowResearchSourceRecord {
  backend: "brainpilot-library" | "tavily";
  status: "ok" | "empty" | "failed" | "missing" | "unmatched";
  requestedUrl: string | null;
  returnedUrl: string | null;
  title?: string;
  content: string;
  receivedChars: number | null;
  retainedChars: number;
  contentTruncated: boolean | null;
  librarySegment?: { requested: 1; hasMore: boolean | null };
}
export interface WorkflowResearchEvidence {
  sourceAvailability: { library: boolean; tavilySearch: boolean; tavilyExtract: boolean };
  localPapers: WorkflowResearchPaper[];
  webResults: Array<{ title: string; url: string; content: string }>;
  pages: Array<{ url: string; content: string }>;
  sourceRecords: WorkflowResearchSourceRecord[];
  /** URLs handed to the extract tool, recorded even when the call then fails. */
  extractRequestedUrls: string[];
  issues: string[];
  retrievedAt: string;
}
export interface WorkflowResearchToolOptions {
  /** Already configured, enabled tools from the session's MCP bridge. */
  getMcpTools(): Promise<SystemTool[]>;
  /** Resolve for every request so changing the library toggle takes effect. */
  getPaperTool(): Promise<SystemTool | undefined>;
}

type ObjectValue = Record<string, unknown>;
class ResearchSourceError extends Error {
  constructor(readonly code: "quota_exceeded" | "rate_limited") { super(code); }
}
function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : undefined;
}

/** Evidence never includes credential-bearing URLs or local filesystem locations. */
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2_048) return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    if (/^(?:localhost|127\.|0\.|\[::1\])/.test(url.hostname) || url.hostname.endsWith(".local")) return undefined;
    for (const key of url.searchParams.keys()) {
      if (/(?:key|token|auth|secret|password|credential|signature|^sig$|^x-amz-|^x-goog-)/i.test(key)) return undefined;
    }
    return url.href;
  } catch { return undefined; }
}

interface CleanedText {
  /** Exactly what `text()` returns for the same input. */
  value: string | undefined;
  /** Length of the backend's own string, or null when it sent no string at all. */
  receivedChars: number | null;
  retainedChars: number;
  /**
   * True only when a length limit dropped characters; redaction, control-character
   * removal and trimming also shorten the text, but are not length-based truncation.
   */
  truncated: boolean | null;
}

function cleanText(value: unknown, limit: number): CleanedText {
  if (typeof value !== "string") return { value: undefined, receivedChars: null, retainedChars: 0, truncated: null };
  const initial = value.slice(0, limit * 2);
  const normalized = initial
    .replace(/https?:\/\/[^\s<>"']+/gi, (url) => safeUrl(url) ?? "[redacted URL]")
    .replace(/\b(?:Bearer\s+\S+|(?:api[_-]?key|access[_-]?token|secret|password|authorization)\s*[:=]\s*[^\s,;]+)/gi, "[redacted credential]")
    .replace(/\b(?:tvly-[\w-]+|sk-[\w-]{10,})\b/g, "[redacted credential]")
    .replace(/(?:\/(?:Users|home|root|etc|var|tmp|private|opt|mnt|srv)\/[^\s<>"']+|\b[A-Za-z]:\\[^\s<>"']+)/g, "[redacted path]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim();
  const retained = normalized.slice(0, limit);
  return {
    value: retained || undefined,
    receivedChars: value.length,
    retainedChars: retained.length,
    truncated: initial.length < value.length || retained.length < normalized.length,
  };
}

function text(value: unknown, limit: number): string | undefined {
  return cleanText(value, limit).value;
}

function parsePublicationDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?)?)?$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]); const month = match[2] ? Number(match[2]) : undefined; const day = match[3] ? Number(match[3]) : undefined;
  if (year < 1000 || year > 3000 || (month !== undefined && (month < 1 || month > 12))) return undefined;
  if (day !== undefined && (day < 1 || day > new Date(Date.UTC(year, month!, 0)).getUTCDate())) return undefined;
  if (value.includes("T") && !Number.isFinite(Date.parse(value))) return undefined;
  return value;
}

function normalizePaper(raw: unknown): WorkflowResearchPaper | undefined {
  const record = object(raw);
  if (!record) return undefined;
  const metadata = object(record.metadata) ?? record;
  const title = text(metadata.title, 500);
  if (!title) return undefined;
  const authors = (Array.isArray(metadata.authors) ? metadata.authors : [])
    .slice(0, 40).map((author) => text(typeof author === "string" ? author : object(author)?.name, 160))
    .filter((author): author is string => Boolean(author));
  const rawDate = metadata.published_date ?? metadata.publicationDate;
  const publicationDate = parsePublicationDate(rawDate);
  const rawYear = metadata.year ?? publicationDate?.slice(0, 4);
  const year = typeof rawYear === "number" || typeof rawYear === "string" ? Number(rawYear) : NaN;
  const abstract = text(metadata.abstract, 4_000);
  const venue = text(metadata.journal ?? metadata.venue, 300);
  const url = safeUrl(metadata.pdf_url) ?? safeUrl(metadata.url);
  const rawDoi = metadata.doi;
  const doi = typeof rawDoi === "string" && /^10\.\d{4,9}\/[^\s<>"']{1,200}$/i.test(rawDoi) ? rawDoi : undefined;
  return { title, authors, source: "brainpilot-library",
    ...(Number.isInteger(year) && year >= 1000 && year <= 3000 ? { year } : {}),
    ...(publicationDate ? { publicationDate } : {}), ...(abstract ? { abstract } : {}),
    ...(venue ? { venue } : {}), ...(url ? { url } : {}), ...(doi ? { doi } : {}) };
}

/** Decode the legacy paper server's Python repr without evaluating expressions. */
function pythonLiteral(input: string): unknown {
  let position = 0;
  let values = 0;
  const fail = (): never => { throw new Error("source_invalid_response"); };
  const whitespace = () => { while (position < input.length && /\s/.test(input[position]!)) position++; };
  const string = (): string => {
    const quote = input[position++];
    let output = "";
    while (position < input.length) {
      const character = input[position++];
      if (character === quote) return output;
      if (character === "\n" || character === "\r") return fail();
      if (character !== "\\") { output += character; continue; }
      const escape = input[position++];
      if (!escape) return fail();
      const simple: Record<string, string> = { "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", a: "\u0007" };
      if (Object.hasOwn(simple, escape)) { output += simple[escape]; continue; }
      if (escape === "x" || escape === "u" || escape === "U") {
        const length = escape === "x" ? 2 : escape === "u" ? 4 : 8;
        const digits = input.slice(position, position + length);
        if (digits.length !== length || !/^[\da-f]+$/i.test(digits)) return fail();
        const codepoint = Number.parseInt(digits, 16);
        if (codepoint > 0x10ffff) return fail();
        output += String.fromCodePoint(codepoint); position += length; continue;
      }
      if (/[0-7]/.test(escape)) {
        const following = /^[0-7]{0,2}/.exec(input.slice(position))![0];
        output += String.fromCodePoint(Number.parseInt(escape + following, 8)); position += following.length; continue;
      }
      return fail();
    }
    return fail();
  };
  const value = (depth: number): unknown => {
    whitespace();
    if (depth > 24 || ++values > 20_000) return fail();
    const character = input[position];
    if (character === "'" || character === '"') return string();
    if (character === "[" || character === "{") {
      position++;
      const array: unknown[] = [];
      const dictionary: ObjectValue = Object.create(null) as ObjectValue;
      const closing = character === "[" ? "]" : "}";
      whitespace();
      if (input[position] === closing) { position++; return character === "[" ? array : dictionary; }
      while (position < input.length) {
        if (character === "[") array.push(value(depth + 1));
        else {
          whitespace();
          if (input[position] !== "'" && input[position] !== '"') return fail();
          const key = string(); whitespace();
          if (input[position++] !== ":") return fail();
          dictionary[key] = value(depth + 1);
        }
        whitespace();
        if (input[position] === closing) { position++; return character === "[" ? array : dictionary; }
        if (input[position++] !== ",") return fail();
        whitespace();
        if (input[position] === closing) { position++; return character === "[" ? array : dictionary; }
      }
      return fail();
    }
    for (const [literal, parsed] of [["True", true], ["False", false], ["None", null]] as const) {
      if (input.startsWith(literal, position)) { position += literal.length; return parsed; }
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(input.slice(position));
    if (number && Number.isFinite(Number(number[0]))) { position += number[0].length; return Number(number[0]); }
    return fail();
  };
  const parsed = value(0); whitespace();
  if (position !== input.length) return fail();
  return parsed;
}

function boundedPayload(parsed: unknown): unknown {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
  let values = 0;
  while (pending.length) {
    const { value, depth } = pending.pop()!;
    if (depth > 24 || ++values > 20_000) throw new Error("source_invalid_response");
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) {
        if (pending.length + values >= 20_000) throw new Error("source_invalid_response");
        pending.push({ value: child, depth: depth + 1 });
      }
    }
  }
  return parsed;
}

function classifySourceFailure(payload: unknown): void {
  const status = object(payload)?.status;
  // These exact numeric statuses are returned by the configured Tavily tool.
  // Never preserve the provider's detail/error text, which can contain secrets.
  if (status === 432) throw new ResearchSourceError("quota_exceeded");
  if (status === 429) throw new ResearchSourceError("rate_limited");
}

/** The bridge exposes text blocks: modern JSON or the library's legacy repr. */
function payloads(result: SystemToolResult, allowPython = false): unknown[] {
  if (result.isError) {
    for (const block of result.content.slice(0, 16)) {
      if (typeof block.text !== "string" || block.text.length > MAX_PAYLOAD_CHARS) continue;
      try { classifySourceFailure(JSON.parse(block.text)); }
      catch (error) { if (error instanceof ResearchSourceError) throw error; }
    }
    throw new Error("source_failed");
  }
  const output: unknown[] = [];
  let remaining = MAX_PAYLOAD_CHARS;
  for (const block of result.content.slice(0, 16)) {
    if (typeof block.text !== "string" || !remaining) continue;
    if (block.text.length > remaining) throw new Error("source_payload_too_large");
    remaining -= block.text.length;
    try {
      const parsed = boundedPayload(JSON.parse(block.text));
      classifySourceFailure(parsed); output.push(parsed);
    }
    catch (error) {
      if (error instanceof ResearchSourceError) throw error;
      if (allowPython) {
        try { output.push(boundedPayload(pythonLiteral(block.text))); continue; }
        catch { /* Fall through to the known rendered format; never echo a parse error. */ }
      }
      // The configured Tavily MCP also supports a rendered search response.
      // Parse only its explicit Title/URL/Content fields, never echo its preamble.
      const entries = block.text.split(/(?:^|\n)Title:\s*/).slice(1, MAX_RESULTS + 1);
      const results = entries.flatMap((entry) => {
        const match = /^([^\n]+)\nURL:\s*(\S+)\n(?:Content|Snippet):\s*([\s\S]*)$/.exec(entry.trim());
        return match ? [{ title: match[1], url: match[2], content: match[3] }] : [];
      });
      if (results.length) output.push({ results });
    }
  }
  if (!output.length) throw new Error("source_invalid_response");
  return output;
}

/** Compare titles on their letters and numbers only, ignoring case and punctuation. */
function normalizedWords(value: string): string {
  return ` ${value.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu)?.join(" ") ?? ""} `;
}

/** A search hit only stands for the candidate when it repeats the whole title. */
function mentionsTitle(title: string, ...fields: Array<string | undefined>): boolean {
  const needle = normalizedWords(title);
  if (!needle.trim()) return false;
  return fields.some((field) => typeof field === "string" && normalizedWords(field).includes(needle));
}

function records(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  const record = object(payload);
  if (!record) return undefined;
  if (Array.isArray(record.results)) return record.results;
  if (Array.isArray(record.data)) return record.data;
  if (object(record.data)) return records(record.data);
  return undefined;
}

function resultRecords(parsed: unknown[], limit: number): ObjectValue[] {
  const lists = parsed.map(records).filter((list): list is unknown[] => Boolean(list));
  if (!lists.length) throw new Error("source_invalid_response");
  return lists.flat().slice(0, limit).map(object).filter((record): record is ObjectValue => Boolean(record));
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    operation.then((value) => { signal.removeEventListener("abort", abort); resolve(value); },
      (error) => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
}

/** Two source calls at a time; cancelled waiters never start a tool later. */
function sourceLimiter() {
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (active < 2) { active++; return Promise.resolve(); }
    if (queue.length >= MAX_PENDING) return Promise.reject(new Error("source_busy"));
    return new Promise((resolve, reject) => {
      const abort = () => { const index = queue.indexOf(admit); if (index !== -1) queue.splice(index, 1); reject(signal.reason); };
      const admit = () => { signal.removeEventListener("abort", abort); active++; resolve(); };
      queue.push(admit); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  };
  return async <T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> => {
    await acquire(signal);
    // Keep the slot until the underlying promise settles, even if a broken tool
    // ignores cancellation. That prevents timed-out callers from multiplying it.
    const operation = Promise.resolve().then(() => { signal.throwIfAborted(); return action(); }).finally(() => {
      active--; queue.shift()?.();
    });
    // Install the rejection handler before checking cancellation.
    operation.catch(() => {});
    return abortable(operation, signal);
  };
}

function requestInput(request: WorkflowToolRequest): { title?: string; query?: string; urls: string[]; maxResults: number; maxExtractUrls: number } {
  const input = object(request.input);
  if (!input) throw new Error("Research input must be an object");
  if (request.name === "research_search") {
    if (typeof input.query !== "string" || !input.query.trim() || input.query.length > 1_000) throw new Error("Research query must contain 1–1000 characters");
    if (input.maxResults !== undefined && (typeof input.maxResults !== "number" || !Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > MAX_RESULTS)) {
      throw new Error(`Research maxResults must be an integer from 1 to ${MAX_RESULTS}`);
    }
    return { query: input.query.trim(), urls: [], maxResults: (input.maxResults as number | undefined) ?? 5, maxExtractUrls: MAX_URLS };
  }
  if (request.name === "research_resolve") {
    if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 1_000) throw new Error("Research title must contain 1–1000 characters");
    if (input.urls !== undefined && (!Array.isArray(input.urls) || input.urls.length > MAX_URLS || input.urls.some((url) => !safeUrl(url)))) {
      throw new Error(`Research urls must contain at most ${MAX_URLS} public HTTP(S) URLs without credentials`);
    }
    // Only this call's own allowance; the caller reserves the whole run's budget atomically.
    if (input.maxExtractUrls !== undefined && (typeof input.maxExtractUrls !== "number" || !Number.isInteger(input.maxExtractUrls) || input.maxExtractUrls < 0 || input.maxExtractUrls > MAX_URLS)) {
      throw new Error(`Research maxExtractUrls must be an integer from 0 to ${MAX_URLS}`);
    }
    return { title: input.title.trim(), urls: [...new Set(((input.urls as string[] | undefined) ?? []).map((url) => safeUrl(url)!))], maxResults: 1,
      maxExtractUrls: (input.maxExtractUrls as number | undefined) ?? MAX_URLS };
  }
  throw new Error("Unsupported research tool");
}

export function createWorkflowResearchTools(options: WorkflowResearchToolOptions) {
  const limited = sourceLimiter();
  return async (request: WorkflowToolRequest, signal: AbortSignal): Promise<WorkflowToolResult> => {
    signal.throwIfAborted();
    const input = requestInput(request);
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error("source_timeout")), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    const sourceSignal = AbortSignal.any([signal, deadline.signal]);
    const evidence: WorkflowResearchEvidence = {
      sourceAvailability: { library: false, tavilySearch: false, tavilyExtract: false },
      localPapers: [], webResults: [], pages: [], sourceRecords: [], extractRequestedUrls: [], issues: [], retrievedAt: "",
    };
    /** A library attempt that never produced a response: no body, no metadata, no segment. */
    const libraryFailure = () => {
      evidence.sourceRecords.push({ backend: "brainpilot-library", status: "failed", requestedUrl: null, returnedUrl: null,
        content: "", receivedChars: null, retainedChars: 0, contentTruncated: null });
    };
    /** Requested extract URLs that already carry a record, so a later pass never duplicates them. */
    const extractRecorded = new Set<string>();
    /** An extract attempt that produced no body for this URL: no metadata, no counts. */
    const extractFailure = (requestedUrl: string | null) => {
      evidence.sourceRecords.push({ backend: "tavily", status: "failed", requestedUrl, returnedUrl: null,
        content: "", receivedChars: null, retainedChars: 0, contentTruncated: null });
      if (requestedUrl) extractRecorded.add(requestedUrl);
    };
    const collect = async (source: "library" | "tavily", action: () => Promise<void>) => {
      try { await limited(action, sourceSignal); }
      catch (error) {
        signal.throwIfAborted();
        const code = deadline.signal.aborted ? "timeout" : error instanceof ResearchSourceError ? error.code : "unavailable";
        evidence.issues.push(`${source}_${code}`);
        if (source === "library" && input.title) libraryFailure();
        if (source === "tavily" && input.title) {
          // Only URLs actually handed to the extract tool can carry a per-URL failure; a
          // collapse before that is one observation about the backend, not about any URL.
          if (!evidence.extractRequestedUrls.length) extractFailure(null);
          else for (const url of evidence.extractRequestedUrls) { if (!extractRecorded.has(url)) extractFailure(url); }
        }
      }
    };
    try {
      await Promise.all([
        collect("library", async () => {
          const tool = await options.getPaperTool();
          sourceSignal.throwIfAborted();
          if (!tool || !PAPER_TOOL_NAMES.has(tool.name)) { evidence.issues.push("library_unavailable"); if (input.title) libraryFailure(); return; }
          const params = input.query
            ? { keywords: input.query.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)?.slice(0, 16) ?? [input.query], topk: input.maxResults, mode: "meta-data" }
            : { title: input.title, topk: 1, mode: "full-paper", segment: 1 };
          const result = await tool.execute(params, { signal: sourceSignal });
          sourceSignal.throwIfAborted();
          const parsed = payloads(result, true);
          const lists = parsed.map(records).filter((list): list is unknown[] => Boolean(list));
          if (!lists.length) throw new Error("source_invalid_response");
          evidence.sourceAvailability.library = true;
          const returned = lists.flat().slice(0, input.maxResults);
          for (const raw of returned) {
            const paper = normalizePaper(raw);
            if (paper) evidence.localPapers.push(paper);
            if (!input.title) continue;
            // A resolved full paper stays usable as a source even without a public URL,
            // while `pages` keeps its existing URL requirement.
            const record = object(raw);
            const body = cleanText(record?.mmd_content, MAX_CONTENT_CHARS);
            // The title may only come from the backend's own metadata, never from the request.
            const metadata = object(record?.metadata) ?? record;
            const returnedUrl = paper?.url ?? safeUrl(metadata?.pdf_url) ?? safeUrl(metadata?.url) ?? null;
            const title = paper?.title ?? text(metadata?.title, 500);
            const hasMore = object(record?.segment_info)?.has_more;
            evidence.sourceRecords.push({
              backend: "brainpilot-library", status: body.value ? "ok" : "empty", requestedUrl: null, returnedUrl,
              ...(title ? { title } : {}),
              content: body.value ?? "", receivedChars: body.receivedChars, retainedChars: body.retainedChars, contentTruncated: body.truncated,
              librarySegment: { requested: 1, hasMore: typeof hasMore === "boolean" ? hasMore : null },
            });
            if (paper && body.value && paper.url) evidence.pages.push({ url: paper.url, content: body.value });
          }
          // An answered request that carried no entries is a recorded miss, not a failure.
          if (input.title && !returned.length) {
            evidence.sourceRecords.push({ backend: "brainpilot-library", status: "missing", requestedUrl: null, returnedUrl: null,
              content: "", receivedChars: null, retainedChars: 0, contentTruncated: null, librarySegment: { requested: 1, hasMore: null } });
          }
        }),
        collect("tavily", async () => {
          const tools = await options.getMcpTools();
          sourceSignal.throwIfAborted();
          const searchTool = tools.find((candidate) => /^mcp__[A-Za-z0-9_.-]+__tavily[_-]search$/.test(candidate.name));
          const extractTool = tools.find((candidate) => /^mcp__[A-Za-z0-9_.-]+__tavily[_-]extract$/.test(candidate.name));
          evidence.sourceAvailability.tavilySearch = Boolean(searchTool);
          evidence.sourceAvailability.tavilyExtract = Boolean(extractTool);
          const search = async (tool: SystemTool, query: string, maxResults: number): Promise<WorkflowResearchEvidence["webResults"]> => {
            // A configured channel that fails is not evidence of an empty search.
            // The unused Tavily capability remains a declaration until invoked.
            evidence.sourceAvailability.tavilySearch = false;
            const result = await tool.execute({ query, max_results: maxResults, search_depth: "basic", include_raw_content: false }, { signal: sourceSignal });
            sourceSignal.throwIfAborted();
            const found = resultRecords(payloads(result), maxResults).flatMap((record) => {
              const url = safeUrl(record.url);
              const title = text(record.title, 500);
              return url && title ? [{ title, url, content: text(record.raw_content ?? record.content, MAX_CONTENT_CHARS) ?? "" }] : [];
            });
            evidence.sourceAvailability.tavilySearch = true;
            return found;
          };
          if (input.query) {
            if (!searchTool) { evidence.issues.push("tavily_search_unavailable"); return; }
            evidence.webResults.push(...await search(searchTool, input.query, input.maxResults));
            return;
          }
          const title = input.title!;
          // Discovery may only have seen the candidate quoted inside an unrelated page.
          // An exact-title search locates the paper's own source before extracting.
          const observed: string[] = [];
          if (!searchTool) evidence.issues.push("tavily_search_unavailable");
          else {
            try {
              for (const hit of await search(searchTool, `"${title.replace(/["\\]/g, " ").trim()}"`, MAX_URLS)) {
                evidence.webResults.push(hit);
                if (mentionsTitle(title, hit.title, hit.content)) observed.push(hit.url);
              }
            } catch (error) {
              if (sourceSignal.aborted) throw error;
              // Keep the caller's own URLs usable, and never echo the provider's detail.
              evidence.issues.push(`tavily_search_${error instanceof ResearchSourceError ? error.code : "unavailable"}`);
            }
          }
          // The caller's own per-call extract allowance applies to the merged, deduplicated list.
          const urls = [...new Set([...observed, ...input.urls])].slice(0, Math.min(MAX_URLS, input.maxExtractUrls));
          // A zero allowance means no extraction was attempted; the tool's availability is unchanged.
          if (!urls.length) return;
          if (!extractTool) {
            // No URL ever reached a backend, so `extractRequestedUrls` stays empty and the
            // gap is reported once against the backend rather than against each URL.
            evidence.issues.push("tavily_extract_unavailable"); extractFailure(null); return;
          }
          sourceSignal.throwIfAborted();
          evidence.sourceAvailability.tavilyExtract = false;
          evidence.extractRequestedUrls = urls;
          const result = await extractTool.execute({ urls, extract_depth: "basic", format: "markdown" }, { signal: sourceSignal });
          sourceSignal.throwIfAborted();
          const parsed = payloads(result);
          const extracted = resultRecords(parsed, MAX_URLS);
          evidence.sourceAvailability.tavilyExtract = true;
          for (const record of extracted) {
            const url = safeUrl(record.url);
            const body = cleanText(record.raw_content ?? record.content, MAX_CONTENT_CHARS);
            if (!url || !urls.includes(url)) {
              // A URL this call never asked for cannot stand in for a requested one. Its text
              // is kept only as a diagnostic and stays out of `pages`.
              evidence.sourceRecords.push({ backend: "tavily", status: "unmatched", requestedUrl: null, returnedUrl: url ?? null,
                content: body.value ?? "", receivedChars: body.receivedChars, retainedChars: body.retainedChars, contentTruncated: body.truncated });
              continue;
            }
            // The title may only come from the backend's own metadata, never from the request.
            const returnedTitle = text(record.title, 500);
            evidence.sourceRecords.push({
              backend: "tavily", status: body.value ? "ok" : "empty", requestedUrl: url, returnedUrl: url,
              ...(returnedTitle ? { title: returnedTitle } : {}),
              content: body.value ?? "", receivedChars: body.receivedChars, retainedChars: body.retainedChars, contentTruncated: body.truncated,
            });
            extractRecorded.add(url);
            if (body.value) evidence.pages.push({ url, content: body.value });
          }
          // Read only the bounded head of the reported failures, and never the provider's
          // error text, which can carry secrets.
          const failures = parsed.flatMap((payload) => {
            const list = object(payload)?.failed_results;
            return Array.isArray(list) ? list : [];
          }).slice(0, MAX_URLS).map(object).filter((record): record is ObjectValue => Boolean(record));
          for (const failure of failures) {
            const url = safeUrl(failure.url);
            if (url && urls.includes(url)) {
              evidence.sourceRecords.push({ backend: "tavily", status: "failed", requestedUrl: url, returnedUrl: url,
                content: "", receivedChars: null, retainedChars: 0, contentTruncated: null });
              extractRecorded.add(url);
            } else {
              evidence.sourceRecords.push({ backend: "tavily", status: "unmatched", requestedUrl: null, returnedUrl: url ?? null,
                content: "", receivedChars: null, retainedChars: 0, contentTruncated: null });
            }
          }
          // A requested URL the backend answered about in neither list is a recorded miss.
          for (const url of urls) {
            if (extractRecorded.has(url)) continue;
            evidence.sourceRecords.push({ backend: "tavily", status: "missing", requestedUrl: url, returnedUrl: null,
              content: "", receivedChars: null, retainedChars: 0, contentTruncated: null });
            extractRecorded.add(url);
          }
          if (parsed.some((payload) => Array.isArray(object(payload)?.failed_results) && (object(payload)!.failed_results as unknown[]).length)) {
            evidence.issues.push("tavily_extract_partial");
          }
        }),
      ]);
      signal.throwIfAborted();
      evidence.retrievedAt = new Date().toISOString();
      evidence.issues = [...new Set(evidence.issues)];
      return { data: evidence, artifacts: [] };
    } finally { clearTimeout(timer); }
  };
}
