type Translate = (key: string, params?: Record<string, string | number>) => string;

export function restoreErrorMessage(reason: unknown, t: Translate): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const normalized = message.toLowerCase();
  if (normalized.includes("workspace changed") || normalized.includes("stale_workspace")) {
    return t("trace.checkpoint.staleGuidance");
  }
  if (normalized.includes("session_active") || normalized.includes("while a task is running")) {
    return t("trace.checkpoint.activeGuidance");
  }
  if (normalized.includes("file conflicts") || normalized.includes("causal_conflict")) {
    return t("trace.checkpoint.conflictGuidance");
  }
  if (normalized.includes("automatic recovery failed") || normalized.includes("workspace_recovery_failed")) {
    return t("trace.checkpoint.recoveryFailedGuidance");
  }
  return t("trace.checkpoint.restoreFailed", { message });
}
