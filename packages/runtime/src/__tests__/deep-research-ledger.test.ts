import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  admitProvidedSources, admitResearchSources, catalogProvidedSources, createSourceLedger, publicationWindow,
} from "../workflows/deep-research-ledger.js";
import type { CutoffStatus, SourceLedger } from "../workflows/deep-research-ledger.js";
import type {
  WorkflowResearchEvidence, WorkflowResearchPaper, WorkflowResearchSourceRecord,
} from "../workflows/research-tools.js";

/** Every assertion reads the window the module returns, so a status is checked by name. */
const status = (publicationDate: unknown, year: unknown, cutoffDate: string): CutoffStatus =>
  publicationWindow(publicationDate, year, cutoffDate).cutoffStatus;

const codes = (ledger: SourceLedger) => ledger.diagnostics.map((entry) => entry.code);
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const record = (overrides: Partial<WorkflowResearchSourceRecord> = {}): WorkflowResearchSourceRecord => ({
  backend: "tavily", status: "ok", requestedUrl: null, returnedUrl: null, content: "a retrieved body",
  receivedChars: 16, retainedChars: 16, contentTruncated: false, ...overrides,
});
const paper = (overrides: Partial<WorkflowResearchPaper> = {}): WorkflowResearchPaper => ({
  title: "Sleep and memory", authors: ["Ada Lovelace"], source: "brainpilot-library", ...overrides,
});
const evidence = (
  sourceRecords: WorkflowResearchSourceRecord[], localPapers: WorkflowResearchPaper[] = [],
): WorkflowResearchEvidence => ({
  sourceAvailability: { library: true, tavilySearch: true, tavilyExtract: true },
  localPapers, webResults: [], pages: [], sourceRecords,
  extractRequestedUrls: [], issues: [], retrievedAt: "2025-01-01T00:00:00Z",
});

describe("publicationWindow cutoff boundary", () => {
  it("marks a day exactly on the cutoff eligible and the next day after_cutoff", () => {
    expect(status("2025-01-31", undefined, "2025-01-31")).toBe("eligible");
    expect(status("2025-02-01", undefined, "2025-01-31")).toBe("after_cutoff");
  });

  it("keeps a whole year before the cutoff eligible and one after it after_cutoff", () => {
    expect(status("2024", undefined, "2025-01-31")).toBe("eligible");
    expect(status("2026", undefined, "2025-01-31")).toBe("after_cutoff");
  });

  it("treats a year straddling the cutoff as unknown, not eligible", () => {
    expect(status("2025", undefined, "2025-06-30")).toBe("unknown");
  });

  it("treats a month fully before the cutoff as eligible, one ending on it as eligible, and a straddling month as unknown", () => {
    expect(status("2024-12", undefined, "2025-01-31")).toBe("eligible");
    expect(status("2025-01", undefined, "2025-01-15")).toBe("unknown");
    // A whole month is eligible on its last day: the interval ends exactly on the cutoff.
    expect(status("2025-01", undefined, "2025-01-31")).toBe("eligible");
    expect(status("2025-02", undefined, "2025-01-31")).toBe("after_cutoff");
  });
});

describe("publicationWindow leap-month windows", () => {
  it("spans February 2024 as a leap month, ending on the 29th", () => {
    const window = publicationWindow("2024-02", undefined, "2025-01-31");
    expect([window.earliest, window.latest]).toEqual(["2024-02-01", "2024-02-29"]);
  });

  it("spans February 2000 as a leap month and February 1900 and 2025 as 28 days", () => {
    expect(publicationWindow("2000-02", undefined, "2025-01-31").latest).toBe("2000-02-29");
    expect(publicationWindow("1900-02", undefined, "2025-01-31").latest).toBe("1900-02-28");
    expect(publicationWindow("2025-02", undefined, "2025-01-31").latest).toBe("2025-02-28");
  });
});

describe("publicationWindow rejects impossible explicit values", () => {
  it("returns unknown rather than throwing for an invalid day", () => {
    expect(status("2025-02-30", undefined, "2025-01-31")).toBe("unknown");
    expect(status("2025-04-31", undefined, "2025-01-31")).toBe("unknown");
  });

  it("returns unknown rather than throwing for an invalid month, including year 0000", () => {
    const month = publicationWindow("2025-13", undefined, "2025-01-31");
    expect(month).toMatchObject({ publicationPrecision: "unknown", earliest: null, latest: null });
    expect(() => publicationWindow("0000-02", undefined, "2025-01-31")).not.toThrow();
    expect(status("0000-02", undefined, "2025-01-31")).toBe("unknown");
  });

  it("returns unknown for year 0000 as a bare year", () => {
    expect(status("0000", undefined, "2025-01-31")).toBe("unknown");
  });
});

