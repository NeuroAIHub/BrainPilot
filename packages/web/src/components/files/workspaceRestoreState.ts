/**
 * A File preview restore badge is a present-tense claim about loaded bytes.
 * Keep it only while the restore remains the latest transcript event, the
 * restored bytes were actually reloaded, and the user has not edited them.
 */
export function restoreNoticeIsCurrent(input: {
  restoreMessageIndex: number;
  messageCount: number;
  isDirty: boolean;
  successfullyReloaded: boolean;
}): boolean {
  return (
    input.successfullyReloaded
    && !input.isDirty
    && input.restoreMessageIndex === input.messageCount - 1
  );
}
