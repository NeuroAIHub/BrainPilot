/**
 * agent-error.ts — normalize raw agent/SDK error messages before they reach
 * the user-facing event stream and events.jsonl (issues #45, #97).
 *
 * Three jobs:
 *  1. Recognize the "no provider / no API key" case and replace the raw Pi SDK
 *     guidance (which points at `/login` and absolute node_modules doc paths)
 *     with a product-level message that points at BrainPilot's own Settings →
 *     Providers flow.
 *  2. Recognize a provider HTTP error (e.g. `401 {"error":{...}}`) and split it
 *     into a concise, localized headline (`message`) and the full raw blob
 *     (`details`), so the chat bubble shows a short line and tucks the provider
 *     internals / request id behind an expandable section instead of dumping
 *     escaped JSON into the primary transcript (#97).
 *  3. Redact local filesystem leakage (absolute node_modules paths, `/login`
 *     hints) from any other error, so we never persist or display internal
 *     install paths.
 *
 * Language follows the existing runtime system_message convention (Chinese) for
 * the BrainPilot-authored shell; the provider's own error text is preserved
 * verbatim (we don't translate third-party messages — that loses fidelity).
 */

/** Normalized error: a short headline plus optional expandable raw detail. */
export interface NormalizedAgentError {
  /** Concise, user-facing headline (chat bubble body). */
  message: string;
  /** Full raw error for the expandable "details" section, when worth keeping. */
  details?: string;
}

/** Product-level recovery message for a missing provider/key. */
const NO_PROVIDER_MESSAGE =
  "未配置任何 provider。请打开 设置 → Providers 添加一个 provider。";

/** Heuristics for the "no key / no provider configured" class of error. */
function isNoProviderError(raw: string): boolean {
  return /no api key|no provider|api key found|api key for the selected model/i.test(
    raw,
  );
}

/**
 * Detect a provider HTTP error and build a concise headline + raw details.
 *
 * Real shape (observed in #97):
 *   `401 {"error":{"message":"invalid api key (request id: ...)", ...}}`
 * i.e. a leading HTTP status code followed by a JSON body. We extract the
 * status code and, when possible, the provider's own `error.message`, and keep
 * the entire original blob as `details` so the request id stays available
 * behind the expandable section.
 *
 * Returns undefined when the string doesn't look like a provider HTTP error,
 * so the caller falls through to plain redaction.
 */
function parseProviderError(raw: string): NormalizedAgentError | undefined {
  // Observed shape is always `<status> {json}` — require BOTH a 4xx/5xx code
  // and a JSON body, so a plain message that happens to contain a 3-digit
  // number ("retry in 500ms") is NOT misclassified as a provider error.
  if (!raw.includes("{")) return undefined;
  const m = raw.match(/\b(4\d{2}|5\d{2})\b/);
  if (!m) return undefined;
  const status = m[1];

  let providerMsg = extractProviderMessage(raw);
  // Guard against echoing the whole blob back as the "message" — if the
  // extracted text still looks like a JSON dump, drop it and keep only the code.
  if (providerMsg && /[{}]/.test(providerMsg)) providerMsg = undefined;

  const headline = providerMsg
    ? `provider 拒绝请求 (${status}): ${providerMsg}`
    : `provider 拒绝请求 (HTTP ${status})。详情见下方展开。`;

  return { message: headline, details: raw.trim() };
}

/**
 * Best-effort pull of the provider's own human-readable message out of an
 * error blob. Tries to JSON.parse a `{...}` substring and read common shapes
 * (`error.message`, `message`, `error` as string); falls back to undefined.
 */
function extractProviderMessage(raw: string): string | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as unknown;
    const msg = pickMessage(obj);
    return msg?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function pickMessage(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  if (typeof o.message === "string") return o.message;
  const err = o.error;
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
  }
  return undefined;
}

/**
 * Strip local-path / `/login` leakage from an arbitrary error string while
 * keeping its semantic content. Best-effort — drops lines that are purely an
 * absolute node_modules doc path or a `/login` hint, and scrubs any inline
 * absolute path that reaches into node_modules.
 */
function redact(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      if (/use \/login/i.test(t)) return false;
      // A line that is just an absolute path into node_modules (doc pointer).
      if (/^\/?\S*node_modules\/\S+$/.test(t)) return false;
      return true;
    })
    .map((line) =>
      // Scrub any remaining inline absolute node_modules path.
      line.replace(/\/\S*node_modules\/\S+/g, "").trimEnd(),
    )
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Normalize a raw agent error message for user display + persistence.
 * - No-provider/no-key errors → a product-level Settings → Providers message.
 * - Provider HTTP errors (`401 {...}`) → concise headline + raw blob in details.
 * - Everything else → the original message with local paths / `/login` redacted.
 */
export function normalizeAgentError(raw: string): NormalizedAgentError {
  if (!raw) return { message: raw };
  if (isNoProviderError(raw)) return { message: NO_PROVIDER_MESSAGE };
  const provider = parseProviderError(raw);
  if (provider) return provider;
  return { message: redact(raw) };
}
