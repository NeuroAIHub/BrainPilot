import { afterEach, describe, expect, it, vi } from "vitest";
import type { SystemTool, SystemToolResult } from "../types.js";
import { createWorkflowResearchTools, type WorkflowResearchEvidence } from "../workflows/research-tools.js";

const signal = () => new AbortController().signal;
const json = (data: unknown): SystemToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });
/** A real discovery candidate that only appeared quoted inside an unrelated article. */
const candidate = "Erroneous analyses of interactions in neuroscience: a problem of significance";
const snippetPage = "https://www.painscience.com/articles/statistical-significance-abuse.php";
const sourcePage = "https://www.nature.com/articles/nn.2886";
function tool(name: string, execute: SystemTool["execute"]): SystemTool {
  return { name, description: "Fixture tool", parameters: { type: "object" }, execute };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
async function tick() { for (let index = 0; index < 12; index++) await Promise.resolve(); }
afterEach(() => { vi.useRealTimers(); });

describe("workflow research tools", () => {
  it("reuses configured Tavily and the paper library, bounding and normalizing their evidence", async () => {
    const library = vi.fn<SystemTool["execute"]>(async () => json([{
      title: "A real paper", authors: ["Alice", { name: "Bob", private: "hidden" }],
      published_date: "2024-02-11", journal: "Journal", abstract: "A supported abstract",
      pdf_url: "https://example.org/paper.pdf", doi: "10.1234/example", keyword_hits: 3,
      mmd_path: "/secret/location", private_key: "never expose this", unknown: { secret: "hidden" },
    }]));
    const search = vi.fn<SystemTool["execute"]>(async () => json({ results: [
      { title: "Web paper", url: "https://example.org/article", content: "Evidence", score: 0.9, api_key: "hidden" },
      { title: "Credential URL", url: "https://example.org/article?api_key=secret", content: "Hidden" },
    ], answer: "Do not trust synthesized answers" }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", library),
      getMcpTools: async () => [tool("mcp__configured-tavily__tavily_search", search)] });
    const result = await run({ name: "research_search", input: { query: "brain network analysis", maxResults: 3 } }, signal());
    const evidence = result.data as WorkflowResearchEvidence;
    expect(library.mock.calls[0]?.[0]).toEqual({ keywords: ["brain", "network", "analysis"], topk: 3, mode: "meta-data" });
    expect(search.mock.calls[0]?.[0]).toEqual({ query: "brain network analysis", max_results: 3, search_depth: "basic", include_raw_content: false });
    expect(evidence.localPapers).toEqual([{ title: "A real paper", authors: ["Alice", "Bob"], year: 2024,
      publicationDate: "2024-02-11", venue: "Journal", abstract: "A supported abstract", url: "https://example.org/paper.pdf",
      doi: "10.1234/example", source: "brainpilot-library" }]);
    expect(evidence.webResults).toEqual([{ title: "Web paper", url: "https://example.org/article", content: "Evidence" }]);
    expect(evidence.issues).toEqual([]);
    expect(evidence.sourceAvailability).toEqual({ library: true, tavilySearch: true, tavilyExtract: false });
    expect(evidence.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(result)).not.toMatch(/hidden|secret|mmd_path|score|synthesized/);
    expect(result.artifacts).toEqual([]);
  });

  it("keeps the working source when the other returns a credential-bearing error", async () => {
    const run = createWorkflowResearchTools({
      getPaperTool: async () => tool("search_papers_local", async () => ({ isError: true,
        content: [{ type: "text", text: "API key secret from /Users/worker/config" }] })),
      getMcpTools: async () => [tool("mcp__tavily__tavily-search", async () => json({ results: [{ title: "Found", url: "https://example.org/", content: "Paper" }] }))],
    });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.webResults).toHaveLength(1);
    expect(evidence.issues).toEqual(["library_unavailable"]);
    expect(JSON.stringify(evidence)).not.toMatch(/secret|Users|config/);
  });

  it.each([
    { status: 432, isError: false, issue: "tavily_quota_exceeded" },
    { status: 429, isError: false, issue: "tavily_rate_limited" },
    { status: 432, isError: true, issue: "tavily_quota_exceeded" },
    { status: 429, isError: true, issue: "tavily_rate_limited" },
  ])("classifies Tavily status $status with isError=$isError without echoing provider details", async ({ status, isError, issue }) => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", async () => json([])),
      getMcpTools: async () => [tool("mcp__tavily__tavily_search", async () => ({ ...json({ error: "Search failed", status,
        detail: { error: "usage limit: api_key=private-secret /srv/private/config" }, documentation: "https://example.org/private" }), isError }))],
    });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.sourceAvailability).toEqual({ library: true, tavilySearch: false, tavilyExtract: false });
    expect(evidence.issues).toEqual([issue]);
    expect(evidence.webResults).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/Search failed|private|api_key|usage limit|documentation/);
  });

  it("distinguishes an accessible source with no matches from unavailable sources", async () => {
    const run = createWorkflowResearchTools({
      getPaperTool: async () => tool("search_papers_local", async () => json([])),
      getMcpTools: async () => [tool("mcp__tavily__tavily_search", async () => json({ results: [] }))],
    });
    const evidence = (await run({ name: "research_search", input: { query: "no matching paper" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.sourceAvailability).toEqual({ library: true, tavilySearch: true, tavilyExtract: false });
    expect(evidence.localPapers).toEqual([]); expect(evidence.webResults).toEqual([]); expect(evidence.issues).toEqual([]);
  });

  it("uses the recognized BrainPilot remote paper library through the same query contract", async () => {
    const execute = vi.fn<SystemTool["execute"]>(async () => json([{ title: "Remote paper", authors: ["Researcher"],
      published_date: "2023", pdf_url: "", abstract: "Remote library metadata", mmd_path: "/srv/library/private.mmd" }]));
    const run = createWorkflowResearchTools({
      getPaperTool: async () => tool("mcp__neuro_sci_papersearch__search_papers", execute), getMcpTools: async () => [],
    });
    const evidence = (await run({ name: "research_search", input: { query: "remote paper", maxResults: 2 } }, signal())).data as WorkflowResearchEvidence;
    expect(execute.mock.calls[0]?.[0]).toEqual({ keywords: ["remote", "paper"], topk: 2, mode: "meta-data" });
    expect(evidence.sourceAvailability.library).toBe(true);
    expect(evidence.localPapers[0]).toEqual({ title: "Remote paper", authors: ["Researcher"], publicationDate: "2023", year: 2023,
      abstract: "Remote library metadata", source: "brainpilot-library" });
    expect(JSON.stringify(evidence)).not.toMatch(/srv|private|mmd_path/);
  });

  it("decodes the remote library's Python repr including escaped apostrophes and Unicode", async () => {
    const repr = String.raw`[{'title': 'An individual\'s "brain-age" study', 'authors': ['Jos\u00e9 Researcher', "O'Neill", '\U0001f9e0'], 'published_date': '2019-05-03', 'abstract': 'First\nSecond\tline with \\ notation and \x41', 'journal': 'A Journal', 'pdf_url': '', 'mmd_path': '/srv/private/paper.mmd', 'validated': True, 'missing': None, 'disabled': False, 'score': -1.25e+2}]`;
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: repr }] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("mcp__preset-neuro_sci_papersearch__search_papers", execute), getMcpTools: async () => [] });
    const evidence = (await run({ name: "research_search", input: { query: "brain age" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.sourceAvailability.library).toBe(true);
    expect(evidence.localPapers[0]).toEqual({ title: 'An individual\'s "brain-age" study', authors: ["José Researcher", "O'Neill", "🧠"],
      publicationDate: "2019-05-03", year: 2019, abstract: "First\nSecond\tline with \\ notation and A", venue: "A Journal", source: "brainpilot-library" });
    expect(JSON.stringify(evidence)).not.toMatch(/srv|private|mmd_path|validated|missing|disabled|score/);
  });

  it("retains valid ISO publication timestamps and rejects impossible calendar dates", async () => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", async () => json([
      { title: "ISO paper", published_date: "2024-01-01T00:00:00Z", authors: [] },
      { title: "Invalid date", published_date: "2024-02-31T00:00:00Z", authors: [] },
    ])), getMcpTools: async () => [] });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.localPapers[0]?.publicationDate).toBe("2024-01-01T00:00:00Z");
    expect(evidence.localPapers[0]?.year).toBe(2024);
    expect(evidence.localPapers[1]?.publicationDate).toBeUndefined();
    expect(evidence.localPapers[1]?.year).toBeUndefined();
  });

  it.each([
    "[{'title': __import__('os').system('touch /tmp/should-never-run')} ]",
    "[{'title': 'unterminated}]",
    "[{'title': 'bad escape \\UFFFFFFFF'}]",
    "[{'title': 'ok'}]; globalThis.__researchLiteralExecuted = true",
    "[".repeat(30) + "{'title':'too deep'}" + "]".repeat(30),
    "[".repeat(30) + '{"title":"JSON too deep"}' + "]".repeat(30),
  ])("rejects malformed or executable Python literals without returning their content", async (repr) => {
    const run = createWorkflowResearchTools({
      getPaperTool: async () => tool("mcp__neuro_sci_papersearch__search_papers", async () => ({ content: [{ type: "text", text: repr }] })),
      getMcpTools: async () => [],
    });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.sourceAvailability.library).toBe(false);
    expect(evidence.issues).toContain("library_unavailable");
    expect(evidence.localPapers).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/should-never-run|globalThis|unterminated|bad escape|too deep/);
    expect((globalThis as unknown as Record<string, unknown>).__researchLiteralExecuted).toBeUndefined();
  });

  it("does not accept arbitrary MCP servers exposing a search_papers tool", async () => {
    const execute = vi.fn(async () => json([]));
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("mcp__unrecognized__search_papers", execute), getMcpTools: async () => [] });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.sourceAvailability.library).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves the exact library title and only returns extracted URLs selected by the caller", async () => {
    const library = vi.fn<SystemTool["execute"]>(async () => json([{ metadata: { title: "Exact title", authors: [], pdf_url: "https://example.org/local" }, mmd_content: "Library full paper", segment_info: { has_more: true } }]));
    const extract = vi.fn<SystemTool["execute"]>(async () => json({ results: [
      { url: "https://example.org/web", raw_content: "Fetched article" },
      { url: "https://example.org/unrequested", raw_content: "Unexpected source" },
    ], failed_results: [{ url: "https://example.org/failed", error: "private detail" }] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", library),
      getMcpTools: async () => [tool("mcp__tavily__tavily-extract", extract)] });
    const evidence = (await run({ name: "research_resolve", input: { title: "Exact title", urls: ["https://example.org/web"] } }, signal())).data as WorkflowResearchEvidence;
    expect(library.mock.calls[0]?.[0]).toEqual({ title: "Exact title", topk: 1, mode: "full-paper", segment: 1 });
    expect(extract.mock.calls[0]?.[0]).toEqual({ urls: ["https://example.org/web"], extract_depth: "basic", format: "markdown" });
    expect(evidence.pages).toEqual([{ url: "https://example.org/local", content: "Library full paper" }, { url: "https://example.org/web", content: "Fetched article" }]);
    expect(evidence.webResults).toEqual([]);
    expect(evidence.issues).toContain("tavily_extract_partial");
    // Without a configured search tool the candidate's own source cannot be located.
    expect(evidence.issues).toContain("tavily_search_unavailable");
    expect(JSON.stringify(evidence)).not.toContain("private detail");
  });

  it("can resolve library metadata without a web URL and rechecks the library toggle", async () => {
    let enabled = true;
    const execute = vi.fn(async () => json([{ metadata: { title: "Local only", authors: [] }, mmd_content: "Full paper" }]));
    const getMcpTools = vi.fn(async () => []);
    const run = createWorkflowResearchTools({ getPaperTool: async () => enabled ? tool("search_papers_local", execute) : undefined, getMcpTools });
    const first = (await run({ name: "research_resolve", input: { title: "Local only" } }, signal())).data as WorkflowResearchEvidence;
    expect(first.localPapers[0]?.title).toBe("Local only");
    expect(first.pages).toEqual([]);
    expect(first.issues).toEqual(["tavily_search_unavailable"]);
    expect(getMcpTools).toHaveBeenCalledTimes(1);
    enabled = false;
    const second = (await run({ name: "research_resolve", input: { title: "Local only" } }, signal())).data as WorkflowResearchEvidence;
    expect(second.issues.sort()).toEqual(["library_unavailable", "tavily_search_unavailable"]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resolves a candidate seen only in another page's snippet to its own source page", async () => {
    const calls: string[] = [];
    const search = vi.fn<SystemTool["execute"]>(async () => { calls.push("search"); return json({ results: [
      { title: "Statistical Significance Abuse", url: snippetPage, content: "Cites Erroneous analyses of interactions in neuroscience among many other papers", score: 0.8 },
      { title: "Erroneous Analyses of Interactions in Neuroscience — A Problem of Significance", url: sourcePage, content: "Nature Neuroscience commentary", api_key: "hidden" },
    ] }); });
    const extract = vi.fn<SystemTool["execute"]>(async () => { calls.push("extract"); return json({ results: [
      { url: sourcePage, raw_content: "Full commentary text" },
    ] }); });
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", async () => json([])),
      getMcpTools: async () => [tool("mcp__tavily__tavily_search", search), tool("mcp__tavily__tavily-extract", extract)] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: [snippetPage] } }, signal())).data as WorkflowResearchEvidence;
    expect(search.mock.calls[0]?.[0]).toEqual({ query: `"${candidate}"`, max_results: 3, search_depth: "basic", include_raw_content: false });
    // The paper's own page is preferred over the already validated snippet page.
    expect(extract.mock.calls[0]?.[0]).toEqual({ urls: [sourcePage, snippetPage], extract_depth: "basic", format: "markdown" });
    expect(calls).toEqual(["search", "extract"]);
    expect(evidence.pages).toEqual([{ url: sourcePage, content: "Full commentary text" }]);
    expect(evidence.webResults.map((entry) => entry.url)).toEqual([snippetPage, sourcePage]);
    expect(evidence.sourceAvailability).toEqual({ library: true, tavilySearch: true, tavilyExtract: true });
    expect(evidence.issues).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/hidden|score/);
  });

  it("falls back to the caller's validated URLs when the exact-title search fails", async () => {
    const extract = vi.fn<SystemTool["execute"]>(async () => json({ results: [{ url: snippetPage, raw_content: "Snippet page text" }] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => ({ ...json({ status: 432, error: "Search failed", detail: "usage limit api_key=private-secret" }), isError: false })),
      tool("mcp__tavily__tavily-extract", extract),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: [snippetPage] } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.issues.sort()).toEqual(["library_unavailable", "tavily_search_quota_exceeded"]);
    expect(evidence.sourceAvailability).toEqual({ library: false, tavilySearch: false, tavilyExtract: true });
    expect(extract.mock.calls[0]?.[0]).toEqual({ urls: [snippetPage], extract_depth: "basic", format: "markdown" });
    expect(evidence.pages).toEqual([{ url: snippetPage, content: "Snippet page text" }]);
    expect(evidence.webResults).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/Search failed|usage limit|api_key|private-secret/);
  });

  it("never reports extracted pages when neither source can be reached", async () => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => ({ content: [{ type: "text", text: "private search failure" }] })),
      tool("mcp__tavily__tavily-extract", async () => ({ isError: true, content: [{ type: "text", text: "private extract failure" }] })),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: [snippetPage] } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.issues.sort()).toEqual(["library_unavailable", "tavily_search_unavailable", "tavily_unavailable"]);
    expect(evidence.sourceAvailability).toEqual({ library: false, tavilySearch: false, tavilyExtract: false });
    expect(evidence.pages).toEqual([]); expect(evidence.webResults).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/private/);
  });

  it("reports an unavailable extract channel instead of implying the found source was read", async () => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [{ title: candidate, url: sourcePage, content: "" }] })),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.issues.sort()).toEqual(["library_unavailable", "tavily_extract_unavailable"]);
    expect(evidence.sourceAvailability).toEqual({ library: false, tavilySearch: true, tavilyExtract: false });
    expect(evidence.webResults.map((entry) => entry.url)).toEqual([sourcePage]);
    expect(evidence.pages).toEqual([]);
  });

  it("does not extract unsafe search URLs even when they repeat the candidate title", async () => {
    const extract = vi.fn<SystemTool["execute"]>(async () => json({ results: [] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [
        { title: candidate, url: "https://example.org/paper?api_key=secret", content: "" },
        { title: candidate, url: "http://localhost:8080/paper", content: "" },
        { title: candidate, url: "file:///Users/private/paper.pdf", content: "" },
      ] })),
      tool("mcp__tavily__tavily-extract", extract),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate } }, signal())).data as WorkflowResearchEvidence;
    expect(extract).not.toHaveBeenCalled();
    expect(evidence.webResults).toEqual([]); expect(evidence.pages).toEqual([]);
    expect(evidence.sourceAvailability.tavilySearch).toBe(true);
    expect(JSON.stringify(evidence)).not.toMatch(/api_key|localhost|Users|file:\/\/\/|private/);
  });

  it("keeps a partial-title search hit as provenance without preferring its URL", async () => {
    const extract = vi.fn<SystemTool["execute"]>(async () => json({ results: [{ url: "https://example.org/caller", raw_content: "Caller page" }] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [
        { title: "Statistical Significance Abuse", url: snippetPage, content: "Erroneous analyses of interactions in neuroscience" },
        { title: "Significance in neuroscience", url: "https://example.org/unrelated", content: "A problem of significance" },
      ] })),
      tool("mcp__tavily__tavily-extract", extract),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: ["https://example.org/caller"] } }, signal())).data as WorkflowResearchEvidence;
    expect(extract.mock.calls[0]?.[0]).toEqual({ urls: ["https://example.org/caller"], extract_depth: "basic", format: "markdown" });
    expect(evidence.webResults.map((entry) => entry.url)).toEqual([snippetPage, "https://example.org/unrelated"]);
    expect(evidence.pages).toEqual([{ url: "https://example.org/caller", content: "Caller page" }]);
  });

  it("merges at most three deduplicated URLs with the search matches first", async () => {
    const extract = vi.fn<SystemTool["execute"]>(async () => json({ results: [] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [
        { title: candidate, url: sourcePage, content: "" },
        { title: candidate, url: "https://example.org/mirror", content: "" },
        { title: candidate, url: "https://example.org/shared", content: "" },
      ] })),
      tool("mcp__tavily__tavily-extract", extract),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: ["https://example.org/shared", "https://example.org/caller"] } }, signal())).data as WorkflowResearchEvidence;
    expect(extract.mock.calls[0]?.[0]).toEqual({ urls: [sourcePage, "https://example.org/mirror", "https://example.org/shared"], extract_depth: "basic", format: "markdown" });
    expect(evidence.pages).toEqual([]);
    expect(evidence.sourceAvailability.tavilyExtract).toBe(true);
  });

  it("does not start the extract call when the request is cancelled after the search", async () => {
    const controller = new AbortController();
    const extract = vi.fn<SystemTool["execute"]>(async () => json({ results: [] }));
    const search = vi.fn<SystemTool["execute"]>(async () => {
      controller.abort(new Error("Stop between calls"));
      return json({ results: [{ title: candidate, url: sourcePage, content: "" }] });
    });
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", search), tool("mcp__tavily__tavily-extract", extract),
    ] });
    await expect(run({ name: "research_resolve", input: { title: candidate } }, controller.signal)).rejects.toThrow("Stop between calls");
    await tick();
    expect(search).toHaveBeenCalledTimes(1);
    expect(extract).not.toHaveBeenCalled();
  });

  it("keeps the whole-request deadline across the search and the extract call", async () => {
    vi.useFakeTimers();
    const extraction = deferred<SystemToolResult>();
    const extract = vi.fn<SystemTool["execute"]>(() => extraction.promise);
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [{ title: candidate, url: sourcePage, content: "" }] })),
      tool("mcp__tavily__tavily-extract", extract),
    ] });
    const pending = run({ name: "research_resolve", input: { title: candidate } }, signal());
    await tick(); await tick();
    await vi.advanceTimersByTimeAsync(45_000);
    const evidence = (await pending).data as WorkflowResearchEvidence;
    expect(extract).toHaveBeenCalledTimes(1);
    expect(evidence.issues).toContain("tavily_timeout");
    expect(evidence.pages).toEqual([]);
    expect(evidence.sourceAvailability.tavilyExtract).toBe(false);
    expect(evidence.webResults.map((entry) => entry.url)).toEqual([sourcePage]);
    expect(vi.getTimerCount()).toBe(0);
    extraction.resolve(json({ results: [] })); await tick();
  });

  it("never invokes unrelated MCP tools or a substituted local tool", async () => {
    const execute = vi.fn(async () => json([]));
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("shell", execute), getMcpTools: async () => [
      tool("mcp__tavily__crawl", execute), tool("tavily_search", execute), tool("mcp__server__tavily_search_extra", execute),
      tool("mcp__tavily__research", execute),
    ] });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.issues).toEqual(["library_unavailable", "tavily_search_unavailable"]);
    expect(evidence.sourceAvailability).toEqual({ library: false, tavilySearch: false, tavilyExtract: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts rendered Tavily search blocks without echoing their preamble", async () => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [tool("mcp__tavily__tavily_search", async () => ({ content: [{ type: "text", text:
      "Private preamble\nTitle: Paper one\nURL: https://example.org/one\nContent: First excerpt\n\nTitle: Paper two\nURL: https://example.org/two\nContent: Second excerpt" }] }))] });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.webResults.map((entry) => entry.title)).toEqual(["Paper one", "Paper two"]);
    expect(JSON.stringify(evidence)).not.toContain("Private preamble");
  });

  it("bounds result text and strips obvious credentials and local paths in allowlisted fields", async () => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", async () => json([{
      title: "Paper", authors: [], pdf_url: "file:///Users/private/paper.pdf", abstract: "token path /Users/private/paper.pdf api_key=secret tvly-credential123",
    }])), getMcpTools: async () => [tool("mcp__tavily__tavily_search", async () => json({ results: Array.from({ length: 12 }, (_, i) => ({
      title: `Result ${i}`, url: `https://example.org/${i}`, content: "x".repeat(20_000),
    })) }))] });
    const evidence = (await run({ name: "research_search", input: { query: "topic", maxResults: 2 } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.webResults).toHaveLength(2);
    expect(evidence.webResults[0]?.content).toHaveLength(12_000);
    expect(evidence.localPapers[0]?.url).toBeUndefined();
    expect(JSON.stringify(evidence)).not.toMatch(/Users|secret|credential123|file:\/\/\/|private/);
  });

  it.each([
    { name: "research_search", input: { query: "", maxResults: 2 } },
    { name: "research_search", input: { query: "topic", maxResults: 9 } },
    { name: "research_resolve", input: { title: "Paper", urls: ["https://user:password@example.org/"] } },
    { name: "research_resolve", input: { title: "Paper", urls: ["https://example.org/?token=private"] } },
    { name: "research_resolve", input: { title: "Paper", urls: ["file:///private/paper"] } },
    { name: "research_resolve", input: { title: "Paper", urls: Array(4).fill("https://example.org/") } },
    { name: "research_unknown", input: {} },
  ])("rejects invalid requests before discovering tools: $name", async (request) => {
    const getPaperTool = vi.fn(async () => undefined);
    const getMcpTools = vi.fn(async () => []);
    const run = createWorkflowResearchTools({ getPaperTool, getMcpTools });
    await expect(run(request, signal())).rejects.toThrow();
    expect(getPaperTool).not.toHaveBeenCalled(); expect(getMcpTools).not.toHaveBeenCalled();
  });

  it("returns promptly on cancellation during discovery and never starts a late tool", async () => {
    const discovery = deferred<SystemTool[]>();
    const execute = vi.fn(async () => json({ results: [] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: () => discovery.promise });
    const controller = new AbortController();
    const pending = run({ name: "research_search", input: { query: "topic" } }, controller.signal);
    const rejected = expect(pending).rejects.toThrow("Stop research");
    await tick(); controller.abort(new Error("Stop research")); await rejected;
    discovery.resolve([tool("mcp__tavily__tavily_search", execute)]);
    await tick(); expect(execute).not.toHaveBeenCalled();
  });

  it("forwards cancellation to an active tool even when its promise ignores the signal", async () => {
    const response = deferred<SystemToolResult>();
    let received: AbortSignal | undefined;
    const execute: SystemTool["execute"] = async (_params, options) => { received = options?.signal; return response.promise; };
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [tool("mcp__tavily__tavily_search", execute)] });
    const controller = new AbortController();
    const pending = run({ name: "research_search", input: { query: "topic" } }, controller.signal);
    const rejected = expect(pending).rejects.toThrow("Stop active request");
    await tick(); expect(received?.aborted).toBe(false);
    controller.abort(new Error("Stop active request")); await rejected;
    expect(received?.aborted).toBe(true);
    response.resolve(json({ results: [] })); await tick();
  });

  it("does not discover or execute tools for an already cancelled request", async () => {
    const getMcpTools = vi.fn(async () => []);
    const getPaperTool = vi.fn(async () => undefined);
    const run = createWorkflowResearchTools({ getPaperTool, getMcpTools });
    const controller = new AbortController(); controller.abort(new Error("Already stopped"));
    await expect(run({ name: "research_search", input: { query: "topic" } }, controller.signal)).rejects.toThrow("Already stopped");
    expect(getMcpTools).not.toHaveBeenCalled(); expect(getPaperTool).not.toHaveBeenCalled();
  });

  it("bounds source concurrency and removes cancelled queue waiters", async () => {
    const response = deferred<SystemToolResult>();
    let active = 0; let maximum = 0;
    const executed: string[] = [];
    const execute: SystemTool["execute"] = async (params) => { active++; maximum = Math.max(active, maximum); executed.push(String(params.query ?? "library"));
      try { return await response.promise; } finally { active--; } };
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", execute),
      getMcpTools: async () => [tool("mcp__tavily__tavily_search", execute)] });
    const first = run({ name: "research_search", input: { query: "first" } }, signal());
    await tick(); expect(active).toBe(2);
    const controller = new AbortController();
    const cancelled = run({ name: "research_search", input: { query: "cancelled" } }, controller.signal);
    const rejected = expect(cancelled).rejects.toThrow("Stop waiter");
    const later = run({ name: "research_search", input: { query: "later" } }, signal());
    controller.abort(new Error("Stop waiter")); await rejected;
    response.resolve(json([])); await Promise.all([first, later]);
    expect(maximum).toBe(2); expect(executed).not.toContain("cancelled"); expect(executed).toContain("later");
  });

  it("expires stalled discovery and prevents its late result from invoking tools", async () => {
    vi.useFakeTimers();
    const discovery = deferred<SystemTool[]>();
    const execute = vi.fn(async () => json({ results: [] }));
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: () => discovery.promise });
    const pending = run({ name: "research_search", input: { query: "topic" } }, signal());
    await tick(); await vi.advanceTimersByTimeAsync(45_000);
    const evidence = (await pending).data as WorkflowResearchEvidence;
    expect(evidence.issues).toContain("tavily_timeout");
    discovery.resolve([tool("mcp__tavily__tavily_search", execute)]); await tick();
    expect(execute).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it("sanitizes malformed and oversized responses", async () => {
    const run = createWorkflowResearchTools({
      getPaperTool: async () => tool("search_papers_local", async () => ({ content: [{ type: "text", text: "private invalid data" }] })),
      getMcpTools: async () => [tool("mcp__tavily__tavily_search", async () => ({ content: [{ type: "text", text: "secret".repeat(100_000) }] }))],
    });
    const evidence = (await run({ name: "research_search", input: { query: "topic" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.issues.sort()).toEqual(["library_unavailable", "tavily_unavailable"]);
    expect(evidence.localPapers).toEqual([]); expect(evidence.webResults).toEqual([]);
    expect(JSON.stringify(evidence)).not.toMatch(/private|secret/);
  });

  it("records a resolved library body without a public URL under the backend's own title", async () => {
    const returnedTitle = "Actual library title";
    const body = "Resolved body text";
    const run = createWorkflowResearchTools({ getMcpTools: async () => [],
      getPaperTool: async () => tool("search_papers_local", async () => json([
        { metadata: { title: returnedTitle }, mmd_content: body, segment_info: { has_more: true } },
      ])) });
    const evidence = (await run({ name: "research_resolve", input: { title: "Requested alias title" } }, signal())).data as WorkflowResearchEvidence;
    // A full paper with no public URL stays a usable source, but never becomes a page.
    expect(evidence.pages).toEqual([]);
    expect(evidence.localPapers).toEqual([{ title: returnedTitle, authors: [], source: "brainpilot-library" }]);
    expect(evidence.sourceRecords.filter((entry) => entry.backend === "brainpilot-library")).toEqual([{
      backend: "brainpilot-library", status: "ok", requestedUrl: null, returnedUrl: null, title: returnedTitle,
      content: body, receivedChars: body.length, retainedChars: body.length, contentTruncated: false,
      librarySegment: { requested: 1, hasMore: true },
    }]);
    // The requested title must never masquerade as something the backend returned.
    expect(JSON.stringify(evidence)).not.toMatch(/Requested alias title/);
  });

  it("reports library body length metadata against the received text, counting only length limits as truncation", async () => {
    const dummyPath = "/Users/dummy-user/Library/CachedPapers/sample-paper-draft-v3.mmd";
    const cases: Array<{ name: string; raw: string; truncated: boolean }> = [
      { name: "trimmed short body", raw: "  Trimmed body  ", truncated: false },
      { name: "body past the retained limit", raw: "a".repeat(12_001), truncated: true },
      { name: "body past the initial scan", raw: "b".repeat(24_001), truncated: true },
      { name: "redaction shortens without a length limit", raw: `Stored at ${dummyPath} now`, truncated: false },
    ];
    for (const { name, raw, truncated } of cases) {
      const run = createWorkflowResearchTools({ getMcpTools: async () => [],
        getPaperTool: async () => tool("search_papers_local", async () => json([{ metadata: { title: "Paper" }, mmd_content: raw }])) });
      const evidence = (await run({ name: "research_resolve", input: { title: "Paper" } }, signal())).data as WorkflowResearchEvidence;
      const record = evidence.sourceRecords.filter((entry) => entry.backend === "brainpilot-library")[0];
      expect(record, name).toBeDefined();
      expect(record?.receivedChars, name).toBe(raw.length);
      expect(record?.retainedChars, name).toBe(record?.content.length);
      expect(record?.contentTruncated, name).toBe(truncated);
      expect(JSON.stringify(record), name).not.toMatch(/\/Users\//);
    }
  });

  it("distinguishes an answered miss, a collapsed library call and an unreported segment state", async () => {
    const answered = (payload: unknown) => async () => tool("search_papers_local", async () => json(payload));
    const cases: Array<{ name: string; getPaperTool: () => Promise<SystemTool | undefined>; status: string; segment: unknown }> = [
      { name: "answered with no entries", getPaperTool: answered([]), status: "missing", segment: { requested: 1, hasMore: null } },
      { name: "no library tool at all", getPaperTool: async () => undefined, status: "failed", segment: undefined },
      { name: "entry without segment info", getPaperTool: answered([{ metadata: { title: "Paper" }, mmd_content: "Body" }]),
        status: "ok", segment: { requested: 1, hasMore: null } },
    ];
    for (const { name, getPaperTool, status, segment } of cases) {
      const run = createWorkflowResearchTools({ getPaperTool, getMcpTools: async () => [] });
      const evidence = (await run({ name: "research_resolve", input: { title: "Paper" } }, signal())).data as WorkflowResearchEvidence;
      const records = evidence.sourceRecords.filter((entry) => entry.backend === "brainpilot-library");
      expect(records.length, name).toBe(1);
      expect(records[0]?.status, name).toBe(status);
      // A call that never produced a response says nothing about any segment.
      if (segment === undefined) expect(records[0], name).not.toHaveProperty("librarySegment");
      else expect(records[0]?.librarySegment, name).toEqual(segment);
    }
  });

  it("applies the caller's extract allowance to the merged list without changing the channel's availability", async () => {
    const callerPage = "https://example.org/caller";
    const found = [sourcePage, "https://example.org/mirror", "https://example.org/third"];
    const cases: Array<{ name: string; maxExtractUrls?: number; requested: string[] }> = [
      { name: "a single-URL allowance keeps only the first merged URL", maxExtractUrls: 1, requested: [sourcePage] },
      { name: "the default allowance sends three URLs", requested: found },
      { name: "a zero allowance attempts no extraction", maxExtractUrls: 0, requested: [] },
    ];
    for (const { name, maxExtractUrls, requested } of cases) {
      const extract = vi.fn<SystemTool["execute"]>(async () => json({ results: requested.map((url) => ({ url, raw_content: "Body" })) }));
      const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
        tool("mcp__tavily__tavily_search", async () => json({ results: found.map((url) => ({ title: candidate, url, content: "" })) })),
        tool("mcp__tavily__tavily-extract", extract),
      ] });
      const input = { title: candidate, urls: [callerPage], ...(maxExtractUrls === undefined ? {} : { maxExtractUrls }) };
      const evidence = (await run({ name: "research_resolve", input }, signal())).data as WorkflowResearchEvidence;
      expect(extract.mock.calls[0]?.[0], name).toEqual(requested.length ? { urls: requested, extract_depth: "basic", format: "markdown" } : undefined);
      expect(evidence.extractRequestedUrls, name).toEqual(requested);
      expect(evidence.sourceRecords.filter((entry) => entry.backend === "tavily").map((entry) => entry.requestedUrl), name).toEqual(requested);
      // A zero allowance is the caller's own choice, never a broken extract channel.
      expect(evidence.sourceAvailability.tavilyExtract, name).toBe(true);
      expect(evidence.issues, name).not.toContain("tavily_extract_unavailable");
      expect(evidence.issues, name).toContain("library_unavailable");
    }
  });

  it.each([-1, 0.5, "1", 4])("rejects an out-of-contract extract allowance before discovering tools: %p", async (maxExtractUrls) => {
    const getPaperTool = vi.fn(async () => undefined);
    const getMcpTools = vi.fn(async () => []);
    const run = createWorkflowResearchTools({ getPaperTool, getMcpTools });
    await expect(run({ name: "research_resolve", input: { title: candidate, maxExtractUrls } }, signal())).rejects.toThrow();
    expect(getPaperTool).not.toHaveBeenCalled(); expect(getMcpTools).not.toHaveBeenCalled();
  });

  it("matches extracted bodies to the URL the backend answered about, never to its position", async () => {
    const requested = ["https://example.org/a", "https://example.org/b", "https://example.org/c"];
    const cases: Array<{ name: string; url: string; returnedUrl: string | null }> = [
      { name: "an unrequested URL", url: "https://example.org/unrequested", returnedUrl: "https://example.org/unrequested" },
      { name: "an unsafe URL", url: "http://localhost:8080/paper?api_key=secret", returnedUrl: null },
    ];
    for (const { name, url, returnedUrl } of cases) {
      const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
        tool("mcp__tavily__tavily-extract", async () => json({ results: [
          { url: requested[0], title: "Backend title", raw_content: "First body" },
          { url: requested[1], raw_content: "" },
          { url, raw_content: "Unmatched body" },
        ], failed_results: [] })),
      ] });
      const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: requested } }, signal())).data as WorkflowResearchEvidence;
      const view = (entry: WorkflowResearchEvidence["sourceRecords"][number]) =>
        ({ status: entry.status, requestedUrl: entry.requestedUrl, returnedUrl: entry.returnedUrl, title: entry.title, content: entry.content });
      expect(evidence.sourceRecords.filter((entry) => entry.backend === "tavily").map(view), name).toEqual([
        { status: "ok", requestedUrl: requested[0], returnedUrl: requested[0], title: "Backend title", content: "First body" },
        { status: "empty", requestedUrl: requested[1], returnedUrl: requested[1], title: undefined, content: "" },
        { status: "unmatched", requestedUrl: null, returnedUrl, title: undefined, content: "Unmatched body" },
        { status: "missing", requestedUrl: requested[2], returnedUrl: null, title: undefined, content: "" },
      ]);
      expect(evidence.pages, name).toEqual([{ url: requested[0], content: "First body" }]);
      expect(evidence.issues, name).not.toContain("tavily_extract_partial");
      expect(JSON.stringify(evidence), name).not.toMatch(/localhost|api_key|secret/);
    }
  });

  it("records a reported extract failure without its detail and still misses the unanswered URL", async () => {
    const requested = ["https://example.org/a", "https://example.org/b", "https://example.org/c"];
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily-extract", async () => json({
        results: [{ url: requested[0], raw_content: "First body" }],
        failed_results: [{ url: requested[1], error: "quota exhausted for tvly-dummy-key-123" }],
      })),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: requested } }, signal())).data as WorkflowResearchEvidence;
    const records = evidence.sourceRecords.filter((entry) => entry.backend === "tavily");
    // A failure and a silence are both observations about a URL, not measured content.
    expect(records.slice(1)).toEqual([
      { backend: "tavily", status: "failed", requestedUrl: requested[1], returnedUrl: requested[1], content: "", receivedChars: null, retainedChars: 0, contentTruncated: null },
      { backend: "tavily", status: "missing", requestedUrl: requested[2], returnedUrl: null, content: "", receivedChars: null, retainedChars: 0, contentTruncated: null },
    ]);
    expect(evidence.issues).toContain("tavily_extract_partial");
    expect(JSON.stringify(evidence)).not.toMatch(/quota exhausted|tvly-dummy-key-123/);
  });

  const extractCollapses: Array<{ name: string; extract: SystemTool["execute"] }> = [
    { name: "a thrown transport error", extract: async () => { throw new Error("socket closed for tvly-dummy-key-123"); } },
    // A real backend can answer with a body that is neither JSON nor the rendered search format.
    { name: "an unparsable body", extract: async () => ({ content: [{ type: "text", text: "<html><body>Gateway error for tvly-dummy-key-123</body></html>" }] }) },
  ];
  it.each(extractCollapses)("blames every attempted URL when the extract call collapses: $name", async ({ extract }) => {
    const requested = ["https://example.org/caller-one", "https://example.org/caller-two"];
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [] })),
      tool("mcp__tavily__tavily-extract", extract),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: requested } }, signal())).data as WorkflowResearchEvidence;
    // The attempt is what happened, so both URLs stay reported even though nothing came back.
    expect(evidence.extractRequestedUrls).toEqual(requested);
    expect(evidence.sourceRecords.filter((entry) => entry.backend === "tavily")).toEqual(requested.map((url) => (
      { backend: "tavily", status: "failed", requestedUrl: url, returnedUrl: null, content: "", receivedChars: null, retainedChars: 0, contentTruncated: null }
    )));
    expect(evidence.pages).toEqual([]);
    expect(evidence.sourceAvailability).toEqual({ library: false, tavilySearch: true, tavilyExtract: false });
    expect(evidence.issues.sort()).toEqual(["library_unavailable", "tavily_unavailable"]);
    expect(JSON.stringify(evidence)).not.toMatch(/socket closed|Gateway error|tvly-dummy-key-123|html/);
  });

  it("reports one backend observation when the caller's URL has no extract tool to reach", async () => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [{ title: "An unrelated page", url: snippetPage, content: "Nothing about the candidate" }] })),
    ] });
    const evidence = (await run({ name: "research_resolve", input: { title: candidate, urls: ["https://example.org/caller-one"] } }, signal())).data as WorkflowResearchEvidence;
    // No URL ever reached a backend, so nothing was requested and no URL carries a failure.
    expect(evidence.extractRequestedUrls).toEqual([]);
    expect(evidence.sourceRecords.filter((entry) => entry.backend === "tavily")).toEqual([
      { backend: "tavily", status: "failed", requestedUrl: null, returnedUrl: null, content: "", receivedChars: null, retainedChars: 0, contentTruncated: null },
    ]);
    expect(evidence.issues.sort()).toEqual(["library_unavailable", "tavily_extract_unavailable"]);
    expect(evidence.sourceAvailability).toEqual({ library: false, tavilySearch: true, tavilyExtract: false });
    expect(evidence.pages).toEqual([]);
  });

  it("counts no extraction for an ordinary search, whose hits are not extracted pages", async () => {
    const run = createWorkflowResearchTools({ getPaperTool: async () => tool("search_papers_local", async () => json([])),
      getMcpTools: async () => [tool("mcp__tavily__tavily_search", async () => json({ results: [{ title: "Web paper", url: sourcePage, content: "Evidence" }] }))] });
    const evidence = (await run({ name: "research_search", input: { query: "brain network analysis" } }, signal())).data as WorkflowResearchEvidence;
    expect(evidence.webResults.map((entry) => entry.url)).toEqual([sourcePage]);
    // A search hit is neither a requested extraction nor a per-URL source observation.
    expect(evidence.extractRequestedUrls).toEqual([]);
    expect(evidence.sourceRecords).toEqual([]);
    expect(evidence.pages).toEqual([]);
    expect(evidence.issues).toEqual([]);
  });

  it("rejects with the caller's own reason when the request is cancelled during the extract call", async () => {
    const controller = new AbortController();
    const reason = new Error("Caller stopped the workflow");
    const run = createWorkflowResearchTools({ getPaperTool: async () => undefined, getMcpTools: async () => [
      tool("mcp__tavily__tavily_search", async () => json({ results: [] })),
      tool("mcp__tavily__tavily-extract", async () => { controller.abort(reason); throw reason; }),
    ] });
    const pending = run({ name: "research_resolve", input: { title: candidate, urls: [snippetPage] } }, controller.signal);
    // Cancellation outranks the ordinary source failure the same call would otherwise report.
    await expect(pending).rejects.toBe(reason);
  });
});
