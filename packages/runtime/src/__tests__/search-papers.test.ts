import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  normalizeTitle,
  searchPapers,
  type FullPaperResult,
  type MetaResult,
  type PaperMetadata,
} from "../tools/kb/search-papers.js";
import { createSearchPapersLocalTool } from "../tools/kb/tools.js";

const roots: string[] = [];

afterEach(async () => {
  delete process.env.BP_KB_ROOT;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function makeKb(
  papers: Array<PaperMetadata & {
    mmd_content?: string;
    mmd_missing?: boolean;
    mmd_unreadable?: boolean;
  }>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "brainpilot-paper-search-"));
  roots.push(root);
  const source = join(root, "source");
  const mmdDir = join(source, "mmd");
  await mkdir(mmdDir, { recursive: true });

  const stored = [];
  for (const [index, paper] of papers.entries()) {
    const path = join(mmdDir, `paper-${index}.mmd`);
    if (paper.mmd_unreadable) await mkdir(path);
    else if (!paper.mmd_missing) await writeFile(path, paper.mmd_content ?? "", "utf8");
    const {
      mmd_content: _content,
      mmd_missing: _missing,
      mmd_unreadable: _unreadable,
      ...metadata
    } = paper;
    stored.push({ ...metadata, mmd_path: path });
  }
  await writeFile(join(source, "KB_source.json"), JSON.stringify({ papers: stored }), "utf8");
  return root;
}

const eegnet: PaperMetadata & { mmd_content: string } = {
  title: "EEGNet: A Compact Convolutional Neural Network for EEG-based BCIs",
  authors: ["Vernon J. Lawhern"],
  journal: "Journal of Neural Engineering",
  published_date: "2018-10-12",
  abstract: "EEGNet uses depthwise and separable convolutions for EEG classification.",
  mmd_content: "Full EEGNet paper body with architecture and evaluation details.",
};

