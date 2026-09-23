/*
 * Bounded, traceable source reading for the deep-research workflow. An evidence stage is handed exact
 * character windows of a source body, never a whole long body, so one paper cannot swamp a stage, and
 * the windows a branch actually received are what its quotes are later checked against. Everything
 * here is pure: no file, no network, no index, no embedding, no dependency beyond the standard
 * library, and no term list that could answer the question on the stage's behalf. Offsets are
 * JavaScript UTF-16 indices into the body that was passed in, so `body.slice(start, end) === text`
 * holds for every window returned and the canonical body is never rewritten or normalized.
 */

/** One delivered excerpt: the exact `body.slice(start, end)` a stage was shown. */
export interface ReadWindow { start: number; end: number; text: string }

/** A window aims for this range; the material, not a target, decides the last one's size. */
const MIN_WINDOW_CHARS = 1_800;
const MAX_WINDOW_CHARS = 2_400;
const MIN_TERM_CHARS = 3;

/**
 * Generic function words only. A list naming the topic under investigation would decide the answer
 * here instead of letting the evidence stage read for it, so nothing paper- or task-specific belongs
 * in this set.
 */
const STOPWORDS = new Set(("a an and are as at be been but by can could did do does for from had has have how if in "
  + "into is it its may might must no not of on or over per she that the their them then there these they this those "
  + "to under upon was were what when where which while who whom why will with within without would you your we our he "
  + "his her him they them one two both each any all more most such same only also very")
  .split(" "));

/** A run of letters or digits. A script written without spaces matches as one run, not per glyph. */
const WORD = /[\p{L}\p{N}]+/gu;
const PARAGRAPH_BREAK = /\n[ \t]*\n/gu;
/** Generic headings only, in the shapes Markdown, numbered and bold prose actually write them. */
const HEADING = "^[ \\t]*(?:#{1,6}[ \\t]*)?(?:\\*\\*|__)?(?:\\d+(?:\\.\\d+)*[.)]?[ \\t]+)?";
/**
 * A heading occupies its whole line: only closing emphasis and a trailing colon or period may
 * follow its words. Without this, an ordinary sentence that merely opens with the word — "References
 * to previous studies were sparse." — would be read as the start of the reference list and silently
 * truncate source selection at a paragraph that may itself answer the question.
 */
const HEADING_END = "[ \\t]*(?:\\*\\*|__)?[ \\t]*[:.]?[ \\t]*$";
const ABSTRACT_HEADING = new RegExp(`${HEADING}(?:abstract\\b|摘要)`, "imu");
const BACKMATTER_HEADING = new RegExp(
  `${HEADING}(?:references|bibliography|works cited|literature cited|参考文献)${HEADING_END}`, "gimu");

const words = (text: string): string[] => text.normalize("NFKC").toLowerCase().match(WORD) ?? [];

/** The distinct query and facet terms a window is scored against; blank input scores nothing. */
function selectionTerms(query: unknown, facets: unknown): Set<string> {
  const parts = [typeof query === "string" ? query : "", ...(Array.isArray(facets) ? facets : [])
    .map((facet) => (typeof facet === "string" ? facet : ""))];
  const terms = new Set<string>();
  for (const term of words(parts.join(" "))) {
    if (term.length >= MIN_TERM_CHARS && !STOPWORDS.has(term)) terms.add(term);
  }
  return terms;
}

/**
 * Where the selectable part of a body ends: at a recognized References or Bibliography heading in the
 * document's second half. Back matter is dense with title words and would otherwise outscore the
 * prose that answers the question; a heading in the first half is left alone because it is more
 * likely a mention than the start of the reference list. Only the selection narrows — the canonical
 * body is untouched and every offset returned stays absolute in it.
 */
function readableEnd(body: string): number {
  const half = Math.floor(body.length / 2);
  for (const match of body.matchAll(BACKMATTER_HEADING)) {
    if (match.index !== undefined && match.index >= half) return match.index;
  }
  return body.length;
}

/** Paragraph pieces of at most MIN_WINDOW_CHARS in document order, each trimmed to real text. */
function pieces(body: string, limit: number): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const push = (from: number, until: number): void => {
    let start = from;
    let end = until;
    while (start < end && /\s/u.test(body[start]!)) start++;
    while (end > start && /\s/u.test(body[end - 1]!)) end--;
    let at = start;
    while (at < end) {
      let stop = Math.min(end, at + MIN_WINDOW_CHARS);
      // Never cut a surrogate pair: a window's text must be the exact slice of the body, and half a
      // pair is not the character the body contains.
      if (stop < end && (body.charCodeAt(stop) & 0xfc00) === 0xdc00) stop++;
      out.push({ start: at, end: stop });
      at = stop;
    }
  };
  let cursor = 0;
  for (const match of body.slice(0, limit).matchAll(PARAGRAPH_BREAK)) {
    push(cursor, match.index!);
    cursor = match.index! + match[0].length;
  }
  push(cursor, limit);
  return out;
}