describe("publicationWindow explicit date versus fallback year", () => {
  it("keeps an invalid explicit date unknown even when the fallback year is valid", () => {
    const window = publicationWindow("not a date", 2020, "2025-01-31");
    expect(window).toMatchObject({ publicationPrecision: "unknown", cutoffStatus: "unknown", publicationDate: null });
    expect(window.earliest).toBeNull();
  });

  it("keeps a non-string explicit value unknown even when the fallback year is valid", () => {
    expect(status(42, 2020, "2025-01-31")).toBe("unknown");
  });

  it("uses the fallback year when the explicit date is missing, null or blank", () => {
    for (const missing of [undefined, null, "", "   "]) {
      const window = publicationWindow(missing, 2024, "2025-01-31");
      expect(window).toMatchObject({ publicationPrecision: "year", publicationDate: "2024", cutoffStatus: "eligible" });
    }
  });

  it("lets a valid explicit date override the fallback year", () => {
    const window = publicationWindow("2019-03-04", 2024, "2025-01-31");
    expect(window).toMatchObject({ publicationPrecision: "day", publicationDate: "2019-03-04", earliest: "2019-03-04" });
  });
});

describe("publicationWindow strict timestamps", () => {
  it("resolves the UTC day when an offset crosses the cutoff in both directions", () => {
    // Local time is already the day after the cutoff, but +02:00 lands it back on the 31st in UTC.
    expect(status("2025-02-01T00:30:00+02:00", undefined, "2025-01-31")).toBe("eligible");
    expect(status("2025-01-31T23:30:00-02:00", undefined, "2025-01-31")).toBe("after_cutoff");
  });

  it("rejects a timestamp whose calendar day is invalid or that is free-form text", () => {
    expect(status("2025-02-30T00:00:00Z", undefined, "2025-01-31")).toBe("unknown");
    expect(status("January 31, 2025", undefined, "2025-01-31")).toBe("unknown");
    expect(status("2025-01-31T12:00:00", undefined, "2025-01-31")).toBe("unknown");
  });

  it("rejects a UTC day that overflows outside the calendar year range", () => {
    expect(status("9999-12-31T23:59:59-14:00", undefined, "9999-12-31")).toBe("unknown");
    expect(status("0001-01-01T00:00:00+14:00", undefined, "9999-12-31")).toBe("unknown");
  });
});

describe("createSourceLedger", () => {
  it("rejects a malformed cutoff date", () => {
    expect(() => createSourceLedger("2025-02-30")).toThrow(TypeError);
    expect(() => createSourceLedger("0000-01-01")).toThrow(TypeError);
  });

  it("returns fresh empty arrays that do not share state across calls", () => {
    const first = createSourceLedger("2025-01-31");
    const second = createSourceLedger("2025-01-31");
    expect(first).toEqual({ cutoffDate: "2025-01-31", sources: [], diagnostics: [] });
    expect(first.sources).not.toBe(second.sources);
    first.sources.push({
      sourceId: "s1", identityKey: "k1", origin: "provided", title: null, authors: [], doi: null,
      url: null, metadataOrigin: "unknown", publicationDate: null, publicationPrecision: "unknown",
      earliest: null, latest: null, cutoffStatus: "unknown", canonicalText: null, contentHash: null,
      contentTruncated: null, providedPath: null, expectedSha256: null, metadataOnly: false,
      bytes: null, provenanceNote: null,
    });
    expect(second.sources).toEqual([]);
  });
});

