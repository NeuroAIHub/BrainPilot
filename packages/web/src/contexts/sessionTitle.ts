const ATTACHMENT_NOTICE = /^\[(?:Conversation attachments[^\]]*|本次对话附件[^\]]*)\]\s*/iu;

/** Derive a sidebar title from user-authored text, not transport metadata. */
export function deriveSessionTitle(content: string, maxLength = 48): string {
  const trimmed = content.trim();
  const userText = trimmed.replace(ATTACHMENT_NOTICE, "").trim();
  return (userText || trimmed).slice(0, maxLength);
}