/** Contiguous non-overlapping candidate windows, each an exact slice of the body. */
function candidateWindows(body: string, limit: number): ReadWindow[] {
  const windows: ReadWindow[] = [];
  let open: { start: number; end: number } | null = null;
  const close = (): void => {
    if (open !== null) windows.push({ start: open.start, end: open.end, text: body.slice(open.start, open.end) });
  };
  for (const piece of pieces(body, limit)) {
    if (open !== null && piece.end - open.start <= MAX_WINDOW_CHARS) { open.end = piece.end; continue; }
    close();
    open = { start: piece.start, end: piece.end };
  }
  close();
  return windows;
}

interface ScoredWindow { window: ReadWindow; index: number; score: number; hits: number }

/** Distinct terms a window matches, with total occurrences as the tie-breaker below it. */
function scoreWindow(window: ReadWindow, terms: Set<string>): { score: number; hits: number } {
  const matched = new Set<string>();
  let hits = 0;
  for (const word of words(window.text)) {
    if (!terms.has(word)) continue;
    matched.add(word);
    hits++;
  }
  return { score: matched.size, hits };
}

/** The candidate holding the first generic Abstract heading, when the body carries one. */
function abstractIndex(body: string, limit: number, pool: ReadWindow[]): number | null {
  const at = ABSTRACT_HEADING.exec(body.slice(0, limit))?.index;
  if (at === undefined) return null;
  const found = pool.findIndex((window) => at >= window.start && at < window.end);
  return found === -1 ? null : found;
}

/**
 * Windows of `body` to hand a stage, in document order, together holding at most `maxChars`
 * characters. A body that already fits is delivered whole. A longer one is cut into deterministic
 * paragraph windows, and the budget goes first to any abstract, then to the windows with the most
 * query and facet word overlap, and finally to whichever remaining windows sit furthest from what is
 * already selected — which is the whole selection when no term matched anything, so an unmatched
 * query still reads across the document instead of reading nothing. Selection is a function of its
 * arguments alone: equal inputs give equal windows, and every tie resolves in document order.
 */
export function selectReadWindows(
  body: string, query: string, facets: string[], maxChars: number,
): ReadWindow[] {
  if (typeof body !== "string" || body.length === 0) return [];
  if (!Number.isFinite(maxChars) || maxChars < 1) return [];
  if (body.length <= maxChars) return [{ start: 0, end: body.length, text: body }];
  const limit = readableEnd(body);
  const pool = candidateWindows(body, limit > 0 ? limit : body.length);
  const terms = selectionTerms(query, facets);
  const scored: ScoredWindow[] = pool.map((window, index) => ({ window, index, ...scoreWindow(window, terms) }));
  const taken = new Set<number>();
  let used = 0;
  const take = (entry: ScoredWindow | undefined): boolean => {
    if (entry === undefined || taken.has(entry.index)) return false;
    if (used + entry.window.text.length > maxChars) return false;
    taken.add(entry.index);
    used += entry.window.text.length;
    return true;
  };
  const abstractAt = abstractIndex(body, limit > 0 ? limit : body.length, pool);
  if (abstractAt !== null) take(scored[abstractAt]);
  for (const entry of scored.filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.hits - left.hits || left.index - right.index)) {
    take(entry);
  }
  fillByDispersion(scored, taken, take);
  return scored.filter((entry) => taken.has(entry.index)).map((entry) => entry.window);
}

/** Spends what is left of the budget on the unselected window furthest from every selected one. */
function fillByDispersion(
  scored: ScoredWindow[], taken: Set<number>, take: (entry: ScoredWindow) => boolean,
): void {
  const unusable = new Set<number>();
  for (;;) {
    let best: ScoredWindow | null = null;
    let bestDistance = -1;
    for (const entry of scored) {
      if (taken.has(entry.index) || unusable.has(entry.index)) continue;
      const distance = taken.size === 0
        ? scored.length - entry.index
        : Math.min(...[...taken].map((index) => Math.abs(index - entry.index)));
      if (distance > bestDistance) { best = entry; bestDistance = distance; }
    }
    if (best === null) return;
    // A window too large for the remaining budget is set aside, never silently trimmed.
    if (!take(best)) unusable.add(best.index);
  }
}

/**
 * Whether a located quote span lies wholly inside one window a branch was actually handed. A span
 * straddling two delivered windows was never readable as a single passage, and a source whose body
 * sits in the ledger but was never delivered has no window here at all, so it cannot support a quote:
 * a body existing on disk is not evidence that the stage inspected it. A span that is not a real
 * forward range of characters — fractional, negative, empty, reversed or non-finite — describes no
 * readable passage and is rejected before any window is consulted.
 */
export function isSpanInsideWindows(
  windows: readonly ReadWindow[] | undefined, start: number, end: number,
): boolean {
  if (!Array.isArray(windows)) return false;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return false;
  if (start < 0 || end <= start) return false;
  return windows.some((window) => start >= window.start && end <= window.end);
}
