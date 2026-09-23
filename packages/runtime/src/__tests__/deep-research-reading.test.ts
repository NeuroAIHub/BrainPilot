import { describe, expect, it } from "vitest";
import { isSpanInsideWindows, selectReadWindows } from "../workflows/deep-research-reading.js";

/**
 * Every paragraph below is exactly PARA characters of generic filler, so each one becomes its own
 * candidate window (two paragraphs together exceed the merge ceiling) and window offsets are simple
 * arithmetic. The prose is synthetic on purpose: no test may hand the selector the words that would
 * answer a real question for it.
 */
const PARA = 1_500;
/** First offset of the nth paragraph of a body joined by blank lines. */
const at = (index: number): number => index * (PARA + 2);

const para = (seed: string): string => {
  let out = seed;
  while (out.length < PARA) out += " the passage continues with ordinary neutral wording of no fixed topic";
  // A trailing space would be trimmed away by piece selection and shift every offset below.
  return `${out.slice(0, PARA - 1)}x`;
};
const bodyOf = (...seeds: string[]): string => seeds.map(para).join("\n\n");
const generic = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `Part ${i} reviews measurement practice.`);

/** The last window a selection delivered, without relying on Array.prototype.at. */
const last = (windows: ReturnType<typeof selectReadWindows>) => windows[windows.length - 1]!;

/** The invariant that makes a delivered window traceable: it is an exact slice of the body given. */
const expectExactSlices = (body: string, windows: ReturnType<typeof selectReadWindows>): void => {
  for (const window of windows) {
    expect(window.end).toBeGreaterThan(window.start);
    expect(window.text).toBe(body.slice(window.start, window.end));
  }
};

describe("selectReadWindows", () => {
  it("delivers a short body whole as one exact window", () => {
    const body = "A single short paragraph that already fits inside the budget.";
    expect(selectReadWindows(body, "budget", [], 5_000)).toEqual([{ start: 0, end: body.length, text: body }]);
  });

  it("keeps a long body inside the budget in ordered non-overlapping deterministic windows", () => {
    const body = bodyOf(...generic(6));
    const windows = selectReadWindows(body, "measurement practice", ["neutral wording"], 4_000);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows.reduce((sum, window) => sum + window.text.length, 0)).toBeLessThanOrEqual(4_000);
    for (let i = 1; i < windows.length; i++) expect(windows[i]!.start).toBeGreaterThanOrEqual(windows[i - 1]!.end);
    expectExactSlices(body, windows);
    expect(selectReadWindows(body, "measurement practice", ["neutral wording"], 4_000)).toEqual(windows);
  });

  it("spends a single-window budget on the paragraph the query terms appear in", () => {
    const body = bodyOf("Part 0 reviews measurement practice.", "Part 1 restates the method.",
      "The quaternary calibration drift was tabulated here.", "Part 3 lists apparatus.", "Part 4 closes.");
    const windows = selectReadWindows(body, "quaternary calibration drift", [], PARA);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start).toBe(at(2));
    expect(windows[0]!.text).toContain("quaternary calibration drift");
    expectExactSlices(body, windows);
  });

  it("prefers an abstract over the window with the most term overlap", () => {
    const body = bodyOf("The thermal expansion coefficient dominates this opening paragraph.",
      "Part 1 restates the method.", "## Abstract\nA short synthetic summary of the work follows.",
      "Part 3 lists apparatus.");
    const windows = selectReadWindows(body, "thermal expansion coefficient", [], PARA);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.start).toBe(at(2));
    expect(windows[0]!.text.startsWith("## Abstract\n")).toBe(true);
    expect(windows[0]!.text).not.toContain("thermal");
  });

  it("stops at a References heading but keeps an ordinary sentence that opens with the word", () => {
    const seeds = generic(6);
    seeds[4] = "References to prior work in adjacent fields were sparse.";
    const body = `${bodyOf(...seeds)}\n\n## References\nSmith A. A placeholder entry. BACKMATTERONLY sentinel.`;
    const budget = 6 * PARA;
    expect(body.length).toBeGreaterThan(budget);
    const windows = selectReadWindows(body, "", [], budget);
    const delivered = windows.map((window) => window.text).join("\n");
    expect(delivered).toContain("References to prior work in adjacent fields were sparse.");
    expect(delivered).not.toContain("BACKMATTERONLY");
    expect(last(windows).end).toBeLessThanOrEqual(body.indexOf("## References"));
    expectExactSlices(body, windows);
  });

  it("falls back to reading across the document when no query term matches", () => {
    const body = bodyOf(...generic(6));
    const windows = selectReadWindows(body, "", [], 2 * PARA);
    expect(windows.map((window) => window.start)).toEqual([at(0), at(5)]);
    expectExactSlices(body, windows);
  });

  it("cuts on exact UTF-16 offsets without splitting a surrogate pair", () => {
    const body = `A${"\u{1F600}".repeat(2_000)}`;
    const windows = selectReadWindows(body, "", [], 4_000);
    expect(windows.length).toBeGreaterThan(0);
    // The 1800-char cut lands on a trailing surrogate here, so the window must extend by one unit.
    expect(windows[0]!.end).toBe(1_801);
    expectExactSlices(body, windows);
    for (const { text } of windows) {
      expect(text.charCodeAt(0) & 0xfc00).not.toBe(0xdc00);
      expect(text.charCodeAt(text.length - 1) & 0xfc00).not.toBe(0xd800);
    }
  });

  it("returns nothing for an empty body or an unusable budget", () => {
    const body = bodyOf(...generic(4));
    expect(selectReadWindows("", "topic", [], 1_000)).toEqual([]);
    for (const budget of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(selectReadWindows(body, "topic", [], budget)).toEqual([]);
    }
  });

  it("does not truncate selection at a long digit-leading line that is not a heading", () => {
    const seeds = generic(4);
    seeds[2] = "1234567890 1234567890 1234567890 references and tables appear later in TAILWARD order.";
    seeds[3] = "Part 3 closes with TAILMARKER at the end of the body.";
    const body = bodyOf(...seeds);
    const windows = selectReadWindows(body, "", [], 4 * PARA);
    expect(last(windows).end).toBe(body.length);
    expect(windows.map((window) => window.text).join("\n")).toContain("TAILMARKER");
    expectExactSlices(body, windows);
  });
});

describe("isSpanInsideWindows", () => {
  const body = "0123456789abcdefghij0123456789";
  const windows = [{ start: 0, end: 10, text: body.slice(0, 10) }, { start: 20, end: 30, text: body.slice(20, 30) }];

  it("accepts only spans lying wholly inside one delivered window", () => {
    expect(isSpanInsideWindows(windows, 0, 10)).toBe(true);
    expect(isSpanInsideWindows(windows, 2, 8)).toBe(true);
    expect(isSpanInsideWindows(windows, 20, 30)).toBe(true);
    expect(isSpanInsideWindows(windows, 12, 18)).toBe(false);
    expect(isSpanInsideWindows(windows, 25, 35)).toBe(false);
    expect(isSpanInsideWindows(windows, 5, 25)).toBe(false);
    expect(isSpanInsideWindows([], 0, 5)).toBe(false);
    expect(isSpanInsideWindows(undefined, 0, 5)).toBe(false);
  });

  it("rejects a span that is not a real forward range of characters", () => {
    for (const [start, end] of [[5, 5], [8, 3], [-1, 5], [0.5, 5], [0, Number.POSITIVE_INFINITY],
      [Number.NaN, 5]] as Array<[number, number]>) {
      expect(isSpanInsideWindows(windows, start, end)).toBe(false);
    }
  });
});
