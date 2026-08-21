export type KbGuideStepState = "complete" | "active" | "pending" | "error";
export type KbGuideAction = "upload" | "setup" | "build" | "ready";

export interface KbGuidedState {
  action: KbGuideAction;
  steps: {
    files: KbGuideStepState;
    preparing: KbGuideStepState;
    ready: KbGuideStepState;
    error: KbGuideStepState;
  };
}

export type KbPdfUploadRecovery = "choose" | "retry";

export function kbPdfUploadErrorKey(code?: string): string {
  switch (code) {
    case "KB_PDF_INVALID_FILENAME": return "settings.kb.guide.upload.invalidFilename";
    case "KB_PDF_ONLY": return "settings.kb.guide.upload.onlyPdf";
    case "KB_PDF_EMPTY": return "settings.kb.guide.upload.empty";
    case "KB_PDF_TOO_LARGE": return "settings.kb.guide.upload.tooLarge";
    case "KB_PDF_INVALID_CONTENT": return "settings.kb.guide.upload.invalidContent";
    case "KB_PDF_ALREADY_EXISTS": return "settings.kb.guide.upload.alreadyExists";
    default: return "settings.kb.guide.upload.failed";
  }
}

/** Invalid/conflicting files need a new selection; transient failures can retry bytes. */
export function kbPdfUploadRecovery(code?: string): KbPdfUploadRecovery {
  return code?.startsWith("KB_PDF_") ? "choose" : "retry";
}

export function kbSetupEventNeedsProbe(event: { stage: string; event: string }): boolean {
  return (event.stage === "setup-models" || event.stage === "setup-full")
    && (event.event === "done" || event.event === "error");
}

/** Product-level KB state: Files → Preparing → Ready, with one error branch. */
export function deriveKbGuidedState(input: {
  pdfCount: number;
  envReady: boolean;
  readyToQuery: boolean;
  busy: boolean;
  hasError: boolean;
}): KbGuidedState {
  const hasFiles = input.pdfCount > 0;
  const action: KbGuideAction = !hasFiles
    ? "upload"
    : !input.envReady
      ? "setup"
      : !input.readyToQuery
        ? "build"
        : "ready";

  return {
    action,
    steps: {
      files: hasFiles ? "complete" : input.hasError ? "error" : "active",
      preparing: input.hasError
        ? "error"
        : input.readyToQuery
          ? "complete"
          : hasFiles
            ? "active"
            : "pending",
      ready: input.readyToQuery ? "complete" : "pending",
      error: input.hasError ? "active" : "pending",
    },
  };
}
