/**
 * Clipboard write with explicit success / failure (#329).
 * Never reports success when the write did not complete.
 */

export type CopyFailureReason = "denied" | "unavailable" | "failed";

export type CopyResult =
  | { ok: true }
  | { ok: false; reason: CopyFailureReason };

export type CopyToClipboardDeps = {
  /** Defaults to `navigator.clipboard` when available. */
  clipboard?: Pick<Clipboard, "writeText"> | null;
  /** Defaults to `window.isSecureContext`. */
  isSecureContext?: boolean;
  /**
   * Legacy fallback. Defaults to a textarea + `document.execCommand("copy")`.
   * Inject in tests to force success/failure without DOM.
   */
  legacyCopy?: (text: string) => boolean | Promise<boolean>;
};

function isPermissionDenied(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  return name === "NotAllowedError" || name === "SecurityError";
}

function defaultLegacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.padding = "0";
  textarea.style.border = "none";
  textarea.style.outline = "none";
  textarea.style.boxShadow = "none";
  textarea.style.background = "transparent";
  textarea.setAttribute("readonly", "");
  document.body.appendChild(textarea);
  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
}

/**
 * Copy plain text to the system clipboard.
 * Prefer the async Clipboard API in secure contexts; fall back to execCommand.
 */
export async function copyTextToClipboard(
  text: string,
  deps: CopyToClipboardDeps = {},
): Promise<CopyResult> {
  const isSecure =
    deps.isSecureContext ??
    (typeof window !== "undefined" ? window.isSecureContext : false);

  const clipboard =
    deps.clipboard !== undefined
      ? deps.clipboard
      : typeof navigator !== "undefined" && navigator.clipboard
        ? navigator.clipboard
        : null;

  if (clipboard && isSecure) {
    try {
      await clipboard.writeText(text);
      return { ok: true };
    } catch (err) {
      if (isPermissionDenied(err)) {
        return { ok: false, reason: "denied" };
      }
      // Fall through to legacy path for other failures (e.g. transient errors).
    }
  }

  if (!clipboard && !isSecure) {
    // Common plain-http deployment: Clipboard API unavailable.
    // Still try legacy; if that fails, report unavailable.
  } else if (!clipboard) {
    // Secure context but no clipboard object — treat as unavailable after legacy.
  }

  const legacy = deps.legacyCopy ?? defaultLegacyCopy;
  try {
    const succeeded = await legacy(text);
    if (succeeded) return { ok: true };
    return {
      ok: false,
      reason: clipboard ? "failed" : "unavailable",
    };
  } catch {
    return { ok: false, reason: clipboard ? "failed" : "unavailable" };
  }
}

/** i18n key for a failure reason. */
export function copyFailureMessageKey(
  reason: CopyFailureReason,
):
  | "chat.copyDenied"
  | "chat.copyUnavailable"
  | "chat.copyFailed" {
  if (reason === "denied") return "chat.copyDenied";
  if (reason === "unavailable") return "chat.copyUnavailable";
  return "chat.copyFailed";
}
