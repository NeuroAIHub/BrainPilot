import { describe, expect, it } from "vitest";
import { getSettingsTabs } from "../components/settings/SettingsDialog";

const ids = (localMode: boolean, knowledgeBaseSettingsEnabled: boolean) =>
  getSettingsTabs({ localMode, knowledgeBaseSettingsEnabled }).map((tab) => tab.id);

describe("Settings tabs — deployment capabilities", () => {
  it("shows knowledge-base management by default", () => {
    expect(ids(true, true)).toContain("knowledgeBase");
  });

  it("hides knowledge-base management when the build flag is disabled", () => {
    expect(ids(false, false)).not.toContain("knowledgeBase");
  });

  it("keeps account and knowledge-base visibility independent", () => {
    expect(ids(true, false)).not.toContain("account");
    expect(ids(true, false)).not.toContain("knowledgeBase");
    expect(ids(false, true)).toContain("account");
    expect(ids(false, true)).toContain("knowledgeBase");
  });
});
