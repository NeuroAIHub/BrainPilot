/** BrainPilot's provider-retry policy layered onto the pinned Pi SDK. */

/** Five retries after the initial provider attempt. */
export const PROVIDER_MAX_RETRIES = 5;
/** Produces bounded waits of 2s, 4s, 8s, 16s, then 32s. */
export const PROVIDER_RETRY_BASE_DELAY_MS = 2_000;

interface PiErrorMessage {
  stopReason?: string;
  errorMessage?: string;
}

interface PiRetryClassifierHost {
  _isRetryableError?: (message: PiErrorMessage) => boolean;
}

/**
 * The production gateway sometimes returns a generic HTTP 400 that is
 * transient: the same request succeeds moments later. Keep this deliberately
 * narrow so concrete validation failures (invalid model/field/body) still fail
 * immediately.
 */
export function isTransientInvalidRequest400(raw: string): boolean {
  const normalized = raw.replace(/\\"/g, '"');
  if (!/\b400\b/.test(normalized)) return false;
  if (!/\binvalid_request_error\b/i.test(normalized)) return false;
  if (!/invalid request error\s+trace[_ -]?id\s*[:=]?\s*[a-z0-9-]+/i.test(normalized)) {
    return false;
  }

  // An explicit field/code makes this a deterministic validation error. Empty
  // or null metadata is the generic transient shape observed in production.
  const param = normalized.match(/"param"\s*:\s*(null|"[^"]*")/i)?.[1];
  if (param && param !== "null" && param !== '""') return false;
  const code = normalized.match(/"code"\s*:\s*(null|"[^"]*")/i)?.[1];
  if (code && code !== "null" && code !== '""') return false;
  return true;
}

/**
 * Extend Pi's per-turn retry classifier without rewriting the prompt or
 * replaying a completed turn. Pi then owns removing the failed assistant
 * message, abortable exponential backoff, and continuing the same LLM turn,
 * which avoids duplicate user bubbles and side-effectful tool calls.
 *
 * Pi 0.84.x does not expose a public classifier hook, so this compatibility
 * shim wraps its instance method. The dependency is exact-pinned; fail loudly
 * on API drift instead of silently dropping the P0 recovery path.
 */
export function installBrainPilotRetryClassifier(session: unknown): void {
  const target = session as PiRetryClassifierHost;
  const original = target._isRetryableError;
  if (typeof original !== "function") {
    throw new Error(
      "Installed Pi SDK does not expose _isRetryableError; update the BrainPilot retry compatibility shim.",
    );
  }

  target._isRetryableError = function classifyWithBrainPilotPolicy(message): boolean {
    return (
      original.call(this, message) ||
      (message.stopReason === "error" &&
        isTransientInvalidRequest400(message.errorMessage ?? ""))
    );
  };
}
