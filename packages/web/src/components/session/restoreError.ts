type Translate = (key: string, params?: Record<string, string | number>) => string;

export function restoreErrorMessage(reason: unknown, t: Translate): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const code = reason && typeof reason === "object" && typeof (reason as { code?: unknown }).code === "string"
    ? (reason as { code: string }).code
    : undefined;
  if (code === "STALE_WORKSPACE") return t("trace.checkpoint.staleGuidance");
  if (code === "SESSION_ACTIVE") return t("trace.checkpoint.activeGuidance");
  if (code === "CAUSAL_CONFLICT") return t("trace.checkpoint.conflictGuidance");
  if (code === "WORKSPACE_RECOVERY_FAILED") return t("trace.checkpoint.recoveryFailedGuidance");
  const normalized = message.toLowerCase();
  if (normalized.includes("workspace changed") || normalized.includes("stale_workspace")) {
    return t("trace.checkpoint.staleGuidance");
  }
  if (
    normalized.includes("session_active")
    || normalized.includes("while a task is running")
    || normalized.includes("while an agent is active")
  ) {
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
