import { describe, expect, it } from "vitest";
import {
  buildWorkspaceFileDeepLink,
  parseWorkspaceFileHref,
  parseWorkspaceFileLocation,
  resolveWorkspaceFileSession,
  shouldResetWorkspaceFileLocation,
} from "../components/chat/workspaceFileLink";

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

describe("workspace file deep links", () => {
  it("builds and parses a session-aware URL that survives copying", () => {
    const href = buildWorkspaceFileDeepLink("session / 中文", {
      path: "/workspace/docs/研究 report.md",
      line: 17,
    });

    expect(href).toBe(
      "/sessions/session%20%2F%20%E4%B8%AD%E6%96%87/files?path=%2Fworkspace%2Fdocs%2F%E7%A0%94%E7%A9%B6%20report.md#L17",
    );
    expect(parseWorkspaceFileHref(href)).toEqual({
      path: "/workspace/docs/研究 report.md",
      line: 17,
    });
    expect(
      parseWorkspaceFileLocation({
        pathname: "/sessions/session%20%2F%20%E4%B8%AD%E6%96%87/files",
        search: "?path=%2Fworkspace%2Fdocs%2F%E7%A0%94%E7%A9%B6%20report.md",
        hash: "#L17",
      }),
    ).toEqual({
      sessionId: "session / 中文",
      path: "/workspace/docs/研究 report.md",
      line: 17,
    });
  });

  it("treats a legacy naked file URL as a workspace path", () => {
    expect(
      parseWorkspaceFileLocation({
        pathname: "/docs/reports/data-inventory.md",
        search: "",
        hash: "#L4",
      }),
    ).toEqual({ path: "/workspace/docs/reports/data-inventory.md", line: 4 });
  });

  it("normalizes Windows separators into portable virtual paths", () => {
    const target = parseWorkspaceFileHref("docs\\reports\\data inventory.md");
    expect(target).toEqual({ path: "/workspace/docs/reports/data inventory.md" });
    expect(buildWorkspaceFileDeepLink("session-a", target!)).toBe(
      "/sessions/session-a/files?path=%2Fworkspace%2Fdocs%2Freports%2Fdata%20inventory.md",
    );
  });

  it("does not mistake application routes or traversal for legacy files", () => {
    for (const pathname of [
      "/app",
      "/account/login",
      "/demos/example",
      "/bench",
      "/feedback",
      "/api/sessions",
      "/assets/index.js",
      "/sessions/abc/files",
      "/../etc/passwd",
    ]) {
      expect(parseWorkspaceFileLocation({ pathname, search: "", hash: "" })).toBeNull();
    }
  });

  it("clears an old Files route after switching conversation but preserves initial deep links", () => {
    const location = { pathname: "/sessions/old/files", search: "?path=%2Fworkspace%2Freport.md", hash: "" };
    expect(shouldResetWorkspaceFileLocation({
      location,
      previousSessionId: "old",
      nextSessionId: null,
      hasInitialTarget: true,
      initialTargetHandled: true,
    })).toBe(true);
    expect(shouldResetWorkspaceFileLocation({
      location,
      previousSessionId: null,
      nextSessionId: "old",
      hasInitialTarget: true,
      initialTargetHandled: false,
    })).toBe(false);
    expect(shouldResetWorkspaceFileLocation({
      location: { pathname: "/app", search: "", hash: "" },
      previousSessionId: "old",
      nextSessionId: "new",
      hasInitialTarget: false,
      initialTargetHandled: false,
    })).toBe(false);
  });

  it("honors canonical session ownership and resolves legacy URLs against the active session", () => {
    expect(
      resolveWorkspaceFileSession(
        { sessionId: "session-b", path: "/workspace/docs/report.md" },
        ["session-a", "session-b"],
        "session-a",
      ),
    ).toEqual({ sessionId: "session-b", path: "/workspace/docs/report.md" });
    expect(
      resolveWorkspaceFileSession(
        { path: "/workspace/docs/report.md" },
        ["session-a", "session-b"],
        "session-a",
      ),
    ).toEqual({ sessionId: "session-a", path: "/workspace/docs/report.md" });
    expect(
      resolveWorkspaceFileSession(
        { sessionId: "deleted", path: "/workspace/docs/report.md" },
        ["session-a"],
        "session-a",
      ),
    ).toBeNull();
  });
});