describe("searchPapers", () => {
  it("returns a structured no_match result instead of unrelated zero-hit papers", async () => {
    const root = await makeKb([
      eegnet,
      {
        title: "A Recent Epilepsy Brain-Age Study",
        published_date: "2026-01-01",
        abstract: "Brain age estimation in epilepsy.",
      },
    ]);

    const response = await searchPapers({
      kbRoot: root,
      keywords: "nonexistent motor imagery transformer",
    });

    expect(response).toEqual(expect.objectContaining({
      status: "no_match",
      results: [],
      corpus_size: 2,
      matched_count: 0,
    }));
  });

  it("matches normalized exact titles and contiguous title phrases", async () => {
    const root = await makeKb([eegnet]);

    expect(normalizeTitle(" EEGNet—A  Compact: Network! ")).toBe("eegnet a compact network");
    const exact = await searchPapers({
      kbRoot: root,
      title: "eegnet — a compact convolutional neural network for eeg based bcis",
    });
    const phrase = await searchPapers({
      kbRoot: root,
      title: "compact convolutional neural network",
    });

    expect(exact.status).toBe("ok");
    expect((exact.results[0] as MetaResult).title_match).toBe("exact");
    expect(phrase.status).toBe("ok");
    expect((phrase.results[0] as MetaResult).title_match).toBe("phrase");
  });

  it("preserves semantic symbols and matches phrases only at token boundaries", async () => {
    const root = await makeKb([{
      title: "C++ Methods for Scientific Computing",
      abstract: "Modern C++ implementation techniques.",
    }]);

    expect(normalizeTitle("C++ Methods")).toBe("c++ methods");
    expect((await searchPapers({ kbRoot: root, title: "C++ Methods" })).status).toBe("ok");
    expect((await searchPapers({ kbRoot: root, title: "C" })).status).toBe("not_in_corpus");
  });

  it("ranks an exact title before phrase matches even without keywords", async () => {
    const root = await makeKb([
      { title: "EEGNet Extended Analysis", published_date: "2026-01-01" },
      { title: "EEGNet", published_date: "2018-01-01" },
    ]);

    const response = await searchPapers({ kbRoot: root, title: "EEGNet" });

    expect((response.results[0] as MetaResult).title).toBe("EEGNet");
    expect((response.results[0] as MetaResult).title_match).toBe("exact");
  });

  it("keeps metadata search cheap while preserving full-text recall in full-paper mode", async () => {
    const root = await makeKb([{
      title: "Generic EEG Methods",
      abstract: "A general methods overview.",
      mmd_content: "The body alone mentions hidden-body-keyword and its validation.",
    }]);

    const metadata = await searchPapers({
      kbRoot: root,
      mode: "meta-data",
      keywords: "hidden-body-keyword",
    });
    const fullPaper = await searchPapers({
      kbRoot: root,
      mode: "full-paper",
      keywords: "hidden-body-keyword",
    });

    expect(metadata.status).toBe("no_match");
    expect(fullPaper.status).toBe("ok");
    expect(fullPaper.results[0]).toEqual(expect.objectContaining({
      mmd_content: expect.stringContaining("hidden-body-keyword"),
    }));
  });

  it("uses keywords as ranking evidence rather than overriding explicit metadata filters", async () => {
    const root = await makeKb([eegnet]);

    const response = await searchPapers({
      kbRoot: root,
      title: "EEGNet",
      keywords: "term-not-present",
    });

    expect(response.status).toBe("ok");
    expect((response.results[0] as MetaResult).keyword_hits).toBe(0);
  });

  it("rejects invalid mode, result limits, and segment numbers consistently", async () => {
    const root = await makeKb([eegnet]);

    for (const args of [
      { kbRoot: root, keywords: "EEGNet", mode: "invalid" as "meta-data" },
      { kbRoot: root, keywords: "EEGNet", topk: 21 },
      { kbRoot: root, keywords: "EEGNet", segment: 0 },
    ]) {
      await expect(searchPapers(args)).resolves.toEqual(expect.objectContaining({
        status: "invalid_query",
        results: [],
      }));
    }
  });

  it("requires a meaningful criterion and a valid publication year", async () => {
    const root = await makeKb([eegnet]);

    for (const args of [
      { kbRoot: root },
      { kbRoot: root, title: "   " },
      { kbRoot: root, journal: "   " },
      { kbRoot: root, published_year: 20 },
    ]) {
      const response = await searchPapers(args);
      expect(response.status).toBe("invalid_query");
    }
  });

  it("reports missing and unreadable full-text artifacts without losing metadata", async () => {
    const root = await makeKb([
      {
        title: "Metadata-Only Paper",
        abstract: "A discoverable abstract.",
        mmd_missing: true,
      },
      {
        title: "Unreadable Full Text",
        abstract: "Another discoverable abstract.",
        mmd_unreadable: true,
      },
    ]);

    const response = await searchPapers({
      kbRoot: root,
      mode: "full-paper",
      title: "Metadata-Only Paper",
    });
    const result = response.results[0] as FullPaperResult;

    expect(response.status).toBe("ok");
    expect(result.metadata.title).toBe("Metadata-Only Paper");
    expect(result.full_text_status).toBe("missing");
    expect(result.mmd_content).toBe("");
    expect(result.segment_info).toEqual(expect.objectContaining({ available: false }));

    const unreadable = await searchPapers({
      kbRoot: root,
      mode: "full-paper",
      title: "Unreadable Full Text",
    });
    expect((unreadable.results[0] as FullPaperResult).full_text_status).toBe("unreadable");
  });

  it("reports an unavailable requested page instead of repeating the last page", async () => {
    const root = await makeKb([eegnet]);

    const response = await searchPapers({
      kbRoot: root,
      mode: "full-paper",
      title: "EEGNet",
      segment: 2,
    });
    const result = response.results[0] as FullPaperResult;

    expect(result.full_text_status).toBe("available");
    expect(result.mmd_content).toBe("");
    expect(result.segment_info).toEqual(expect.objectContaining({
      segment: 2,
      total_segments: 1,
      available: false,
      has_more: false,
    }));
  });
});

describe("search_papers_local tool", () => {
  it("keeps query errors recoverable and marks only infrastructure failures as tool errors", async () => {
    const root = await makeKb([eegnet]);
    process.env.BP_KB_ROOT = root;
    const tool = createSearchPapersLocalTool();

    const invalid = await tool.execute({ mode: "invalid", keywords: "EEGNet" });
    expect(invalid.isError).not.toBe(true);
    expect(JSON.parse(invalid.content[0]!.text)).toEqual(expect.objectContaining({
      status: "invalid_query",
      results: [],
    }));

    const missingRoot = await mkdtemp(join(tmpdir(), "brainpilot-paper-search-missing-"));
    roots.push(missingRoot);
    process.env.BP_KB_ROOT = missingRoot;
    const infrastructure = await tool.execute({ keywords: "EEGNet" });
    expect(infrastructure.isError).toBe(true);
    expect(JSON.parse(infrastructure.content[0]!.text)).toEqual(expect.objectContaining({
      status: "infrastructure_error",
      results: [],
    }));
  });
});
