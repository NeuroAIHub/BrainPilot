import { describe, expect, it } from "vitest";
import { parseWorkspaceFileHref } from "../components/chat/workspaceFileLink";

describe("parseWorkspaceFileHref", () => {
  it("roots relative Markdown links in the active workspace", () => {
    expect(parseWorkspaceFileHref("docs/report.md")).toEqual({ path: "/workspace/docs/report.md" });
    expect(parseWorkspaceFileHref("./notes/readme.txt#L12")).toEqual({
      path: "/workspace/notes/readme.txt",
      line: 12,
    });
  });

  it("accepts explicit workspace and persistent-library paths", () => {
    expect(parseWorkspaceFileHref("/workspace/results/run.json")).toEqual({
      path: "/workspace/results/run.json",
    });
    expect(parseWorkspaceFileHref("/data/datasets/sample.csv")).toEqual({
      path: "/data/datasets/sample.csv",
    });
  });

  it("keeps external URLs and page anchors out of the Files panel", () => {
    expect(parseWorkspaceFileHref("https://example.com/report.md")).toBeNull();
    expect(parseWorkspaceFileHref("mailto:user@example.com")).toBeNull();
    expect(parseWorkspaceFileHref("#results")).toBeNull();
  });

  it("rejects paths outside managed roots", () => {
    expect(parseWorkspaceFileHref("../../etc/passwd")).toBeNull();
    expect(parseWorkspaceFileHref("/etc/passwd")).toBeNull();
    expect(parseWorkspaceFileHref("/%2e%2e/etc/passwd")).toBeNull();
    expect(parseWorkspaceFileHref("/workspace/../data/private.txt")).toBeNull();
    expect(parseWorkspaceFileHref("/workspace")).toBeNull();
  });
});
