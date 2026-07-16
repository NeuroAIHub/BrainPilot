/**
 * Pure helpers for conversation rename/delete UI state (#325).
 *
 * Keeps commit/cancel rules out of the React tree so keyboard and a11y
 * behavior can be unit-tested without jsdom.
 */

/** Whether Save may commit a rename. Empty and unchanged titles cannot save. */
export function canCommitRename(originalTitle: string, draftTitle: string): boolean {
  const trimmed = draftTitle.trim();
  if (!trimmed) return false;
  return trimmed !== originalTitle.trim();
}

export type RenameValidation = "ok" | "empty" | "unchanged";

export function renameValidation(
  originalTitle: string,
  draftTitle: string,
): RenameValidation {
  const trimmed = draftTitle.trim();
  if (!trimmed) return "empty";
  if (trimmed === originalTitle.trim()) return "unchanged";
  return "ok";
}

/** i18n key for inline rename validation feedback (null when ok). */
export function renameValidationKey(
  status: RenameValidation,
): "sidebar.rename.validation.empty" | "sidebar.rename.validation.unchanged" | null {
  if (status === "empty") return "sidebar.rename.validation.empty";
  if (status === "unchanged") return "sidebar.rename.validation.unchanged";
  return null;
}

/**
 * Handle Escape in rename or delete-confirm: always cancels without mutating.
 */
export function isCancelKey(key: string): boolean {
  return key === "Escape" || key === "Esc";
}
