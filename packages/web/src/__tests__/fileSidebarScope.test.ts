import { describe, expect, it } from "vitest";
import {
  fileRequestForScope,
  fileSidebarScopeKey,
} from "../components/files/fileSidebarScope";

describe("Files sidebar session scope (#403)", () => {
  it("changes instance identity across sessions and new-chat drafts", () => {
    expect(fileSidebarScopeKey("session-a")).toBe("session-a");
    expect(fileSidebarScopeKey("session-b")).toBe("session-b");
    expect(fileSidebarScopeKey(null)).toBe("draft");
    expect(fileSidebarScopeKey("session-a")).not.toBe(fileSidebarScopeKey(null));
  });

  it("does not replay a linked-file request in another session", () => {
    const request = { path: "/workspace/report.md", requestId: 1, scopeKey: "session-a" };
    expect(fileRequestForScope(request, "session-a")).toBe(request);
    expect(fileRequestForScope(request, "session-b")).toBeNull();
  });
});
