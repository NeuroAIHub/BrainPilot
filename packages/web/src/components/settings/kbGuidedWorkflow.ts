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
