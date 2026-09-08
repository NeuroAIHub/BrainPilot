import { describe, expect, it } from "vitest";
import { datasetErrorKey, datasetWorkspacePath } from "../components/plugins/datasetFeedback";

describe("dataset research handoff and recovery", () => {
  it("keeps selected samples separate from the full data root", () => {
    expect(datasetWorkspacePath({ datasetId: "physionet-eegmat", selectionId: "sample" })).toBe("/data/datasets/physionet-eegmat--sample");
    expect(datasetWorkspacePath({ datasetId: "physionet-eegmat", selectionId: "full" })).toBe("/data/datasets/physionet-eegmat");
    expect(datasetWorkspacePath({ datasetId: "physionet-eegmat" })).toBe("/data/datasets/physionet-eegmat");
  });
  it.each([
    ["Failed to fetch", "network"], ["TypeError: fetch failed", "network"],
    ["Required downloader 'datalad' is not installed or not on PATH", "tools"],
    ["Missing download tools: git-annex", "tools"], ["ENOSPC", "space"],
    ["SHA256 checksum mismatch", "checksum"], ["HTTP 403", "access"],
  ])("gives an actionable message for %s", (message, key) => {
    expect(datasetErrorKey(message)).toBe(`datasets.error.${key}`);
  });
});
