import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@brainpilot/plugin-sdk/workflow";
import { runDeepResearch } from "../workflows/deep-research.js";

const SOURCE_PATH = "synthetic-study.md";
const SOURCE_TEXT = [
  "# Synthetic sleep study",
  "Authors: Example Author",
  "First publication date: 2022-01-01",
  "A synthetic study in healthy adults reports that sleep restriction reduced n-back accuracy by nine percent.",
].join("\n");
const QUOTE = "sleep restriction reduced n-back accuracy by nine percent";
const input = {
  question: "How did the synthetic intervention affect working memory?",
  scope: "One synthetic local study, for workflow control-flow testing.",
  cutoffDate: "2025-01-01",
  inputPaths: [SOURCE_PATH],
  budget: { maxBranches: 1, maxFollowups: 0, maxModelStages: 4, maxResearchCalls: 0, maxExtractUrls: 0, maxDurationMs: 60_000 },
};

function harness(options: { verification?: "supported" | "unverified"; failAt?: string } = {}) {
  const files = new Map<string, string>();
  const runAgent = vi.fn(async ({ stageId, inputs }: { stageId: string; inputs: Record<string, any> }) => {
    if (stageId === options.failAt) throw new Error("synthetic stage failure");
    if (stageId === "deep-research-plan") {
      const providedSource = inputs.providedSources[0];
      return { branches: [{
        question: "What did the synthetic study report?", query: "synthetic sleep study",
        requiredFacets: ["working-memory effect"], sourceIds: [providedSource.sourceId],
      }] };
    }
    if (stageId.startsWith("deep-research-evidence-")) {
      const source = inputs.sources[0];
      return { claims: [{
        text: "The synthetic study reports a nine percent reduction in n-back accuracy.",
        facetIds: inputs.facets.map((facet: { facetId: string }) => facet.facetId),
        supports: [{ sourceId: source.sourceId, quote: QUOTE }], limitations: ["Synthetic test evidence."],
      }], gaps: [], contradictions: [] };
    }
    if (stageId === "deep-research-gap-review") return { followups: [] };
    if (stageId === "deep-research-synthesis") return {
      title: "Synthetic study findings",
      paragraphs: [{ heading: "Finding", text: "The study reports a nine percent reduction in n-back accuracy.", claimIds: ["c1"] }],
    };
    if (stageId === "deep-research-verification") return {
      paragraphs: [{ paragraphId: "p1", verdict: options.verification ?? "supported", reason: "Synthetic verification result." }],
      facetCoverage: [{ facetId: "f1", status: "covered", reason: "The local synthetic source covers the facet." }], issues: [],
    };
    throw new Error(`Unexpected synthetic stage: ${stageId}`);
  });
  const ctx = {
    runId: "deep-research-loop-test",
    modelBinding: { id: "test", providerId: "test", modelId: "deterministic", thinkingLevel: "low" },
    signal: new AbortController().signal,
    emit: vi.fn(), runAgent, runTool: vi.fn(async () => { throw new Error("No research tools are expected"); }),
    readText: vi.fn(async (path: string) => {
      if (path !== SOURCE_PATH) throw new Error("Unexpected synthetic path");
      return SOURCE_TEXT;
    }),
    writeArtifact: vi.fn(async ({ path, content, mediaType, role }: { path: string; content: string; mediaType: string; role: string }) => {
      files.set(path, content);
      return { path: `workflow-runs/deep-research-loop-test/${path}`, sha256: createHash("sha256").update(content).digest("hex"), mediaType, role };
    }),
  } as unknown as WorkflowContext;
  return { ctx, files, runAgent };
}

describe("runDeepResearch full-loop persistence", () => {
  it("delivers local evidence through synthesis and verification to the published report", async () => {
    const f = harness();
    const result = await runDeepResearch(input, f.ctx);

    expect(result.data).toMatchObject({ status: "completed", sourceCount: 1, claimCount: 1 });
    expect(result.data.reportPath).toMatch(/report\.md$/u);
    expect(f.files.get("report.md")).toContain("nine percent reduction in n-back accuracy");
    expect(f.files.has("report.partial.md")).toBe(false);
    const checkpoint = [...f.files.entries()].find(([path]) => path.startsWith("evidence/"))?.[1];
    expect(checkpoint).toContain(QUOTE);
    expect(f.runAgent).toHaveBeenCalledTimes(4);
  });

  it("keeps evidence and a partial report when independent verification rejects the draft", async () => {
    const f = harness({ verification: "unverified" });

    await expect(runDeepResearch(input, f.ctx)).rejects.toThrow("deep_research_verification_incomplete");

    expect([...f.files.keys()].some((path) => path.startsWith("evidence/"))).toBe(true);
    expect(f.files.get("claims.json")).toContain("sleep restriction reduced n-back accuracy");
    expect(f.files.get("report.partial.md")).toContain("independent verification did not clear this draft");
    expect(f.files.has("report.md")).toBe(false);
    expect(f.files.get("run-summary.json")).toContain("failed_verification");
  });

  it("preserves the admitted evidence checkpoint when a later synthesis stage fails", async () => {
    const f = harness({ failAt: "deep-research-synthesis" });

    await expect(runDeepResearch(input, f.ctx)).rejects.toThrow("deep_research_run_failed");

    const checkpoint = [...f.files.entries()].find(([path]) => path.startsWith("evidence/"))?.[1];
    expect(checkpoint).toContain(QUOTE);
    expect(f.files.has("report.md")).toBe(false);
    expect(f.files.has("report.partial.md")).toBe(false);
  });
});
