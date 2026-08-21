import type { DraftStore } from "../../contexts/draftStore";
import type { AttachmentStore } from "./attachmentScopes";

export function recoverFailedSubmission({
  submittedScopeId,
  resultSessionId,
  content,
  attachmentNames,
  drafts,
  attachments,
}: {
  submittedScopeId: string;
  resultSessionId?: string;
  content: string;
  attachmentNames: readonly string[];
  drafts: Pick<DraftStore, "get" | "set">;
  attachments: Pick<AttachmentStore, "restoreIfEmpty">;
}): string {
  const recoveryScope = resultSessionId ?? submittedScopeId;
  if (drafts.get(recoveryScope).trim().length === 0) {
    drafts.set(recoveryScope, content);
  }
  if (attachmentNames.length > 0) {
    attachments.restoreIfEmpty(recoveryScope, attachmentNames);
  }
  return recoveryScope;
}