describe("catalogProvidedSources", () => {
  it("gives a repeated path one identity, fills only a byte count it lacked, and stores no body", () => {
    const ledger = createSourceLedger("2025-01-31");
    const views = catalogProvidedSources(ledger, [
      { path: "notes.md", title: "Notes", authors: ["Ada Lovelace"], publicationDate: "2024-05-01" },
      { path: "notes.md", bytes: 120 },
    ]);
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ sourceId: "s1", bytes: 120, readable: true });
    expect(ledger.sources).toHaveLength(1);
    expect(ledger.sources[0]).toMatchObject({
      canonicalText: null, contentHash: null, contentTruncated: null, metadataOrigin: "provided",
    });
    expect(codes(ledger)).toContain("provided_source_duplicate");
  });

  it("catalogues neither a blank path nor a descriptor whose expected hash is malformed", () => {
    const ledger = createSourceLedger("2025-01-31");
    expect(catalogProvidedSources(ledger, [{ path: "   " }, { path: "a.md", expectedSha256: "abc" }])).toEqual([]);
    expect(ledger.sources).toEqual([]);
    expect(codes(ledger)).toEqual(["provided_source_skipped", "provided_source_skipped"]);
  });
});

describe("admitProvidedSources", () => {
  const body = "Sleep restriction reduced n-back accuracy by 8 points. — Δ";

  it("admits a body whose UTF-8 hash matches and reuses the id for an identical re-read", () => {
    const ledger = createSourceLedger("2025-01-31");
    const [view] = catalogProvidedSources(ledger, [{ path: "p.md", expectedSha256: sha256(body) }]);
    expect(admitProvidedSources(ledger, [
      { sourceId: view!.sourceId, text: body }, { sourceId: view!.sourceId, text: body },
    ])).toEqual(["s1"]);
    expect(ledger.sources[0]).toMatchObject({ canonicalText: body, contentHash: sha256(body), contentTruncated: false });
  });

  it("rejects a body that does not match the expected hash and leaves the source unread", () => {
    const ledger = createSourceLedger("2025-01-31");
    const [view] = catalogProvidedSources(ledger, [{ path: "p.md", expectedSha256: "0".repeat(64) }]);
    expect(admitProvidedSources(ledger, [{ sourceId: view!.sourceId, text: body }])).toEqual([]);
    expect(ledger.sources[0]!.canonicalText).toBeNull();
    expect(codes(ledger)).toContain("source_hash_mismatch");
  });

  it("keeps the stored text when a different body later arrives for the same source", () => {
    const ledger = createSourceLedger("2025-01-31");
    const [view] = catalogProvidedSources(ledger, [{ path: "p.md" }]);
    expect(admitProvidedSources(ledger, [{ sourceId: view!.sourceId, text: body }])).toEqual(["s1"]);
    expect(admitProvidedSources(ledger, [{ sourceId: view!.sourceId, text: `${body} revised` }])).toEqual([]);
    expect(ledger.sources[0]!.canonicalText).toBe(body);
    expect(codes(ledger)).toContain("source_changed");
  });

  it("admits background whose date is unknown and leaves it labelled unknown", () => {
    const ledger = createSourceLedger("2025-01-31");
    const [view] = catalogProvidedSources(ledger, [{ path: "background.md", title: "Background", authors: ["Ada Lovelace"] }]);
    expect(admitProvidedSources(ledger, [{ sourceId: view!.sourceId, text: body }])).toEqual(["s1"]);
    expect(ledger.sources[0]).toMatchObject({ cutoffStatus: "unknown", publicationDate: null });
    expect(codes(ledger)).toContain("source_date_unknown");
  });
});

describe("provided metadata that cannot back a body or an identifier", () => {
  it("marks a metadata-only source unreadable and refuses any body for it", () => {
    const ledger = createSourceLedger("2025-01-31");
    const [view] = catalogProvidedSources(ledger, [{
      path: "abstract.md", title: "Abstract", authors: ["Ada Lovelace"], publicationDate: "2024-05-01", metadataOnly: true,
    }]);
    expect(view).toMatchObject({ readable: false });
    expect(admitProvidedSources(ledger, [{ sourceId: view!.sourceId, text: "an abstract, not the full text" }])).toEqual([]);
    expect(codes(ledger)).toEqual(["provided_source_metadata_only", "source_body_rejected"]);
    expect(ledger.sources[0]!.canonicalText).toBeNull();
  });

  it("omits an identifier that is neither a bare DOI nor a public credential-free URL", () => {
    const ledger = createSourceLedger("2025-01-31");
    catalogProvidedSources(ledger, [{
      path: "x.md", title: "X", authors: ["Ada Lovelace"], publicationDate: "2024-05-01",
      doi: "doi:10.1/x", url: "http://localhost/x",
    }]);
    expect(ledger.sources[0]).toMatchObject({ doi: null, url: null });
    expect(codes(ledger)).toEqual(["provided_source_identifier_omitted"]);
  });
});

