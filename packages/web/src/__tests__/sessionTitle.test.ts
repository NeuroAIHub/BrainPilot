import { describe, expect, it } from "vitest";
import { deriveSessionTitle } from "../contexts/sessionTitle";

describe("deriveSessionTitle (#468)", () => {
  it("uses visible user text after the English attachment notice", () => {
    expect(deriveSessionTitle(
      "[Conversation attachments (in the .attachments/ directory): report.csv]\n\n" +
      "Compare the two cohorts",
    )).toBe("Compare the two cohorts");
  });

  it("uses visible user text after the Chinese attachment notice", () => {
    expect(deriveSessionTitle(
      "[本次对话附件（位于 .attachments/ 目录）：脑电数据.csv]\n\n请比较两组受试者",
    )).toBe("请比较两组受试者");
  });

  it("keeps ordinary prompts and the existing length bound", () => {
    expect(deriveSessionTitle("  hello world  ")).toBe("hello world");
    expect(deriveSessionTitle("x".repeat(60))).toBe("x".repeat(48));
  });
});
