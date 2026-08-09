import { describe, expect, it } from "vitest";
import { fileRequestMatchesSession, fileSidebarScopeKey } from "../components/files/fileSidebarScope";

describe("Files sidebar session scope (#403)", () => {
  it("changes instance identity across sessions and new-chat drafts", () => {
    expect(fileSidebarScopeKey("session-a")).toBe("session-a");
    expect(fileSidebarScopeKey("session-b")).toBe("session-b");
    expect(fileSidebarScopeKey(null)).toBe("draft");
    expect(fileSidebarScopeKey("session-a")).not.toBe(fileSidebarScopeKey(null));
  });

  it("rejects a linked-file request issued by another session", () => {
    expect(fileRequestMatchesSession("session-a", "session-a")).toBe(true);
    expect(fileRequestMatchesSession("session-a", "session-b")).toBe(false);
    expect(fileRequestMatchesSession("session-a", null)).toBe(false);
  });
});