describe("admitResearchSources cutoff eligibility", () => {
  it("admits a library source matched by title alone, with no URL on either side", () => {
    const ledger = createSourceLedger("2025-01-31");
    const admitted = admitResearchSources(ledger, evidence([record({
      backend: "brainpilot-library", title: "Sleep and memory", content: "accuracy fell by 8 points",
      librarySegment: { requested: 1, hasMore: false },
    })], [paper({ publicationDate: "2024-05-01", doi: "10.1234/sleep" })]));
    expect(admitted).toEqual(["s1"]);
    expect(ledger.sources[0]).toMatchObject({
      url: null, doi: "10.1234/sleep", authors: ["Ada Lovelace"], cutoffStatus: "eligible",
      metadataOrigin: "observed", librarySegment: { requested: 1, hasMore: false },
    });
  });

  it("retains a library snapshot whose date is unknown or later, but never returns it as citable", () => {
    const ledger = createSourceLedger("2025-01-31");
    const admitted = admitResearchSources(ledger, evidence([
      record({ backend: "brainpilot-library", title: "Undated work", content: "first body" }),
      record({ backend: "brainpilot-library", title: "Later work", content: "second body" }),
    ], [paper({ title: "Undated work" }), paper({ title: "Later work", publicationDate: "2025-06-01" })]));
    expect(admitted).toEqual([]);
    expect(ledger.sources.map((source) => source.cutoffStatus)).toEqual(["unknown", "after_cutoff"]);
    expect(ledger.sources.map((source) => source.canonicalText)).toEqual(["first body", "second body"]);
    expect(codes(ledger)).toEqual([
      "research_source_date_unknown", "research_source_not_citable", "research_source_not_citable",
    ]);
  });
});

describe("admitResearchSources conflicting identities", () => {
  it("enriches nothing when a library paper shares the returned URL but states another title", () => {
    const ledger = createSourceLedger("2025-01-31");
    const admitted = admitResearchSources(ledger, evidence(
      [record({ title: "Returned title", returnedUrl: "https://example.org/a", content: "a retrieved body" })],
      [paper({
        title: "A different paper", url: "https://example.org/a", authors: ["Someone Else"],
        doi: "10.1234/other", publicationDate: "2024-01-01",
      })]));
    expect(admitted).toEqual([]);
    expect(ledger.sources[0]).toMatchObject({
      title: "Returned title", authors: [], doi: null, publicationDate: null, cutoffStatus: "unknown",
    });
    expect(codes(ledger)).toContain("research_source_metadata_conflict");
  });
});

describe("admitResearchSources dates an external body states", () => {
  const stating = (value: string) => `datePublished: "${value}"\naccuracy fell by 8 points`;

  it("reads a full strict timestamp and judges the day it really denotes", () => {
    const ledger = createSourceLedger("2025-01-31");
    expect(admitResearchSources(ledger, evidence([record({ content: stating("2025-01-31T23:30:00-02:00") })]))).toEqual([]);
    expect(ledger.sources[0]).toMatchObject({ publicationDate: "2025-02-01", cutoffStatus: "after_cutoff" });
  });

  it("never truncates a malformed value to the calendar day it starts with", () => {
    const ledger = createSourceLedger("2025-01-31");
    expect(admitResearchSources(ledger, evidence([record({ content: stating("2024-05-01T99:00:00Z") })]))).toEqual([]);
    expect(ledger.sources[0]).toMatchObject({ publicationDate: null, cutoffStatus: "unknown" });
  });

  it("reuses the id for an identical body and keeps a changed one as a separate snapshot", () => {
    const ledger = createSourceLedger("2025-01-31");
    const body = stating("2024-05-01");
    const first = record({ returnedUrl: "https://example.org/a", content: body });
    expect(admitResearchSources(ledger, evidence([first, { ...first }]))).toEqual(["s1"]);
    expect(admitResearchSources(ledger, evidence([{ ...first, content: `${body} revised` }]))).toEqual(["s2"]);
    expect(ledger.sources.map((source) => source.canonicalText)).toEqual([body, `${body} revised`]);
  });
});
