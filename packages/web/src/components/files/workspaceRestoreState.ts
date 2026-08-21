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

/**
 * A restore stays pending until an affected preview is actually available to
 * reload. In particular, a closed sidebar must not consume the restore event.
 */
export function shouldReloadRestorePreview(input: {
  isOpen: boolean;
  sandboxReady: boolean;
  hasSelectedFile: boolean;
  selectedFileAffected: boolean;
  isDirty: boolean;
  restoreIsLatest: boolean;
  alreadyReloaded: boolean;
}): boolean {
  return (
    input.isOpen
    && input.sandboxReady
    && input.hasSelectedFile
    && input.selectedFileAffected
    && !input.isDirty
    && input.restoreIsLatest
    && !input.alreadyReloaded
  );
}

/** Same path, different restore generation must trigger a fresh byte load. */
export function restorePreviewLoadKey(path: string, restoreRequestKey?: string): string {
  return JSON.stringify([path, restoreRequestKey ?? null]);
}
