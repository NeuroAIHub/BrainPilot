/*
 * Source ledger foundation for the deep-research workflow: plain JSON types, the
 * publication-window rule that decides whether a source predates the evidence cutoff, and
 * admission of caller-provided files and of the bodies a retrieval adapter reported. Claim linking
 * arrives in a later slice; nothing here reads a file or the network, so no source is ever externally
 * verified. Metadata that arrived with a provided file stays marked `provided`; this module never
 * upgrades it to an externally verified fact, and a stored body is never overwritten by a
 * conflicting one.
 * Every persisted shape is plain JSON: no Map, Set or Date survives into the ledger.
 */
import { createHash } from "node:crypto";
import { isCalendarDate } from "./deep-research-contract.js";
import type {
  WorkflowResearchEvidence, WorkflowResearchPaper, WorkflowResearchSourceRecord,
} from "./research-tools.js";

export type PublicationPrecision = "day" | "month" | "year" | "unknown";
export type CutoffStatus = "eligible" | "after_cutoff" | "unknown";

/**
 * A publication date plus the whole interval it could denote. A bare year means the source
 * may have appeared on any day of that year, so earliest/latest span it and the cutoff
 * comparison stays honest instead of pretending the source landed on January 1.
 */
export interface PublicationWindow {
  publicationDate: string | null;
  publicationPrecision: PublicationPrecision;
  earliest: string | null;
  latest: string | null;
  cutoffStatus: CutoffStatus;
}

/** A file the caller supplied. Every field is the caller's claim, not an observation. */
export interface ProvidedSourceDescriptor {
  path: string;
  title?: string;
  authors?: string[];
  publicationDate?: string;
  year?: number;
  doi?: string;
  url?: string;
  expectedSha256?: string;
  bytes?: number;
  metadataOnly?: boolean;
  provenanceNote?: string;
}

export type SourceOrigin = "provided" | "brainpilot-library" | "tavily";
/** `provided` metadata came from the caller, `observed` from the retrieved content. */
export type MetadataOrigin = "provided" | "observed" | "unknown";

/** One library retrieval: this slice always requests a single segment. */
export interface LibrarySegment {
  requested: 1;
  hasMore: boolean | null;
}

export interface LedgerSource extends PublicationWindow {
  sourceId: string;
  /** Stable dedup key assigned by the host; equal keys mean the same claimed/observed identity, not proof that two entries are the same work. */
  identityKey: string;
  origin: SourceOrigin;
  title: string | null;
  authors: string[];
  doi: string | null;
  url: string | null;
  metadataOrigin: MetadataOrigin;
  canonicalText: string | null;
  contentHash: string | null;
  /** null when no text was retrieved, so truncation is unknown rather than false. */
  contentTruncated: boolean | null;
  librarySegment?: LibrarySegment;
  providedPath: string | null;
  expectedSha256: string | null;
  /** True when only metadata is known and no content backs this entry. */
  metadataOnly: boolean;
  /** The caller's claimed size for a provided file; the observed UTF-8 length of a stored body. */
  bytes: number | null;
  /** The caller's own note about where a provided file came from. Never a verification claim. */
  provenanceNote: string | null;
}

export interface LedgerDiagnostic {
  code: string;
  message: string;
  sourceId?: string;
}

export interface SourceLedger {
  cutoffDate: string;
  sources: LedgerSource[];
  diagnostics: LedgerDiagnostic[];
}

const YEAR_ONLY = /^(\d{4})$/u;
const YEAR_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/u;
/**
 * A strict RFC 3339 timestamp. The calendar prefix is re-checked with isCalendarDate before
 * any Date parsing, so 2025-02-30T00:00:00Z is rejected instead of rolling into March, and
 * free-form text never reaches Date.parse. Leap seconds are not accepted.
 */
const TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2})[Tt]([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:[Zz]|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

const UNKNOWN_WINDOW: Readonly<Omit<PublicationWindow, "cutoffStatus">> = Object.freeze({
  publicationDate: null, publicationPrecision: "unknown", earliest: null, latest: null,
});

/** Last real day of a month, found by asking the calendar validator rather than restating it. */
function lastDayOfMonth(year: string, month: string): string {
  for (const day of ["31", "30", "29", "28"]) {
    const candidate = `${year}-${month}-${day}`;
    if (isCalendarDate(candidate)) return candidate;
  }
  /* istanbul ignore next: every valid month has one of the days above. */
  throw new RangeError(`no valid day for ${year}-${month}`);
}

/** UTC calendar day of a strict timestamp, or null when the shape or calendar day is wrong. */
function utcDayOfTimestamp(value: string): string | null {
  const match = TIMESTAMP.exec(value);
  if (!match || !isCalendarDate(match[1]!)) return null;
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  const day = new Date(instant).toISOString().slice(0, 10);
  // A UTC offset can shift the instant outside 0001..9999, where the ISO string is no longer
  // a plain YYYY-MM-DD prefix; the converted day is checked before it is accepted as a date.
  return isCalendarDate(day) ? day : null;
}

/** An explicit publication string, resolved to its precision and possible interval. */
function fromDateString(value: string): Omit<PublicationWindow, "cutoffStatus"> | null {
  if (isCalendarDate(value)) {
    return { publicationDate: value, publicationPrecision: "day", earliest: value, latest: value };
  }
  const month = YEAR_MONTH.exec(value);
  if (month) {
    // The first day guards the whole month: a month whose day 1 is not a calendar day
    // (year 0000) has no last day either, so it stays unknown instead of throwing.
    const first = `${value}-01`;
    if (!isCalendarDate(first)) return null;
    return {
      publicationDate: value, publicationPrecision: "month",
      earliest: first, latest: lastDayOfMonth(month[1]!, month[2]!),
    };
  }
  const year = YEAR_ONLY.exec(value);
  if (year) return fromYearNumber(Number(year[1]));
  const day = utcDayOfTimestamp(value);
  if (day) {
    return { publicationDate: day, publicationPrecision: "day", earliest: day, latest: day };
  }
  return null;
}

/** A bare year spans the whole year; publicationDate keeps the year, never a made-up day. */
function fromYearNumber(year: number): Omit<PublicationWindow, "cutoffStatus"> | null {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;
  const padded = String(year).padStart(4, "0");
  return {
    publicationDate: padded, publicationPrecision: "year",
    earliest: `${padded}-01-01`, latest: `${padded}-12-31`,
  };
}

/** True only for an absent explicit date: missing, null or blank, where the year may stand in. */
function isMissing(value: unknown): boolean {
  return value === undefined || value === null
    || (typeof value === "string" && value.trim().length === 0);
}

/**
 * Resolves a publication date against the evidence cutoff. The fallback year applies only when
 * the explicit date is missing, null or blank; a non-empty explicit value is authoritative even
 * when it is unparseable, so an invalid date stays `unknown` instead of silently inheriting a
 * valid year, and a non-string explicit value is `unknown` too. Anything unparseable stays
 * `unknown` rather than being guessed, and a window that straddles the cutoff is `unknown`:
 * only a whole interval at or before the cutoff is `eligible`, and only one starting strictly
 * after it is `after_cutoff`. Comparison is lexicographic, exact for zero-padded YYYY-MM-DD.
 */
export function publicationWindow(
  publicationDate: unknown, year: unknown, cutoffDate: string,
): PublicationWindow {
  const resolved = isMissing(publicationDate)
    ? (typeof year === "number" ? fromYearNumber(year) : null)
    : (typeof publicationDate === "string" ? fromDateString(publicationDate.trim()) : null);
  const window = resolved ?? UNKNOWN_WINDOW;
  const cutoffValid = isCalendarDate(cutoffDate);
  let cutoffStatus: CutoffStatus = "unknown";
  if (cutoffValid && window.earliest && window.latest) {
    if (window.earliest > cutoffDate) cutoffStatus = "after_cutoff";
    else if (window.latest <= cutoffDate) cutoffStatus = "eligible";
  }
  return { ...window, cutoffStatus };
}

/**
 * An empty ledger. The cutoff is the invariant every later admission is judged against, so a
 * malformed one fails loudly here rather than silently marking every source `unknown`.
 */
export function createSourceLedger(cutoffDate: string): SourceLedger {
  if (!isCalendarDate(cutoffDate)) {
    throw new TypeError(`cutoffDate must be a calendar date as YYYY-MM-DD, received: ${cutoffDate}`);
  }
  return { cutoffDate, sources: [], diagnostics: [] };
}

/**
 * What planning is allowed to see about a catalogued source: the caller's descriptor facts and
 * whether a body may be read, never the body itself and never a property the descriptor did not
 * carry. `readable` is false for a metadata-only entry (no full text exists to read) and for one
 * past the cutoff (admission will refuse it), so planning never queues a doomed read.
 */
export interface PlanningSource {
  sourceId: string;
  path: string;
  title: string | null;
  authors: string[];
  publicationDate: string | null;
  cutoffStatus: CutoffStatus;
  bytes: number | null;
  readable: boolean;
}

const SHA256_HEX = /^[0-9a-fA-F]{64}$/u;

/** Diagnostics stay generic: a caller path, hash or body could carry a secret, so none is echoed. */
function note(state: SourceLedger, code: string, message: string, sourceId?: string): void {
  state.diagnostics.push(sourceId === undefined ? { code, message } : { code, message, sourceId });
}

function trimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

/** Filename stands in for a missing title; a trailing separator leaves the title unknown. */
function filenameOf(path: string): string | null {
  const parts = path.split(/[\\/]/u);
  return trimmed(parts[parts.length - 1]);
}

function sha256Utf8(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function byteLengthUtf8(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/** A bare DOI: the 10.<registrant>/<suffix> form only, never a URL or a "doi:" prefix. */
const BARE_DOI = /^10\.\d{4,9}\/\S+$/u;
const MAX_URL_CHARS = 2_048;
const MAX_PROVENANCE_CHARS = 500;

/** Case is not significant in a DOI, so identity is compared in lower case. */
function validDoi(value: unknown): string | null {
  const text = trimmed(value)?.toLowerCase() ?? null;
  return text !== null && BARE_DOI.test(text) ? text : null;
}

/**
 * A public, credential-free http(s) URL, by the same basic rules the retrieval adapter applies to
 * evidence: no embedded user or password, no loopback or .local host, no secret-looking query key.
 * Anything else is not carried into the ledger, so a stored URL never leaks a credential.
 */
function publicUrl(value: unknown): string | null {
  const text = trimmed(value);
  if (text === null || text.length > MAX_URL_CHARS) return null;
  try {
    const url = new URL(text);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (/^(?:localhost|127\.|0\.|\[::1\])/u.test(url.hostname) || url.hostname.endsWith(".local")) return null;
    for (const key of url.searchParams.keys()) {
      if (/(?:key|token|auth|secret|password|credential|signature|^sig$|^x-amz-|^x-goog-)/iu.test(key)) return null;
    }
    return url.href;
  } catch { return null; }
}

/** The caller's provenance note, kept only when it is short enough to be a note rather than a body. */
function provenanceNoteOf(value: unknown): string | null {
  const text = trimmed(value);
  return text !== null && text.length <= MAX_PROVENANCE_CHARS ? text : null;
}

function integerAtLeastZero(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Catalogues caller-supplied files as ledger rows and returns the planning view of them, one view
 * per requested valid path. Nothing here reads a file or the network: every row starts with
 * `canonicalText` and `contentHash` null, `contentTruncated` null (truncation is unknown until text
 * arrives) and `metadataOrigin` `provided`, because each field is still only the caller's claim. Ids
 * are host-assigned s1, s2… continuing the ledger. A path already catalogued — earlier in this call
 * or by an earlier call — keeps its single identity and its existing id, and is still returned so
 * planning can act on it; a byte count the first descriptor omitted may be filled from a later one,
 * but nothing already stored is overwritten. A blank path, or an `expectedSha256` that is not 64 hex
 * digits, is skipped: a malformed hash cannot verify anything, and honouring it would fake
 * verification. `doi` and `url` are kept only when they are a bare DOI and a public credential-free
 * http(s) URL; anything else is omitted with a generic diagnostic. Omitted metadata is reported so
 * planning knows the gap is the caller's, not ours.
 */
export function catalogProvidedSources(
  state: SourceLedger, descriptors: ProvidedSourceDescriptor[],
): PlanningSource[] {
  const planning: PlanningSource[] = [];
  const returned = new Map<string, PlanningSource>();
  for (const descriptor of Array.isArray(descriptors) ? descriptors : []) {
    const path = trimmed(descriptor?.path);
    if (path === null) {
      note(state, "provided_source_skipped", "A provided source was skipped: its path was missing or blank.");
      continue;
    }
    const existing = state.sources.find(
      (candidate) => candidate.origin === "provided" && candidate.providedPath === path,
    );
    if (existing) {
      note(state, "provided_source_duplicate", "A provided source repeated a path already catalogued; the existing entry was reused instead of a second identity.", existing.sourceId);
      const refreshed = planningViewOf(existing, path, descriptor);
      const already = returned.get(path);
      if (already) already.bytes = refreshed.bytes;
      else {
        returned.set(path, refreshed);
        planning.push(refreshed);
      }
      continue;
    }
    const expected = descriptor.expectedSha256;
    if (expected !== undefined && !(typeof expected === "string" && SHA256_HEX.test(expected.trim()))) {
      note(state, "provided_source_skipped", "A provided source was skipped: its expected SHA-256 was not 64 hexadecimal digits.");
      continue;
    }
    const view = catalogOne(state, descriptor, path, expected);
    returned.set(path, view);
    planning.push(view);
  }
  return planning;
}

/** The planning view of a row, taking a byte count from the descriptor only when none is stored. */
function planningViewOf(
  source: LedgerSource, path: string, descriptor: ProvidedSourceDescriptor,
): PlanningSource {
  if (source.bytes === null) source.bytes = integerAtLeastZero(descriptor?.bytes);
  return {
    sourceId: source.sourceId, path, title: source.title, authors: [...source.authors],
    publicationDate: source.publicationDate, cutoffStatus: source.cutoffStatus, bytes: source.bytes,
    readable: !source.metadataOnly && source.cutoffStatus !== "after_cutoff",
  };
}

/** Appends one row for an accepted descriptor and returns its planning view. */
function catalogOne(
  state: SourceLedger, descriptor: ProvidedSourceDescriptor, path: string, expected: string | undefined,
): PlanningSource {
  const window = publicationWindow(descriptor.publicationDate, descriptor.year, state.cutoffDate);
  const sourceId = `s${state.sources.length + 1}`;
  const title = trimmed(descriptor.title) ?? filenameOf(path);
  const authors = (Array.isArray(descriptor.authors) ? descriptor.authors : [])
    .map(trimmed).filter((author): author is string => author !== null);
  const metadataOnly = descriptor.metadataOnly === true;
  const doi = validDoi(descriptor.doi);
  const url = publicUrl(descriptor.url);
  const source: LedgerSource = {
    ...window, sourceId, identityKey: `provided:${path}`, origin: "provided",
    title, authors, doi, url, metadataOrigin: "provided",
    canonicalText: null, contentHash: null, contentTruncated: null,
    providedPath: path, expectedSha256: expected === undefined ? null : expected.trim().toLowerCase(),
    metadataOnly, bytes: integerAtLeastZero(descriptor.bytes),
    provenanceNote: provenanceNoteOf(descriptor.provenanceNote),
  };
  state.sources.push(source);
  if (metadataOnly) {
    note(state, "provided_source_metadata_only", "A provided source is metadata only: its full text is unavailable, so no body can be admitted for it.", sourceId);
  }
  if ((doi === null && descriptor.doi !== undefined) || (url === null && descriptor.url !== undefined)) {
    note(state, "provided_source_identifier_omitted", "A provided source carried a DOI or URL that is not a bare DOI or a public credential-free http(s) URL; it was omitted.", sourceId);
  }
  if (title === null || authors.length === 0 || window.publicationDate === null) {
    note(state, "provided_source_metadata_incomplete", "A provided source omitted title, authors or publication date; the missing fields stay unknown.", sourceId);
  }
  return planningViewOf(source, path, descriptor);
}

/**
 * Admits caller-supplied body text for catalogued provided sources and returns the ids whose text
 * was actually read, without duplicates. The host does the reading; this function never touches a
 * file or the network, so the text is trusted only as far as the descriptor's own hash allows: when
 * an `expectedSha256` was catalogued, the SHA-256 of the UTF-8 text must match it exactly, and a
 * mismatch is rejected rather than recorded as a corrected fact. A first read fills the row's
 * `canonicalText`, `contentHash` and `contentTruncated` false; an identical later body reuses the
 * same id; a conflicting body is never allowed to overwrite the stored text and is rejected with a
 * `source_changed` diagnostic (re-reading a changed file needs a snapshot, a later slice). Unknown
 * ids, absent bodies and rejections are reported generically and do not stop the remaining inputs.
 * A source past the cutoff is not read and not returned; an unknown publication date is admitted
 * and stays labelled `unknown` with a diagnostic. Nothing here adds an external verification claim.
 */
export function admitProvidedSources(
  state: SourceLedger, inputs: Array<{ sourceId: string; text: string }>,
): string[] {
  const admitted: string[] = [];
  for (const input of Array.isArray(inputs) ? inputs : []) {
    const sourceId = trimmed(input?.sourceId);
    const source = sourceId === null ? undefined : state.sources.find(
      (candidate) => candidate.sourceId === sourceId
        && candidate.origin === "provided" && candidate.providedPath !== null,
    );
    if (!source) {
      note(state, "unknown_source", "A body was offered for an id that is not a catalogued provided source and was ignored.");
      continue;
    }
    if (source.metadataOnly) {
      note(state, "source_body_rejected", "A body was offered for a metadata-only source and was ignored.", source.sourceId);
      continue;
    }
    if (source.cutoffStatus === "after_cutoff") {
      note(state, "source_after_cutoff", "A body was offered for a source published after the evidence cutoff; it was not read.", source.sourceId);
      continue;
    }
    const text = typeof input.text === "string" ? input.text : "";
    if (text.trim().length === 0) {
      note(state, "source_body_missing", "A body was offered with no text and the source stays unread.", source.sourceId);
      continue;
    }
    const contentHash = sha256Utf8(text);
    if (source.expectedSha256 !== null && source.expectedSha256 !== contentHash) {
      note(state, "source_hash_mismatch", "A body did not match the expected SHA-256 for its source and was rejected.", source.sourceId);
      continue;
    }
    if (source.canonicalText === null) {
      source.canonicalText = text;
      source.contentHash = contentHash;
      source.contentTruncated = false;
    } else if (source.contentHash !== contentHash) {
      note(state, "source_changed", "A body conflicted with the text already stored for its source; the stored text was kept and the new body rejected.", source.sourceId);
      continue;
    }
    if (source.cutoffStatus === "unknown") {
      note(state, "source_date_unknown", "A source was admitted with an unknown publication date; its cutoff status stays unknown.", source.sourceId);
    }
    if (!admitted.includes(source.sourceId)) admitted.push(source.sourceId);
  }
  return admitted;
}

/**
 * The keys Tavily uses for a publication date, captured as the whole value the body states —
 * quoted or bare — never as a leading slice of it, so a timestamp or a malformed suffix is
 * judged in full rather than truncated to something that only looks like a calendar day.
 */
const TAVILY_DATE =
  /(?:datePublished|publication_date|published_date)['"]?\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s,;}\])]+))/giu;

/**
 * The one publication value a retrieved body states, or null when it states none or disagrees with
 * itself: a body carrying two different values cannot decide the question. The value is returned
 * exactly as written and resolved by the same strict rules as any other date, so anything that is
 * not a full calendar day, month, year or strict timestamp conservatively stays unknown.
 */
function tavilyPublicationValue(body: string): string | null {
  const values = new Set<string>();
  for (const match of body.matchAll(TAVILY_DATE)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (value.length > 0) values.add(value);
  }
  return values.size === 1 ? [...values][0]! : null;
}

/**
 * The single library paper a record matches: ambiguous when several do and none can be trusted, and
 * a conflict when the one matched by URL states a different title than the record returned. Sharing
 * a URL is not proof of being the same work, so a disagreement enriches nothing.
 */
function matchLibraryPaper(
  papers: WorkflowResearchPaper[], url: string | null, title: string | null,
): { paper: WorkflowResearchPaper | null; ambiguous: boolean; conflict: boolean } {
  const unique = (predicate: (paper: WorkflowResearchPaper) => boolean) => {
    const hits = papers.filter((paper) => paper !== null && typeof paper === "object" && predicate(paper));
    return { paper: hits.length === 1 ? hits[0]! : null, ambiguous: hits.length > 1, conflict: false };
  };
  if (url !== null) {
    const byUrl = unique((paper) => publicUrl(paper.url) === url);
    const matchedTitle = byUrl.paper === null ? null : trimmed(byUrl.paper.title)?.toLowerCase() ?? null;
    if (title !== null && matchedTitle !== null && matchedTitle !== title.toLowerCase()) {
      return { paper: null, ambiguous: false, conflict: true };
    }
    if (byUrl.paper !== null || byUrl.ambiguous) return byUrl;
  }
  if (title !== null) {
    const key = title.toLowerCase();
    return unique((paper) => trimmed(paper.title)?.toLowerCase() === key);
  }
  return { paper: null, ambiguous: false, conflict: false };
}

function librarySegmentOf(record: WorkflowResearchSourceRecord): LibrarySegment | undefined {
  const segment = record.librarySegment;
  if (!segment || segment.requested !== 1) return undefined;
  return { requested: 1, hasMore: typeof segment.hasMore === "boolean" ? segment.hasMore : null };
}

function sameSegment(stored: LibrarySegment | undefined, incoming: LibrarySegment | undefined): boolean {
  if (stored === undefined || incoming === undefined) return stored === incoming;
  return stored.hasMore === incoming.hasMore;
}

/**
 * Admits the bodies a retrieval adapter actually returned and returns the ids that may be cited,
 * without duplicates. This is inspected evidence, not verification: a row records what the backend
 * returned, never that the source was checked against the outside world. Only an `ok` record with
 * non-blank text is admitted; every other status, an empty body and an unknown backend are reported
 * generically and admit nothing. The body, its UTF-8 hash, its truncation flag and its library
 * segment are stored exactly as observed, so metadata is `observed` whenever the record or a matched
 * library paper carried any. Titles and URLs come from what the record returned — never from the
 * request — and a URL that is not public and credential-free is omitted. A record is enriched with
 * library metadata only when it matches exactly one local paper, by returned URL first and otherwise
 * by the returned title; several matches are ambiguous and enrich nothing, and a paper that shares a
 * URL while stating a different title is a conflict that enriches nothing either. The publication
 * window comes from that matched paper, and for an external result otherwise from the single complete
 * date value the body itself states. Any retrieved result whose window is unknown or after the cutoff
 * is still retained as a snapshot but is not returned as citable, a library one included: an
 * unresolved date is not evidence that a source predates the cutoff.
 * Equal identity and body reuse the existing id; a different body or segment is stored as a further
 * snapshot and never overwrites the one already there. Identity prefers a DOI, then a URL, and
 * otherwise combines origin, returned title and body hash, so a shared title alone never merges
 * two different bodies.
 */
export function admitResearchSources(state: SourceLedger, evidence: WorkflowResearchEvidence): string[] {
  const admitted: string[] = [];
  const papers = Array.isArray(evidence?.localPapers) ? evidence.localPapers : [];
  for (const record of Array.isArray(evidence?.sourceRecords) ? evidence.sourceRecords : []) {
    const usable = record !== null && typeof record === "object" && record.status === "ok";
    const body = usable && typeof record.content === "string" ? record.content : "";
    if (!usable || body.trim().length === 0) {
      note(state, "research_source_not_admitted", "A retrieval record carried no usable content and was not admitted.");
      continue;
    }
    const sourceId = admitOneRecord(state, record, body, papers);
    if (sourceId !== null && !admitted.includes(sourceId)) admitted.push(sourceId);
  }
  return admitted;
}

/** Stores or reuses one snapshot and returns its id when the source may be cited. */
function admitOneRecord(
  state: SourceLedger, record: WorkflowResearchSourceRecord, body: string,
  papers: WorkflowResearchPaper[],
): string | null {
  const origin: SourceOrigin | null = record.backend === "brainpilot-library" ? "brainpilot-library"
    : record.backend === "tavily" ? "tavily" : null;
  if (origin === null) {
    note(state, "research_source_not_admitted", "A retrieval record named no known retrieval backend and was not admitted.");
    return null;
  }
  const returnedTitle = trimmed(record.title);
  const returnedUrl = publicUrl(record.returnedUrl);
  if (returnedUrl === null && trimmed(record.returnedUrl) !== null) {
    note(state, "research_source_url_omitted", "A retrieval record returned a URL that is not a public credential-free http(s) URL; it was omitted.");
  }
  const match = matchLibraryPaper(papers, returnedUrl, returnedTitle);
  if (match.ambiguous) {
    note(state, "research_source_metadata_ambiguous", "A retrieval record matched more than one library paper, so no library metadata was used for it.");
  }
  if (match.conflict) {
    note(state, "research_source_metadata_conflict", "A retrieval record and a library paper share a URL but state different titles, so they are not treated as the same work: no library authors, DOI or date were used and the missing metadata stays unknown.");
  }
  const paper = match.paper;
  const doi = validDoi(paper?.doi);
  if (doi === null && paper?.doi !== undefined) {
    note(state, "research_source_identifier_omitted", "A matched library paper carried a DOI that is not a bare DOI; it was omitted.");
  }
  const window = paper !== null
    ? publicationWindow(paper.publicationDate, paper.year, state.cutoffDate)
    : publicationWindow(origin === "tavily" ? tavilyPublicationValue(body) : null, undefined, state.cutoffDate);
  const title = returnedTitle ?? trimmed(paper?.title);
  const url = returnedUrl ?? publicUrl(paper?.url);
  const authors = (paper !== null && Array.isArray(paper.authors) ? paper.authors : [])
    .map(trimmed).filter((author): author is string => author !== null);
  const contentHash = sha256Utf8(body);
  const identityKey = doi !== null ? `doi:${doi}`
    : url !== null ? `url:${url}` : `${origin}:${title ?? ""}:${contentHash}`;
  const segment = librarySegmentOf(record);
  const stored = state.sources.find((candidate) => candidate.identityKey === identityKey
    && candidate.contentHash === contentHash && sameSegment(candidate.librarySegment, segment));
  const source = stored ?? appendResearchSource(state, {
    ...window, sourceId: `s${state.sources.length + 1}`, identityKey, origin, title, authors, doi, url,
    metadataOrigin: title !== null || url !== null || doi !== null || authors.length > 0 ? "observed" : "unknown",
    canonicalText: body, contentHash,
    contentTruncated: typeof record.contentTruncated === "boolean" ? record.contentTruncated : null,
    providedPath: null, expectedSha256: null, metadataOnly: false, bytes: byteLengthUtf8(body),
    provenanceNote: null,
  }, segment);
  // Every retrieved source keeps its snapshot, but only a window at or before the cutoff is citable:
  // an unresolved date is an open question, never evidence that the source predates the cutoff.
  if (source.cutoffStatus === "eligible") return source.sourceId;
  if (source.cutoffStatus === "unknown") {
    note(state, "research_source_date_unknown", "A retrieved source was stored with an unknown publication date; its cutoff status stays unknown.", source.sourceId);
  }
  note(state, "research_source_not_citable", "A retrieved source is retained as a snapshot but is not citable: its publication window is unknown or after the evidence cutoff.", source.sourceId);
  return null;
}

function appendResearchSource(
  state: SourceLedger, source: LedgerSource, segment: LibrarySegment | undefined,
): LedgerSource {
  if (segment !== undefined) source.librarySegment = segment;
  state.sources.push(source);
  return source;
}

