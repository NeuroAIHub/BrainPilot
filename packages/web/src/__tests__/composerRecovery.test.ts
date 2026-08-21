import { describe, expect, it } from "vitest";

import { AttachmentStore } from "../components/chat/attachmentScopes";
import { recoverFailedSubmission } from "../components/chat/composerRecovery";
import { DraftStore } from "../contexts/draftStore";

describe("composer failed-send recovery", () => {
  it("restores a failed first send into the newly-created session scope", () => {
    const drafts = new DraftStore(null);
    const attachments = new AttachmentStore(null);

    const recoveryScope = recoverFailedSubmission({
      submittedScopeId: "__draft__",
      resultSessionId: "session-created-before-post-failed",
      content: "retry this prompt",
      attachmentNames: ["paper.pdf"],
      drafts,
      attachments,
    });

    expect(recoveryScope).toBe("session-created-before-post-failed");
    expect(drafts.get("session-created-before-post-failed")).toBe("retry this prompt");
    expect(attachments.get("session-created-before-post-failed")).toEqual(["paper.pdf"]);
    expect(drafts.get("__draft__")).toBe("");
    expect(attachments.get("__draft__")).toEqual([]);
  });
});
