/**
 * Which lines the composer footer shows below the input.
 *
 * The footer used to render, independently: the raw session error, whichever of
 * the composer/staging errors happened to be set, and — whenever `canSend` was
 * false — a generic "start the sandbox / connecting / preparing" hint. With a
 * failing local backend all three appeared at once and contradicted each other,
 * while a genuine attachment-staging failure could be masked by an unrelated
 * upload error.
 *
 * The rules here are deliberately narrow:
 *  - every genuine error stays inspectable (run/fatal, composer operation,
 *    attachment staging), only *identical* texts are deduplicated;
 *  - the blocked-send hint is emitted at most once, and never when a specific
 *    actionable error already names the blocker;
 *  - "this model is unavailable" is specific and actionable, so it survives.
 *
 * Pure and i18n-free (hints are returned as message keys) so it is unit-testable
 * in this package's `node` vitest env.
 */

export type ComposerStatusHintKey =
  | "chat.status.modelUnavailable"
  | "chat.status.startSandbox"
  | "chat.status.preparing"
  | "chat.status.connecting";

export type ComposerStatusLine =
  | { id: string; tone: "error"; text: string }
  | { id: string; tone: "hint"; messageKey: ComposerStatusHintKey };

export interface ComposerStatusInput {
  /** Session/run error from SessionContext (run failures, fatal errors, Stop). */
  runError?: string | null;
  /** Composer operation error: model save, upload, attachment removal. */
  operationError?: string | null;
  /** Attachment staging error — a distinct failure, kept alongside the above. */
  stagingError?: string | null;
  /** The provider load/refresh notice is already explaining the block. */
  providerLoadFailed?: boolean;
  /**
   * The "pick a model" / "add a provider" notice is already explaining the
   * block. A generic "connecting…" underneath it only muddies the instruction.
   */
  providerSelectionMissing?: boolean;
  /**
   * The scoped history-load notice (with its own retry) already explains why
   * this conversation cannot be used yet.
   */
  historyLoadFailed?: boolean;
  canSend: boolean;
  draftModelUnavailable: boolean;
  sandboxRunning: boolean;
  isConnected: boolean;
}

export function resolveComposerStatus(input: ComposerStatusInput): ComposerStatusLine[] {
  const lines: ComposerStatusLine[] = [];
  const seen = new Set<string>();
  const pushError = (id: string, value: string | null | undefined) => {
    const text = value?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push({ id, tone: "error", text });
  };
  pushError("run", input.runError);
  pushError("operation", input.operationError);
  pushError("staging", input.stagingError);

  if (input.canSend) return lines;
  if (input.draftModelUnavailable) {
    lines.push({ id: "blocked", tone: "hint", messageKey: "chat.status.modelUnavailable" });
    return lines;
  }
  // A specific actionable error or notice already names why this send is
  // blocked; adding "connecting…"/"start the sandbox" on top only contradicts
  // it. Genuine run/staging errors above are untouched by these suppressions.
  if (
    lines.length > 0
    || input.providerLoadFailed
    || input.providerSelectionMissing
    || input.historyLoadFailed
  ) {
    return lines;
  }
  lines.push({
    id: "blocked",
    tone: "hint",
    messageKey: !input.sandboxRunning
      ? "chat.status.startSandbox"
      : input.isConnected
        ? "chat.status.preparing"
        : "chat.status.connecting",
  });
  return lines;
}

/** Keep technical payloads inspectable without dumping them into the main input area. */
export function isTechnicalComposerError(text: string): boolean {
  return text.length > 240 || /<!doctype|<html\b|<body\b|\n\s*at\s+|^\s*[\[{]/i.test(text)
    || /^(failed to fetch|networkerror|internal server error|request failed\s*\()/i.test(text.trim());
}
export function composerErrorSummaryKey(id: string): string {
  return id === "staging" ? "chat.status.attachmentFailed" : id === "operation" ? "chat.status.operationFailed" : "chat.status.requestFailed";
}
