import { describe, expect, it } from "vitest";
import { fileSidebarScopeKey } from "../components/files/fileSidebarScope";

describe("Files sidebar session scope (#403)", () => {
  it("changes instance identity across sessions and new-chat drafts", () => {
    expect(fileSidebarScopeKey("session-a")).toBe("session-a");
    expect(fileSidebarScopeKey("session-b")).toBe("session-b");
    expect(fileSidebarScopeKey(null)).toBe("draft");
    expect(fileSidebarScopeKey("session-a")).not.toBe(fileSidebarScopeKey(null));
  });
});
